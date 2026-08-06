"""AutoLink V3.2.0-T9-3 - 批量优化建议引擎（轨道 B：收敛比/成本/散热批量应用）

设计：
  - `suggest`：读取项目配置 + 估算指标（收敛比/功率密度/冷却一致性），
    按规则批量产出结构化建议 `{category, title, description, patch, impact}`
    （patch = {section: {key: value}}，section 为 project_config.json 顶层键）；
  - `apply`：把选中的建议 patch 合并到配置 → 宽松校验 → 写回 project_config.json，
    返回更新后的配置与明细（供前端展示应用结果）。

建议类别：
  - convergence  收敛比（参数网/存储网超额 → 调整下联端口数）
  - cost         成本（协议/速率/端口富余降档）
  - thermal      散热（冷却方式/机柜功率上限与密度匹配）
"""
import math
import os
from typing import Any, Dict, List

CATEGORY_CONVERGENCE = 'convergence'
CATEGORY_COST = 'cost'
CATEGORY_THERMAL = 'thermal'
CATEGORY_LABELS = {
    CATEGORY_CONVERGENCE: '收敛比',
    CATEGORY_COST: '成本',
    CATEGORY_THERMAL: '散热',
}
_CATEGORY_ORDER = (CATEGORY_CONVERGENCE, CATEGORY_COST, CATEGORY_THERMAL)


# ================================================================
#  建议生成（确定性规则引擎，不依赖外部 LLM，可稳定测试）
# ================================================================

def _resolve_config_file(config_file: str) -> str:
    """解析配置路径：JSON 直接用；INI 优先取同目录 project_config.json"""
    if config_file.endswith('.json'):
        return config_file
    json_path = os.path.join(os.path.dirname(config_file), 'project_config.json')
    return json_path if os.path.exists(json_path) else config_file


def _new_suggestion(category: str, title: str, description: str,
                    patch: Dict[str, Any], impact: str) -> Dict[str, Any]:
    return {
        'category': category,
        'categoryLabel': CATEGORY_LABELS.get(category, category),
        'title': title,
        'description': description,
        'patch': patch,
        'impact': impact,
    }


