"""Explicit production-column binding; never infer actual output from a target/rate.

This adapter keeps the ordinary long-table import contract. Repeated, exact
headers are structural rows; incomplete business records still fail the file.
"""

from collections import Counter

FILL_ROLES = ('date', 'process')
FORBIDDEN_KEYS = frozenset(('__proto__', 'constructor', 'prototype'))


def normalize(value=None):
    if value is None:
        value = {}
    if not isinstance(value, dict) or value.get('layout', 'rows') != 'rows':
        raise ValueError('产量绑定目前支持逐行明细表，请选择生产跟踪表。')
    fill = value.get('fillDown', [])
    if not isinstance(fill, list) or any(x not in FILL_ROLES for x in fill):
        raise ValueError('只允许为产量日期和工序设置向下继承。')
    result = {'layout': 'rows', 'fillDown': [x for x in FILL_ROLES if x in fill]}
    result['missingQuantity'] = value.get('missingQuantity', 'reject')
    if result['missingQuantity'] not in ('reject', 'pending'):
        raise ValueError('空白产量处理方式无效。')
    for field in ('processAliases', 'shiftAliases'):
        aliases = value.get(field, {})
        if not isinstance(aliases, dict) or len(aliases) > 200:
            raise ValueError('产量名称对应最多200项。')
        cleaned = {}
        for key, target in aliases.items():
            if not isinstance(key, str) or not isinstance(target, str):
                raise ValueError('产量名称对应必须是文字。')
            key, target = key.strip(), target.strip()
            if not key or not target or len(key) > 160 or len(target) > 160 or key in FORBIDDEN_KEYS:
                raise ValueError('产量名称对应不能为空，且每项最多160字。')
            if key in cleaned:
                raise ValueError('产量名称对应存在重复原值。')
            cleaned[key] = target
        result[field] = cleaned
    return result


def active(value=None):
    binding = normalize(value)
    return bool(binding['fillDown'] or binding['processAliases'] or binding['shiftAliases'] or binding['missingQuantity'] != 'reject')


def repeated_header(raw, source, columns):
    from .tabular import norm
    labels = {column['id']: column['label'] for column in columns}
    fields = [source.get('mapping', {}).get(role) for role in ('date', 'process', 'shift', 'quantity')]
    fields = [field for field in fields if field]
    return len(fields) >= 3 and all(norm(raw.get(field)) == norm(labels.get(field)) for field in fields)


def add_hints(info, rows):
    """Prefer populated duplicate headings, retaining review status and all choices."""
    from .tabular import display, norm, parse_date
    records = [row for row in rows if any(display(x) for x in row)]
    metrics = {}
    for column in info['columns']:
        values = [row[column['index']] if column['index'] < len(row) else None for row in records]
        values = [value for value in values if norm(value) != norm(column['label'])]
        populated = sum(bool(display(value)) for value in values)
        valid_dates = 0
        for value in values:
            if display(value):
                try:
                    parse_date(value)
                    valid_dates += 1
                except (ValueError, TypeError, OverflowError):
                    pass
        metrics[column['id']] = {'populated': populated, 'validDates': valid_dates}
    for role in ('date', 'process'):
        current = next((c for c in info['columns'] if c['id'] == info['mapping'].get(role)), None)
        if current is None:
            continue
        duplicates = [c for c in info['columns'] if norm(c['label']) == norm(current['label'])]
        if len(duplicates) > 1:
            chosen = max(duplicates, key=lambda c: (
                metrics[c['id']]['validDates' if role == 'date' else 'populated'], -c['index']))
            info['mapping'][role] = chosen['id']
            info['confidence'][role] = 'review'
    shift_id = info['mapping'].get('shift')
    shift_col = next((c for c in info['columns'] if c['id'] == shift_id), None)
    shifts = sorted({display(row[shift_col['index']]) for row in records
                     if shift_col and shift_col['index'] < len(row)
                     and display(row[shift_col['index']])
                     and norm(row[shift_col['index']]) != norm(shift_col['label'])})
    info['productionHints'] = {
        'layout': 'rows', 'preferredMapping': dict(info['mapping']),
        'columnCoverage': metrics, 'shiftValues': shifts,
        'quantityNote': '请选择实际生产数量；目标、差异、良率、金额不能作为不良率分母。',
        'bindingNote': '同名表头建议使用每行完整的列。仅确有分组空白时启用日期或工序继承。',
    }


