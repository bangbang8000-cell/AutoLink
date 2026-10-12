"""5.4.12-F54-12-4（P3.5）：设备配置自检引擎（检查项模型 + TextFSM 最小可用）。

面向"渲染产物/运行配置的自检"：把一段设备配置喂给注册的检查项，
得到结构化 CheckResult（id / 严重级 / ok / 建议），供 CLI 与工作台校验视图消费。
"""
from .core import CheckItem, CheckRegistry, CheckResult
from .runner import default_registry, run_self_checks
from .textfsm_mini import MiniTextFSM, MiniTextFSMError

__all__ = [
    "CheckItem",
    "CheckRegistry",
    "CheckResult",
    "MiniTextFSM",
    "MiniTextFSMError",
    "default_registry",
    "run_self_checks",
]
