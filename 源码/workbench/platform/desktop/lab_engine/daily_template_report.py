"""Daily people and rate worksheets for the native reason-grouped report."""

from collections import defaultdict
from datetime import date, datetime, timedelta
import re

from . import analysis, grouping_semantics, manual_production, original_report, shift_calendar, store, tabular


DEFAULT_TITLE = '装管失效人员'
CUTOVER = timedelta(hours=7)


def default_rate_keywords():
    rules = [('物料穿错', [reason]) for reason in ('穿错物料', '物料穿反', '物料少穿', '多穿')]
    rules.extend((product + reason, [product, reason])
                 for reason, products in (('并纤反', ('MPO', 'MMC')), ('装管反', ('MPO', 'MMC', 'LCD')))
                 for product in products)
    rules.extend((product + '插芯内断纤', [product, '插芯', '断纤']) for product in ('MPO', 'MMC', 'LCD'))
    rules.extend((product + '纤缩/无纤', [product, reason])
                 for product in ('MPO', 'MMC', 'LCD') for reason in ('纤缩', '无纤'))
    rules.extend((product + ' PIN孔堵', [product, 'PIN孔堵']) for product in ('MPO', 'MMC'))
    return [{'label': label, 'keywords': words} for label, words in rules]


def decision_day(row, column, fmt):
    value = row['values'].get(column) if column else None
    # Excel datetime serials without a fraction may represent exactly midnight;
    # a bare text date has no explicit timestamp and is not substituted here.
    try:
        if isinstance(value, (int, float)) and not isinstance(value, bool) and 1 <= value < 100000:
            return (datetime(1899, 12, 30) + timedelta(days=value) - CUTOVER).date().isoformat()
        moment = shift_calendar.clock(value, fmt)
        return (moment - CUTOVER).date().isoformat() if moment is not None else None
    except (ValueError, TypeError, OverflowError):
        return None


def valid_export_row(row, sn_col):
    return not sn_col or bool(tabular.display(row['values'].get(sn_col)))


def groups_for_daily(rows, reason_col, settings, daily_group_hints=()):
    # The supplied daily worksheet intentionally covers four failure families.
    # Retain that population when it intersects the current result, while using
    # saved user groups to name/organize it. New-only reasons retain all rows.
    groups = settings.get('reasonGroups') or daily_group_hints or None
    wanted = {code for group in daily_group_hints for code in group['reasons']}
    scope = [row for row in rows if tabular.display(row['values'].get(reason_col)) in wanted]
    return scope or rows, groups


def counted_input(row, column):
    """Match the reference pivot's COUNT of nonempty original 数量 cells."""
    return None if not column else int(row['values'].get(column) not in (None, ''))


def keyword_totals(items, reason_col, quantity_col, rules):
    buckets = defaultdict(list)
    for rule in rules:
        buckets[rule['label']].append(tuple(key.casefold() for key in rule['keywords']))
    quantity = 0 if quantity_col else None
    relative = {label: 0 if quantity_col else None for label in buckets}
    for row in items:
        reason = tabular.display(row['values'].get(reason_col)).casefold()
        count = counted_input(row, quantity_col)
        if count is None:
            continue
        quantity += count
        for label, choices in buckets.items():
            if any(all(word in reason for word in words) for words in choices):
                relative[label] += count
    return quantity, relative


def usable_denominators(db, source, sources, settings, query, available, matched, span):
    """Use verified date/process/shift matches, never a partial raw total."""
    if not settings.get('includeRate') or not span:
        return {}
    typed = None
    if settings.get('productionMode') == 'manual':
        typed = manual_production.rows(settings.get('manualProduction', []))
        production = manual_production.SOURCE if typed else None
    else:
        production = sources.get(settings.get('productionId'))
        if not production or production.get('kind') != 'production' or not production.get('confirmed'):
            production = None
    if not production:
        return {}
    source = {**source, '_grouping': grouping_semantics.from_db(db, source)}
    scope = {**query, 'filters': [
        rule for rule in query.get('filters', [])
        if not (rule['field'] == source['mapping'].get('date') or analysis.role(rule['field'], source) in {'date', 'week', 'month'})
    ]}
    # The A3 population uses the original 数量 cell. Automatic matching requires
    # the source's confirmed 件数 plus a matching denominator for that same day.
    context = analysis.rate_context(db, source, production, scope, available, span,
                                    settings.get('rateBasis', 'same-scope'), manual_rows=typed)
    # Original index-date completeness does not prove completeness after a new
    # judgment 07:00 cut. Require an actually observed cohort in that same scope.
    observed = {manual_production.key(row) for row in available}
    context['complete'] = {manual_production.key(row) for row in context['production']
                           if manual_production.key(row) in observed}
    denominators = {}
    by_day = defaultdict(list)
    for row in context['production']:
        by_day[row['date']].append(row)
    for day, rows in matched.items():
        required = {cohort for cohort in context['manualRequired'] if cohort[0] == day} if typed is not None else None
        # Explicit per-day matching also prevents a 07:00/00:00 mismatch from
        # borrowing a denominator from a different business date.
        result = analysis.compute_rate(rows, {**context, 'production': by_day[day]}, required=required)
        denominators[day] = (result['denominator'] if result['value'] is not None else None, result['reason'])
    return denominators


