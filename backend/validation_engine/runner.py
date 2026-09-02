"""F5-5（45-f）校验执行器：一键运行 T1-T4，产出统一校验报告（JSON 可导出）。

- build_design_dict：从后端 NetworkDesignerV2 对象提取规范化设计 dict（只读，不修改设计器）
- run_all_validation：运行一致性 / 导出核对 / IP 规划 / AI 准确性全部维度
- export_report_json：校验报告落盘（UTF-8 JSON）
"""
import json
import os
from typing import Any, Dict, List, Optional

from validation_engine.core import (
    ValidationReport, ValidationProblem, sort_problems,
)
from validation_engine.consistency import run_consistency_checks
from validation_engine.export_check import check_export_batch, collect_batch_stats
from validation_engine.ip_check import check_ip_plan
from validation_engine.ai_accuracy import (
    check_optimization_suggestions, check_ai_plan_claims,
)


# ---------------- 设计对象适配器（只读 NetworkDesignerV2） ----------------

def _device_model(dev: Any) -> str:
    try:
        profile = getattr(dev, 'device_profile', None)
        if profile is not None:
            return str(getattr(profile, 'model', '') or '')
    except Exception:
        pass
    return ''


def build_design_dict(designer: Any) -> Dict[str, Any]:
    """从后端设计器对象提取规范化设计 dict（供一致性/导出核对/AI 校验复用）。"""
    if designer is None:
        return {}

    # 网络设备计数
    network_devices = {
        'param_leaves': len(getattr(designer, 'param_leaves', []) or []),
        'param_spines': len(getattr(designer, 'param_spines', []) or []),
        'param_cores': len(getattr(designer, 'param_cores', []) or []),
        'storage_leaves': len(getattr(designer, 'storage_leaves', []) or []),
        'storage_spines': len(getattr(designer, 'storage_spines', []) or []),
        'biz_access': len(getattr(designer, 'biz_access', []) or []),
        'biz_agg': len(getattr(designer, 'biz_agg', []) or []),
        'oob_access': len(getattr(designer, 'oob_access', []) or []),
        'oob_agg': len(getattr(designer, 'oob_agg', []) or []),
    }

    # 机柜设备（按 cabinet_id 聚合）
    cabinets: List[Dict[str, Any]] = []
    cab_map: Dict[Any, Dict[str, Any]] = {}
    rack_type_map = {}
    try:
        rack_type_map = {cab.id: cab.type for cab in (getattr(designer, '_rack_cabinets', []) or [])}
    except Exception:
        pass
    for dev in getattr(designer, 'all_devices', lambda: [])():
        cid = getattr(dev, 'cabinet_id', None)
        if cid is None:
            continue
        cab = cab_map.get(cid)
        if cab is None:
            cab = {
                'id': cid,
                'name': getattr(dev, 'cabinet_name', '') or f'机柜{cid}',
                'type': rack_type_map.get(cid, ''),
                'total_u': int(getattr(designer, 'rack_type', 42) or 42),
                'power_limit': int(getattr(designer, 'power_limit_per_rack', 0) or 0),
                'devices': [],
            }
            cab_map[cid] = cab
            cabinets.append(cab)
        cab['devices'].append({
            'name': getattr(dev, 'name', ''),
            'type': getattr(dev, 'obj_type', ''),
            'model': _device_model(dev),
            'start_u': int(getattr(dev, 'start_u', 0) or 0),
            'end_u': int(getattr(dev, 'end_u', 0) or 0),
            'power_watts': int(getattr(dev, 'power_watts', 0) or 0),
        })

    # 连接（网络对象 connections 去重：仅 A 端设备计数一次）
    conns: List[Dict[str, str]] = []
    seen_pairs = set()
    for dev in getattr(designer, 'all_devices', lambda: [])():
        for conn in getattr(dev, 'connections', []) or []:
            a = getattr(conn, 'a_device', '')
            z = getattr(conn, 'z_device', '')
            if getattr(conn, 'a_device', None) != getattr(dev, 'name', None):
                continue
            key = tuple(sorted([a, z])) + (getattr(conn, 'a_port', ''),)
            if key in seen_pairs:
                continue
            seen_pairs.add(key)
            conns.append({
                'source': a,
                'target': z,
                'network_type': getattr(conn, 'network_type', '') or '',
            })

    return {
        'servers': len(getattr(designer, 'servers', []) or []),
        'total_servers': int(getattr(designer, 'total_servers', 0) or 0),
        'mode': getattr(designer, 'downlink_mode', '') or '',
        'network_devices': network_devices,
        'cabinets': cabinets,
        'unplaced_devices': [],
        'connections': conns,
    }


