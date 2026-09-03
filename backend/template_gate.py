"""5.0.1-501-b: 模板库门禁强化（rack_config 完整性 / 参数合理性 / 协议兼容性）

将模板级配置校验从 scripts/validate_templates.py 抽出为可复用、可单测的函数：
  - check_rack_config_complete:     cooling_method/gpu_dedicated 完整性（模板须显式声明）
  - check_protocol_compatibility:   IB/RoCE 参数网交换机型号与协议匹配
  - check_parameter_reasonableness: PFC/CNP/收敛比（plan.json macro）与 param_speed 速率匹配
  - check_template_config:          聚合（validate_config + device_refs 可解析 + 旧 id 门禁 + 上述）

设计约束：
  - validate_config（project_config.py）保持向后兼容（cooling_method/gpu_dedicated 缺失不报错），
    完整性由模板门禁强制（23 套内置模板全部显式声明）。
  - 本模块只读校验，不修改配置。
"""
import os
import json
from typing import List, Optional

VALID_COOLING_METHODS = ('air', 'cold_plate', 'immersion')

# 参数网交换机引用键（协议兼容性/速率匹配的作用域）
PARAM_SWITCH_KEYS = ('param_leaf_switch', 'param_spine_switch', 'param_core_switch', 'param_switch')

# M4 旧设备 id（应更新为新 id，不可出现在模板）
LEGACY_DEVICE_IDS = ('h3c_s9850_64h', 'h3c_s6805_48p', 'h3c_s5820v2_24p', 'ruijie_s6910_32oc2vs_1_6t')

# plan:table macro 中的队列/速率键（camelCase + snake_case 双写兼容）
_QUEUE_KEYS = {'pfc': ('pfcQueue', 'pfc_queue'), 'cnp': ('cnpQueue', 'cnp_queue')}


def check_rack_config_complete(config: dict) -> List[str]:
    """rack_config 完整性：cooling_method（合法枚举）+ gpu_dedicated（布尔）强制。

    模板库门禁专用——内置模板必须显式声明散热方式与 GPU 独占策略，
    保证渲染 BOM/机柜规划（散热阈值 V002、GPU 独占装箱）有确定输入。
    """
    problems: List[str] = []
    rack = (config or {}).get('rack_config') or {}
    cm = rack.get('cooling_method')
    if not cm:
        problems.append('rack_config 缺少 cooling_method（模板须显式声明散热方式 air/cold_plate/immersion）')
    elif cm not in VALID_COOLING_METHODS:
        problems.append(f"rack_config.cooling_method 非法: {cm!r}（须为 {'/'.join(VALID_COOLING_METHODS)}）")
    if 'gpu_dedicated' not in rack:
        problems.append('rack_config 缺少 gpu_dedicated（模板须显式声明 GPU 是否独占机柜）')
    elif not isinstance(rack['gpu_dedicated'], bool):
        problems.append(f"rack_config.gpu_dedicated 必须是布尔值: {rack['gpu_dedicated']!r}")
    return problems


def _ib_capable(dev) -> bool:
    """设备是否支持 IB：id 含 '_ib' / 型号含 Quantum / rdma_type ∈ {IB, both}"""
    if dev is None:
        return False
    did = (getattr(dev, 'id', '') or '').lower()
    model = (getattr(dev, 'model', '') or '').lower()
    rdma = (getattr(dev, 'rdma_type', None) or '') or ''
    return bool('_ib' in did or 'quantum' in model or rdma in ('IB', 'both'))


def _ib_only(dev) -> bool:
    """设备是否为 IB 专用（不适用于 RoCE/UEC）：id 含 '_ib' 或型号含 Quantum 且 rdma_type ≠ both"""
    if dev is None:
        return False
    did = (getattr(dev, 'id', '') or '').lower()
    model = (getattr(dev, 'model', '') or '').lower()
    rdma = (getattr(dev, 'rdma_type', None) or '') or ''
    return bool(('_ib' in did or 'quantum' in model) and rdma != 'both')


