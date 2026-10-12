"""5.4.12-F54-12-4（P3.5）：自检执行器（注册默认检查项 + 一键运行）。"""
from __future__ import annotations

from typing import List, Optional, Sequence

from .checks import BUILTIN_CHECKS
from .core import CheckItem, CheckRegistry, CheckResult


def default_registry() -> CheckRegistry:
    registry = CheckRegistry()
    for item in BUILTIN_CHECKS:
        registry.register(item)
    return registry


def run_self_checks(
    config_text: str,
    categories: Optional[Sequence[str]] = None,
    registry: Optional[CheckRegistry] = None,
) -> List[CheckResult]:
    """对一段设备配置运行全部（或指定类别）自检项。"""
    reg = registry or default_registry()
    return reg.run(config_text, categories=categories)


__all__ = [
    "CheckItem",
    "CheckRegistry",
    "CheckResult",
    "default_registry",
    "run_self_checks",
]
