"""5.4.14-F54-14-2：本地遥测（默认关 / 脱敏 / 可导出）。

- 开关持久化在 ops_config.json（enable_telemetry，默认 False）
- 事件追加到 telemetry.jsonl（JSON 行），仅本地落盘，不联网
- 写前脱敏：password/token/api_key/secret 等字段值 → ***（防 PII/密钥泄漏）
- 可导出：export() 返回最近 N 条 + 计数（供支持包/诊断使用）
"""
from __future__ import annotations

import json
import os
import re
import time
from typing import Any, Dict, List, Optional, Iterator
from contextlib import contextmanager

_SENSITIVE_KEY_RE = re.compile(
    r"(password|passwd|pwd|token|api[_-]?key|secret|authorization|credential|private[_-]?key)",
    re.IGNORECASE,
)


def sanitize_event(event: Dict[str, Any]) -> Dict[str, Any]:
    """递归脱敏：键名命中敏感词 → 值替换为 ***。原事件不被修改。"""
    out: Dict[str, Any] = {}
    for k, v in event.items():
        if isinstance(v, dict):
            out[k] = sanitize_event(v)
        elif _SENSITIVE_KEY_RE.search(str(k)):
            out[k] = "***"
        else:
            out[k] = v
    return out


class Telemetry:
    """本地遥测写入器（默认关；可注入路径便于测试）。"""

    def __init__(self, config_path: str, log_path: str) -> None:
        self.config_path = config_path
        self.log_path = log_path

    # ---- 开关 ----

    def _load_config(self) -> dict:
        try:
            with open(self.config_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (OSError, ValueError):
            return {}

    def is_enabled(self) -> bool:
        return bool(self._load_config().get("enable_telemetry", False))

    def set_enabled(self, enabled: bool) -> bool:
        cfg = self._load_config()
        cfg["enable_telemetry"] = bool(enabled)
        os.makedirs(os.path.dirname(self.config_path) or ".", exist_ok=True)
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        return bool(enabled)

    # ---- 事件 ----

    def record(self, event: Dict[str, Any]) -> Optional[int]:
        """记录一条事件（脱敏后追加）。返回当前事件计数；关闭时返回 None。"""
        if not self.is_enabled():
            return None
        line = {
            "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
            "event": sanitize_event(event),
        }
        os.makedirs(os.path.dirname(self.log_path) or ".", exist_ok=True)
        with open(self.log_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(line, ensure_ascii=False) + "\n")
        return self.count()

    def count(self) -> int:
        try:
            with open(self.log_path, "r", encoding="utf-8") as f:
                return sum(1 for _ in f)
        except OSError:
            return 0

    def export(self, limit: int = 100) -> List[dict]:
        """导出最近 limit 条事件（不含 ts 之外的包装），供支持包使用。"""
        try:
            with open(self.log_path, "r", encoding="utf-8") as f:
                lines = [json.loads(ln) for ln in f if ln.strip()]
        except (OSError, ValueError):
            return []
        return lines[-limit:]

    def clear(self) -> None:
        try:
            os.remove(self.log_path)
        except OSError:
            pass


_default_dir = os.path.join(os.path.expanduser("~"), ".autolink", "ops")
default_telemetry = Telemetry(
    config_path=os.path.join(_default_dir, "ops_config.json"),
    log_path=os.path.join(_default_dir, "telemetry.jsonl"),
)


@contextmanager
def timed_telemetry(tel: Telemetry, stage: str, detail: Optional[Dict[str, Any]] = None) -> Iterator[None]:
    """5.4.14-F54-14-4：耗时埋点 —— 记录某环节耗时（遥测开启时），配合 5.4.9 性能基线。

    用法：
        with timed_telemetry(default_telemetry, "matrix_layout", {"racks": 225}):
            run_layout()
    关闭时零开销（仅计时与判断开关）。
    """
    start = time.monotonic()
    try:
        yield
    finally:
        cost_ms = int((time.monotonic() - start) * 1000)
        tel.record({"op": "timing", "stage": stage, "cost_ms": cost_ms, **(detail or {})})


__all__ = ["Telemetry", "sanitize_event", "default_telemetry", "timed_telemetry"]