# ---------------- 校验执行器 ----------------

def run_all_validation(plan: Optional[Dict] = None,
                       design: Optional[Dict] = None,
                       designer: Any = None,
                       render: Optional[Dict] = None,
                       batch_dir: Optional[str] = None,
                       suggestions: Optional[List[Dict]] = None,
                       ai_claims: Optional[Dict] = None,
                       ai_actual: Optional[Dict] = None,
                       config: Optional[Dict] = None,
                       scope: Optional[Dict] = None) -> ValidationReport:
    """一键运行全部校验维度（T1 一致性 / T2 导出核对 / T3 IP 规划 / T4 AI 准确性）。

    参数均可选：传入即可校验对应维度；designer 提供时自动提取 design dict。
    """
    if designer is not None:
        design = design or build_design_dict(designer)
    scope = dict(scope or {})
    scope.setdefault('schema', 'al-data-accuracy/4.5')
    report = ValidationReport(scope=scope)

    # T1 一致性（规划↔设计 / 设计内部 / 设计→渲染）
    report.extend(run_consistency_checks(plan, design, render))

    # T2 导出核对
    if batch_dir:
        report.extend(check_export_batch(batch_dir, design))

    # T3 IP 规划
    if plan is not None:
        report.extend(check_ip_plan(plan))

    # T4 AI 准确性
    if suggestions is not None:
        report.extend(check_optimization_suggestions(suggestions, designer or _DesignerProxy(design), config))
    if ai_claims is not None and ai_actual is not None:
        report.extend(check_ai_plan_claims(ai_claims, ai_actual))

    report.problems = sort_problems(report.problems)
    return report


class _DesignerProxy:
    """当未传 designer 对象、仅传设计 dict 时，供建议端口效果重算的轻量代理。"""

    def __init__(self, design: Optional[Dict]):
        self._design = design or {}
        nd = self._design.get('network_devices') or {}
        self.param_dl = 0
        self.param_switch_ports = 0
        self.param_leaf_count = int(nd.get('param_leaves', 0) or 0)
        self.storage_dl = 0
        self.storage_switch_ports = 0
        self.storage_leaf_count = int(nd.get('storage_leaves', 0) or 0)
        self.param_speed = '400G'
        self.storage_speed = '200G'


def export_report_json(report: ValidationReport, filepath: str) -> str:
    """校验报告落盘（UTF-8 JSON，无 BOM），返回落盘路径。"""
    os.makedirs(os.path.dirname(os.path.abspath(filepath)) or '.', exist_ok=True)
    with open(filepath, 'w', encoding='utf-8') as f:
        json.dump(report.to_dict(), f, ensure_ascii=False, indent=2)
    return filepath


def build_render_dict(batch_dir: str) -> Dict[str, Any]:
    """由批次目录统计构建渲染 dict（供 T1 渲染一致性复用）。"""
    stats = collect_batch_stats(batch_dir)
    return {
        'batch': os.path.basename(batch_dir.rstrip('/\\')),
        'mode': stats['mode'],
        'connections': stats['connection_rows'],
        'device_list_entries': stats['device_list_rows'],
        'bom_entries': stats['bom_rows'],
        'file_names': stats['files'],
        'has_manifest': stats['has_manifest'],
        'output_types': stats['output_types'],
    }
