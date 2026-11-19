"""Single-machine BI handoff: explicit task state, bounded polling, audited imports.

No browser credentials, cross-origin callbacks or database connections are used.
JOBS is process-local; only an audit summary is persisted. Access is serialized by
panel.DATA_LOCK. A task captures its query so later screen edits cannot change it.
"""
from __future__ import annotations

import copy
import datetime as dt
import hashlib
import json
import re
import time
import uuid
from pathlib import Path
from zipfile import BadZipFile

import daily
from daily_analysis import normalize_query
from daily_common import atomic_json, date_range, read_json

JOBS = {}
ACTIVE_STATES = ('waiting', 'stabilizing')
TIMEOUT_SECONDS = 900
STABLE_SECONDS = 4


def stamp(path):
    stat = path.stat()
    return stat.st_size, stat.st_mtime_ns


def public(job):
    keys = ('id', 'state', 'message', 'result', 'output', 'query', 'config', 'report_state')
    return {'ok': True, **{key: copy.deepcopy(job[key]) for key in keys if key in job}}


def audit(base, job):
    path = Path(base) / 'bi_tasks.json'
    history = read_json(path, [])
    if not isinstance(history, list):
        raise ValueError('BI任务日志格式无效，请备份后检查。')
    summary = {key: job.get(key) for key in ('id', 'state', 'message', 'output', 'report_state')}
    summary.update(updated=dt.datetime.now().isoformat(), scope=job['query']['scope'],
                   start=job['query']['start'], end=job['query']['end'])
    history = [entry for entry in history if entry.get('id') != job['id']]
    atomic_json(path, (history + [summary])[-100:])


def transition(base, job, state, message):
    job.update(state=state, message=message)
    audit(base, job)
    return public(job)


def expire(base):
    for job in JOBS.values():
        if job['base'] == str(Path(base).resolve()) and job['state'] in ACTIVE_STATES:
            if time.time() - job['started'] > TIMEOUT_SECONDS:
                transition(base, job, 'failed', '等待超过15分钟，已停止接收。请检查浏览器下载后重新开始。')


def start(base, body):
    # Validate inputs before creating a task or scanning any directory.
    query = normalize_query(body.get('query', {}))
    query['start'], query['end'] = date_range(query)
    query['scope'] = str(query.get('scope') or '').strip()
    if not query['scope']:
        raise ValueError('请填写来源范围名称，例如 BK5F_六类连接器_不良明细。')
    folder_text = str(body.get('folder') or '').strip()
    if not folder_text:
        raise ValueError('请选择浏览器实际下载文件夹。')
    folder = Path(folder_text).expanduser().resolve()
    if not folder.is_dir():
        raise ValueError('下载文件夹不存在，请重新选择。')
    pattern = str(body.get('pattern') or 'data*.xlsx').strip()
    if any(char in pattern for char in ('/', '\\', '..')) or not pattern.lower().endswith('.xlsx'):
        raise ValueError('文件名规则应为 data*.xlsx 等名称，不能包含目录。')
    products = body.get('products') or []
    if not isinstance(products, list) or not all(isinstance(value, str) for value in products):
        raise ValueError('预期连接器类型必须是名称列表。')
    expire(base)
    base_name = str(Path(base).resolve())
    if any(job['base'] == base_name and job['state'] in ACTIVE_STATES for job in JOBS.values()):
        raise ValueError('已有接收任务，请停止旧任务后再开始。')
    baseline = {path.name: stamp(path) for path in folder.iterdir() if path.is_file()}
    identity = uuid.uuid4().hex
    config = {'id': identity, 'start': query['start'], 'end': query['end']}
    job = {
        'id': identity, 'base': base_name, 'folder': str(folder), 'query': copy.deepcopy(query),
        'config': config, 'baseline': baseline, 'started': time.time(), 'state': 'waiting',
        'message': '等待本次BI脚本执行及下载；请将生成代码粘贴到BI页面。',
        'seen': {}, 'replace': bool(body.get('replace')), 'floor': str(body.get('floor') or '').strip(),
        'products': sorted(set(products)), 'pattern': pattern, 'report_state': '未生成',
    }
    JOBS[identity] = job
    audit(base, job)
    # Bound memory during a long-running desktop session.
    for old in list(JOBS):
        if len(JOBS) <= 100:
            break
        if JOBS[old]['state'] not in ACTIVE_STATES:
            JOBS.pop(old)
    return {'ok': True, 'job': identity, 'config': config, 'message': job['message']}


def validate_download(job, rows, metadata):
    query = job['query']
    if not all(query['start'] <= row['date'] <= query['end'] for row in rows):
        raise ValueError('下载记录的业务日期不在任务范围内，未入库。')
    # Fail closed for unknown filter syntax; do not infer inclusive/exclusive bounds.
    text = '\n'.join(line for line in metadata.splitlines() if 'WORK_DATE' in line.upper())
    match = re.search(r'(\d{4}/\d{1,2}/\d{1,2})\s*当天或之后.*?(\d{4}/\d{1,2}/\d{1,2})\s*之前', text)
    if not match:
        raise ValueError('无法确认WORK_DATE的起止筛选说明，未自动入库；可手动核对后导入。')
    start, end_exclusive = [dt.datetime.strptime(value, '%Y/%m/%d').date() for value in match.groups()]
    if (start != dt.date.fromisoformat(query['start']) or
            end_exclusive != dt.date.fromisoformat(query['end']) + dt.timedelta(days=1)):
        raise ValueError('BI日期筛选说明与任务不一致。请等待BI刷新完成后重试。')
    if job['floor'] and any(row['floor'] != job['floor'] for row in rows):
        raise ValueError('下载记录楼层与任务要求不一致，未入库。')
    if job['products'] and any(row['product'] not in job['products'] for row in rows):
        raise ValueError('下载包含预期范围以外的连接器类型，未入库。')


