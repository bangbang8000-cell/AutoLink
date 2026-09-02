"""4.5 数据准确性与校验体系（F5-1~F5-5）— 统一校验问题模型

提供跨 T1-T4 复用的结构化校验问题结构：
  - rule_id：规则 ID（C=一致性 / E=导出核对 / IP=IP 规划 / A=AI 准确性）
  - severity：error（必须修复）/ warning（建议修复）/ info（提示）
  - category：问题类别（一致性 / 导出核对 / IP规划 / AI准确性）
  - location：字段定位（含中文 + 字段路径，UI 可直接展示）
  - message：中文问题描述
  - suggestion：修复建议
  - data：结构化附加数据（供测试与门禁精确断言）

同时提供 ValidationReport（汇总 + 分组统计 + JSON 序列化），供 UI 校验面板与测试复用。
"""
import datetime
import json
from dataclasses import dataclass, field, asdict
from typing import Any, Dict, List, Optional


SEVERITY_ERROR = 'error'
SEVERITY_WARNING = 'warning'
SEVERITY_INFO = 'info'
SEVERITIES = (SEVERITY_ERROR, SEVERITY_WARNING, SEVERITY_INFO)

CATEGORY_CONSISTENCY = '一致性'
CATEGORY_DESIGN = '设计内部'
CATEGORY_RENDER = '渲染'
CATEGORY_EXPORT = '导出核对'
CATEGORY_IP = 'IP规划'
CATEGORY_AI = 'AI准确性'
CATEGORIES = (CATEGORY_CONSISTENCY, CATEGORY_DESIGN, CATEGORY_RENDER,
              CATEGORY_EXPORT, CATEGORY_IP, CATEGORY_AI)

REPORT_SCHEMA_VERSION = 1


@dataclass
class ValidationProblem:
    """结构化校验问题"""
    rule_id: str
    severity: str            # error | warning | info
    category: str            # 类别
    location: str            # 字段定位
    message: str             # 中文描述
    suggestion: str          # 修复建议
    data: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            'ruleId': self.rule_id,
            'severity': self.severity,
            'category': self.category,
            'location': self.location,
            'message': self.message,
            'suggestion': self.suggestion,
            'data': self.data,
        }


def _now_iso() -> str:
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')


@dataclass
class ValidationReport:
    """校验报告：scope（校验范围）+ problems（问题列表）"""
    scope: Dict[str, Any]
    problems: List[ValidationProblem] = field(default_factory=list)
    generated_at: str = field(default_factory=_now_iso)

    @property
    def valid(self) -> bool:
        """无 error 级问题即通过（warning/info 不阻断）"""
        return not any(p.severity == SEVERITY_ERROR for p in self.problems)

    def add(self, problem: ValidationProblem) -> None:
        self.problems.append(problem)

    def extend(self, problems: List[ValidationProblem]) -> None:
        self.problems.extend(problems)

    def summary(self) -> Dict[str, Any]:
        by_severity = {s: 0 for s in SEVERITIES}
        by_category: Dict[str, int] = {}
        for p in self.problems:
            by_severity[p.severity] = by_severity.get(p.severity, 0) + 1
            by_category[p.category] = by_category.get(p.category, 0) + 1
        return {
            'valid': self.valid,
            'total': len(self.problems),
            'bySeverity': by_severity,
            'byCategory': dict(sorted(by_category.items(), key=lambda kv: (-kv[1], kv[0]))),
        }

    def to_dict(self) -> Dict[str, Any]:
        return {
            'schemaVersion': REPORT_SCHEMA_VERSION,
            'generatedAt': self.generated_at,
            'scope': self.scope,
            'summary': self.summary(),
            'problems': [p.to_dict() for p in self.problems],
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False, indent=indent)


def sort_problems(problems: List[ValidationProblem]) -> List[ValidationProblem]:
    """按严重度（error→warning→info）与规则 ID 稳定排序"""
    rank = {SEVERITY_ERROR: 0, SEVERITY_WARNING: 1, SEVERITY_INFO: 2}
    return sorted(problems, key=lambda p: (rank.get(p.severity, 3), p.rule_id))