def read_records(file, source, info, rows):
    from pathlib import Path
    from .tabular import ALIASES, display, filename_date, number, parse_date
    from . import shift_calendar

    binding = normalize(source.get('productionBinding'))
    mapping = source['mapping']
    columns = info['columns']
    calendar = shift_calendar.validate(source.get('calendar', {}))
    if calendar['mode'] == 'check-time' and calendar['timeColumn'] not in {c['id'] for c in columns}:
        raise ValueError('班次时间列不在当前文件中，请重新选择并确认规则。')
    if not mapping.get('quantity'):
        raise ValueError('请明确绑定实际产量列，不能将每行按1件产量处理。')
    fallback = filename_date(Path(file).name) if source.get('dateFromFilename') else None
    if not mapping.get('date') and not fallback:
        raise ValueError('缺少日期列，文件名也没有已确认的完整日期。')
    output, errors, previous = [], [], {}
    summary = Counter()
    for index, row in enumerate(rows[info['headerRow']:], start=info['headerRow'] + 1):
        if not any(display(x) for x in row):
            previous.clear()
            continue
        raw = {c['id']: row[c['index']] if c['index'] < len(row) else None for c in columns}
        if repeated_header(raw, source, columns):
            summary['skippedHeaderRows'] += 1
            previous.clear()
            continue
        effective = dict(raw)
        current_date = effective.get(mapping.get('date'))
        # Starting a new date block must not inherit yesterday's process.
        if display(current_date) and display(current_date) != display(previous.get('date')):
            previous.pop('process', None)
        for role in FILL_ROLES:
            column = mapping.get(role)
            value = effective.get(column)
            if display(value):
                previous[role] = value
            elif role in binding['fillDown'] and column and display(previous.get(role)):
                effective[column] = previous[role]
                summary['filledCells'] += 1
        try:
            get = lambda role: effective.get(mapping.get(role, ''))
            business = parse_date(get('date'), source.get('cutoff', 0), source.get('dateFormat', 'auto')) if mapping.get('date') else fallback
            missing_quantity = not display(get('quantity'))
            if missing_quantity and binding['missingQuantity'] != 'pending':
                raise ValueError('实际产量为空；可在产量绑定中选择保留为待补充，不能用目标值代替')
            # SQLite's existing numeric column is retained. The explicit marker
            # makes this unavailable, never a real zero, for all rate calculations.
            quantity = 0 if missing_quantity else number(get('quantity'))
            canonical = {role: display(get(role)) for role in ALIASES if role not in ('date', 'quantity')}
            if missing_quantity:
                canonical['productionMissing'] = True
                summary['pendingQuantityRows'] += 1
            if calendar['mode'] == 'check-time':
                business, canonical['shift'], note = shift_calendar.apply(effective, business, calendar, source.get('dateFormat', 'auto'))
                if note:
                    canonical['shiftNote'] = note
            if not canonical['process'] or not canonical['shift']:
                raise ValueError('产量缺少工序或班次；请选择完整列或明确启用分组继承')
            canonical['process'] = binding['processAliases'].get(canonical['process'], canonical['process'])
            canonical['shift'] = binding['shiftAliases'].get(canonical['shift'], canonical['shift'])
            # Preserve original cell values for traceability; canonical fields use the explicit binding.
            output.append({'date': business, 'quantity': quantity, **canonical, 'values': raw, 'row': index})
        except (ValueError, TypeError, OverflowError) as error:
            previous.clear()
            if len(errors) < 20:
                errors.append({'row': index, 'message': str(error)})
    if errors:
        raise ValueError('产量文件含无效行，未部分导入：' + '; '.join(
            f'第{x["row"]}行 {x["message"]}' for x in errors[:5]))
    info['productionImport'] = dict(summary)
    dates = sorted({r['date'] for r in output} or ({fallback} if fallback else set()))
    return output, info, dates
