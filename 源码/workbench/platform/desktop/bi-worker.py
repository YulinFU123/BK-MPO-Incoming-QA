"""Trusted local BI adapter. JSON lines over inherited pipes; no HTTP listener.

The original V10.2 source remains byte-for-byte preserved. This adapter retains
its handlers and storage protocols while selecting an explicit working copy.
"""
import argparse
import ast
import contextlib
import datetime
import io
import json
import os
from pathlib import Path
import sys
import traceback
import types
import uuid

sys.dont_write_bytecode = True

WORKER_LOG = None


def setup_error_log(data_dir):
    """Keep a bounded, structured diagnostic log in the BI working copy.
    Only exception classes, messages and stack frames are written; never source
    rows or business values."""
    global WORKER_LOG
    try:
        path = Path(data_dir) / 'bi-worker.log'
        if path.exists() and path.stat().st_size > 2 * 1024 * 1024:
            path.replace(path.with_name(path.name + '.1'))
        WORKER_LOG = path
    except Exception:
        WORKER_LOG = None


def record_error(error_id, error):
    if WORKER_LOG is None:
        return
    try:
        with open(WORKER_LOG, 'a', encoding='utf-8') as handle:
            handle.write(
                '\n[%s] %s %s: %s\n' % (
                    datetime.datetime.now().isoformat(timespec='seconds'),
                    error_id,
                    type(error).__name__,
                    error,
                )
            )
            handle.write(traceback.format_exc())
    except Exception:
        pass


class PathPolicy:
    def __init__(self, base):
        self.base = Path(base).resolve()
        self.reads = {self.base}
        self.writes = {self.base}

    def grant(self, value, write=False):
        original = Path(value)
        if original.is_symlink() or original.is_junction():
            raise ValueError('不能选用符号链接。')
        target = original.resolve(strict=True)
        self.reads.add(target)
        if write:
            if not target.is_dir():
                raise ValueError('输出位置必须是文件夹。')
            self.writes.add(target)

    def checked(self, value, write=False):
        if not isinstance(value, str) or not value or '\x00' in value:
            raise ValueError('文件位置无效，请通过选择按钮重新选择。')
        candidate = Path(value)
        target = (candidate if candidate.is_absolute() else self.base / candidate).resolve()
        for root in self.writes if write else self.reads:
            if target == root or (root.is_dir() and root in target.parents):
                return str(target)
        raise ValueError('此位置尚未授权。请使用选择按钮；输出和历史库应保存在当前 BI 工作副本内。')

    def config(self, body):
        config = body.get('config')
        if not isinstance(config, dict):
            return
        paths = config.get('paths', {})
        if not isinstance(paths, dict):
            raise ValueError('BI目录配置格式无效。')
        pattern = paths.get('pattern', 'data*.xlsx')
        if not isinstance(pattern, str) or not pattern or any(value in pattern for value in ('/', '\\', ':', '\x00')):
            raise ValueError('文件名规则只填写名称，例如 data*.xlsx；请在原表目录中选择文件夹，不要把路径填到规则里。')
        for name in ('input', 'history', 'output'):
            if name in paths:
                self.checked(paths[name], write=name != 'input')
        # Source files stay read-only outside the private working copy.
        if config.get('P', {}).get('导入后归档原表') == '是':
            self.checked(paths.get('input', '每日原表'), write=True)


GET_ROUTES = {'/api/ping', '/api/state', '/api/status'}
POST_ROUTES = {
    '/api/save', '/api/scan', '/api/preview', '/api/analytics', '/api/analytics/export',
    '/api/analytics/detail',
    '/api/run', '/api/legacy', '/api/names', '/api/bye',
    '/api/daily/state', '/api/daily/save', '/api/daily/import', '/api/daily/analyze',
    '/api/daily/export', '/api/daily/images', '/api/fusion/inbox', '/api/fusion/home',
}


def prepare(source, base):
    source, base = Path(source).resolve(strict=True), Path(base).resolve()
    base.mkdir(parents=True, exist_ok=True)
    # Inject paths BEFORE importing panel, which otherwise writes in its source.
    paths = types.ModuleType('app_paths')
    paths.RESOURCE_DIR, paths.DATA_DIR = source, base
    sys.modules['app_paths'] = paths
    trusted_path = [str(source)] + [p for p in sys.path if p and Path(p).resolve() != base]
    sys.path[:] = trusted_path
    class TrustedFormula(str):
        pass

    class FormulaLiterals(ast.NodeTransformer):
        def visit_JoinedStr(self, node):
            self.generic_visit(node)
            if node.values and isinstance(node.values[0], ast.Constant) and isinstance(node.values[0].value, str) and node.values[0].value.startswith('='):
                return ast.copy_location(ast.Call(func=ast.Name(id='_fusion_formula', ctx=ast.Load()), args=[node], keywords=[]), node)
            return node

    # Mark only reviewed formula literals in the ORIGINAL program. A value read
    # from a source file/config cannot acquire this marker by matching a string.
    engine_path = source / 'engine.py'
    engine = types.ModuleType('engine')
    engine.__file__ = str(engine_path)
    engine._fusion_formula = TrustedFormula
    sys.modules['engine'] = engine
    tree = FormulaLiterals().visit(ast.parse(engine_path.read_text(encoding='utf-8-sig'), filename=str(engine_path)))
    exec(compile(ast.fix_missing_locations(tree), str(engine_path), 'exec'), engine.__dict__)
    import analytics
    import daily
    import bi_bridge
    import importlib.util
    filter_spec = importlib.util.spec_from_file_location('fusion_filter_guard', Path(__file__).with_name('bi-filter-guard.py'))
    filter_guard = importlib.util.module_from_spec(filter_spec)
    filter_spec.loader.exec_module(filter_guard)
    filter_guard.install(bi_bridge)
    defect_spec = importlib.util.spec_from_file_location('fusion_defect_filter', Path(__file__).with_name('bi-defect-filter.py'))
    defect_filter = importlib.util.module_from_spec(defect_spec)
    defect_spec.loader.exec_module(defect_filter)
    defect_filter.install()
    import panel
    # panel's original startup prepends BASE and BASE/libs; remove both again.
    sys.path[:] = trusted_path
    # Plain source strings are never evaluated as workbook formulas. Preserve
    # the engine's explicitly marked SUM/IF/cumulative-share formulas.
    from openpyxl.cell.cell import Cell
    original_bind = Cell._bind_value

    def bind_text(self, value):
        original_bind(self, value)
        if isinstance(value, str) and not isinstance(value, TrustedFormula) and value.startswith('=') and self.data_type == 'f':
            self.data_type = 's'

    Cell._bind_value = bind_text
    return panel, PathPolicy(base)


