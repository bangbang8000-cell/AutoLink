"""F5-1（45-a/45-e）一致性校验引擎：规划 ↔ 设计 ↔ 渲染

数据链（AL）：
  AIDC 规划（plan.json/aidc_macro）→ 设计（机房矩阵/机柜/designSnapshot）→ 渲染（output/版本批次）

本模块提供三个维度的确定性校验（纯函数，输入为可 JSON 序列化的 dict，供 UI/测试/门禁复用）：
  1. check_plan_design_consistency  —— 规划↔设计：服务器/网络设备数与设计机柜/设备匹配
  2. check_design_internal_consistency —— 设计内部：机柜 U 位/设备型号/端口引用/功率汇总
  3. check_render_consistency  —— 设计→渲染：渲染产物结构（连接数/设备清单/BOM/命名）与设计匹配

设计 dict 规范（canonical design，见 build_design_dict / 前端快照）：
  {
    'servers': int, 'total_servers': int, 'mode': 'full'|'custom',
    'network_devices': { 'param_leaves': n, 'param_spines': n, 'param_cores': n,
                         'storage_leaves': n, 'storage_spines': n,
                         'biz_access': n, 'biz_agg': n, 'oob_access': n, 'oob_agg': n },
    'cabinets': [ {'name', 'type', 'total_u', 'power_limit', 'devices': [{name,type,model,start_u,end_u,power_watts}]} ],
    'unplaced_devices': [ {'name','type','height','power_watts'} ],
    'connections': [ {'source','target','network_type'} ],
  }
"""
from typing import Any, Dict, List, Optional, Sequence

from validation_engine.core import (
    ValidationProblem, SEVERITY_ERROR, SEVERITY_WARNING, SEVERITY_INFO,
    CATEGORY_CONSISTENCY, CATEGORY_DESIGN, CATEGORY_RENDER,
)


# ---------------- 数值/字段安全读取 ----------------

def _as_int(v: Any, default: int = 0) -> int:
    try:
        return int(v)
    except (TypeError, ValueError):
        return default


def _as_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def _get(d: Optional[Dict], *keys: str, default: Any = None) -> Any:
    """多 key 回退读取（兼容 snake_case / camelCase）"""
    if not isinstance(d, dict):
        return default
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    return default


def _count(d: Dict[str, Any], *keys: str) -> int:
    return _as_int(_get(d, *keys, default=0))


# ---------------- 规划提取 ----------------

def plan_gpu_count(plan: Optional[Dict]) -> int:
    """plan 宏观 GPU 规模：macro.gpuCount / macro.gpu_count → topology.scale.gpuCount"""
    if not isinstance(plan, dict):
        return 0
    macro = plan.get('macro') if isinstance(plan.get('macro'), dict) else {}
    gpu = _count(macro, 'gpuCount', 'gpu_count')
    if gpu > 0:
        return gpu
    topo = plan.get('topology') if isinstance(plan.get('topology'), dict) else {}
    scale = topo.get('scale') if isinstance(topo.get('scale'), dict) else {}
    return _count(scale, 'gpuCount', 'gpu_count')


def plan_role_counts(plan: Optional[Dict]) -> Dict[str, int]:
    """plan 设备角色计数：deviceList[].role → count（SPINE/LEAF/STO_SPINE/...）"""
    out: Dict[str, int] = {}
    if not isinstance(plan, dict):
        return out
    for dev in (plan.get('deviceList') or []):
        if not isinstance(dev, dict):
            continue
        role = dev.get('role') or dev.get('scenario') or ''
        if role:
            out[role] = out.get(role, 0) + 1
    return out


# ---------------- 设计提取 ----------------

def design_server_count(design: Optional[Dict]) -> int:
    if not isinstance(design, dict):
        return 0
    return _count(design, 'servers')


def design_net_counts(design: Optional[Dict]) -> Dict[str, int]:
    if not isinstance(design, dict):
        return {}
    nd = design.get('network_devices')
    if not isinstance(nd, dict):
        return {}
    return {k: _as_int(v) for k, v in nd.items()}


def design_cabinets(design: Optional[Dict]) -> List[Dict]:
    if not isinstance(design, dict):
        return []
    cabs = design.get('cabinets')
    return [c for c in (cabs or []) if isinstance(c, dict)]


def design_unplaced(design: Optional[Dict]) -> List[Dict]:
    if not isinstance(design, dict):
        return []
    ups = design.get('unplaced_devices')
    return [u for u in (ups or []) if isinstance(u, dict)]


def design_connections(design: Optional[Dict]) -> List[Dict]:
    if not isinstance(design, dict):
        return []
    conns = design.get('connections')
    return [c for c in (conns or []) if isinstance(c, dict)]


