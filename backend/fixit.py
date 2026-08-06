"""AutoLink V3.2.0-T9-4 - 智能修复引擎（校验错误 → 修复 patch → 复核 → 一键应用）

设计：
  - `repair_plan`：读取项目配置 → 运行完整校验（复用 engine._run_validation，
    UI/CLI/AI 同一执行路径）→ 收集 error 级问题，为可自动修复的 rule_id
    生成修复 patch（{section: {key: value}}，section 为 project_config.json 顶层键）；
    不可自动修复的 error 仅列出说明（不生成 patch）。
  - `repair_apply`：应用选中的修复 patch → 宽松校验 → 写回 → **复核**
    （重新校验），返回复核后 valid/issues（错误→修复→复核闭环）。

可自动修复规则（改配置字段）：
  - V002 机柜功率超限     → rack_config.power_limit_per_rack 提升
  - V007 Rail 端口不匹配   → topology.param_ports_per_server = rail 数
  - V010 参数网收敛比过高  → 复用 optimization 收敛比修复（降下联/提升交换机端口）
  - V016 网卡总数超容量    → topology.param_downlink_limit / param_switch_ports 提升
  - V018 Scale-Up 域超限  → scale_up.domain_size 降至协议上限
  - V019 整机房功率超供电  → rack_config.power_limit_per_rack 提升
  - V020 ZCube 容量不足   → topology.param_zcube.switch_ports 提升
"""
import math
import os
from typing import Any, Dict, List

from optimization import _round_switch_ports


# ================================================================
#  修复 patch 生成（rule_id → 配置字段映射）
# ================================================================

def _fix_v002(issue: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any] | None:
    """V002: 机柜功率超限 → 提升机柜功率上限（上取整到 1000W 档位）"""
    rack = config.get('rack_config') or {}
    power = _extract_number(issue.get('message', ''), '功率')
    current = int(rack.get('power_limit_per_rack', 6000) or 6000)
    if power and power > current:
        new_limit = int(math.ceil(power / 1000.0) * 1000)
        return {'rack_config': {'power_limit_per_rack': max(new_limit, current)}}
    return None


def _fix_v007(issue: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any] | None:
    """V007: Rail 模式下端口数 ≠ Rail 数 → 端口数对齐 Rail 数"""
    topo = config.get('topology') or {}
    rail_count = int(topo.get('rail_count', 8) or 8)
    ports = int(topo.get('param_ports_per_server', 8) or 8)
    if ports != rail_count:
        return {'topology': {'param_ports_per_server': rail_count}}
    return None


def _fix_v010(issue: Dict[str, Any], config: Dict[str, Any],
              designer) -> Dict[str, Any] | None:
    """V010: 参数网收敛比 >1.5 → 降下联端口 / 提升交换机端口（复用 T9-3 逻辑）"""
    from optimization import _convergence_suggestions
    for sug in _convergence_suggestions(designer, config):
        if sug['category'] == 'convergence' and '参数网' in sug['title']:
            return sug['patch']
    return None


def _fix_v016(issue: Dict[str, Any], config: Dict[str, Any],
              designer) -> Dict[str, Any] | None:
    """V016: 网卡总数超 Leaf 容量 → 提升下联端口（或交换机端口）"""
    topo = config.get('topology') or {}
    mode = str(topo.get('param_network_mode', '') or '').strip().lower()
    # ZCube：提升 param_zcube.switch_ports（L 自动重推，容量 2L*(ports-L)）
    if mode == 'zcube':
        zc = dict(topo.get('param_zcube') or {})
        ports = int(zc.get('switch_ports', 144) or 144)
        if ports < 288:
            zc['switch_ports'] = 288
            return {'topology': {'param_zcube': zc}}
        return None
    # 传统四网：参数网容量不足 → 提升 param_downlink_limit / param_switch_ports
    num_servers = int(topo.get('num_gpu_servers', 0) or 0)
    ports_per_server = int(topo.get('param_ports_per_server', 8) or 8)
    leaf_count = getattr(designer, 'param_leaf_count', 0) or 0
    if leaf_count <= 0 or num_servers <= 0:
        return None
    required = num_servers * ports_per_server
    dl_new = math.ceil(required / leaf_count)
    switch_ports = int(topo.get('param_switch_ports', 64) or 64)
    if dl_new < switch_ports:
        return {'topology': {'param_downlink_limit': dl_new}}
    return {'topology': {'param_switch_ports': _round_switch_ports(switch_ports * 2)}}


