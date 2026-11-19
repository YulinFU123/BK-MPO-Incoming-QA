"""Read-only receipt inbox over the existing transactional daily BI engine."""
import datetime as dt
import hashlib
import json
from pathlib import Path
import re
import time
import zipfile

SEEN = {}
PATTERN = re.compile(r'^NCX_([a-f0-9]{32})_complete\.json$')

def receipt(path):
    if path.is_symlink() or path.stat().st_size > 65536:
        raise ValueError('回执不是普通文件或超过64KB。')
    value = json.loads(path.read_text(encoding='utf-8-sig'))
    if (not isinstance(value, dict) or value.get('format') != 'BK-MPO-NCX-EXPORT' or
        value.get('version') != 1 or value.get('downloadComplete') is not True or
        value.get('filterVerified') is not True or not re.fullmatch('[a-f0-9]{32}', str(value.get('runId', '')))):
        raise ValueError('回执未确认下载完成及筛选复核，未自动导入。')
    if path.name != 'NCX_' + value['runId'] + '_complete.json' or value.get('file') != 'NCX_' + value['runId'] + '.xlsx':
        raise ValueError('回执与文件编号不一致。')
    if not re.match(r'^https://app\.powerbi\.com/', str(value.get('source', ''))):
        raise ValueError('回执来源不是受支持的Power BI页面。')
    filters=value.get('filters')
    if not isinstance(filters,dict) or any(not isinstance(filters.get(key),list) or not 0<len(filters[key])<=2000 or any(not isinstance(x,str) or not 0<len(x)<=512 for x in filters[key]) for key in ('floors','connectors')):
        raise ValueError('回执缺少楼层或连接器核对范围。')
    dates = value.get('period')
    if not isinstance(dates, dict) or set(dates) != {'start', 'end'}:
        raise ValueError('回执日期缺失。')
    for date in dates.values():
        if not isinstance(date, str) or dt.date.fromisoformat(date).isoformat() != date:
            raise ValueError('回执日期无效。')
    if dates['start'] > dates['end']:
        raise ValueError('回执日期倒置。')
    return value

def poll(base, body, daily, bridge):
    from daily_common import read_json, atomic_json
    folder = Path(body.get('folder') or '')
    scope = str(body.get('scope') or '').strip()
    if not folder.is_dir() or folder.is_symlink() or not scope or len(scope) > 128:
        raise ValueError('请先选择接收目录并填写独立来源范围。')
    ledger_file = Path(base) / 'ncx-inbox-audit.json'
    ledger = read_json(ledger_file, {'version': 1, 'runs': {}})
    if not isinstance(ledger, dict) or ledger.get('version') != 1 or not isinstance(ledger.get('runs'), dict):
        raise ValueError('接收记录损坏，已保留原件；请恢复备份后重试。')
    markers = sorted(p for p in folder.iterdir() if PATTERN.fullmatch(p.name))
    if len(markers) > 2000:
        raise ValueError('接收目录超过2000个回执，请保留备份并选择新的专用接收目录。')
    results = []
    for marker in markers:
        identity = PATTERN.fullmatch(marker.name)[1]
        if identity in ledger['runs']:
            # Completed receipts are immutable; changed receipts never trigger re-import.
            continue
        try:
            value = receipt(marker)
            file = folder / value['file']
            if not file.exists():
                results.append({'runId': identity, 'state': 'waiting', 'message': '等待本次Excel文件。'})
                continue
            if file.is_symlink() or file.resolve().parent != folder.resolve() or not file.is_file():
                raise ValueError('Excel必须是接收目录中的普通文件。')
            stat = file.stat()
            if not 0 < stat.st_size <= 20 * 1024 * 1024:
                raise ValueError('Excel为空或超过20MB，未自动导入。')
            key = str(Path(base).resolve()) + ':' + identity
            stamp = (stat.st_size, stat.st_mtime_ns, hashlib.sha256(marker.read_bytes()).hexdigest())
            prior = SEEN.get(key)
            if prior is None or prior[0] != stamp:
                SEEN[key] = (stamp, time.monotonic())
                results.append({'runId': identity, 'state': 'stabilizing', 'message': '等待文件稳定。'})
                continue
            if time.monotonic() - prior[1] < 4:
                results.append({'runId': identity, 'state': 'stabilizing', 'message': '等待文件稳定。'})
                continue
            if file.with_suffix('.xlsx.crdownload').exists() or file.with_suffix('.xlsx.part').exists():
                results.append({'runId': identity, 'state': 'waiting', 'message': '浏览器仍在下载。'})
                continue
            with zipfile.ZipFile(file) as book:
                if sum(row.file_size for row in book.infolist()) > 100 * 1024 * 1024:
                    raise ValueError('Excel解压内容过大，请人工核查。')
            digest = hashlib.sha256(file.read_bytes()).hexdigest()
            rows, metadata, _ = daily.read_table(file, 'quality')
            query = {'scope': scope, **value['period'], 'status': '', 'period': 'day', 'top': 10}
            job = {'query': query, 'floor': str(body.get('floor') or ''), 'products': value['filters']['connectors'], 'config': {}}
            bridge.validate_download(job, rows, metadata)
            if any(row['floor'] not in value['filters']['floors'] for row in rows):
                raise ValueError('下载记录与回执楼层范围不一致，未入库。')
            if file.stat().st_size != stamp[0] or file.stat().st_mtime_ns != stamp[1] or hashlib.sha256(file.read_bytes()).hexdigest() != digest:
                SEEN.pop(key, None)
                raise ValueError('检查期间文件变化，未导入，请重试。')
            _, sources = daily.load(base, 'quality', scope)
            present = {row['date'] for row in rows}
            missing = {source['date'] for source in sources if query['start'] <= source['date'] <= query['end']} - present
            if missing:
                raise ValueError('新导出缺少已有业务日期，未替换历史。')
            result = daily.ingest(base, {'path': str(file), 'kind': 'quality', 'scope': scope,
                                        'replace': body.get('replace') is True, 'expected_digest': digest})
            analysis = daily.analyze(base, query)
            summary = {'state': 'done', 'scope': scope, 'digest': digest, 'period': value['period'],
                       'result': result, 'at': dt.datetime.now().isoformat(),
                       'message': '已核对、去重并更新分析；没有有效产量分母时不计算不良率。'}
            ledger['runs'][identity] = summary
            atomic_json(ledger_file, ledger)
            SEEN.pop(key, None)
            results.append({'runId': identity, **summary, 'analysis': {key:analysis[key] for key in ('start','end','count','quantity','revision')}})
        except (ValueError, OSError, zipfile.BadZipFile, KeyError, TypeError) as error:
            # Raw files remain in place. A corrected file/receipt can be retried.
            results.append({'runId': identity, 'state': 'failed', 'message': str(error) if isinstance(error, ValueError) else '文件暂不可读或格式错误，原件保留。'})
    # Bound transient observations without deleting durable audit history.
    if len(SEEN) > 2000:
        SEEN.clear()
    return {'ok': True, 'results': results, 'completedCount': len(ledger['runs'])}
