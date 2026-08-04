"""验证所有场景模板能被设计师正确解析 (v2.9.1-T7, v2.9.4-T5 升级)

覆盖全部模板目录（自动发现），校验：
  - project_config.json 存在且 validate_config 通过（V2.9.4 新增）
  - device_refs 全部能通过设备库 resolve_ref 解析（V2.9.4 新增）
  - INI 设计 与 JSON 设计拓扑等价（服务器/交换机/连接数一致，V2.9.4 新增）
  - 机柜分配数/总功率摘要、功率超限柜 (total_power > power_limit)
  - U 位重叠（同柜设备 U 区间冲突）、服务器上架覆盖率（无 cabinet_id）
"""
import sys
import os
import json
import tempfile
import shutil

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from designer import NetworkDesignerV2
from project_config import validate_config
from device_library import get_device_library

base = os.path.join(os.path.dirname(__file__), '..', 'template')

# 自动发现模板目录（含 network_config.ini），排除 device_library/.gitkeep 等
templates = sorted([
    name for name in os.listdir(base)
    if os.path.isdir(os.path.join(base, name))
    and os.path.exists(os.path.join(base, name, 'network_config.ini'))
])


def _find_u_overlaps(cabinets):
    """同柜设备 U 位区间重叠检查"""
    overlaps = []
    for cab in cabinets:
        items = sorted(cab.devices, key=lambda d: d.start_u or 0)
        for i in range(len(items) - 1):
            a, b = items[i], items[i + 1]
            if b.start_u <= a.end_u:
                overlaps.append(
                    f"{cab.name}: {a.name}(U{a.start_u}-U{a.end_u}) 与 {b.name}(U{b.start_u}-U{b.end_u})")
    return overlaps


def _design_stats(d):
    """提取设计器拓扑规模统计（用于 INI/JSON 等价断言）"""
    return {
        'servers': len(d.servers),
        'param_leaves': len(d.param_leaves),
        'param_spines': len(d.param_spines),
        'param_cores': len(d.param_cores),
        'storage_leaves': len(d.storage_leaves),
        'storage_spines': len(d.storage_spines),
        'combined_leaves': len(getattr(d, 'combined_leaves', [])),
        'conns': sum(len(s.connections) for s in d.servers) // 2,
    }


def _check_cabinets(d):
    """机柜级检查，返回 (passed, messages)"""
    cabinets = getattr(d, '_rack_cabinets', []) or []
    total_power = sum(c.total_power for c in cabinets)
    exceeded = [c for c in cabinets if c.exceeded]
    unmounted = [s.name for s in d.servers if not getattr(s, 'cabinet_id', 0)]
    overlaps = _find_u_overlaps(cabinets)

    ok = True
    msgs = []
    if exceeded:
        ok = False
        shown = [f"{c.name}({c.total_power}/{c.power_limit}W)" for c in exceeded[:5]]
        msgs.append(f'功率超限: {shown}{f" 等{len(exceeded)}柜" if len(exceeded) > 5 else ""}')
    if unmounted:
        ok = False
        msgs.append(f'未上架服务器: {unmounted[:5]}{"..." if len(unmounted) > 5 else ""} ({len(unmounted)}台)')
    if overlaps:
        ok = False
        msgs.append(f'U位重叠: {overlaps[:5]}')
    return ok, msgs, cabinets, total_power


def _load_ini_only_design(tpl_dir):
    """在临时目录中用纯 INI 设计（避免同目录 project_config.json 被优先加载）"""
    with tempfile.TemporaryDirectory() as tmp:
        shutil.copy(os.path.join(tpl_dir, 'network_config.ini'), os.path.join(tmp, 'network_config.ini'))
        return NetworkDesignerV2(os.path.join(tmp, 'network_config.ini'))


failures = 0
print(f'共发现 {len(templates)} 个模板\n')
for t in templates:
    tpl_dir = os.path.join(base, t)
    ini = os.path.join(tpl_dir, 'network_config.ini')
    json_path = os.path.join(tpl_dir, 'project_config.json')
    problems = []

    # 1. JSON 完整性 + device_refs 可解析
    config = None
    if not os.path.exists(json_path):
        problems.append('缺少 project_config.json')
    else:
        try:
            with open(json_path, encoding='utf-8') as f:
                config = json.load(f)
        except json.JSONDecodeError as e:
            problems.append(f'project_config.json 解析失败: {e}')
        if config is not None:
            verr = validate_config(config)
            if verr:
                problems.append(f'validate_config: {verr}')
            lib = get_device_library()
            missing = [k for k, ref in config.get('device_refs', {}).items() if lib.resolve_ref(ref) is None]
            if missing:
                problems.append(f'device_refs 无法解析: {missing}')

    # 2. INI 设计 + 机柜检查（向后兼容；临时目录避免 JSON 抢占）
    stats_ini = None
    try:
        d_ini = _load_ini_only_design(tpl_dir)
        v = d_ini.validate_topology()
        if not v['valid']:
            problems.append(f'INI 拓扑错误: {v["errors"]}')
        stats_ini = _design_stats(d_ini)
    except Exception as e:
        problems.append(f'INI 设计失败: {e}')

    # 3. JSON 设计 + 机柜检查（V2.9.4 权威）
    stats_json = None
    try:
        d_json = NetworkDesignerV2(json_path)
        vj = d_json.validate_topology()
        if not vj['valid']:
            problems.append(f'JSON 拓扑错误: {vj["errors"]}')
        ok_cab, msgs, cabinets, total_power = _check_cabinets(d_json)
        if not ok_cab:
            problems.extend(msgs)
        stats_json = _design_stats(d_json)
    except Exception as e:
        problems.append(f'JSON 设计失败: {e}')

    # 4. INI/JSON 拓扑等价
    # 双平面模板(param_planes)跳过：INI 无 param_planes 通道,纯 INI 设计为单平面
    # (leaf/spine/core ≈ 1/2),与 JSON 双平面本就不同,等价断言仅对单平面模板生效。
    # V3.0.2-T2-3: huawei_supernode（含 zcube）模板同理——INI 无 param_network_mode
    # 通道,纯 INI 设计为传统四网,与 JSON 超节点组网本就不同。
    # V3.0.2-T2-5: 三合一融合网模板（eth_combined）同理——INI 无 eth_combined
    # 通道,纯 INI 设计为传统四网,与 JSON 融合网组网本就不同。
    _mode = (config or {}).get('topology', {}).get('param_network_mode')
    if config and (config.get('topology', {}).get('param_planes')
                   or _mode in ('zcube', 'huawei_supernode')
                   or (config.get('networks', {}) or {}).get('eth_combined')):
        stats_ini = stats_json  # 视为等价,仅校验各自 validate 通过
    if stats_ini is not None and stats_json is not None and stats_ini != stats_json:
        problems.append(f'INI/JSON 拓扑不一致: INI={stats_ini}, JSON={stats_json}')

    ok = not problems
    if not ok:
        failures += 1

    extra = ''
    if stats_json is not None:
        extra = (f'cabinets={len(cabinets)}, power={total_power}W, '
                 f'leaves={stats_json["param_leaves"]}, spines={stats_json["param_spines"]}, '
                 f'cores={stats_json["param_cores"]}, conns={stats_json["conns"]}')
    print(f'[{"OK" if ok else "FAIL"}] {t}: servers={stats_json["servers"] if stats_json else "-"}, {extra}')
    for p in problems:
        print(f'       {p}')

print(f'\n结果: {len(templates) - failures}/{len(templates)} 模板通过')
sys.exit(1 if failures else 0)