def _convergence_suggestions(designer, config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """收敛比建议：参数网/存储网收敛比超标 → 降低下联端口 / 提高交换机端口

    两条修复路径：
      A. 容量允许时降低 Leaf 下联端口数（上行占比提升）；
      B. 容量约束（下联端口已是最低必需）时提高交换机端口数（上行带宽增大）。
    """
    from estimation import calc_convergence_ratio

    out: List[Dict[str, Any]] = []

    def _gen(net_type: str, leaf_count: int, dl: int, ports: int, speed: str,
             target: float, dl_key: str, ports_key: str) -> None:
        if leaf_count <= 0:
            return
        ul = max(ports - dl, 0)
        if ul <= 0:
            return
        r = calc_convergence_ratio(net_type, dl, ul,
                                   _parse_speed_gbps(speed), leaf_count)
        if r.meets_target:
            return
        net_label = '参数网' if net_type == 'param' else '存储网'
        if net_type == 'param':
            required = designer.num_servers * (getattr(designer, 'param_ports_per_server', 8) or 8)
        else:
            required = designer.total_servers * (
                getattr(designer, 'storage_ports_per_server', 1) or 1)
        min_dl = math.ceil(required / max(1, leaf_count))  # 容量必需的最低下联端口

        # 路径 A：降低下联端口至目标收敛比（容量允许时）
        ratio_dl = max(1, round(dl / (r.convergence_ratio / target)))
        if min_dl < ratio_dl < dl:
            out.append(_new_suggestion(
                CATEGORY_CONVERGENCE,
                f'{net_label}收敛比优化',
                f'{net_label}收敛比 {r.convergence_ratio}:1 超过目标 {target}:1'
                f'（上行带宽不足），建议降低 Leaf 下联端口数',
                {'topology': {dl_key: ratio_dl}},
                f'{net_label}收敛比降至约 {round(dl / ratio_dl, 1)}:1，缓解上行拥塞',
            ))
            return

        # 路径 B：容量约束 → 提高交换机端口数（增大上行带宽）
        ports_new = _round_switch_ports(math.ceil(dl * (1 + 1 / target)))
        if ports_new > ports:
            out.append(_new_suggestion(
                CATEGORY_CONVERGENCE,
                f'{net_label}收敛比优化（提升交换机端口）',
                f'{net_label}收敛比 {r.convergence_ratio}:1 超过目标 {target}:1，'
                f'下联端口受容量约束无法降低，建议提升交换机端口以增大上行带宽',
                {'topology': {ports_key: ports_new}},
                f'{net_label}上行端口 {ports - dl} → {ports_new - dl}，'
                f'收敛比降至约 {round(dl / (ports_new - dl), 1)}:1',
            ))

    is_zcube = getattr(designer, 'param_network_mode', 'standard') == 'zcube'
    if not is_zcube:
        _gen('param', getattr(designer, 'param_leaf_count', 0),
             getattr(designer, 'param_dl', 0) or 0,
             getattr(designer, 'param_switch_ports', 0),
             getattr(designer, 'param_speed', '400G'),
             1.0, 'param_downlink_limit', 'param_switch_ports')
    _gen('storage', getattr(designer, 'storage_leaf_count', 0),
         getattr(designer, 'storage_dl', 0) or 0,
         getattr(designer, 'storage_switch_ports', 0),
         getattr(designer, 'storage_speed', '200G'),
         2.0, 'storage_downlink_limit', 'storage_switch_ports')
    return out


def _round_switch_ports(ports_new: int) -> int:
    """上取整到常用交换机端口档位（64/128/144/256/288/512）"""
    for p in (128, 144, 256, 288, 512):
        if ports_new <= p:
            return p
    return 512


def _cost_suggestions(designer, config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """成本建议：规模小 → 协议/速率降档；端口富余 → 减少下联端口（省交换机）"""
    out: List[Dict[str, Any]] = []
    topo = config.get('topology') or {}
    num_servers = designer.num_servers

    # 1. 小规模 IB → RoCE（低成本无损替代）
    if num_servers <= 32 and (topo.get('param_protocol') or 'IB') == 'IB':
        out.append(_new_suggestion(
            CATEGORY_COST, '参数网协议降档（IB → RoCE）',
            f'GPU 服务器仅 {num_servers} 台，IB 交换机/光模块成本高企，'
            f'RoCE 在中小规模下性能差距小且硬件成本显著更低',
            {'topology': {'param_protocol': 'RoCE'}},
            '参数网硬件成本显著下降（IB 交换/网卡/光模块 → RoCE）',
        ))

    # 2. 小规模 800G → 400G
    if num_servers <= 64 and (topo.get('param_speed') or '400G') == '800G':
        out.append(_new_suggestion(
            CATEGORY_COST, '参数网速率降档（800G → 400G）',
            f'GPU 服务器仅 {num_servers} 台，800G 交换机与光模块单价高，'
            f'400G 在中小规模吞吐足够',
            {'topology': {'param_speed': '400G'}},
            '光模块/交换机单价约降一半（800G → 400G）',
        ))

    # 3. 端口富余 → 减少下联端口（省交换机规模）
    leaf_count = getattr(designer, 'param_leaf_count', 0)
    dl = getattr(designer, 'param_dl', 0) or 0
    if leaf_count > 0 and dl > 0:
        required = math.ceil(num_servers * (getattr(designer, 'param_ports_per_server', 8) or 8)
                             / leaf_count)
        if required < dl and dl - required >= max(2, dl // 4):
            out.append(_new_suggestion(
                CATEGORY_COST, '参数网端口富余收敛',
                f'每 Leaf 下联 {dl} 口，实际接入仅需 {required} 口，'
                f'端口空置浪费交换机成本',
                {'topology': {'param_downlink_limit': required}},
                f'每 Leaf 下联降至 {required} 口，交换机选型可降档',
            ))
    return out


def _thermal_suggestions(designer, config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """散热建议：冷却方式与功率密度匹配 + 机柜功率上限充足"""
    from estimation import estimate_cabinet_power_density

    out: List[Dict[str, Any]] = []
    rack = config.get('rack_config') or {}
    configured_cooling = designer.cooling_method or 'air'
    power_limit = designer.power_limit_per_rack or 6000

    # 机柜功率密度（复用 designer 服务器+交换机功率）
    all_switches = (getattr(designer, 'param_leaves', []) + getattr(designer, 'param_spines', [])
                    + getattr(designer, 'storage_leaves', []) + getattr(designer, 'storage_spines', [])
                    + getattr(designer, 'oob_access', []) + getattr(designer, 'oob_agg', [])
                    + getattr(designer, 'biz_access', []) + getattr(designer, 'biz_agg', []))
    it_power_w = (sum(s.power_watts or 0 for s in designer.servers)
                  + sum(sw.power_watts or 0 for sw in all_switches))
    density = estimate_cabinet_power_density(it_power_w / 1000.0, max(1, designer.num_servers))
    recommended = density.get('recommended_cooling', 'air')

    # 1. 冷却方式与密度推荐不一致
    if configured_cooling != recommended and configured_cooling != 'air':
        out.append(_new_suggestion(
            CATEGORY_THERMAL, '冷却方式与功率密度匹配',
            f'机柜功率密度 {density["density_level"]}（均 {density["power_per_cabinet_w"]}W/柜）'
            f'推荐 {recommended} 冷却，当前配置 {configured_cooling}',
            {'rack_config': {'cooling_method': recommended}},
            f'散热方式切换为 {recommended}，保障高密度机柜散热余量',
        ))
    elif configured_cooling == 'air' and density['power_per_cabinet_w'] > 15000:
        out.append(_new_suggestion(
            CATEGORY_THERMAL, '高密度机柜建议液冷',
            f'平均机柜功率 {density["power_per_cabinet_w"]}W 超过风冷安全区'
            f'（>15kW），建议切换冷板液冷',
            {'rack_config': {'cooling_method': 'cold_plate'}},
            '切换 cold_plate 液冷，规避风冷散热不足',
        ))

    # 2. 机柜功率上限不足（总功率超上限 → 提高上限或分散）
    power_per_rack = density['power_per_cabinet_w']
    if power_per_rack > power_limit:
        new_limit = int(math.ceil(power_per_rack / 1000.0) * 1000)
        out.append(_new_suggestion(
            CATEGORY_THERMAL, '机柜功率上限调整',
            f'平均机柜功率 {power_per_rack}W 超过当前上限 {power_limit}W，'
            f'存在机柜过载风险',
            {'rack_config': {'power_limit_per_rack': new_limit}},
            f'机柜功率上限提升至 {new_limit}W，消除过载告警',
        ))
    return out


def _parse_speed_gbps(speed_str: str) -> float:
    """速率字符串（如 '400G'）→ Gbps"""
    if not speed_str:
        return 400.0
    s = str(speed_str).strip().upper()
    for unit in ('GB', 'G', 'TB', 'T'):
        if s.endswith(unit):
            try:
                return float(s[:-len(unit)]) * (1000.0 if unit.startswith('T') else 1.0)
            except ValueError:
                break
    try:
        return float(s)
    except ValueError:
        return 400.0


# ================================================================
#  建议生成 / 批量应用主入口
# ================================================================

def suggest(params: dict) -> dict:
    """生成批量优化建议（只读）

    参数:
        configFile: project_config.json 或 network_config.ini 路径
    返回:
        {success, suggestions[{category, categoryLabel, title, description,
                               patch, impact}], total, counts}
    """
    config_file = params.get('configFile') or ''
    if not config_file or not os.path.exists(config_file):
        return {'success': False, 'error': '配置文件不存在'}
    cfg_path = _resolve_config_file(config_file)
    if not os.path.exists(cfg_path):
        return {'success': False, 'error': f'未找到项目配置: {cfg_path}'}

    from project_config import load_project_config
    from designer import NetworkDesignerV2

    try:
        config, load_err = load_project_config(cfg_path)
        if load_err:
            return {'success': False, 'error': f'读取配置失败: {load_err}'}
        designer = NetworkDesignerV2(cfg_path)
    except Exception as e:
        return {'success': False, 'error': f'读取配置失败: {e}'}

    suggestions = (
        _convergence_suggestions(designer, config)
        + _cost_suggestions(designer, config)
        + _thermal_suggestions(designer, config)
    )
    counts = {c: sum(1 for s in suggestions if s['category'] == c)
              for c in _CATEGORY_ORDER}
    return {
        'success': True,
        'suggestions': suggestions,
        'total': len(suggestions),
        'counts': counts,
    }


def apply(params: dict) -> dict:
    """批量应用选中的建议 patch（写操作）

    参数:
        configFile: 项目配置路径
        suggestions: 选中的建议列表（至少含 patch 字段）
    返回:
        {success, applied[{category, title, patch}], config, issues}
    """
    config_file = params.get('configFile') or ''
    suggestions = params.get('suggestions') or []
    if not config_file or not os.path.exists(config_file):
        return {'success': False, 'error': '配置文件不存在'}
    if not isinstance(suggestions, list) or not suggestions:
        return {'success': False, 'error': '缺少选中的建议（suggestions）'}
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
    for sug in suggestions:
        patch = sug.get('patch') if isinstance(sug, dict) else None
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
                applied.append({'category': sug.get('category', ''),
                                'title': sug.get('title', ''),
                                'patch': {section: {key: value}}})

    if not applied:
        return {'success': False, 'error': '没有可应用的 patch', 'issues': skipped}

    # 宽松校验（补默认值，不回退非法关键字段）；写回
    error = validate_config(config, strict=False)
    issues = []
    if error:
        issues.append(error)
    save_project_config(cfg_path, config)
    return {
        'success': True,
        'applied': applied,
        'skipped': skipped,
        'config': config,
        'issues': issues,
    }
