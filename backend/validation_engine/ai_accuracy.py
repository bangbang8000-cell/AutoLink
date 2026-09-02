"""F5-4（45-a）AI 规划器准确性校验：AI 规划/优化建议与实际计算一致性

校验维度：
  A001 建议声称的当前收敛比 vs 后端真实计算（容差 0.05）
  A002 建议声称的应用后收敛比（impact）vs 按 patch 重算的真实值（容差 0.1）
  A003 建议 patch 引用的配置段/键必须真实存在（AI 声称的操作须可落地）
  A010 AI 规划器声称的收敛比/拓扑参数 vs 实际计算（通用 claims 校验）

说明：AI 优化建议（optimization.suggest / repair_plan）为确定性规则引擎产物，
本模块以真实计算为基准复核建议声称值，供测试与门禁复用。
"""
import re
from typing import Any, Dict, List, Optional, Sequence

from validation_engine.core import (
    ValidationProblem, SEVERITY_ERROR, SEVERITY_WARNING,
    CATEGORY_AI,
)

_TOLERANCE = 0.05      # 当前收敛比声称容差
_IMPACT_TOLERANCE = 0.1  # 应用后收敛比声称容差


def _parse_speed_gbps(speed_str: Any) -> float:
    """速率字符串（'400G'/'200G'）→ Gbps"""
    if not speed_str:
        return 400.0
    s = str(speed_str).strip().upper()
    for unit, factor in (('GB', 1.0), ('G', 1.0), ('TB', 1000.0), ('T', 1000.0)):
        if s.endswith(unit):
            try:
                return float(s[:-len(unit)]) * factor
            except ValueError:
                break
    try:
        return float(s)
    except ValueError:
        return 400.0


def _parse_ratio(text: str) -> Optional[float]:
    """从文本解析收敛比声称值：'收敛比 1.5:1' / '降至约 1.2:1'"""
    if not text:
        return None
    m = re.search(r'(?:收敛比|降至约)\s*([\d.]+)\s*:1', text)
    if m:
        try:
            return float(m.group(1))
        except ValueError:
            return None
    return None


def designer_convergence(designer: Any, net_type: str = 'param') -> Optional[Dict[str, Any]]:
    """从后端设计器对象计算指定网络真实收敛比（与 estimation 一致）。"""
    from estimation import calc_convergence_ratio
    if net_type == 'param':
        dl = int(getattr(designer, 'param_dl', 0) or 0)
        ports = int(getattr(designer, 'param_switch_ports', 0) or 0)
        speed = getattr(designer, 'param_speed', '400G')
        leaves = int(getattr(designer, 'param_leaf_count', 0) or 0)
    elif net_type == 'storage':
        dl = int(getattr(designer, 'storage_dl', 0) or 0)
        ports = int(getattr(designer, 'storage_switch_ports', 0) or 0)
        speed = getattr(designer, 'storage_speed', '200G')
        leaves = int(getattr(designer, 'storage_leaf_count', 0) or 0)
    else:
        return None
    ul = max(ports - dl, 0)
    if ul <= 0 or leaves <= 0:
        return None
    res = calc_convergence_ratio(net_type, dl, ul, _parse_speed_gbps(speed), leaves)
    return {
        'convergence_ratio': float(res.convergence_ratio),
        'target_ratio': float(res.target_ratio),
        'downlink': dl,
        'uplink': ul,
        'switch_ports': ports,
        'leaf_count': leaves,
    }


