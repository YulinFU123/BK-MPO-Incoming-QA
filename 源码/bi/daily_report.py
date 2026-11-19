"""Export a checked analysis revision and explicitly track incomplete image output."""
from __future__ import annotations

import base64
import datetime as dt
import json
import shutil
import struct
import uuid
from pathlib import Path

import openpyxl
from openpyxl.styles import Font, PatternFill
from daily_analysis import analyze
from daily_common import atomic_json, read_json


def summary_text(result):
    query = result['applied_query']
    lines = [f"质量日报｜{result['start']}—{result['end']}",
             f"范围：{query.get('scope', '')}；处置口径：{query.get('status') or '全部报检记录'}",
             f"记录数量：{result['quantity']:g}；明细条数：{result['count']}。"]
    for chart in result['charts'][:2]:
        items = []
        for row in chart['rows'][:3]:
            share = f"{row['share']:.1%}" if row['share'] is not None else '无分母'
            items.append(f"{row['name']} {row['qty']:g}（{share}）")
        lines.append(chart['title'] + '：' + ('；'.join(items) or '当前范围无记录'))
    if result['production']:
        lines.append('产量（按工序/单位，不按责任人员或报检班别筛选）：')
        lines.extend(f"{row['process']}：{row['qty']:g} {row['unit']}" for row in result['production'])
    lines.extend(['', '统计说明：', *result['warnings'],
                  '请补充核实结论、跟进负责人、措施与反馈期限后发送。'])
    return '\n'.join(lines)


def write_workbook(path, result):
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    sheet.title = '日报汇总'
    sheet.append(['统计项', '值'])
    for key, value in [('开始日期', result['start']), ('结束日期', result['end']),
                       ('范围', result['applied_query'].get('scope', '')),
                       ('处置口径', result['applied_query']['status'] or '全部报检记录'),
                       ('数量字段合计', result['quantity']), ('记录条数', result['count'])]:
        sheet.append([key, value])
    sheet = workbook.create_sheet('责任人员明细')
    sheet.append(['业务日期', '责任工序', '责任人', '记录楼层', '连接器类型', '报检班别', '处置状态', '判定项目', '数量'])
    keys = ['date', 'process', 'employee', 'floor', 'product', 'shift', 'status', 'item', 'qty']
    for row in result['rows']:
        sheet.append([row.get(key, '') for key in keys])
    sheet = workbook.create_sheet('原始记录')
    headers = list(dict.fromkeys(key for row in result['rows'] for key in row['raw']))
    sheet.append(headers or ['当前范围无记录'])
    for row in result['rows']:
        sheet.append([row['raw'].get(key, '') for key in headers])
    sheet = workbook.create_sheet('排行数量占比')
    sheet.append(['图表（含分母说明）', '对象', '数量', '占比'])
    for chart in result['charts']:
        for row in chart['rows']:
            sheet.append([chart['title'], row['name'], row['qty'], row['share']])
            sheet.cell(sheet.max_row, 4).number_format = '0.0%'
    sheet = workbook.create_sheet('产量')
    sheet.append(['工序', '单位', '产量（未按人员及报检班别筛选）'])
    for row in result['production']:
        sheet.append([row['process'], row['unit'], row['qty']])
    sheet = workbook.create_sheet('统计说明')
    sheet.append(['项目', '内容'])
    sheet.append(['完整筛选', json.dumps(result['applied_query'], ensure_ascii=False)])
    sheet.append(['分析版本', result['revision']])
    for warning in result['warnings']:
        sheet.append(['口径', warning])
    for source in result['sources']:
        sheet.append([f"来源快照 {source['id']} / {source['date']}", source['filters']])
    for sheet in workbook:
        sheet.freeze_panes = 'A2'
        sheet.auto_filter.ref = sheet.dimensions
        for column in sheet.columns:
            sheet.column_dimensions[column[0].column_letter].width = 25
        for cell in sheet[1]:
            cell.fill = PatternFill('solid', fgColor='16334A')
            cell.font = Font(color='FFFFFF', bold=True)
        for row in sheet:
            for cell in row:
                if cell.data_type == 'f':
                    cell.data_type = 's'  # Source strings must never execute as Excel formulas.
    workbook.save(path)
    workbook.close()


def export_report(base, body):
    result = analyze(base, body['query'])
    if not result['start'] or not result['end']:
        raise ValueError('请先导入数据并选择业务日期，再生成日报。')
    expected = body.get('expected_revision')
    if expected and expected != result['revision']:
        raise ValueError('历史数据已更新，当前预览不是最新版本。请更新分析后再导出。')
    token = uuid.uuid4().hex
    root = Path(base) / '日报输出'
    root.mkdir(exist_ok=True)
    target = root / (dt.datetime.now().strftime('%Y%m%d_%H%M%S_') + token[:8])
    staging = root / ('.building_' + token)
    staging.mkdir()
    try:
        summary = summary_text(result)
        atomic_json(staging / '统计快照.json', {'query': result['applied_query'], 'result': result})
        (staging / '邮件正文草稿.txt').write_text(summary, encoding='utf-8-sig')
        write_workbook(staging / '日报明细.xlsx', result)
        atomic_json(staging / '导出状态.json', {
            'status': '等待图片', 'revision': result['revision'], 'token': token,
            'message': 'Excel和正文已生成，图片尚未完成。',
        })
        staging.rename(target)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise
    return {'ok': True, 'path': str(target), 'summary': summary, 'token': token,
            'revision': result['revision'], 'status': '等待图片'}


def save_images(base, body):
    root = (Path(base) / '日报输出').resolve()
    folder = Path(body.get('path') or '').resolve()
    if folder.parent != root or not folder.is_dir():
        raise ValueError('无效的日报输出目录。')
    manifest = read_json(folder / '导出状态.json', {})
    if not body.get('token') or body['token'] != manifest.get('token'):
        raise ValueError('图片与日报任务不匹配，请重新生成。')
    images = body.get('images')
    if not isinstance(images, list) or len(images) > 500:
        raise ValueError('图片数量无效。')
    decoded = []
    for index, image in enumerate(images):
        payload = image.get('data', '')
        if not payload.startswith('data:image/png;base64,'):
            raise ValueError('图片转换失败，请检查浏览器后重试。')
        data = base64.b64decode(payload.split(',', 1)[1], validate=True)
        if len(data) < 24 or not data.startswith(b'\x89PNG\r\n\x1a\n'):
            raise ValueError('图片不是有效PNG。')
        width, height = struct.unpack('>II', data[16:24])
        if not width or not height:
            raise ValueError('图片尺寸无效。')
        decoded.append((f'{index + 1:02d}_日报图.png', data, image.get('title', '')))
    staging = folder / '.images_pending'
    staging.mkdir(exist_ok=True)
    try:
        for name, data, _ in decoded:
            (staging / name).write_bytes(data)
        for name, _, _ in decoded:
            (staging / name).replace(folder / name)
        manifest.update(status='完成', message=f'已生成{len(decoded)}张图片、Excel和邮件草稿；未发送邮件。',
                        images=[{'file': name, 'title': title} for name, _, title in decoded])
        atomic_json(folder / '导出状态.json', manifest)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
    return {'ok': True, 'count': len(decoded), 'status': '完成'}
