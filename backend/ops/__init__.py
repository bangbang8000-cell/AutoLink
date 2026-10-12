"""5.4.14-F54-14-1（F54-14-2）：运维保障 —— 支持包导出 + 本地遥测。

- 支持包：一键打包 版本信息 + 配置快照 + 日志尾部 + 审计尾部 → 时间戳 zip
- 遥测：默认关 / PII 脱敏 / JSONL 追加 / 可导出计数（本地可观测，不联网）
"""
from .support_bundle import export_support_bundle
from .telemetry import Telemetry, sanitize_event, default_telemetry

__all__ = [
    "export_support_bundle",
    "Telemetry",
    "sanitize_event",
    "default_telemetry",
]