def _fix_v018(issue: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any] | None:
    """V018: Scale-Up 域规模超协议上限 → 降至协议上限"""
    su = config.get('scale_up')
    if not isinstance(su, dict):
        return None
    limit = _extract_number(issue.get('message', ''), '上限')
    if limit and int(su.get('domain_size', 0) or 0) > limit:
        return {'scale_up': {'domain_size': int(limit)}}
    return None


def _fix_v019(issue: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any] | None:
    """V019: 整机房功率超供电 → 提升机柜功率上限（分摊到柜）"""
    rack = config.get('rack_config') or {}
    total_power = _extract_number(issue.get('message', ''), '总功率')
    num_cabinets = _estimate_num_cabinets(config)
    current = int(rack.get('power_limit_per_rack', 6000) or 6000)
    if total_power and num_cabinets > 0:
        per_rack = math.ceil(total_power / num_cabinets / 1000.0) * 1000
        if per_rack > current:
            return {'rack_config': {'power_limit_per_rack': per_rack}}
    return None


def _fix_v020(issue: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any] | None:
    """V020: ZCube 端口容量不足 → 提升 param_zcube.switch_ports"""
    topo = config.get('topology') or {}
    zc = dict(topo.get('param_zcube') or {})
    ports = int(zc.get('switch_ports', 144) or 144)
    if ports < 288:
        zc['switch_ports'] = 288
        return {'topology': {'param_zcube': zc}}
    return None


# rule_id → 修复函数（仅登记可自动修复的 error 级规则）
_FIXERS = {
    'V002': _fix_v002,
    'V007': _fix_v007,
    'V010': _fix_v010,
    'V016': _fix_v016,
    'V018': _fix_v018,
    'V019': _fix_v019,
    'V020': _fix_v020,
}


def _extract_number(message: str, keyword: str) -> float | None:
    """从消息中提取 keyword 后第一个数值（如 '机柜 机柜1 功率 8500W 超过上限 6000W' → 8500）"""
    import re
    idx = message.find(keyword)
    if idx < 0:
        return None
    m = re.search(r'(\d+(?:\.\d+)?)', message[idx + len(keyword):])
    return float(m.group(1)) if m else None


def _estimate_num_cabinets(config: Dict[str, Any]) -> int:
    """估算机柜数（GPU 服务器数，与 engine 的 density 计算口径一致）"""
    topo = config.get('topology') or {}
    num = (int(topo.get('num_gpu_servers', 0) or 0)
           + int(topo.get('num_all_flash_storage', 0) or 0)
           + int(topo.get('num_hybrid_flash_storage', 0) or 0)
           + int(topo.get('num_compute_servers', 0) or 0))
    return max(1, num)


# ================================================================
#  修复主入口
# ================================================================

def _resolve_config_file(config_file: str) -> str:
    if config_file.endswith('.json'):
        return config_file
    json_path = os.path.join(os.path.dirname(config_file), 'project_config.json')
    return json_path if os.path.exists(json_path) else config_file


def _run_validation(config_path: str):
    """运行完整校验（与 validate/design 同一执行路径），返回 validationIssues 等"""
    from engine import _run_validation as run_validation
    from designer import NetworkDesignerV2
    designer = NetworkDesignerV2(config_path)
    return designer, run_validation(designer)


