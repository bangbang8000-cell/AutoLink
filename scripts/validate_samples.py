"""49-d（示例资产与收官）：4 个示例模板自动化验收（49-a 产物门禁）

自动发现 template/ 下 isSample=true 的模板（现为 H100-64台-IB / -RoCE、H100-128台-IB / -RoCE），
每个示例校验：
  1. 文件齐全：project_config.json + network_config.ini + template.json + plan.json + room_layout.json
  2. project_config.json：validate_config + device_refs 可解析
  3. 设计可消费：NetworkDesignerV2 拓扑校验通过 + 机柜 U 位/功率/上架合规
  4. INI/JSON 设计拓扑等价（服务器/交换机/连接数一致）
  5. plan.json：plan:table v1.2 自包含（meta/macro/deviceList/connections/terminals/
     protocols/convergence），import_plan 回导通过
  6. plan.macro 与 project_config 一致（protocol/gpuCount）
  7. room_layout.json：validate_room_layout 通过，gpu 分区格数 ≥ GPU 服务器数
  8. 导出：plan zip 交付包 + excel + json 可落盘；zip 内 plan.json 导入回灌
     往返一致（planHash 不变）
  9. 协议差异：IB 收敛比 < RoCE 收敛比、设备型号不同、param_protocol 正确

用法：
  python scripts/validate_samples.py
"""
import json
import os
import sys
import tempfile
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from aidc_planner import export_plan, import_plan  # noqa: E402
from designer import NetworkDesignerV2  # noqa: E402
from device_library import get_device_library  # noqa: E402
from project_config import validate_config  # noqa: E402
from room import validate_room_layout  # noqa: E402

BASE = os.path.join(os.path.dirname(__file__), '..', 'template')

# 关键契约段（MC 导入必需，plan:table v1.2）
PLAN_REQUIRED_SECTIONS = ('meta', 'macro', 'deviceList', 'connections', 'terminals',
                          'protocols', 'convergence')


def discover_samples(base=BASE):
    """自动发现 isSample=true 的模板目录"""
    out = []
    for name in sorted(os.listdir(base)):
        tpl_dir = os.path.join(base, name)
        if not os.path.isdir(tpl_dir):
            continue
        meta_path = os.path.join(tpl_dir, 'template.json')
        if not os.path.isfile(meta_path):
            continue
        try:
            with open(meta_path, encoding='utf-8') as f:
                meta = json.load(f)
        except (OSError, ValueError):
            continue
        if meta.get('isSample'):
            out.append((name, tpl_dir))
    return out


