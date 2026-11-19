"""Shared validation and atomic UTF-8 configuration I/O for the daily workflow."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any


def parse_date(value: Any, label: str = '日期') -> str:
    """Accept Excel dates and unambiguous year-first dates; never guess locale."""
    if isinstance(value, dt.datetime):
        return value.date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    text = str(value or '').strip()
    if not text:
        raise ValueError(f'请填写{label}。')
    match = re.fullmatch(r'(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T]\d{2}:\d{2}:\d{2}(?:\.\d+)?)?', text)
    try:
        if match:
            return dt.date(*map(int, match.groups())).isoformat()
    except ValueError:
        pass
    raise ValueError(f'{label}无效，请使用 YYYY-MM-DD，例如 2026-10-16。')


def date_range(query: dict) -> tuple[str, str]:
    start = parse_date(query.get('start'), '起始业务日')
    end = parse_date(query.get('end'), '结束业务日')
    if start > end:
        raise ValueError('起始业务日不能晚于结束业务日。')
    return start, end


def stable_hash(value: Any) -> str:
    raw = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(raw.encode('utf-8')).hexdigest()


def atomic_json(path: Path, value: Any) -> None:
    """Replace only after a complete UTF-8 write; retain the previous file on failure."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, name = tempfile.mkstemp(prefix=path.name + '.', suffix='.tmp', dir=path.parent)
    try:
        with os.fdopen(fd, 'w', encoding='utf-8') as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2, allow_nan=False)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding='utf-8-sig'))
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError(f'{path.name}无法读取；原文件已保留，请从备份恢复，勿直接覆盖。') from exc
