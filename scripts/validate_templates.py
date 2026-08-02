"""验证所有场景模板能被设计师正确解析 (v2.9.1-T7)

覆盖全部模板目录（自动发现），除拓扑自检外新增机柜级检查：
  - 机柜分配数/总功率摘要
  - 功率超限柜 (total_power > power_limit)
  - U 位重叠（同柜设备 U 区间冲突）
  - 服务器上架覆盖率（无 cabinet_id 的服务器）
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from designer import NetworkDesignerV2

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


failures = 0
print(f'共发现 {len(templates)} 个模板\n')
for t in templates:
    ini = os.path.join(base, t, 'network_config.ini')
    try:
        d = NetworkDesignerV2(ini)
        result = d.validate_topology()
        v = result['valid']
        errs = result['errors']
        conn_count = sum(len(s.connections) for s in d.servers) // 2

        # 机柜检查
        cabinets = getattr(d, '_rack_cabinets', []) or []
        total_power = sum(c.total_power for c in cabinets)
        exceeded = [c for c in cabinets if c.exceeded]
        unmounted = [s.name for s in d.servers if not getattr(s, 'cabinet_id', 0)]
        overlaps = _find_u_overlaps(cabinets)

        ok = v and not exceeded and not unmounted and not overlaps
        if not ok:
            failures += 1
        print(f'[{"OK" if ok else "FAIL"}] {t}: servers={d.num_servers}, '
              f'leaves={len(d.param_leaves)}, spines={len(d.param_spines)}, '
              f'cores={len(d.param_cores)}, conns={conn_count}, '
              f'cabinets={len(cabinets)}, power={total_power}W, valid={v}')
        if not v:
            print(f'       拓扑错误: {errs}')
        if exceeded:
            print(f'       功率超限: {[f"{c.name}({c.total_power}/{c.power_limit}W)" for c in exceeded]}')
        if unmounted:
            print(f'       未上架服务器: {unmounted[:5]}{"..." if len(unmounted) > 5 else ""} ({len(unmounted)}台)')
        if overlaps:
            print(f'       U位重叠: {overlaps[:5]}')
    except Exception as e:
        failures += 1
        print(f'[FAIL] {t}: {e}')

print(f'\n结果: {len(templates) - failures}/{len(templates)} 模板通过')
sys.exit(1 if failures else 0)