# ================================================================
# 1. 规划 ↔ 设计 一致性
# ================================================================

def check_plan_design_consistency(plan: Optional[Dict],
                                  design: Optional[Dict]) -> List[ValidationProblem]:
    """规划↔设计：plan 的服务器/网络设备数与 design（机房/机柜/designSnapshot）匹配。

    C001 服务器数、C002 参数网（Leaf/Spine/Core）、C003 存储网、C004 业务/带外。
    仅当两端都能取到该维度时才判定（容忍缺失，避免误报）。
    """
    problems: List[ValidationProblem] = []
    if plan is None and design is None:
        return problems

    # --- C001 服务器规模 ---
    gpu = plan_gpu_count(plan)
    servers = design_server_count(design)
    if gpu > 0 and servers > 0 and gpu != servers:
        problems.append(ValidationProblem(
            rule_id='C001',
            severity=SEVERITY_ERROR,
            category=CATEGORY_CONSISTENCY,
            location='plan.macro.gpuCount ↔ design.servers',
            message=f'规划 GPU 规模 {gpu} 与设计服务器数 {servers} 不一致',
            suggestion='同步宏观参数或重新生成设计，使服务器数与规划规模一致',
            data={'plan_gpu': gpu, 'design_servers': servers},
        ))

    # --- C002 参数网设备数 ---
    roles = plan_role_counts(plan)
    nets = design_net_counts(design)
    if roles and nets:
        pairs = (
            ('LEAF', 'param_leaves', '参数网 Leaf'),
            ('SPINE', 'param_spines', '参数网 Spine'),
            ('CORE', 'param_cores', '参数网 Core'),
            ('STO_LEAF', 'storage_leaves', '存储网 Leaf'),
            ('STO_SPINE', 'storage_spines', '存储网 Spine'),
            ('BIZACC', 'biz_access', '业务接入'),
            ('BIZAGG', 'biz_agg', '业务汇聚'),
            ('OOBACC', 'oob_access', 'OOB 接入'),
            ('OOBAGG', 'oob_agg', 'OOB 汇聚'),
        )
        for role, net_key, label in pairs:
            expected = roles.get(role, 0)
            actual = nets.get(net_key, 0)
            # 仅当其中一侧有值才比对（plan 未规划该网但设计有 → 不算不一致）
            if expected <= 0 and actual <= 0:
                continue
            if expected != actual:
                problems.append(ValidationProblem(
                    rule_id='C002',
                    severity=SEVERITY_ERROR if expected > 0 else SEVERITY_WARNING,
                    category=CATEGORY_CONSISTENCY,
                    location=f'plan.deviceList[role={role}] ↔ design.network_devices.{net_key}',
                    message=f'{label}数量不一致：规划 {expected} 台，设计 {actual} 台',
                    suggestion=f'调整设计中的 {label} 数量或重新生成设计，与规划保持一致',
                    data={'role': role, 'planned': expected, 'designed': actual},
                ))

    return problems


# ================================================================
# 2. 设计内部一致性
# ================================================================