def dispatch(panel, policy, route, body=None):
    from urllib.parse import urlsplit
    endpoint = urlsplit(route).path
    if endpoint not in (GET_ROUTES if body is None else POST_ROUTES):
        raise ValueError('未开放的 BI 操作。')
    if body is not None:
        if not isinstance(body, dict):
            raise ValueError('请求内容必须为对象。')
        policy.config(body)
        if endpoint in ('/api/scan', '/api/run', '/api/analytics', '/api/analytics/export',
                        '/api/analytics/detail', '/api/preview', '/api/fusion/home'):
            policy.config({'config': body.get('config') or panel.engine.load_config_file(panel.BASE)})
        if endpoint in ('/api/daily/import', '/api/legacy', '/api/names') and body.get('path'):
            body = dict(body, path=policy.checked(body['path']))
        if endpoint == '/api/daily/images' and body.get('path'):
            body = dict(body, path=policy.checked(body['path'], write=True))

    if endpoint == '/api/fusion/home':
        import importlib.util
        spec = importlib.util.spec_from_file_location('fusion_home', Path(__file__).with_name('bi-home.py'))
        module = sys.modules.get('fusion_home')
        if module is None:
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            sys.modules['fusion_home'] = module
        with panel.DATA_LOCK:
            return module.report(panel, body)

    if endpoint == '/api/fusion/inbox':
        import importlib.util
        spec = importlib.util.spec_from_file_location('fusion_inbox', Path(__file__).with_name('bi-inbox.py'))
        module = sys.modules.get('fusion_inbox')
        if module is None:
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            sys.modules['fusion_inbox'] = module
        import daily, bi_bridge
        with panel.DATA_LOCK:
            return module.poll(panel.BASE, dict(body, folder=policy.checked(body.get('folder'))), daily, bi_bridge)

    class LocalRequest(panel.H):
        def __init__(self):
            self.path = route
            payload = json.dumps(body, ensure_ascii=False).encode('utf-8') if body is not None else b''
            self.headers = {'Host': '127.0.0.1', 'Content-Length': str(len(payload))}
            self.rfile = io.BytesIO(payload)
            self.result = None

        def _send(self, code, value, ctype='application/json; charset=utf-8'):
            if code >= 400:
                raise ValueError('BI请求未完成。')
            self.result = value

    request = LocalRequest()
    # Serial request loop plus original DATA_LOCK serializes import/export. The
    # original report job is still asynchronous and exposed by /api/status.
    (request.do_GET if body is None else request.do_POST)()
    return request.result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--data', required=True)
    args = parser.parse_args()
    sys.stdin.reconfigure(encoding='utf-8')
    protocol = sys.stdout
    protocol.reconfigure(encoding='utf-8', newline='\n', line_buffering=True)
    # Keep engine diagnostics out of the machine-readable channel.
    sys.stdout = sys.stderr
    setup_error_log(args.data)
    panel, policy = prepare(args.source, args.data)
    protocol.write(json.dumps({'ready': True, 'protocol': 1}) + '\n')
    for line in sys.stdin:
        if len(line) > 130 * 1024 * 1024:
            break
        request = None
        try:
            request = json.loads(line)
            identity = request['id']
            if request.get('control') == 'grant':
                policy.grant(request['path'], request.get('write') is True)
                result = True
            elif request.get('control') == 'close':
                with panel.LOCK:
                    if panel.S['running']:
                        raise ValueError('BI报表仍在生成，请等待完成后再锁定或关闭。')
                protocol.write(json.dumps({'id': identity, 'ok': True, 'value': True}) + '\n')
                break
            else:
                result = dispatch(panel, policy, request['route'], request.get('body'))
            protocol.write(json.dumps({'id': identity, 'ok': True, 'value': result}, ensure_ascii=False, default=str, allow_nan=False) + '\n')
        except Exception as error:
            # User input validation stays actionable in the UI. Unexpected
            # failures disclose only the class over IPC, but the full traceback
            # is written to a bounded log in the BI working copy so the problem
            # can actually be diagnosed instead of showing "KeyError" forever.
            if isinstance(error, ValueError):
                message = str(error)
            else:
                error_id = 'BI-%s-%s' % (
                    datetime.datetime.now().strftime('%Y%m%d-%H%M%S'),
                    uuid.uuid4().hex[:6],
                )
                record_error(error_id, error)
                message = 'BI操作失败：%s（记录编号 %s，详情见 BI工作副本\\bi-worker.log）' % (
                    type(error).__name__, error_id
                )
            protocol.write(json.dumps({'id': request.get('id') if isinstance(request, dict) else None, 'ok': False, 'error': message}, ensure_ascii=False) + '\n')
    # EOF is the parent lifetime boundary. Do not leave an orphan report worker.
    os._exit(0)


if __name__ == '__main__':
    main()