def _patch_topology_effect(patch: Dict[str, Any], designer: Any,
                           net_type: str) -> Optional[Dict[str, Any]]:
    """模拟应用 patch 后的收敛比（基于当前 designer 端口 + patch 覆盖值）。"""
    from estimation import calc_convergence_ratio
    if not isinstance(patch, dict):
        return None
    topo = patch.get('topology')
    if not isinstance(topo, dict):
        return None
    if net_type == 'param':
        dl = int(topo.get('param_downlink_limit') or getattr(designer, 'param_dl', 0) or 0)
        ports = int(topo.get('param_switch_ports') or getattr(designer, 'param_switch_ports', 0) or 0)
        speed = getattr(designer, 'param_speed', '400G')
        leaves = int(getattr(designer, 'param_leaf_count', 0) or 0)
    elif net_type == 'storage':
        dl = int(topo.get('storage_downlink_limit') or getattr(designer, 'storage_dl', 0) or 0)
        ports = int(topo.get('storage_switch_ports') or getattr(designer, 'storage_switch_ports', 0) or 0)
        speed = getattr(designer, 'storage_speed', '200G')
        leaves = int(getattr(designer, 'storage_leaf_count', 0) or 0)
    else:
        return None
    ul = max(ports - dl, 0)
    if ul <= 0 or leaves <= 0:
        return None
    res = calc_convergence_ratio(net_type, dl, ul, _parse_speed_gbps(speed), leaves)
    return {'convergence_ratio': float(res.convergence_ratio), 'downlink': dl, 'uplink': ul}


def _suggestion_net_type(suggestion: Dict[str, Any]) -> str:
    """推断建议目标网络：从 patch 键 / 文本推断 param | storage。"""
    patch = suggestion.get('patch')
    if isinstance(patch, dict):
        topo = patch.get('topology')
        if isinstance(topo, dict):
            keys = ' '.join(topo.keys())
            if 'storage' in keys:
                return 'storage'
            if 'param' in keys:
                return 'param'
    text = f"{suggestion.get('title', '')} {suggestion.get('description', '')}"
    if '存储网' in text or 'storage' in text.lower():
        return 'storage'
    return 'param'


def check_patch_targets(suggestion: Dict[str, Any],
                        config: Optional[Dict[str, Any]] = None) -> List[ValidationProblem]:
    """A003：建议 patch 引用的配置段/键必须真实存在（AI 声称的操作可落地）。"""
    problems: List[ValidationProblem] = []
    patch = suggestion.get('patch')
    if not isinstance(patch, dict):
        return problems
    if not isinstance(config, dict):
        return problems
    title = suggestion.get('title', '') or suggestion.get('category', '')
    for section, kv in patch.items():
        cfg_section = config.get(section)
        if not isinstance(cfg_section, dict):
            problems.append(ValidationProblem(
                rule_id='A003',
                severity=SEVERITY_ERROR,
                category=CATEGORY_AI,
                location=f'suggestion.patch.{section} ↔ config.{section}',
                message=f'AI 建议「{title}」引用不存在的配置段 {section}',
                suggestion='建议应只引用 project_config.json 真实存在的段',
                data={'section': section},
            ))
            continue
        if isinstance(kv, dict):
            for key in kv:
                if key not in cfg_section:
                    problems.append(ValidationProblem(
                        rule_id='A003',
                        severity=SEVERITY_ERROR,
                        category=CATEGORY_AI,
                        location=f'suggestion.patch.{section}.{key} ↔ config.{section}',
                        message=f'AI 建议「{title}」引用不存在的配置键 {section}.{key}',
                        suggestion='建议应只引用配置中真实存在的键',
                        data={'section': section, 'key': key},
                    ))
    return problems