def check_design_internal_consistency(design: Optional[Dict]) -> List[ValidationProblem]:
    """设计内部一致性：机柜 U 位冲突/越界、设备型号、端口引用、功率汇总。"""
    problems: List[ValidationProblem] = []
    if not isinstance(design, dict):
        return problems

    # --- C010 机柜 U 位冲突（同柜设备 U 区间重叠） ---
    for cab in design_cabinets(design):
        cab_name = cab.get('name') or cab.get('cabinet_name') or str(cab.get('id', ''))
        devices = [d for d in (cab.get('devices') or []) if isinstance(d, dict)]
        intervals = []
        for d in devices:
            s = _as_int(d.get('start_u'))
            e = _as_int(d.get('end_u'))
            if s > 0 and e >= s:
                intervals.append((d.get('name') or '未知设备', s, e))
        for i, (name1, s1, e1) in enumerate(intervals):
            for name2, s2, e2 in intervals[i + 1:]:
                if s1 <= e2 and s2 <= e1:
                    problems.append(ValidationProblem(
                        rule_id='C010',
                        severity=SEVERITY_ERROR,
                        category=CATEGORY_DESIGN,
                        location=f'design.cabinets[{cab_name}].devices U位',
                        message=f'机柜 {cab_name} U 位冲突：{name1}(U{s1}-U{e1}) 与 {name2}(U{s2}-U{e2})',
                        suggestion='调整设备 U 位分配，消除重叠',
                        data={'cabinet': cab_name, 'a': name1, 'b': name2,
                              'a_range': [s1, e1], 'b_range': [s2, e2]},
                    ))

    # --- C011 机柜 U 位越界 ---
    for cab in design_cabinets(design):
        cab_name = cab.get('name') or cab.get('cabinet_name') or str(cab.get('id', ''))
        total_u = _as_int(cab.get('total_u') or cab.get('totalU'), 42) or 42
        for d in (cab.get('devices') or []):
            if not isinstance(d, dict):
                continue
            s = _as_int(d.get('start_u'))
            e = _as_int(d.get('end_u'))
            if e > total_u:
                problems.append(ValidationProblem(
                    rule_id='C011',
                    severity=SEVERITY_ERROR,
                    category=CATEGORY_DESIGN,
                    location=f'design.cabinets[{cab_name}].devices.{d.get("name", "")}.end_u',
                    message=f'机柜 {cab_name} 设备 {d.get("name", "")} U 位越界：U{e} 超过机柜 {total_u}U',
                    suggestion='降低设备安装高度或改用更大机柜',
                    data={'cabinet': cab_name, 'device': d.get('name', ''), 'end_u': e, 'total_u': total_u},
                ))

    # --- C012 机柜功率汇总超限 ---
    for cab in design_cabinets(design):
        cab_name = cab.get('name') or cab.get('cabinet_name') or str(cab.get('id', ''))
        power_limit = _as_int(cab.get('power_limit') or cab.get('powerLimit'))
        if power_limit <= 0:
            continue
        total_power = sum(_as_int(d.get('power_watts')) for d in (cab.get('devices') or []))
        if total_power > power_limit:
            problems.append(ValidationProblem(
                rule_id='C012',
                severity=SEVERITY_ERROR,
                category=CATEGORY_DESIGN,
                location=f'design.cabinets[{cab_name}].devices[].power_watts',
                message=f'机柜 {cab_name} 功率 {total_power}W 超过上限 {power_limit}W',
                suggestion='分散高功耗设备或提高机柜功率上限',
                data={'cabinet': cab_name, 'total_power': total_power, 'power_limit': power_limit},
            ))

    # --- C013 未上架设备（warning） ---
    unplaced = design_unplaced(design)
    if unplaced:
        problems.append(ValidationProblem(
            rule_id='C013',
            severity=SEVERITY_WARNING,
            category=CATEGORY_DESIGN,
            location='design.unplaced_devices',
            message=f'存在 {len(unplaced)} 台未上架设备（如 {unplaced[0].get("name", "")} 等）',
            suggestion='将未上架设备分配到机柜，确保全部设备进入设计',
            data={'unplaced_count': len(unplaced),
                  'unplaced_names': [u.get('name', '') for u in unplaced[:10]]},
        ))

    # --- C014 设备型号缺失（info） ---
    missing_model = []
    for cab in design_cabinets(design):
        for d in (cab.get('devices') or []):
            if isinstance(d, dict) and not (d.get('model') or d.get('device_model')):
                missing_model.append(d.get('name', ''))
    if missing_model:
        problems.append(ValidationProblem(
            rule_id='C014',
            severity=SEVERITY_INFO,
            category=CATEGORY_DESIGN,
            location='design.cabinets[].devices[].model',
            message=f'{len(missing_model)} 台设备未指定型号（如 {missing_model[0]}）',
            suggestion='为设备指定厂商型号，便于设备清单/BOM 准确输出',
            data={'missing_count': len(missing_model), 'names': missing_model[:10]},
        ))

    # --- C015 端口引用：连接端点必须存在于设备集合 ---
    known = set()
    for cab in design_cabinets(design):
        for d in (cab.get('devices') or []):
            if isinstance(d, dict):
                known.add(d.get('name', ''))
    for u in design_unplaced(design):
        known.add(u.get('name', ''))
    missing_endpoints = []
    for conn in design_connections(design):
        for side in ('source', 'target'):
            ep = conn.get(side) or conn.get(f'{side}_name', '')
            if ep and ep not in known and ep not in missing_endpoints:
                missing_endpoints.append(ep)
    if missing_endpoints:
        problems.append(ValidationProblem(
            rule_id='C015',
            severity=SEVERITY_ERROR,
            category=CATEGORY_DESIGN,
            location='design.connections[].source/target',
            message=f'连接引用不存在的端点：{", ".join(missing_endpoints[:5])}',
            suggestion='补齐连接端点设备，或删除悬空连接',
            data={'missing_endpoints': missing_endpoints[:20]},
        ))

    return problems


# ================================================================
# 3. 渲染一致性（设计 → 渲染产物结构）
# ================================================================

