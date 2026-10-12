"""5.4.12-F54-12-4（P3.5）：最小可用 TextFSM 引擎。

实现 Google TextFSM 的一个务实子集，足以解析设备运行配置为结构化记录：
- `Value NAME (regex)` —— 声明可提取变量
- `Start` —— 状态起点
- `^ 正则（含 ${NAME} 引用）[-> Record]` —— 匹配行；`-> Record` 触发当前记录落盘并重置
- 按行顺序累积"最近一次命中"的值；Record 时输出当前快照

不支持的完整 TextFSM 特性（多状态机 / Next / . 行 / Filldown 等）由调用方模板避免。
后续可直接换用官方 textfsm 包（保持模板语法兼容），本实现仅保证"最小可用"。
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, List, Optional


class MiniTextFSMError(ValueError):
    pass


@dataclass
class _ValueDecl:
    name: str
    regex: str
    required: bool = False


@dataclass
class _Rule:
    pattern: str  # 已把 ${NAME} 替换为 (?P<NAME>regex)
    emit: bool  # 命中后 Record


_VALUE_RE = re.compile(r"^\s*Value(?:\s+(\w+))?\s+(\S+)\s+\((.+)\)\s*$")
_RULE_RE = re.compile(r"^\s*\^(.+?)\s*(?:->\s*(\w+))?\s*$")


class MiniTextFSM:
    """解析 TextFSM 模板子集 → 逐行匹配文本 → 记录列表。"""

    def __init__(self, template: str) -> None:
        self._values: List[_ValueDecl] = []
        self._rules: List[_Rule] = []
        self._compile(template)

    def _compile(self, template: str) -> None:
        in_start = False
        for raw in template.splitlines():
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            vm = _VALUE_RE.match(line)
            if vm:
                required = vm.group(1) == "Required"
                self._values.append(_ValueDecl(vm.group(2), vm.group(3), required))
                continue
            if line == "Start":
                in_start = True
                continue
            if not in_start:
                continue
            rm = _RULE_RE.match(line)
            if not rm:
                raise MiniTextFSMError(f"无法解析模板行: {line!r}")
            pattern_src = rm.group(1).rstrip()
            action = (rm.group(2) or "").strip().lower()
            # 替换 ${NAME} 引用
            pattern = pattern_src
            for v in self._values:
                pattern = pattern.replace("${" + v.name + "}", f"(?P<{v.name}>{v.regex})")
            if "${" in pattern:
                raise MiniTextFSMError(f"模板引用了未声明变量: {pattern_src!r}")
            self._rules.append(_Rule(pattern, emit=(action == "record")))

    def parse(self, text: str) -> List[Dict[str, str]]:
        current: Dict[str, str] = {}
        seen: set[str] = set()
        records: List[Dict[str, str]] = []
        names = [v.name for v in self._values]

        for line in text.splitlines():
            for rule in self._rules:
                m = re.match(rule.pattern, line)
                if not m:
                    continue
                for name in names:
                    val = m.groupdict().get(name)
                    if val is not None:
                        current[name] = val
                        seen.add(name)
                if rule.emit:
                    records.append({n: current.get(n, "") for n in names})
                    current = {}
                    seen = set()
                break  # 每行只匹配首条规则（与 TextFSM 语义一致）
        return records

    @property
    def value_names(self) -> List[str]:
        return [v.name for v in self._values]