def check_protocol_compatibility(config: dict, lib=None) -> List[str]:
    """协议兼容性：IB 协议 → 参数网交换机须 IB 能力；RoCE/UEC → 不得为 IB 专用交换机。"""
    problems: List[str] = []
    topo = (config or {}).get('topology') or {}
    protocol = topo.get('param_protocol')
    if protocol not in ('IB', 'RoCE', 'UEC'):
        return problems
    if lib is None:
        from device_library import get_device_library
        lib = get_device_library()
    for key in PARAM_SWITCH_KEYS:
        ref = ((config or {}).get('device_refs') or {}).get(key)
        if not ref:
            continue
        dev = lib.resolve_ref(ref)
        if dev is None:
            continue
        if protocol == 'IB' and not _ib_capable(dev):
            problems.append(f'协议兼容性: {key}={dev.id} 不支持 IB（参数网协议=IB，建议 IB 交换机）')
        elif protocol in ('RoCE', 'UEC') and _ib_only(dev):
            problems.append(f'协议兼容性: {key}={dev.id} 为 IB 专用交换机，与协议 {protocol} 不匹配')
    return problems


def _check_plan_macro_reasonableness(plan: dict, problems: List[str]) -> None:
    """plan.json macro 参数合理性：PFC/CNP 0-7、收敛比 (0,4]、rails 1-16、协议、GPU 规模档位。"""
    macro = (plan or {}).get('macro') or {}
    for label, keys in _QUEUE_KEYS.items():
        raw = None
        for k in keys:
            if k in macro:
                raw = macro[k]
                break
        if raw is not None:
            try:
                val = int(raw)
            except (TypeError, ValueError):
                problems.append(f'参数合理性: plan.json macro {keys[0]} 非法: {raw!r}')
                continue
            if not (0 <= val <= 7):
                problems.append(f'参数合理性: plan.json macro {keys[0]}={val} 须在 0-7')
    try:
        from aidc_planner import validate_macro
        merr = validate_macro(macro)
        if merr:
            problems.append(f'参数合理性: plan.json macro: {merr}')
    except ImportError:
        pass


def check_parameter_reasonableness(config: dict, lib=None, tpl_dir: Optional[str] = None) -> List[str]:
    """参数合理性：param_speed 与参数网交换机 port_speed 匹配；plan.json macro 合理性（若存在）。"""
    problems: List[str] = []
    topo = (config or {}).get('topology') or {}
    speed = topo.get('param_speed')
    if lib is None:
        from device_library import get_device_library
        lib = get_device_library()
    if speed:
        for key in PARAM_SWITCH_KEYS:
            ref = ((config or {}).get('device_refs') or {}).get(key)
            if not ref:
                continue
            dev = lib.resolve_ref(ref)
            if dev and dev.port_speed and dev.port_speed != speed:
                problems.append(f'参数合理性: param_speed({speed}) 与 {key}={dev.id}({dev.port_speed}) 不匹配')
    if tpl_dir:
        plan_path = os.path.join(tpl_dir, 'plan.json')
        if os.path.isfile(plan_path):
            try:
                with open(plan_path, encoding='utf-8') as f:
                    plan = json.load(f)
                _check_plan_macro_reasonableness(plan, problems)
            except (OSError, ValueError) as e:
                problems.append(f'参数合理性: plan.json 解析失败: {e}')
    return problems


def check_template_config(config: dict, lib=None, tpl_dir: Optional[str] = None) -> List[str]:
    """聚合模板配置门禁：validate_config + device_refs 可解析 + 旧 id + rack 完整性 + 协议兼容 + 参数合理性。"""
    problems: List[str] = []
    from project_config import validate_config

    verr = validate_config(config)
    if verr:
        problems.append(f'validate_config: {verr}')

    if lib is None:
        from device_library import get_device_library
        lib = get_device_library()
    refs = (config or {}).get('device_refs') or {}
    missing = [k for k, ref in refs.items() if lib.resolve_ref(ref) is None]
    if missing:
        problems.append(f'device_refs 无法解析: {missing}')
    legacy_used = [k for k, ref in refs.items()
                   if (ref or {}).get('library_id') in LEGACY_DEVICE_IDS]
    if legacy_used:
        problems.append(f'引用旧设备 id（应更新为新 id）: {legacy_used}')

    problems.extend(check_rack_config_complete(config))
    problems.extend(check_protocol_compatibility(config, lib))
    problems.extend(check_parameter_reasonableness(config, lib, tpl_dir))
    return problems
