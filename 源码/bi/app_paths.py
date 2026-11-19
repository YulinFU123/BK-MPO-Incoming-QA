"""Separate bundled read-only resources from user-owned data in a portable EXE."""
from pathlib import Path
import sys


def resolve_paths(frozen=None, executable=None, resource_file=None):
    frozen = getattr(sys, 'frozen', False) if frozen is None else frozen
    resources = Path(resource_file or __file__).resolve().parent
    if frozen:
        executable_root = Path(executable or sys.executable).resolve().parent
        return resources, executable_root / '用户数据'
    return resources, resources


RESOURCE_DIR, DATA_DIR = resolve_paths()