def judgment_candidates(db, source, span, base, time_col):
    calendar = source.get('calendar', {})
    # A different mapped date may be many days away from the judgment, so only
    # a verified judgment-date index can safely restrict the database window.
    same_clock = (calendar.get('mode') != 'check-time' or calendar.get('dateBasis') == 'mapped'
                  or calendar.get('timeColumn') == time_col)
    if time_col and source['mapping'].get('date') == time_col and same_clock:
        start = (date.fromisoformat(span[0]) - timedelta(days=1)).isoformat()
        end = (date.fromisoformat(span[1]) + timedelta(days=1)).isoformat()
        loaded = store.load_rows(db, source, start, end)
    else:
        loaded = store.load_rows(db, source)
    # Both base and padding can contain a row, and the storage cache returns
    # caller-visible snapshots. Deduplicate by permanent row identity.
    return list({row['id']: row for row in [*base, *loaded]}.values())


def prepare(db, source, sources, query, settings, span, base, template_map, daily_group_hints):
    columns = original_report.resolve_columns(source, template_map)
    time_col, reason_col, sn_col = (columns.get(key) for key in ('判定时间', '判定原因', '容器号'))
    fmt = source.get('dateFormat', 'auto')
    rules = settings.get('rateKeywords') or default_rate_keywords()
    if span is None:
        return None, '', None, None
    # Auxiliary sheets alone use the requested fixed judgment 07:00 boundary.
    # The caller keeps the existing query's main-table rows unchanged.
    padded = judgment_candidates(db, source, span, base, time_col)
    scope = {**query, 'filters': [
        rule for rule in query.get('filters', [])
        if not (rule['field'] == time_col or analysis.role(rule['field'], source) in {'date', 'week', 'month'})
    ]}
    opened, matched = defaultdict(list), defaultdict(list)
    dated_rows = []
    for row in analysis.decision_scope(padded, source, scope):
        day = decision_day(row, time_col, fmt)
        if day is None or not span[0] <= day <= span[1] or not valid_export_row(row, sn_col):
            continue
        dated = {**row, 'date': day}
        dated_rows.append(dated)
        opened[day].append(dated)
    for row in analysis.select_rows(dated_rows, source, scope):
        matched[row['date']].append(row)
    date_for_title = max(matched, default=span[1])
    day = date.fromisoformat(date_for_title)
    label = re.sub(r'^\s*(?:\d{4}年)?\d{1,2}月\d{1,2}日\s*', '', settings.get('dailyTitle', '')) or DEFAULT_TITLE
    daily_title = f'{day.month}月{day.day}日{label}'
    daily_rows = matched.get(date_for_title, [])
    daily_rows, daily_groups = groups_for_daily(daily_rows, reason_col, settings, daily_group_hints)
    all_days = []
    day, end = date.fromisoformat(span[0]), date.fromisoformat(span[1])
    while day <= end:
        all_days.append(day.isoformat())
        day += timedelta(days=1)
    # Include a genuine zero when the date has judgment records but no selected
    # reason. Dates with no observed judgment timestamp remain missing.
    for day in opened:
        matched.setdefault(day, [])
    denominators = usable_denominators(db, source, sources, settings, scope,
                                       [row for day_rows in opened.values() for row in day_rows], matched, span)
    days = []
    for day in all_days:
        records = matched.get(day, [])
        quantity, rates = keyword_totals(records, reason_col, columns.get('数量'), rules) if day in opened else (None, {})
        denominator, reason = denominators.get(day, (None, '请填写该业务日实际产量'))
        if denominator is not None and (quantity is None or any(
                counted_input(row, columns.get('数量')) != row['quantity'] for row in records)):
            denominator, reason = None, '日报数量与已确认件数口径不同，请核对后填写产量'
        days.append({'date': day, 'quantity': quantity, 'production': denominator, 'rates': rates, 'rateReason': reason})
    return daily_rows, daily_title, daily_groups, {'days': days, 'rules': rules}