def check_render_consistency(design: Optional[Dict],
                             render: Optional[Dict]) -> List[ValidationProblem]:
    """渲染一致性：设计→渲染产物结构（连接数/设备清单条目/BOM/文件命名）。"""
    problems: List[ValidationProblem] = []
    if render is None:
        return problems

    # --- C020 渲染产物关键字段缺失 ---
    required_keys = ('connections', 'file_names')
    missing = [k for k in required_keys if k not in (render or {})]
    if missing:
        problems.append(ValidationProblem(
            rule_id='C020',
            severity=SEVERITY_WARNING,
            category=CATEGORY_RENDER,
            location='render.manifest.json',
            message=f'渲染产物缺少关键统计字段：{", ".join(missing)}',
            suggestion='补齐渲染批次 manifest.json 统计，确保可核对',
            data={'missing': missing},
        ))

    # --- C021 连接数：设计连接列表 vs 渲染连接表行数 ---
    design_conns = design_connections(design)
    render_conns = _as_int(_get(render, 'connections', default=None), -1)
    if design_conns and render_conns >= 0 and len(design_conns) != render_conns:
        problems.append(ValidationProblem(
            rule_id='C021',
            severity=SEVERITY_ERROR,
            category=CATEGORY_RENDER,
            location='design.connections ↔ render.connections',
            message=f'连接数不一致：设计 {len(design_conns)} 条，渲染 {render_conns} 条',
            suggestion='检查设计变更后是否重新渲染，或核对连接表导出行数',
            data={'design_connections': len(design_conns), 'render_connections': render_conns},
        ))
    elif render_conns == 0 and design:
        # 设计存在但渲染连接数为 0 → 异常（至少应有设备间连接）
        problems.append(ValidationProblem(
            rule_id='C021',
            severity=SEVERITY_WARNING,
            category=CATEGORY_RENDER,
            location='render.connections',
            message='渲染连接数为 0，连接表疑似为空',
            suggestion='检查网络设计是否生成连接，或重新渲染',
            data={'design_connections': len(design_conns), 'render_connections': 0},
        ))

    # --- C022 设备清单条目 vs 设计交换机数 ---
    render_dev_entries = _as_int(_get(render, 'device_list_entries', default=None), -1)
    nets = design_net_counts(design)
    if nets and render_dev_entries >= 0:
        design_sw = sum(v for v in nets.values())
        # 设备清单按型号聚合，条目数可能小于交换机数；仅当设计有交换机但清单为 0 时报错
        if design_sw > 0 and render_dev_entries == 0:
            problems.append(ValidationProblem(
                rule_id='C022',
                severity=SEVERITY_ERROR,
                category=CATEGORY_RENDER,
                location='render.device_list_entries',
                message=f'设计含 {design_sw} 台交换机，但渲染设备清单条目为 0',
                suggestion='检查设备清单导出是否成功',
                data={'design_switches': design_sw, 'render_entries': 0},
            ))

    # --- C023 文件命名与设计模式匹配 ---
    mode = _get(design, 'mode', default='') if isinstance(design, dict) else ''
    render_mode = _get(render, 'mode', default='') if isinstance(render, dict) else ''
    file_names = render.get('file_names') if isinstance(render, dict) else []
    if mode and render_mode and mode != render_mode:
        problems.append(ValidationProblem(
            rule_id='C023',
            severity=SEVERITY_ERROR,
            category=CATEGORY_RENDER,
            location='design.mode ↔ render.mode',
            message=f'渲染模式 {render_mode} 与设计模式 {mode} 不一致',
            suggestion='以当前设计重新渲染，避免使用旧模式产物',
            data={'design_mode': mode, 'render_mode': render_mode},
        ))
    if mode and isinstance(file_names, list) and file_names:
        mismatched = [f for f in file_names if mode not in f and '模式' in f]
        if mismatched:
            problems.append(ValidationProblem(
                rule_id='C023',
                severity=SEVERITY_WARNING,
                category=CATEGORY_RENDER,
                location='render.file_names',
                message=f'部分渲染文件名与设计模式 {mode} 不匹配：{mismatched[0]}',
                suggestion='重新渲染以更新文件命名',
                data={'design_mode': mode, 'mismatched': mismatched[:5]},
            ))

    return problems


def run_consistency_checks(plan: Optional[Dict], design: Optional[Dict],
                           render: Optional[Dict] = None) -> List[ValidationProblem]:
    """运行全部一致性维度（规划↔设计 / 设计内部 / 设计→渲染）。"""
    problems: List[ValidationProblem] = []
    problems.extend(check_plan_design_consistency(plan, design))
    problems.extend(check_design_internal_consistency(design))
    if render is not None:
        problems.extend(check_render_consistency(design, render))
    return problems
