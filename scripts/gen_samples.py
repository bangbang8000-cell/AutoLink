"""49-a（示例资产与收官）：生成 4 个 H100 示例模板（64/128 × IB/RoCE）

每个示例模板目录（template/<名>/）产出：
  - project_config.json   设计配置（topology + device_refs + rack_config）
  - network_config.ini    与 JSON 等价的 INI 设计配置（validate_templates 等价断言）
  - plan.json             plan:table v1.2（aidc_planner.plan_aidc 生成，自包含，MC 可直接导入）
  - room_layout.json      机房矩阵默认布局（gpu/network/storage/compute 分区）
  - template.json         模板元信息（isSample=true 标记示例）

IB 与 RoCE 差异：
  - 协议：IB（NDR 400G，NVIDIA Quantum-2 MQM9700）/ RoCE（H3C S9825/S9827）
  - 收敛比：IB 1:1 无阻塞 / RoCE 2:1 收敛
  - 设备型号：参数网交换机选型不同（device_refs + plan.macro.deviceModels）

用法：
  python scripts/gen_samples.py            # 生成/覆盖 4 个示例模板
  python scripts/gen_samples.py --check    # 仅校验，不写文件（dry-run）
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from aidc_planner import plan_aidc  # noqa: E402
from designer import NetworkDesignerV2  # noqa: E402
from device_library import get_device_library  # noqa: E402
from project_config import validate_config  # noqa: E402
from room import RoomMatrix  # noqa: E402

BASE = os.path.join(os.path.dirname(__file__), '..', 'template')

# ---------------------------------------------------------------------------
# 示例清单
# ---------------------------------------------------------------------------
# 收敛比：IB NDR 无阻塞 1:1；RoCE 2:1 收敛（示例演示过订阅）
CONVERGENCE_BY_PROTOCOL = {'IB': 1.0, 'RoCE': 2.0}

# plan 角色 → project_config.device_refs 键（5.0.1-501-a：plan.macro.deviceModels 与
# device_refs 严格一致，杜绝示例库“plan 型号 ↔ 设计引用”漂移）
ROLE_DEVICE_REF = {
    'SPINE': 'param_spine_switch',
    'LEAF': 'param_leaf_switch',
    'STO_SPINE': 'storage_spine_switch',
    'STO_LEAF': 'storage_leaf_switch',
    'BIZ_AGG': 'biz_agg_switch',
    'BIZ_ACCESS': 'biz_access_switch',
    'OOB_AGG': 'oob_agg_switch',
    'OOB_ACCESS': 'oob_access_switch',
}

# 参数网设备库 id（IB → NVIDIA Quantum-2；RoCE → H3C S9825-64D / S9827）
PARAM_SWITCH_BY_PROTOCOL = {
    'IB': {'leaf': 'nvidia_mqm9700_64_400g_ib', 'spine': 'nvidia_mqm9700_64_400g_ib'},
    'RoCE': {'leaf': 'h3c_s9825_64d', 'spine': 'h3c_s9827'},
}

SAMPLES = [
    {
        'id': 'H100-64台-IB',
        'name': 'H100-64台-IB（示例）',
        'gpu_count': 64,
        'protocol': 'IB',
        'num_all_flash_storage': 4,
        'num_hybrid_flash_storage': 4,
        'num_compute_servers': 8,
        'storage_switch_ports': 48,
        'description': '64台H100 DGX 单POD IB（NDR 400G，NVIDIA Quantum-2 无阻塞）示例项目',
        'scenario': 'H100-64台-IB',
        'tags': ['H100', '64台', 'IB', '示例项目', '单POD'],
        'project_id': '49a-64-ib-0001',
        'rows': list('ABCDEFGH'),
        'cols': list(range(1, 11)),
        'zones': {'gpu': ('A1', 'H8'), 'network': ('A9', 'B10'),
                  'storage': ('C9', 'D10'), 'compute': ('E9', 'F10')},
    },
    {
        'id': 'H100-64台-RoCE',
        'name': 'H100-64台-RoCE（示例）',
        'gpu_count': 64,
        'protocol': 'RoCE',
        'num_all_flash_storage': 4,
        'num_hybrid_flash_storage': 4,
        'num_compute_servers': 8,
        'storage_switch_ports': 48,
        'description': '64台H100 DGX 单POD RoCE（400G，H3C S9825/S9827 2:1收敛）示例项目',
        'scenario': 'H100-64台-RoCE',
        'tags': ['H100', '64台', 'RoCE', '示例项目', '单POD'],
        'project_id': '49a-64-roce-0001',
        'rows': list('ABCDEFGH'),
        'cols': list(range(1, 11)),
        'zones': {'gpu': ('A1', 'H8'), 'network': ('A9', 'B10'),
                  'storage': ('C9', 'D10'), 'compute': ('E9', 'F10')},
    },
    {
        'id': 'H100-128台-IB',
        'name': 'H100-128台-IB（示例）',
        'gpu_count': 128,
        'protocol': 'IB',
        'num_all_flash_storage': 7,
        'num_hybrid_flash_storage': 7,
        'num_compute_servers': 20,
        'storage_switch_ports': 40,
        'description': '128台H100 DGX 双POD IB（NDR 400G，NVIDIA Quantum-2 无阻塞）示例项目',
        'scenario': 'H100-128台-IB',
        'tags': ['H100', '128台', 'IB', '示例项目', '双POD'],
        'project_id': '49a-128-ib-0001',
        'rows': list('ABCDEFGHIJK'),
        'cols': list(range(1, 21)),
        'zones': {'gpu': ('A1', 'H16'), 'network': ('A17', 'B20'),
                  'storage': ('C17', 'F20'), 'compute': ('G17', 'H20')},
    },
    {
        'id': 'H100-128台-RoCE',
        'name': 'H100-128台-RoCE（示例）',
        'gpu_count': 128,
        'protocol': 'RoCE',
        'num_all_flash_storage': 7,
        'num_hybrid_flash_storage': 7,
        'num_compute_servers': 20,
        'storage_switch_ports': 40,
        'description': '128台H100 DGX 双POD RoCE（400G，H3C S9825/S9827 2:1收敛）示例项目',
        'scenario': 'H100-128台-RoCE',
        'tags': ['H100', '128台', 'RoCE', '示例项目', '双POD'],
        'project_id': '49a-128-roce-0001',
        'rows': list('ABCDEFGHIJK'),
        'cols': list(range(1, 21)),
        'zones': {'gpu': ('A1', 'H16'), 'network': ('A17', 'B20'),
                  'storage': ('C17', 'F20'), 'compute': ('G17', 'H20')},
    },
]

COMMON_TOPOLOGY = {
    'downlink_mode': 'custom',
    'param_ports_per_server': 8,
    'storage_ports_per_server': 1,
    'param_switch_ports': 64,
    'param_speed': '400G',
    'storage_speed': '200G',
    'param_downlink_limit': 25,
    'storage_downlink_limit': 20,
    'biz_downlink_limit': 25,
    'oob_downlink_limit': 25,
}

RACK_CONFIG = {
    'rack_type': 42,
    'power_limit_per_rack': 12000,
    'naming_prefix': '机柜',
    'cooling_method': 'air',
    'gpu_dedicated': True,
}


def _pos(pos):
    row = pos[0]
    col = int(pos[1:])
    return row, col


def build_project_config(sample):
    """project_config.json（与既有模板 schema 一致）"""
    protocol = sample['protocol']
    sw = PARAM_SWITCH_BY_PROTOCOL[protocol]
    topo = dict(COMMON_TOPOLOGY)
    topo.update({
        'param_protocol': protocol,
        'num_gpu_servers': sample['gpu_count'],
        'num_all_flash_storage': sample['num_all_flash_storage'],
        'num_hybrid_flash_storage': sample['num_hybrid_flash_storage'],
        'num_compute_servers': sample['num_compute_servers'],
        'storage_switch_ports': sample['storage_switch_ports'],
    })
    config = {
        'meta': {
            'name': sample['id'],
            'description': sample['description'],
            'version': 1,
            'created_at': '2026-09-03T00:00:00.000000',
            'updated_at': '2026-09-03T00:00:00.000000',
        },
        'networks': {
            'param_network': True, 'storage_network': True,
            'biz_network': True, 'oob_network': True,
        },
        'topology': topo,
        'device_refs': {
            'gpu_server': {'library_id': 'nvidia_dgx_h100'},
            'param_leaf_switch': {'library_id': sw['leaf']},
            'param_spine_switch': {'library_id': sw['spine']},
            'param_core_switch': {'library_id': sw['spine']},
            'param_switch': {'library_id': sw['leaf']},
            # 5.0.1-501-a: 存储网 200G → S9825-128B(200G)；业务汇聚 100G 上联 → S9850-32H(100G)；
            # OOB 汇聚 10G 上联 → S6805-56HF-G(10G)；OOB 接入 1G → S5560X-54C-EI(1G)
            'storage_leaf_switch': {'library_id': 'h3c_s9825_128b'},
            'storage_spine_switch': {'library_id': 'h3c_s9825_128b'},
            'storage_switch': {'library_id': 'h3c_s9825_128b'},
            'all_flash_storage_server': {'library_id': 'generic_all_flash'},
            'hybrid_flash_storage_server': {'library_id': 'generic_hybrid_flash'},
            'storage_server': {'library_id': 'generic_all_flash'},
            'biz_access_switch': {'library_id': 'h3c_s6850_56hf'},
            'biz_agg_switch': {'library_id': 'h3c_s9850_32h'},
            'compute_server': {'library_id': 'generic_2u_compute'},
            'oob_access_switch': {'library_id': 'h3c_s5560x_54c_ei'},
            'oob_agg_switch': {'library_id': 'h3c_s6805_56hf_g'},
        },
        'rack_config': dict(RACK_CONFIG),
        'scale_up': {},
    }
    return config


def build_network_ini(sample):
    """network_config.ini（与 project_config 拓扑等价；IB 显式声明 param_protocol）"""
    total_storage = sample['num_all_flash_storage'] + sample['num_hybrid_flash_storage']
    lines = ['[DEFAULT]', 'downlink_mode = custom']
    if sample['protocol'] == 'IB':
        lines.append('param_protocol = IB')
    lines += [
        f'num_servers = {sample["gpu_count"]}',
        f'additional_storage_servers = {total_storage}',
        f'additional_compute_servers = {sample["num_compute_servers"]}',
        'param_ports_per_server = 8',
        'storage_ports_per_server = 1',
        'param_switch_ports = 64',
        f'storage_switch_ports = {sample["storage_switch_ports"]}',
        'param_speed = 400G',
        'storage_speed = 200G',
        'param_downlink_limit = 25',
        'storage_downlink_limit = 20',
        'biz_downlink_limit = 25',
        'oob_downlink_limit = 25',
        'cable_param_server_leaf = MPO',
        'cable_param_leaf_spine = MPO',
        'cable_param_spine_core = MPO',
        'cable_storage_server_leaf = AOC',
        'cable_storage_leaf_spine = AOC',
        'cable_storage_spine_core = MPO',
        'oob_enabled = true',
        'oob_access_ports = 48',
        'oob_access_uplinks = 2',
        'oob_agg_ports = 48',
        'oob_speed = 1G',
        'oob_uplink_speed = 10G',
        'cable_oob_server_access = 网线',
        'cable_oob_access_agg = 光纤',
        'biz_enabled = true',
        'biz_port_speed = 25G',
        'biz_access_ports = 48',
        'biz_access_uplinks = 8',
        'biz_uplink_speed = 100G',
        'biz_agg_box_ports = 32',
        'biz_agg_chassis_ports = 32',
        'cable_biz_server_access = 光纤',
        'cable_biz_access_agg = 光纤',
        '',
        '[rack]',
        'rack_type = 42',
        'power_limit_per_rack = 12000',
        'naming_prefix = 机柜',
        'cooling_method = air',
        'gpu_dedicated = true',
    ]
    return '\n'.join(lines) + '\n'


def device_models_for(sample):
    """5.0.1-501-a: plan.macro.deviceModels 从 device_refs 实际解析的库设备派生
    （vendor + model，与 aidc_planner.DEFAULTS / 仓库既有约定一致），
    保证示例库 plan 型号与设计引用严格一致（单一事实来源 = 设备库）。"""
    config = build_project_config(sample)
    lib = get_device_library()
    models = {}
    for role, ref_key in ROLE_DEVICE_REF.items():
        ref = config['device_refs'][ref_key]
        dev = lib.resolve_ref(ref)
        if dev is None:
            raise RuntimeError(f"{sample['id']}: device_refs.{ref_key} 无法解析: {ref}")
        models[role] = f"{dev.vendor} {dev.model}".strip()
    return models


def build_plan(sample):
    """plan.json（plan:table v1.2，自包含；IB/RoCE 差异：protocol/convergence/deviceModels）"""
    plan = plan_aidc({
        'gpu_count': sample['gpu_count'],
        'protocol': sample['protocol'],
        'convergence': CONVERGENCE_BY_PROTOCOL[sample['protocol']],
        'device_models': device_models_for(sample),
        'project_id': sample['project_id'],
        'project_name': sample['id'],
        'plan_version': 1,
    })
    if 'error' in plan:
        raise RuntimeError(f"{sample['id']}: plan_aidc 失败: {plan['error']}")
    return plan


def build_room_layout(sample):
    """room_layout.json（机房矩阵默认布局：gpu/network/storage/compute 分区）"""
    matrix = RoomMatrix(rows=sample['rows'], cols=sample['cols'], name=f"{sample['id']}机房")
    for zone, (a, b) in sample['zones'].items():
        ar, ac = _pos(a)
        br, bc = _pos(b)
        ai, bi = sample['rows'].index(ar), sample['rows'].index(br)
        for r in sample['rows'][ai:bi + 1]:
            for c in range(ac, bc + 1):
                matrix.set_type(f'{r}{c}', zone)
    return matrix.to_dict()


def build_template_meta(sample):
    """template.json（示例标记 isSample=true，模板中心可见）"""
    return {
        'id': sample['id'],
        'name': sample['name'],
        'description': sample['description'],
        'scenario': sample['scenario'],
        'tags': sample['tags'],
        'updatedAt': '2026-09-03',
        'templateVersion': 2,
        'isSample': True,
    }


def _write_json(path, data):
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')


def validate_sample(sample):
    """校验单个示例模板（生成内存态后校验，不落盘）。返回错误列表（空 = 通过）"""
    problems = []
    config = build_project_config(sample)
    verr = validate_config(config)
    if verr:
        problems.append(f'validate_config: {verr}')
    lib = get_device_library()
    missing = [k for k, ref in config.get('device_refs', {}).items() if lib.resolve_ref(ref) is None]
    if missing:
        problems.append(f'device_refs 无法解析: {missing}')
    plan = build_plan(sample)
    if plan['macro']['protocol'] != sample['protocol']:
        problems.append('plan.macro.protocol 与示例协议不一致')
    if plan['macro']['gpuCount'] != sample['gpu_count']:
        problems.append('plan.macro.gpuCount 与示例规模不一致')
    # 设计可消费且机柜合规（U 位/功率）
    import tempfile
    try:
        with tempfile.TemporaryDirectory() as tmp:
            cfg_path = os.path.join(tmp, 'project_config.json')
            with open(cfg_path, 'w', encoding='utf-8') as f:
                json.dump(config, f, ensure_ascii=False)
            d = NetworkDesignerV2(cfg_path)
            v = d.validate_topology()
            if not v['valid']:
                problems.append(f'拓扑校验失败: {v.get("errors")}')
            cabinets = getattr(d, '_rack_cabinets', []) or []
            exceeded = [c.name for c in cabinets if c.exceeded]
            if exceeded:
                problems.append(f'功率超限柜: {exceeded[:5]}')
            unmounted = [s.name for s in d.servers if not getattr(s, 'cabinet_id', 0)]
            if unmounted:
                problems.append(f'未上架服务器: {unmounted[:5]}（{len(unmounted)}台）')
    except Exception as e:  # noqa: BLE001
        problems.append(f'设计失败: {e}')
    return problems


def main():
    parser = argparse.ArgumentParser(description='生成/校验 4 个 H100 示例模板')
    parser.add_argument('--check', action='store_true', help='仅校验，不写文件（dry-run）')
    args = parser.parse_args()

    failures = 0
    for sample in SAMPLES:
        tpl_dir = os.path.join(BASE, sample['id'])
        problems = validate_sample(sample)
        if args.check:
            if problems:
                failures += 1
                print(f'[FAIL] {sample["id"]}')
                for p in problems:
                    print(f'       {p}')
            else:
                print(f'[OK]   {sample["id"]}')
            continue

        os.makedirs(tpl_dir, exist_ok=True)
        _write_json(os.path.join(tpl_dir, 'project_config.json'), build_project_config(sample))
        with open(os.path.join(tpl_dir, 'network_config.ini'), 'w', encoding='utf-8') as f:
            f.write(build_network_ini(sample))
        _write_json(os.path.join(tpl_dir, 'plan.json'), build_plan(sample))
        _write_json(os.path.join(tpl_dir, 'room_layout.json'), build_room_layout(sample))
        _write_json(os.path.join(tpl_dir, 'template.json'), build_template_meta(sample))
        if problems:
            failures += 1
            print(f'[WRITE+FAIL] {sample["id"]}（已写出，存在校验问题）')
            for p in problems:
                print(f'       {p}')
        else:
            print(f'[OK]   {sample["id"]} → {os.path.relpath(tpl_dir, BASE)}')

    total = len(SAMPLES)
    print(f'\n结果: {total - failures}/{total} 示例通过' if not args.check else
          f'\n结果: {total - failures}/{total} 示例通过（dry-run）')
    sys.exit(1 if failures else 0)


if __name__ == '__main__':
    main()
