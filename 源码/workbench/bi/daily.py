"""Daily workflow facade. V9 engine stays isolated; public routes remain compatible."""
from pathlib import Path
from daily_common import atomic_json
from daily_source import ALIASES, FIELDS, read_table
from daily_store import db, ingest, load, state
from daily_analysis import analyze
from daily_report import export_report, save_images


def dispatch(base, action, body):
    if not isinstance(body, dict):
        raise ValueError('请求内容必须是对象。')
    if action == 'state':
        return state(base)
    if action == 'import':
        return ingest(base, body)
    if action == 'analyze':
        return analyze(base, body.get('query', {}))
    if action == 'export':
        return export_report(base, body)
    if action == 'images':
        return save_images(base, body)
    if action == 'save':
        config = body.get('config')
        if not isinstance(config, dict) or not isinstance(config.get('templates', []), list):
            raise ValueError('日报配置格式无效，未覆盖原配置。')
        atomic_json(Path(base) / 'daily_config.json', config)
        return {'ok': True}
    raise ValueError('未知日报操作。')
