"""Validate typed report quantities and derive the proposed production cohorts."""
from collections import defaultdict
from datetime import date
import re

MAX_ROWS = 366
MAX_QUANTITY = 10**12
FIELDS = ('date', 'process', 'shift')
SOURCE = {'name': '日报手填产量', 'mapping': {name: name for name in (*FIELDS, 'quantity')}}


def key(row):
    return tuple(row.get(field, '') for field in FIELDS)


def eligible(row):
    return all(key(row)) and row['shift'] != '未归班'


def rows(input_rows):
    """Use the same strict limits as the report settings; no implicit zeros."""
    if not isinstance(input_rows, list) or len(input_rows) > MAX_ROWS:
        raise ValueError(f'日报手填产量最多 {MAX_ROWS} 行，请缩小日期范围。')
    entries = []
    seen = set()
    for index, item in enumerate(input_rows, 1):
        error = f'手填产量第 {index} 行'
        if not isinstance(item, dict) or set(item) != {*FIELDS, 'quantity'}:
            raise ValueError(f'{error}需填写业务日期、工序、班次和实际产量。')
        try:
            exact_date = date.fromisoformat(item['date']).isoformat() == item['date']
        except (TypeError, ValueError):
            exact_date = False
        if not exact_date:
            raise ValueError(f'{error}业务日期无效，请输入 YYYY-MM-DD。')
        entry = dict(item)
        for field, label in [('process', '工序'), ('shift', '班次')]:
            value = item[field]
            if not isinstance(value, str) or not value.strip() or len(value) > 160 or re.search(r'[\x00-\x1f\x7f]', value):
                raise ValueError(f'{error}{label}无效，请填写与查询一致的名称。')
            entry[field] = value.strip()
        if entry['shift'] == '未归班':
            raise ValueError(f'{error}为未归班，请先核对不良记录的班次。')
        quantity = item['quantity']
        if type(quantity) is not int or not 0 <= quantity <= MAX_QUANTITY:
            raise ValueError(f'{error}实际产量须为 0 至一万亿之间的整数。')
        cohort = key(entry)
        if cohort in seen:
            raise ValueError(f'{error}的业务日期、工序、班次已存在，请合并数量。')
        seen.add(cohort)
        entries.append(entry)
    return entries


def suggestions(scoped, filtered):
    totals = defaultdict(int)
    for row in filtered:
        if eligible(row):
            totals[key(row)] += row['quantity']
    cohorts = set()
    for row in scoped:
        if eligible(row):
            cohorts.add(key(row))
            if len(cohorts) > MAX_ROWS:
                raise ValueError(f'当前查询涉及超过 {MAX_ROWS} 个日期、工序和班次组合，请缩小范围再手填产量。')
    return {
        'cohorts': [dict(zip(FIELDS, cohort), quantity=totals[cohort]) for cohort in sorted(cohorts)],
        'unassignedRows': sum(not eligible(row) for row in filtered),
    }