def _read_json(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def _design_stats(d):
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
    """机柜级检查：功率超限 / 未上架 / U 位重叠"""
    cabinets = getattr(d, '_rack_cabinets', []) or []
    exceeded = [c.name for c in cabinets if c.exceeded]
    unmounted = [s.name for s in d.servers if not getattr(s, 'cabinet_id', 0)]
    overlaps = []
    for cab in cabinets:
        items = sorted(cab.devices, key=lambda x: x.start_u or 0)
        for i in range(len(items) - 1):
            a, b = items[i], items[i + 1]
            if b.start_u <= a.end_u:
                overlaps.append(f'{cab.name}: {a.name} 与 {b.name}')
    return exceeded, unmounted, overlaps


def _load_ini_only_design(tpl_dir):
    """纯 INI 设计（临时目录，避免 JSON 抢占）"""
    import shutil
    with tempfile.TemporaryDirectory() as tmp:
        ini_path = os.path.join(tmp, 'network_config.ini')
        shutil.copyfile(os.path.join(tpl_dir, 'network_config.ini'), ini_path)
        return NetworkDesignerV2(ini_path)


def validate_sample(name, tpl_dir):
    """校验单个示例模板，返回错误列表（空 = 通过）"""
    problems = []

    # 1. 文件齐全
    for fname in ('project_config.json', 'network_config.ini', 'template.json',
                  'plan.json', 'room_layout.json'):
        if not os.path.isfile(os.path.join(tpl_dir, fname)):
            problems.append(f'缺少 {fname}')

    # 2. project_config.json
    config = _read_json(os.path.join(tpl_dir, 'project_config.json'))
    verr = validate_config(config)
    if verr:
        problems.append(f'validate_config: {verr}')
    lib = get_device_library()
    missing = [k for k, ref in config.get('device_refs', {}).items() if lib.resolve_ref(ref) is None]
    if missing:
        problems.append(f'device_refs 无法解析: {missing}')

    # 3. JSON 设计 + 机柜合规
    d_json = None
    try:
        d_json = NetworkDesignerV2(os.path.join(tpl_dir, 'project_config.json'))
        vj = d_json.validate_topology()
        if not vj['valid']:
            problems.append(f'JSON 拓扑错误: {vj["errors"]}')
        exceeded, unmounted, overlaps = _check_cabinets(d_json)
        if exceeded:
            problems.append(f'功率超限柜: {exceeded[:5]}')
        if unmounted:
            problems.append(f'未上架服务器: {unmounted[:5]}（{len(unmounted)}台）')
        if overlaps:
            problems.append(f'U位重叠: {overlaps[:5]}')
    except Exception as e:  # noqa: BLE001
        problems.append(f'JSON 设计失败: {e}')

    # 4. INI/JSON 拓扑等价
    try:
        d_ini = _load_ini_only_design(tpl_dir)
        v_ini = d_ini.validate_topology()
        if not v_ini['valid']:
            problems.append(f'INI 拓扑错误: {v_ini["errors"]}')
        if d_json is not None and _design_stats(d_ini) != _design_stats(d_json):
            problems.append(f'INI/JSON 拓扑不一致: INI={_design_stats(d_ini)} '
                            f'JSON={_design_stats(d_json)}')
    except Exception as e:  # noqa: BLE001
        problems.append(f'INI 设计失败: {e}')

    # 5. plan.json 自包含 + 回导
    plan = _read_json(os.path.join(tpl_dir, 'plan.json'))
    for sec in PLAN_REQUIRED_SECTIONS:
        if sec not in plan:
            problems.append(f'plan.json 缺少契约段: {sec}')
    if isinstance(plan.get('meta'), dict):
        if not str(plan['meta'].get('schema', '')).startswith('plan:table/'):
            problems.append(f'plan.meta.schema 非法: {plan["meta"].get("schema")}')
    imp = import_plan(plan)
    if not imp.get('ok'):
        problems.append(f'plan 回导失败: {imp.get("error")}')
    elif imp['planHash'] != plan.get('meta', {}).get('planHash'):
        problems.append('plan 回导 planHash 与元信息不一致')

    # 6. plan.macro 与 project_config 一致
    topo = config.get('topology', {})
    macro = plan.get('macro', {})
    if macro.get('protocol') != topo.get('param_protocol'):
        problems.append(f'plan.macro.protocol({macro.get("protocol")}) != '
                        f'topology.param_protocol({topo.get("param_protocol")})')
    if macro.get('gpuCount') != topo.get('num_gpu_servers'):
        problems.append(f'plan.macro.gpuCount({macro.get("gpuCount")}) != '
                        f'num_gpu_servers({topo.get("num_gpu_servers")})')
    if macro.get('protocol') not in ('IB', 'RoCE'):
        problems.append(f'plan.macro.protocol 非法: {macro.get("protocol")}')

    # 7. room_layout.json
    layout = _read_json(os.path.join(tpl_dir, 'room_layout.json'))
    lerr = validate_room_layout(layout)
    if lerr:
        problems.append(f'room_layout 校验失败: {lerr}')
    gpu_cells = sum(1 for c in layout.get('cells', []) if c.get('type') == 'gpu')
    if gpu_cells < topo.get('num_gpu_servers', 0):
        problems.append(f'room_layout gpu 分区格数({gpu_cells}) < GPU 服务器数'
                        f'({topo.get("num_gpu_servers")})')

    # 8. 导出 + 往返一致（zip 交付包 / excel / json）
    try:
        with tempfile.TemporaryDirectory() as tmp:
            macro_for_export = {
                'gpu_count': macro['gpuCount'],
                'protocol': macro['protocol'],
                'convergence': macro['convergence'],
                'device_models': macro['deviceModels'],
                'project_id': plan['meta']['projectId'],
                'project_name': plan['meta'].get('projectName', name),
                'plan_version': plan['meta'].get('planVersion', 1),
            }
            zip_path = export_plan(macro_for_export, os.path.join(tmp, 'pkg'), 'zip')
            with zipfile.ZipFile(zip_path) as zf:
                if 'plan.json' not in zf.namelist() or 'README.md' not in zf.namelist():
                    problems.append('plan zip 交付包缺少 plan.json/README.md')
                rt = json.loads(zf.read('plan.json').decode('utf-8'))
            rt_imp = import_plan(rt)
            if not rt_imp.get('ok'):
                problems.append(f'zip 内 plan 回灌失败: {rt_imp.get("error")}')
            elif rt_imp['planHash'] != rt['meta']['planHash']:
                problems.append('zip 内 plan 回灌 planHash 不一致')
            excel_path = export_plan(macro_for_export, os.path.join(tmp, 'p'), 'excel')
            if not excel_path.endswith('.xlsx'):
                problems.append('excel 导出路径非法')
            json_path = export_plan(macro_for_export, os.path.join(tmp, 'p'), 'json')
            if not os.path.isfile(json_path):
                problems.append('json 导出失败')
    except Exception as e:  # noqa: BLE001
        problems.append(f'导出/往返失败: {e}')

    return problems


def main():
    samples = discover_samples()
    if not samples:
        print('未发现 isSample=true 的示例模板')
        return 1
    print(f'共发现 {len(samples)} 个示例模板\n')

    failures = 0
    for name, tpl_dir in samples:
        problems = validate_sample(name, tpl_dir)
        ok = not problems
        if not ok:
            failures += 1
        print(f'[{"OK" if ok else "FAIL"}] {name}')
        for p in problems:
            print(f'       {p}')

    # 协议差异断言（跨示例）
    by_proto = {}
    for name, tpl_dir in samples:
        plan = _read_json(os.path.join(tpl_dir, 'plan.json'))
        proto = plan['macro']['protocol']
        by_proto.setdefault(proto, []).append((name, plan))
    print()
    if 'IB' in by_proto and 'RoCE' in by_proto:
        ib_conv = by_proto['IB'][0][1]['macro']['convergence']
        roce_conv = by_proto['RoCE'][0][1]['macro']['convergence']
        if not (ib_conv < roce_conv):
            failures += 1
            print(f'[FAIL] IB 收敛比({ib_conv}) 应 < RoCE 收敛比({roce_conv})')
        else:
            print(f'[OK]   协议差异：IB 收敛比 {ib_conv} < RoCE 收敛比 {roce_conv}')
        ib_model = by_proto['IB'][0][1]['macro']['deviceModels']['LEAF']
        roce_model = by_proto['RoCE'][0][1]['macro']['deviceModels']['LEAF']
        if ib_model == roce_model:
            failures += 1
            print('[FAIL] IB/RoCE 参数网设备型号应不同')
        else:
            print(f'[OK]   协议差异：IB 设备型号 {ib_model} ≠ RoCE {roce_model}')
    else:
        print('[WARN] 缺少 IB 或 RoCE 示例，跳过跨协议差异断言')

    print(f'\n结果: {len(samples) - failures}/{len(samples)} 示例通过')
    return 1 if failures else 0


if __name__ == '__main__':
    sys.exit(main())
