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
from device_library import get_device_library
from template_gate import check_template_config

# V5.4.3-W1.3（修复单 R3）：模板门禁同时消费 validation.py V001~V023 规则集——
# 旧实现只走 designer.validate_topology()（端口溢出），V023 等结构性规则再准
# 模板门禁也测不出（同一拓扑「design 判通过 / validate run 判 ERROR」结论相反）。
from engine import _run_validation

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
            # V5.0.1-501-b: 强化门禁——validate_config + device_refs 可解析 + 旧 id 门禁 +
            # rack_config 完整性（cooling_method/gpu_dedicated）+ 协议兼容性 + 参数合理性
            problems.extend(check_template_config(config, get_device_library(), tpl_dir))

    # 2. INI 设计 + 机柜检查（向后兼容；临时目录避免 JSON 抢占）
    # V5.4.3-W1.4：等效口口径模板（param_equivalent_mode）跳过——INI 无该通道，
    # 纯 INI 设计会走旧钳制路径触发断链 error（与双平面/zcube 跳过同理）
    _equiv_mode = bool((config or {}).get('topology', {}).get('param_equivalent_mode'))
    stats_ini = None
    if _equiv_mode:
        stats_ini = None
    else:
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
        # V5.4.3-W1.3（修复单 R3）：消费 V 规则集，**V021/V023** 结构性 ERROR 使模板
        # 门禁变红。范围收敛说明：
        #   - V021（逐层端口守恒）/ V023（Leaf↔Spine 容量）是 R1~R3 对应的结构性规则；
        #   - V016 与设计器三层 X400 分光容量口径存在既有分歧（万卡-H200-X400-三层
        #     在 5.4.2 即 V016 误报，登记遗留），本版不纳入；
        #   - 功率/散热等商务口径类规则（V002 按散热阈值 15000W 等）存在大量基线
        #     既有告警，纳入会大面积翻红且超出 R3 范围，仍由 validate run 完整透出。
        try:
            rv = _run_validation(d_json)
            struct_errors = [i for i in rv.get('validationIssues', [])
                             if i.get('severity') == 'error'
                             and i.get('rule_id') in ('V021', 'V023')]
            for i in struct_errors[:10]:
                problems.append(f'结构规则 {i.get("rule_id")}: {i.get("message")}')
            if len(struct_errors) > 10:
                problems.append(f'结构规则错误共 {len(struct_errors)} 条（仅显示前 10 条）')
        except Exception as ve:
            problems.append(f'结构规则校验失败: {ve}')
        ok_cab, msgs, cabinets, total_power = _check_cabinets(d_json)
        if not ok_cab:
            problems.extend(msgs)
        stats_json = _design_stats(d_json)
    except Exception as e:
        problems.append(f'JSON 设计失败: {e}')

    # 4. INI/JSON 拓扑等价
    # 双平面模板(param_planes)跳过：INI 无 param_planes 通道,纯 INI 设计为单平面
    # (leaf/spine/core ≈ 1/2),与 JSON 双平面本就不同,等价断言仅对单平面模板生效。
    # V3.0.2-T2-1: zcube 模板同理——INI 无 param_network_mode
    # 通道,纯 INI 设计为传统四网,与 JSON ZCube 组网本就不同。
    # V3.0.2-T2-5: 三合一融合网模板（eth_combined）同理——INI 无 eth_combined
    # 通道,纯 INI 设计为传统四网,与 JSON 融合网组网本就不同。
    _mode = (config or {}).get('topology', {}).get('param_network_mode')
    if config and (config.get('topology', {}).get('param_planes')
                   or _mode in ('zcube',)
                   or (config.get('topology', {}) or {}).get('param_equivalent_mode')
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