def _poll(base, job):
    folder = Path(job['folder'])
    marker = folder / ('NCDetails_job_' + job['id'] + '.json')
    if not marker.exists():
        return public(job)
    if marker.stat().st_size > 2_000_000:
        return transition(base, job, 'failed', '任务标记文件异常过大，未读取。')
    try:
        result = json.loads(marker.read_text(encoding='utf-8-sig'))
    except (UnicodeError, json.JSONDecodeError):
        job['message'] = '任务标记尚不可读，等待下载完成。'
        return public(job)
    if not isinstance(result, dict) or result.get('id') != job['id']:
        return transition(base, job, 'failed', '任务标记不匹配，未入库。')
    if result.get('status') != 'export_clicked_download_unverified':
        return transition(base, job, 'failed', 'BI脚本停止：' + str(result.get('error') or result.get('status')))
    files = [path for path in folder.iterdir() if path.is_file()]
    if any(path.suffix.lower() in ('.crdownload', '.part', '.tmp') and
           stamp(path) != job['baseline'].get(path.name) for path in files):
        job['message'] = '下载目录中有未完成文件，等待下载完成。'
        return public(job)
    candidates = [path for path in folder.glob(job['pattern']) if path.is_file()
                  and path.suffix.lower() == '.xlsx' and not path.name.startswith('~$')
                  and stamp(path) != job['baseline'].get(path.name)]
    if len(candidates) > 1:
        return transition(base, job, 'failed', '出现多个新增Excel，无法确定本次文件。请用专用下载目录或更精确文件名规则重试。')
    if not candidates:
        job['message'] = 'BI已请求导出，等待新的Excel下载。'
        return public(job)
    path = candidates[0]
    signature = stamp(path)
    seen = job['seen'].get(path.name)
    if not seen or seen[0] != signature:
        job['seen'][path.name] = (signature, time.time())
        job.update(state='stabilizing', message='发现Excel，等待文件大小稳定并检查内容。')
        return public(job)
    if time.time() - seen[1] < STABLE_SECONDS:
        return public(job)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    rows, metadata, _ = daily.read_table(path, 'quality')
    validate_download(job, rows, metadata)
    if stamp(path) != signature or hashlib.sha256(path.read_bytes()).hexdigest() != digest:
        job['seen'].pop(path.name, None)
        job['message'] = '校验期间文件变化，重新等待稳定。'
        return public(job)
    # A missing day in a replacement must not quietly leave stale active records.
    _, sources = daily.load(base, 'quality', job['query']['scope'])
    existing_days = {source['date'] for source in sources
                     if job['query']['start'] <= source['date'] <= job['query']['end']}
    missing = existing_days - {row['date'] for row in rows}
    if missing:
        raise ValueError('新导出缺少已有历史日期：' + '、'.join(sorted(missing)) + '。请核对是否漏导，未自动替换。')
    job['result'] = daily.ingest(base, {
        'path': str(path), 'kind': 'quality', 'scope': job['query']['scope'],
        'replace': job['replace'], 'expected_digest': digest,
    })
    job['report_state'] = '待生成'
    return transition(base, job, 'done', '历史已保存；日报素材尚未完成。')


def poll(base, body):
    job = JOBS.get(body.get('job'))
    if not job or job['base'] != str(Path(base).resolve()):
        raise ValueError('任务不存在。程序重启后请重新开始；已入库的数据仍保留。')
    expire(base)
    if job['state'] not in ACTIVE_STATES:
        return public(job)
    try:
        return _poll(base, job)
    except (OSError, BadZipFile) as exc:
        job['message'] = '文件暂不可读，继续等待：' + str(exc)
        return public(job)
    except ValueError as exc:
        return transition(base, job, 'failed', str(exc))
    except Exception as exc:
        transition(base, job, 'failed', '任务处理异常，请查看程序日志；可手动导入核查。')
        raise


def dispatch(base, action, body):
    if action == 'start':
        return start(base, body)
    if action == 'poll':
        return poll(base, body)
    if action == 'current':
        expire(base)
        active = next((public(job) for job in JOBS.values()
                       if job['base'] == str(Path(base).resolve()) and job['state'] in ACTIVE_STATES), None)
        return {'ok': True, 'active': active, 'history': read_json(Path(base) / 'bi_tasks.json', [])[-10:]}
    job = JOBS.get(body.get('job'))
    if not job or job['base'] != str(Path(base).resolve()):
        raise ValueError('任务不存在。')
    if action == 'cancel':
        if job['state'] in ACTIVE_STATES:
            return transition(base, job, 'cancelled', '已停止接收；下载文件未删除。')
        return public(job)
    if action == 'report':
        if job['state'] != 'done':
            raise ValueError('该任务尚未完成入库。')
        if body.get('success'):
            folder = Path(body.get('path') or '').resolve()
            if folder.parent != (Path(base) / '日报输出').resolve():
                raise ValueError('日报目录无效。')
            status = read_json(folder / '导出状态.json', {})
            snapshot = read_json(folder / '统计快照.json', {})
            query = snapshot.get('query', {})
            if status.get('status') != '完成' or any(query.get(key) != job['query'].get(key) for key in ('scope', 'start', 'end')):
                raise ValueError('日报尚未完成或日期范围与任务不一致。')
            job.update(output=str(folder), report_state='完成', message='历史与日报素材均已完成；邮件未发送。')
        else:
            job.update(report_state='未完成', message='历史已保存，日报素材未完成，请在日报页重新预览和导出。')
        audit(base, job)
        return public(job)
    raise ValueError('未知BI任务操作。')