def check_suggestion_accuracy(suggestion: Dict[str, Any],
                              designer: Any = None,
                              config: Optional[Dict[str, Any]] = None,
                              tolerance: float = _TOLERANCE,
                              impact_tolerance: float = _IMPACT_TOLERANCE) -> List[ValidationProblem]:
    """校验单条 AI 优化建议声称值与后端真实计算一致。"""
    problems: List[ValidationProblem] = []
    if not isinstance(suggestion, dict):
        return problems
    title = suggestion.get('title', '') or suggestion.get('category', '')

    # A003 先校验 patch 可落地（独立于 designer 是否存在）
    problems.extend(check_patch_targets(suggestion, config))

    if designer is None:
        return problems

    # A001 当前收敛比声称 vs 实际
    text = f"{suggestion.get('description', '')} {suggestion.get('title', '')}"
    claimed = _parse_ratio(text)
    if claimed is not None and suggestion.get('category') == 'convergence':
        net = _suggestion_net_type(suggestion)
        actual = designer_convergence(designer, net)
        if actual is not None and abs(claimed - actual['convergence_ratio']) > tolerance:
            problems.append(ValidationProblem(
                rule_id='A001',
                severity=SEVERITY_ERROR,
                category=CATEGORY_AI,
                location=f'suggestion.description（{net} 收敛比声称）',
                message=f'AI 建议「{title}」声称当前收敛比 {claimed}:1，'
                        f'后端真实计算为 {actual["convergence_ratio"]}:1',
                suggestion='建议声称值须来自后端真实计算，禁止虚构收敛比',
                data={'claimed': claimed, 'actual': actual['convergence_ratio'],
                      'net_type': net, 'title': title},
            ))

    # A002 应用后收敛比声称（impact）vs 按 patch 重算
    impact_text = suggestion.get('impact', '')
    impact_claimed = _parse_ratio(impact_text)
    if impact_claimed is not None and suggestion.get('category') == 'convergence':
        net = _suggestion_net_type(suggestion)
        recomputed = _patch_topology_effect(suggestion.get('patch'), designer, net)
        if recomputed is not None and abs(impact_claimed - recomputed['convergence_ratio']) > impact_tolerance:
            problems.append(ValidationProblem(
                rule_id='A002',
                severity=SEVERITY_WARNING,
                category=CATEGORY_AI,
                location=f'suggestion.impact（应用后收敛比声称）',
                message=f'AI 建议「{title}」声称应用后收敛比约 {impact_claimed}:1，'
                        f'按 patch 重算实际为 {recomputed["convergence_ratio"]:.2f}:1',
                suggestion='修正建议的 impact 预测，使其与 patch 实际效果一致',
                data={'claimed': impact_claimed, 'recomputed': recomputed['convergence_ratio'],
                      'net_type': net, 'title': title},
            ))

    return problems


def check_optimization_suggestions(suggestions: Sequence[Dict[str, Any]],
                                   designer: Any = None,
                                   config: Optional[Dict[str, Any]] = None) -> List[ValidationProblem]:
    """批量校验 AI 优化建议列表。"""
    problems: List[ValidationProblem] = []
    for sug in suggestions or []:
        problems.extend(check_suggestion_accuracy(sug, designer, config))
    return problems


def check_ai_plan_claims(claims: Optional[Dict[str, Any]],
                         actual: Optional[Dict[str, Any]],
                         tolerance: float = _TOLERANCE) -> List[ValidationProblem]:
    """A010 通用校验：AI 规划器声称的收敛比/拓扑参数 vs 后端真实计算。

    claims：{'param': 1.0, 'storage': 2.0}（AI 声称的收敛比）
    actual：{'param': 1.0, 'storage': 2.2}（后端真实计算）
    """
    problems: List[ValidationProblem] = []
    if not isinstance(claims, dict) or not isinstance(actual, dict):
        return problems
    for net, claimed in claims.items():
        try:
            claimed_f = float(claimed)
        except (TypeError, ValueError):
            problems.append(ValidationProblem(
                rule_id='A010',
                severity=SEVERITY_ERROR,
                category=CATEGORY_AI,
                location=f'claims.{net}',
                message=f'AI 声称值 {net}={claimed} 非法',
                suggestion='声称值须为数值',
                data={'net': net, 'claimed': claimed},
            ))
            continue
        if net not in actual:
            continue
        try:
            actual_f = float(actual[net])
        except (TypeError, ValueError):
            continue
        if abs(claimed_f - actual_f) > tolerance:
            problems.append(ValidationProblem(
                rule_id='A010',
                severity=SEVERITY_ERROR,
                category=CATEGORY_AI,
                location=f'claims.{net} ↔ actual.{net}',
                message=f'AI 声称 {net} 收敛比 {claimed_f}:1，后端真实计算为 {actual_f}:1',
                suggestion='AI 声称值应与后端真实计算一致',
                data={'net': net, 'claimed': claimed_f, 'actual': actual_f},
            ))
    return problems
