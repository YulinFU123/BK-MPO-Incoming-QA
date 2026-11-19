"""Workspace manager projection worker: local SELECT only; never initializes a DB."""
from pathlib import Path
import argparse
import json
import re
import sqlite3
import sys

sys.stdin.reconfigure(encoding='utf-8')
sys.stdout.reconfigure(encoding='utf-8')
sys.path.insert(0, str(Path(__file__).resolve().parent))
from lab_engine import service, store


def read(root, body):
    if body.get('action') != 'home':
        raise ValueError('工作区预览仅允许读取统计')
    identity = body.get('workspaceId', '')
    if not isinstance(identity, str) or not re.fullmatch(r'ws_[a-f0-9-]{36}', identity):
        raise ValueError('工作区标识无效')
    database = root / (identity + '.eap.analysis-data') / 'analysis-v1.sqlite'
    if not database.resolve().is_relative_to(root.resolve()):
        raise ValueError('工作区预览路径越界')
    if not database.is_file():
        return {'state': 'empty', 'channel': 'studio', 'message': '此工作区尚未导入BI数据。'}
    db = sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True, timeout=10)
    db.row_factory = sqlite3.Row
    try:
        db.execute('PRAGMA query_only=ON')
        if db.execute('PRAGMA user_version').fetchone()[0] != 1:
            raise ValueError('BI库版本不兼容，原文件保留')
        db.execute('BEGIN')
        # A fresh read-only connection must not reuse a cache from a prior SQLite snapshot.
        store.clear_rows_cache()
        count = db.execute('SELECT count(*) FROM records r JOIN files f ON r.file_id=f.id WHERE r.active=1 AND f.active=1').fetchone()[0]
        if count and not body.get('config', {}).get('sources'):
            return {'state': 'unconfigured', 'channel': 'studio', 'hasData': True,
                    'message': '已有BI明细，但此工作区的来源配置不可用；请恢复来源配置，未用人工零值代替。'}
        result = service.handle(db, body)
        if result.get('state') == 'ambiguous':
            defect_ids = [s['id'] for s in body.get('config', {}).get('sources', []) if s.get('kind') == 'defects']
            if defect_ids:
                marks = ','.join('?' for _ in defect_ids)
                found = db.execute(f'SELECT 1 FROM records r JOIN files f ON r.file_id=f.id WHERE r.active=1 AND f.active=1 AND r.source_id IN ({marks}) LIMIT 1', defect_ids).fetchone()
                if found:
                    result['hasData'] = True
        return result
    finally:
        db.rollback()
        db.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--data', required=True)
    parser.add_argument('--source')
    args = parser.parse_args()
    root = Path(args.data)
    print(json.dumps({'ready': True}), flush=True)
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            if request.get('control') == 'close':
                print(json.dumps({'id': request.get('id'), 'ok': True, 'value': True}), flush=True)
                break
            value = read(root, request.get('body', {}))
            print(json.dumps({'id': request.get('id'), 'ok': True, 'value': value}, ensure_ascii=False, allow_nan=False), flush=True)
        except Exception as e:
            print(json.dumps({'id': request.get('id'), 'ok': False, 'error': str(e)}, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
