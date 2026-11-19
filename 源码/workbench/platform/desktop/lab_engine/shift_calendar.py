"""Explicit local shift calendar. No timestamp means no inferred shift."""
from datetime import date, datetime, timedelta, timezone
import math
import re

DEFAULTS = {'mode': 'column', 'timeColumn': '', 'dateBasis': 'start',
            'dayStart': '08:00', 'dayEnd': '18:40', 'nightStart': '20:00', 'nightEnd': '06:40',
            'dayLabel': '白班', 'nightLabel': '晚班'}


def validate(value):
    if not isinstance(value, dict) or set(value) - set(DEFAULTS):
        raise ValueError('班次规则格式无效')
    r = {**DEFAULTS, **value}
    if r['mode'] not in ('column', 'check-time') or r['dateBasis'] not in ('mapped', 'start', 'calendar'):
        raise ValueError('班次方式或日期归属无效')
    for k in ('dayStart', 'dayEnd', 'nightStart', 'nightEnd'):
        if not isinstance(r[k], str) or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d', r[k]):
            raise ValueError('班次时间请使用HH:MM')
    for k in ('dayLabel', 'nightLabel'):
        if not isinstance(r[k], str) or len(r[k]) > 24 or re.search(r'[\x00-\x1f]', r[k]):
            raise ValueError('班次名称无效')
    if r['mode'] == 'check-time':
        if not re.fullmatch(r'h_[a-f0-9]{16}', r['timeColumn']) or not r['dayLabel'].strip() or not r['nightLabel'].strip() or r['dayLabel'] == r['nightLabel'] or '未归班' in (r['dayLabel'], r['nightLabel']):
            raise ValueError('请选择时间列和不同的白晚班名称')
        a, b, c, d = [minute(r[k]) for k in ('dayStart', 'dayEnd', 'nightStart', 'nightEnd')]
        if a >= b or c <= d or a <= d or b >= c:
            raise ValueError('白班和跨午夜晚班的时段无效或重叠')
    return r


def minute(text):
    return int(text[:2]) * 60 + int(text[3:])


def clock(value, fmt='auto'):
    if value is None or value == '':
        return None
    if isinstance(value, bool):
        raise ValueError('班次时间不是有效时间')
    if isinstance(value, datetime):
        result = value
    elif isinstance(value, date):
        return None
    elif isinstance(value, (int, float)):
        if not math.isfinite(value) or not 1 <= value < 100000:
            raise ValueError('Excel时间序号无效')
        if value == int(value):
            return None
        result = datetime(1899, 12, 30) + timedelta(days=value)
    else:
        text = str(value).strip()
        if re.fullmatch(r'\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}/\d{1,2}/\d{4}', text):
            return None
        match = re.fullmatch(r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](.+)', text)
        if match:
            y, m, d, tail = match.groups()
        else:
            match = re.fullmatch(r'(\d{1,2})/(\d{1,2})/(\d{4})\s+(.+)', text)
            if not match:
                raise ValueError('Check Date缺少可识别的年月日时分')
            a, b, y, tail = match.groups()
            a, b = int(a), int(b)
            order = fmt if fmt in ('mdy', 'dmy') else 'dmy' if a > 12 and b <= 12 else 'mdy' if b > 12 and a <= 12 else None
            if order is None:
                raise ValueError('时间列月日有歧义，请明确日期解释')
            m, d = (a, b) if order == 'mdy' else (b, a)
        text = f'{int(y):04d}-{int(m):02d}-{int(d):02d} {tail}'
        if re.search(r'\b(?:AM|PM)\b', tail, re.I):
            result = None
            for pattern in ('%Y-%m-%d %I:%M:%S %p', '%Y-%m-%d %I:%M %p'):
                try:
                    result = datetime.strptime(text.upper(), pattern)
                    break
                except ValueError:
                    pass
            if result is None:
                raise ValueError('12小时制时间无效')
        else:
            result = datetime.fromisoformat(text.replace('Z', '+00:00'))
    if result.tzinfo is not None:
        result = result.astimezone(timezone(timedelta(hours=8))).replace(tzinfo=None)
    return result


def apply(raw, business, rule, fmt='auto'):
    r = validate(rule)
    moment = clock(raw.get(r['timeColumn']), fmt)
    if moment is None:
        return business, '未归班', '时间列为空或只有日期，没有明确时分'
    t = moment.hour * 60 + moment.minute
    day = minute(r['dayStart']) <= t <= minute(r['dayEnd'])
    night = t >= minute(r['nightStart']) or t <= minute(r['nightEnd'])
    label = r['dayLabel'] if day else r['nightLabel'] if night else '未归班'
    if r['dateBasis'] != 'mapped':
        business = (moment - timedelta(days=1) if r['dateBasis'] == 'start' and night and t <= minute(r['nightEnd']) else moment).date().isoformat()
    return business, label, '' if day or night else '时间落在两个班次之外'
