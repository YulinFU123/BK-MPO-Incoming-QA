"""Read BI/production files without modifying them or silently dropping bad rows."""
from __future__ import annotations

import csv
import datetime as dt
import math
from collections import Counter
from pathlib import Path

import openpyxl
from daily_common import parse_date

FIELDS = {
    'date': 'Work Date', 'process': 'Workflow Category in Charge',
    'employee': 'Employee in Charge', 'floor': 'Resource Name Category',
    'product': 'Connector Type', 'shift': 'Shift', 'qty': 'Sum of Qty',
    'status': 'Disposition Type', 'item': 'Defect Code',
}
ALIASES = {
    'date': ['业务日期', '日期', 'Work Date', 'Date'],
    'process': ['工序', '责任工序', 'Workflow Category in Charge', 'Process'],
    'qty': ['产量', '完成数量', '产出数量', 'Output Qty'],
    'unit': ['单位', 'Unit'], 'floor': ['楼层', 'Resource Name Category'],
    'product': ['产品', '连接器类型', 'Connector Type'],
    'employee': ['员工', '姓名', 'Employee in Charge'], 'shift': ['生产班别', '班别'],
}


def read_table(path, kind, mapping=None):
    """Return normalized records, pre-header filter text and the applied mapping."""
    path = Path(path)
    if kind not in ('quality', 'production'):
        raise ValueError('数据类型必须是质量或产量。')
    if path.suffix.lower() not in ('.xlsx', '.csv'):
        raise ValueError('支持 .xlsx 或 UTF-8 CSV；旧 .xls 请先另存为 .xlsx。')
    if path.suffix.lower() == '.csv':
        with path.open(encoding='utf-8-sig', newline='') as handle:
            rows = list(csv.reader(handle))
    else:
        workbook = openpyxl.load_workbook(path, read_only=True, data_only=True)
        try:
            rows = list(workbook.worksheets[0].values)
        finally:
            workbook.close()
    header_index = None
    for index, row in enumerate(rows[:50]):
        names = [str(value).strip() if value is not None else '' for value in row]
        quality = kind == 'quality' and set(FIELDS.values()) <= set(names)
        production = kind == 'production' and any(
            name in names for name in ALIASES['qty'] + [(mapping or {}).get('qty', '!')]
        )
        if quality or production:
            header_index = index
            break
    if header_index is None:
        raise ValueError('前50行未找到所需表头，请检查报表类型和字段映射。')
    headers = [str(value).strip() if value is not None else '' for value in rows[header_index]]
    duplicates = [key for key, count in Counter(headers).items() if key and count > 1]
    if duplicates:
        raise ValueError('表头存在重名列，无法可靠识别：' + '、'.join(duplicates))
    applied = FIELDS.copy() if kind == 'quality' else {
        key: (mapping or {}).get(key) or next((name for name in names if name in headers), '')
        for key, names in ALIASES.items()
    }
    if kind == 'production':
        for key in ('date', 'process', 'qty', 'unit'):
            if not applied.get(key) or applied[key] not in headers:
                raise ValueError('产量表必须包含日期、工序、产量、单位，请检查字段映射。')
        invalid = [name for name in applied.values() if name and name not in headers]
        if invalid:
            raise ValueError('保存的字段映射在本表中不存在，请重新选择：' + '、'.join(invalid))
    records = []
    for row_number, values in enumerate(rows[header_index + 1:], header_index + 2):
        if not any(value is not None and str(value).strip() for value in values):
            continue
        raw = {
            key: value.isoformat(sep=' ') if isinstance(value, dt.datetime)
            else str(value) if value is not None else ''
            for key, value in zip(headers, values) if key
        }
        record = {key: raw.get(column, '').strip() for key, column in applied.items()}
        record['raw'] = raw
        record['date'] = parse_date(record['date'], f'第{row_number}行业务日期')
        try:
            quantity = float(str(record['qty']).replace(',', ''))
        except (TypeError, ValueError) as exc:
            raise ValueError(f'第{row_number}行数量不是数字，整份文件未入库。') from exc
        if not math.isfinite(quantity) or quantity < 0:
            raise ValueError(f'第{row_number}行数量必须是非负有限数值。')
        record['qty'] = quantity
        if kind == 'production' and (not record['process'] or not record['unit']):
            raise ValueError(f'第{row_number}行产量的工序或单位为空。')
        records.append(record)
    if not records:
        raise ValueError('文件没有明细记录；未将空文件当作零，也未清除历史。')
    metadata = '\n'.join(str(value) for row in rows[:header_index] for value in row if value is not None)
    return records, metadata, applied
