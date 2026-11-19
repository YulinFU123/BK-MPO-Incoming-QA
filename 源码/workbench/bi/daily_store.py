"""Transactional daily snapshots. Compatible with V10/V10.1 SQLite history."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import shutil
import sqlite3
import tempfile
from collections import defaultdict
from contextlib import closing
from pathlib import Path

from daily_common import read_json, stable_hash
from daily_source import read_table


def db(base):
    root = Path(base) / '日报历史'
    root.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(root / 'snapshots.sqlite', timeout=20)
    connection.execute('''CREATE TABLE IF NOT EXISTS snapshots(
        id INTEGER PRIMARY KEY, kind TEXT, scope TEXT, day TEXT, hash TEXT,
        created TEXT, source TEXT, metadata TEXT, rows TEXT, active INTEGER)''')
    connection.execute('CREATE INDEX IF NOT EXISTS snapshot_lookup ON snapshots(kind,scope,day,active)')
    connection.commit()
    return connection


def filter_signature(text):
    return sorted(line.strip() for line in text.splitlines()
                  if line.strip() and not re.search(r'WORK_DATE|Work Date', line, re.I))


def row_signature(rows):
    """Ignore row order but keep duplicate multiplicity and every source field."""
    return stable_hash(sorted(json.dumps(row, ensure_ascii=False, sort_keys=True) for row in rows))


def ingest(base, body):
    kind = body.get('kind', 'quality')
    scope = str(body.get('scope') or '').strip()
    if not scope:
        raise ValueError('请填写来源范围名称，同一完整BI筛选范围使用同名。')
    source = Path(body.get('path') or '')
    if not source.is_file():
        raise ValueError('请选择存在的Excel或CSV文件。')
    # Parse, hash and archive the same immutable captured bytes.
    with tempfile.TemporaryDirectory(prefix='quality-import-') as temp:
        captured = Path(temp) / source.name
        before = (source.stat().st_size, source.stat().st_mtime_ns)
        shutil.copyfile(source, captured)
        if before != (source.stat().st_size, source.stat().st_mtime_ns):
            raise ValueError('读取期间文件发生变化，请等待下载完成后重试。')
        rows, metadata, mapping = read_table(captured, kind, body.get('mapping'))
        digest = hashlib.sha256(captured.read_bytes()).hexdigest()
        expected_digest = body.get('expected_digest')
        if expected_digest and digest != expected_digest:
            raise ValueError('校验后下载文件又发生变化，未入库，请重试。')
        groups = defaultdict(list)
        for row in rows:
            groups[row['date']].append(row)
        results = []
        with closing(db(base)) as connection, connection:
            connection.execute('BEGIN IMMEDIATE')
            prior = connection.execute(
                'SELECT metadata FROM snapshots WHERE kind=? AND scope=? ORDER BY id DESC LIMIT 1',
                (kind, scope),
            ).fetchone()
            if kind == 'quality' and prior and filter_signature(prior[0]) != filter_signature(metadata):
                raise ValueError('来源筛选说明发生非日期变化。请核对BI条件，不同范围使用新名称。')
            # Check every affected day before mutating any snapshot.
            plan = []
            for day, records in sorted(groups.items()):
                old = connection.execute(
                    'SELECT hash,rows FROM snapshots WHERE kind=? AND scope=? AND day=? AND active=1',
                    (kind, scope, day),
                ).fetchone()
                same = old and (old[0] == digest or row_signature(json.loads(old[1])) == row_signature(records))
                if old and not same and not body.get('replace'):
                    raise ValueError(day + '已有不同记录。只有完整同范围新表才可勾选替换；本次未修改历史。')
                plan.append((day, records, old, same))
            archive = Path(base) / '日报历史' / '原表归档'
            archive.mkdir(exist_ok=True)
            target = archive / (digest + source.suffix.lower())
            if any(not item[3] for item in plan) and not target.exists():
                shutil.copyfile(captured, target)
            for day, records, old, same in plan:
                if same:
                    results.append({'date': day, 'state': '重复，跳过', 'rows': len(records)})
                    continue
                connection.execute('UPDATE snapshots SET active=0 WHERE kind=? AND scope=? AND day=?',
                                   (kind, scope, day))
                connection.execute('''INSERT INTO snapshots
                    (kind,scope,day,hash,created,source,metadata,rows,active) VALUES(?,?,?,?,?,?,?,?,1)''',
                    (kind, scope, day, digest, dt.datetime.now().isoformat(), str(target), metadata,
                     json.dumps(records, ensure_ascii=False)))
                results.append({'date': day, 'state': '替换并保留旧版' if old else '新增', 'rows': len(records)})
    return {'ok': True, 'results': results, 'mapping': mapping, 'metadata': metadata}


def state(base):
    with closing(db(base)) as connection:
        history = [dict(zip(('id', 'kind', 'scope', 'date', 'created', 'active'), row)) for row in
                   connection.execute('SELECT id,kind,scope,day,created,active FROM snapshots ORDER BY id DESC')]
    config = read_json(Path(base) / 'daily_config.json', {'templates': []})
    if not isinstance(config, dict) or not isinstance(config.get('templates', []), list):
        raise ValueError('日报配置格式错误；文件已保留，请从备份恢复。')
    config.setdefault('templates', [])
    return {'ok': True, 'history': history, 'config': config}


def load(base, kind, scope):
    rows, sources = [], []
    with closing(db(base)) as connection:
        for sid, day, created, metadata, encoded in connection.execute(
            'SELECT id,day,created,metadata,rows FROM snapshots WHERE active=1 AND kind=? AND scope=? ORDER BY day',
            (kind, scope),
        ):
            rows.extend(json.loads(encoded))
            sources.append({'id': sid, 'date': day, 'imported': created, 'filters': metadata})
    return rows, sources