def repair_plan(params: dict) -> dict:
    """生成智能修复方案（只读）

    参数:
        configFile: project_config.json 或 network_config.ini 路径
    返回:
        {success, fixes: [{rule_id, severity, message, recommendation, patch}],
         fixable, totalErrors, valid, issues}
        fixes 仅含可自动修复的 error 项（带 patch）；不可修复的 error 在 issues 中列出
    """
    config_file = params.get('configFile') or ''
    if not config_file or not os.path.exists(config_file):
        return {'success': False, 'error': '配置文件不存在'}
    cfg_path = _resolve_config_file(config_file)
    if not os.path.exists(cfg_path):
        return {'success': False, 'error': f'未找到项目配置: {cfg_path}'}

    from project_config import load_project_config

    try:
        config, load_err = load_project_config(cfg_path)
        if load_err:
            return {'success': False, 'error': f'读取配置失败: {load_err}'}
        designer, validation = _run_validation(cfg_path)
    except Exception as e:
        return {'success': False, 'error': f'校验失败: {e}'}

    fixes: List[Dict[str, Any]] = []
    unfixable: List[Dict[str, Any]] = []
    for issue in validation.get('validationIssues', []):
        if issue.get('severity') != 'error':
            continue
        fixer = _FIXERS.get(issue.get('rule_id', ''))
        patch = None
        if fixer:
            try:
                patch = fixer(issue, config, designer) if _needs_designer(issue['rule_id']) else fixer(issue, config)
            except Exception:
                patch = None
        item = {
            'rule_id': issue['rule_id'],
            'severity': issue['severity'],
            'message': issue['message'],
            'recommendation': issue.get('recommendation', ''),
        }
        if patch:
            item['patch'] = patch
            fixes.append(item)
        else:
            unfixable.append(item)

    return {
        'success': True,
        'fixes': fixes,
        'fixable': len(fixes),
        'totalErrors': len(unfixable) + len(fixes),
        'valid': validation.get('valid', False),
        'issues': unfixable,
    }


def _needs_designer(rule_id: str) -> bool:
    return rule_id in ('V010', 'V016')


def repair_apply(params: dict) -> dict:
    """应用选中的修复 patch 并复核（写操作）

    参数:
        configFile: 项目配置路径
        fixes: 选中的修复项（含 patch）
    返回:
        {success, applied[{rule_id, message, patch}], validation（复核结果）}
    """
    config_file = params.get('configFile') or ''
    fixes = params.get('fixes') or []
    if not config_file or not os.path.exists(config_file):
        return {'success': False, 'error': '配置文件不存在'}
    if not isinstance(fixes, list) or not fixes:
        return {'success': False, 'error': '缺少选中的修复项（fixes）'}
    cfg_path = _resolve_config_file(config_file)
    if not os.path.exists(cfg_path):
        return {'success': False, 'error': f'未找到项目配置: {cfg_path}'}

    from project_config import load_project_config, save_project_config, validate_config

    try:
        config, load_err = load_project_config(cfg_path)
        if load_err:
            return {'success': False, 'error': f'读取配置失败: {load_err}'}
    except Exception as e:
        return {'success': False, 'error': f'读取配置失败: {e}'}

    applied: List[Dict[str, Any]] = []
    skipped: List[str] = []
    for fx in fixes:
        patch = fx.get('patch') if isinstance(fx, dict) else None
        if not isinstance(patch, dict):
            continue
        for section, kv in patch.items():
            if section not in config or not isinstance(config[section], dict):
                skipped.append(f"{section}（配置段不存在）")
                continue
            if not isinstance(kv, dict):
                continue
            for key, value in kv.items():
                config[section][key] = value
                applied.append({'rule_id': fx.get('rule_id', ''),
                                'message': fx.get('message', ''),
                                'patch': {section: {key: value}}})

    if not applied:
        return {'success': False, 'error': '没有可应用的 patch', 'issues': skipped}

    # 宽松校验 + 写回
    error = validate_config(config, strict=False)
    save_project_config(cfg_path, config)

    # 复核：重新校验
    try:
        _, validation = _run_validation(cfg_path)
        remaining_errors = [i for i in validation.get('validationIssues', [])
                            if i.get('severity') == 'error']
        review = {
            'valid': validation.get('valid', False) and not remaining_errors,
            'remainingErrors': len(remaining_errors),
            'issues': [{'rule_id': i['rule_id'], 'severity': i['severity'],
                        'message': i['message'], 'recommendation': i.get('recommendation', '')}
                       for i in remaining_errors],
        }
    except Exception as e:
        review = {'valid': False, 'remainingErrors': -1,
                  'issues': [{'rule_id': 'REVIEW', 'severity': 'error',
                              'message': f'复核失败: {e}', 'recommendation': ''}]}

    return {
        'success': True,
        'applied': applied,
        'skipped': skipped,
        'issues': [error] if error else [],
        'validation': review,
    }
