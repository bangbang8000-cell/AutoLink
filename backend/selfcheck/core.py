"""5.4.12-F54-12-4（P3.5）：设备配置自检 —— 检查项模型（单一事实源方向）。

检查项模型：id / 名称 / 类别 / 严重级 / 执行函数 → 结果（含修复建议）。
与 validation_engine（拓扑校验事实源）合并设计见 PRD；本模块先落地最小可用的
检查项注册 + 执行器，供后续 CLI / 工作台校验视图消费。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Sequence

Severity = str
SEV_INFO = "info"
SEV_WARN = "warn"
SEV_ERROR = "error"


@dataclass(frozen=True)
class CheckResult:
    check_id: str
    name: str
    severity: Severity
    ok: bool
    message: str
    detail: Optional[str] = None
    suggestion: Optional[str] = None


@dataclass
class CheckItem:
    id: str
    name: str
    category: str
    severity: Severity
    fn: Callable[[str], List[CheckResult]]

    def run(self, config_text: str) -> List[CheckResult]:
        try:
            return list(self.fn(config_text))
        except Exception as exc:  # 检查项自身异常不拖垮整批
            return [
                CheckResult(
                    check_id=self.id,
                    name=self.name,
                    severity=SEV_ERROR,
                    ok=False,
                    message=f"检查执行异常: {exc}",
                )
            ]


class CheckRegistry:
    """检查项注册表：幂等注册 + 按类别/严重级过滤 + 批量执行。"""

    def __init__(self) -> None:
        self._items: dict[str, CheckItem] = {}

    def register(self, item: CheckItem) -> None:
        if item.id in self._items:
            raise ValueError(f"重复注册检查项: {item.id}")
        self._items[item.id] = item

    def unregister(self, check_id: str) -> None:
        self._items.pop(check_id, None)

    def all(self) -> List[CheckItem]:
        return list(self._items.values())

    def get(self, check_id: str) -> Optional[CheckItem]:
        return self._items.get(check_id)

    def run(self, config_text: str, categories: Optional[Sequence[str]] = None) -> List[CheckResult]:
        out: List[CheckResult] = []
        for item in self._items.values():
            if categories and item.category not in categories:
                continue
            out.extend(item.run(config_text))
        return out


# ============================================================
# 便捷判定辅助
# ============================================================

def find_line(text: str, pattern: str, flags: int = re.IGNORECASE) -> Optional[str]:
    """在配置文本中查找首条匹配行（供无 TextFSM 的简单检查用）。"""
    for line in text.splitlines():
        if re.search(pattern, line, flags):
            return line
    return None


def collect_lines(text: str, pattern: str, flags: int = re.IGNORECASE) -> List[str]:
    return [ln for ln in text.splitlines() if re.search(pattern, ln, flags)]
