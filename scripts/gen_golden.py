"""AutoLink 3.0 拓扑 golden 基线工具（T0-1 前置，v3.0.0）

生成/校验 16 内置模板的设计器输出快照，作为 3.0 拓扑引擎重构的回归锚点：
  - 各层级设备计数（servers/param/storage/oob/biz/scale_up）
  - 连接总数 + 按 network_type 分布
  - 拓扑校验结果（validate_topology valid）
  - 关键配置（rail/协议/速率/下行模式）
  - 机柜数/总功率
  - topology_hash（设备+连接规范化哈希，强校验）

用法：
  python scripts/gen_golden.py            # 生成基线到 tests/backend/golden/
  python scripts/gen_golden.py --check    # 重新生成并与基线比对（CI 门禁，差异即失败）
"""
import sys
import os
import json
import hashlib

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
from designer import NetworkDesignerV2

base = os.path.join(os.path.dirname(__file__), '..', 'template')
golden_dir = os.path.join(os.path.dirname(__file__), '..', 'tests', 'backend', 'golden')

# 自动发现模板目录（含 network_config.ini），排除 device_library/.gitkeep 等
templates = sorted([
    name for name in os.listdir(base)
    if os.path.isdir(os.path.join(base, name))
    and os.path.exists(os.path.join(base, name, 'network_config.ini'))
])


def _all_devices(d):
    """与 engine.py handle_design 一致的全量设备列表"""
    return list(d.servers) + (
        d.param_leaves + d.param_spines + d.param_cores +
        d.storage_leaves + d.storage_spines + d.storage_cores +
        d.oob_access + d.oob_agg + d.biz_access + d.biz_agg +
        list(getattr(d, 'scale_up_gpus', [])) +
        # V3.0.2-T2-3: 华为超节点 NPU + Scale-Out 交换机
        getattr(d, 'huawei_npus', []) + getattr(d, 'huawei_scaleout_switches', [])
    )


def _connections(d):
    """去重连接列表：(a, z, a_port, network_type)"""
    seen = set()
    conns = []
    for dev in _all_devices(d):
        for c in dev.connections:
            if c.a_device != dev.name:
                continue
            key = tuple(sorted([c.a_device, c.z_device])) + (c.a_port,)
            if key in seen:
                continue
            seen.add(key)
            conns.append((c.a_device, c.z_device, c.a_port, c.network_type))
    return conns


def _topology_hash(d):
    """设备 (name,obj_type,group) + 连接 (a,z,port,net) 规范化哈希，捕获任何结构变化"""
    devs = sorted((dev.name, dev.obj_type, dev.group or '') for dev in _all_devices(d))
    conns = sorted(_connections(d))
    payload = json.dumps({'devices': devs, 'connections': conns},
                         ensure_ascii=False, sort_keys=True)
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()[:16]


def _snapshot(d):
    counts = {
        'servers': len(d.servers),
        'param_leaves': len(d.param_leaves),
        'param_spines': len(d.param_spines),
        'param_cores': len(d.param_cores),
        'storage_leaves': len(d.storage_leaves),
        'storage_spines': len(d.storage_spines),
        'storage_cores': len(d.storage_cores),
        'oob_access': len(d.oob_access),
        'oob_agg': len(d.oob_agg),
        'biz_access': len(d.biz_access),
        'biz_agg': len(d.biz_agg),
        'scale_up_gpus': len(getattr(d, 'scale_up_gpus', [])),
        'huawei_npus': len(getattr(d, 'huawei_npus', [])),
        'huawei_scaleout_switches': len(getattr(d, 'huawei_scaleout_switches', [])),
    }
    conns = _connections(d)
    net_conns = {}
    for _, _, _, nt in conns:
        net_conns[nt] = net_conns.get(nt, 0) + 1
    cabinets = getattr(d, '_rack_cabinets', []) or []
    total_power = sum(getattr(c, 'total_power', 0) for c in cabinets)

    return {
        'counts': counts,
        'connections': len(conns),
        'network_connections': dict(sorted(net_conns.items())),
        'valid': d.validate_topology()['valid'],
        'rail_mode': getattr(d, 'rail_mode', 'standard'),
        'rail_count': getattr(d, 'rail_count', 8),
        'param_speed': d.param_speed,
        'param_protocol': getattr(d, 'param_protocol', 'RoCE'),
        'downlink_mode': d.downlink_mode,
        'cabinets': len(cabinets),
        'total_power_w': total_power,
        'topology_hash': _topology_hash(d),
    }


# ================================================================
# V3.0.1-T1-8: 双平面 golden 场景（PRD 验收：CX7 2×200G / CX8 2×400G / 800G）
# ================================================================

def _dual_plane_scenarios():
    """返回 {name: project_config dict}（双平面验收场景，3+ 个）"""
    from project_config import create_default_config

    def base(name, servers, speed, nics=8, leaf=8, switch_ports=144, uplink=16, storage=8, compute=8):
        cfg = create_default_config(name)
        cfg['topology'].update({
            'num_gpu_servers': servers,
            'num_all_flash_storage': storage,
            'num_hybrid_flash_storage': 0,
            'num_compute_servers': compute,
            'param_protocol': 'IB',
            'param_speed': speed,
            'param_nics_per_server': nics,
            'ports_per_nic': 2,
            'param_planes': [
                {'leaf_count': leaf, 'protocol': 'IB', 'speed': speed,
                 'switch_ports': switch_ports, 'uplink': uplink},
                {'leaf_count': leaf, 'protocol': 'IB', 'speed': speed,
                 'switch_ports': switch_ports, 'uplink': uplink},
            ],
        })
        return cfg

    return {
        # 128×H200：CX7 2×200G 双平面，各 8 Leaf（非阻塞 2:1）
        'dual_plane_128_h200_cx7': base('dp-h200', 128, '200G'),
        # 1024×B300：CX8 2×400G 双平面 800G IB（leaf 自动扩容）
        'dual_plane_1024_b300_800g': base('dp-b300', 1024, '800G'),
        # 288×GB300 NVL72：双平面 800G IB（3-tier 形态容量）
        'dual_plane_288_gb300_800g': base('dp-gb300', 288, '800G'),
    }


def _run_dual_plane_scenarios(check):
    """生成/校验双平面场景快照（文件 dual_plane_*.json）"""
    from designer import NetworkDesignerV2
    import tempfile
    import shutil

    diffs = []
    generated = 0
    tmpdir = tempfile.mkdtemp(prefix='golden_dp_')
    try:
        for name, cfg in _dual_plane_scenarios().items():
            cfg_path = os.path.join(tmpdir, 'project_config.json')
            with open(cfg_path, 'w', encoding='utf-8') as f:
                json.dump(cfg, f, ensure_ascii=False)
            try:
                d = NetworkDesignerV2(cfg_path)
                snap = _snapshot(d)
            except Exception as e:  # 设计失败也记录快照（error）
                snap = {'error': f'{type(e).__name__}: {e}'}

            gf = os.path.join(golden_dir, name + '.json')
            if check:
                if not os.path.exists(gf):
                    diffs.append(f'{name}: 缺少基线文件 {gf}')
                    continue
                with open(gf, encoding='utf-8') as f:
                    expected = json.load(f)
                if snap != expected:
                    diffs.append(
                        f'{name}: 与基线不一致\n'
                        f'    基线: {json.dumps(expected, ensure_ascii=False)}\n'
                        f'    当前: {json.dumps(snap, ensure_ascii=False)}')
            else:
                with open(gf, 'w', encoding='utf-8') as f:
                    json.dump(snap, f, ensure_ascii=False, indent=2, sort_keys=True)
                generated += 1
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    return diffs, generated


# ================================================================
# V3.0.2-T2-1: ZCube 扁平二部图 golden 场景（无 Spine / 双口混合接入）
# ================================================================

def _zcube_scenarios():
    """返回 {name: project_config dict}（ZCube 验收场景，2+ 个）"""
    from project_config import create_default_config

    def base(name, servers, nics=2, leaf_count=0, switch_ports=144, storage=8, compute=8):
        cfg = create_default_config(name)
        cfg['topology'].update({
            'num_gpu_servers': servers,
            'num_all_flash_storage': storage,
            'num_hybrid_flash_storage': 0,
            'num_compute_servers': compute,
            'param_speed': '400G',
            'param_network_mode': 'zcube',
            'param_zcube': {'nics_per_gpu': nics, 'leaf_count': leaf_count,
                            'switch_ports': switch_ports},
        })
        return cfg

    return {
        # 512 GPU 双口混合：自动推导 L=8，两组 Leaf 各 8（16 Leaf，无 Spine/Core）
        'zcube_512_dual_nic': base('zc-512', 512, nics=2),
        # 1024 GPU 四口多轨：组 A 2 口 + 组 B 2 口（L 自动扩容满足容量）
        'zcube_1024_quad_nic': base('zc-1024', 1024, nics=4),
    }


def _run_zcube_scenarios(check):
    """生成/校验 ZCube 场景快照（文件 zcube_*.json）"""
    from designer import NetworkDesignerV2
    import tempfile
    import shutil

    diffs = []
    generated = 0
    tmpdir = tempfile.mkdtemp(prefix='golden_zc_')
    try:
        for name, cfg in _zcube_scenarios().items():
            cfg_path = os.path.join(tmpdir, 'project_config.json')
            with open(cfg_path, 'w', encoding='utf-8') as f:
                json.dump(cfg, f, ensure_ascii=False)
            try:
                d = NetworkDesignerV2(cfg_path)
                snap = _snapshot(d)
            except Exception as e:  # 设计失败也记录快照（error）
                snap = {'error': f'{type(e).__name__}: {e}'}

            gf = os.path.join(golden_dir, name + '.json')
            if check:
                if not os.path.exists(gf):
                    diffs.append(f'{name}: 缺少基线文件 {gf}')
                    continue
                with open(gf, encoding='utf-8') as f:
                    expected = json.load(f)
                if snap != expected:
                    diffs.append(
                        f'{name}: 与基线不一致\n'
                        f'    基线: {json.dumps(expected, ensure_ascii=False)}\n'
                        f'    当前: {json.dumps(snap, ensure_ascii=False)}')
            else:
                with open(gf, 'w', encoding='utf-8') as f:
                    json.dump(snap, f, ensure_ascii=False, indent=2, sort_keys=True)
                generated += 1
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    return diffs, generated


# ================================================================
# V3.0.2-T2-3: 华为超节点 golden 场景（UB 域内全对等 + 域间 800G Scale-Out）
# ================================================================

def _huawei_scenarios():
    """返回 {name: project_config dict}（华为超节点验收场景，2+ 个）"""
    from project_config import create_default_config

    def base(name, npus, domain_size=0, so_switches=16, so_ports=2):
        cfg = create_default_config(name)
        cfg['topology'].update({
            'num_gpu_servers': npus,
            'param_network_mode': 'huawei_supernode',
            'param_huawei_supernode': {
                'num_npus': npus, 'npus_per_node': 8, 'ub_bandwidth_gbps': 2800,
                'ub_domain_size': domain_size,
                'num_scaleout_switches': so_switches, 'scaleout_ports_per_npu': so_ports,
                'scaleout_speed': '800G', 'scaleout_switch_ports': 144,
            },
        })
        return cfg

    return {
        # 384 NPU CloudMatrix：单 UB 域全对等 + 16 台 800G Scale-Out（PRD 4.1.3 验收）
        'huawei_384_cloudmatrix': base('hs-384', 384),
        # 768 NPU 双域：每域 384 全对等 + 8×2 台 Scale-Out 跨域全互联骨干
        'huawei_768_two_domains': base('hs-768', 768, domain_size=384, so_switches=8),
    }


def _run_huawei_scenarios(check):
    """生成/校验华为超节点场景快照（文件 huawei_*.json）"""
    from designer import NetworkDesignerV2
    import tempfile
    import shutil

    diffs = []
    generated = 0
    tmpdir = tempfile.mkdtemp(prefix='golden_hs_')
    try:
        for name, cfg in _huawei_scenarios().items():
            cfg_path = os.path.join(tmpdir, 'project_config.json')
            with open(cfg_path, 'w', encoding='utf-8') as f:
                json.dump(cfg, f, ensure_ascii=False)
            try:
                d = NetworkDesignerV2(cfg_path)
                snap = _snapshot(d)
            except Exception as e:  # 设计失败也记录快照（error）
                snap = {'error': f'{type(e).__name__}: {e}'}

            gf = os.path.join(golden_dir, name + '.json')
            if check:
                if not os.path.exists(gf):
                    diffs.append(f'{name}: 缺少基线文件 {gf}')
                    continue
                with open(gf, encoding='utf-8') as f:
                    expected = json.load(f)
                if snap != expected:
                    diffs.append(
                        f'{name}: 与基线不一致\n'
                        f'    基线: {json.dumps(expected, ensure_ascii=False)}\n'
                        f'    当前: {json.dumps(snap, ensure_ascii=False)}')
            else:
                with open(gf, 'w', encoding='utf-8') as f:
                    json.dump(snap, f, ensure_ascii=False, indent=2, sort_keys=True)
                generated += 1
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)
    return diffs, generated


def main():
    check = '--check' in sys.argv
    os.makedirs(golden_dir, exist_ok=True)
    diffs = []
    generated = 0
    skipped = []

    for t in templates:
        json_path = os.path.join(base, t, 'project_config.json')
        if not os.path.exists(json_path):
            skipped.append(f'{t}（无 project_config.json）')
            continue
        try:
            d = NetworkDesignerV2(json_path)
            snap = _snapshot(d)
        except Exception as e:  # 设计失败也记录快照（error），便于基线覆盖失败态
            snap = {'error': f'{type(e).__name__}: {e}'}

        gf = os.path.join(golden_dir, t + '.json')
        if check:
            if not os.path.exists(gf):
                diffs.append(f'{t}: 缺少基线文件 {gf}')
                continue
            with open(gf, encoding='utf-8') as f:
                expected = json.load(f)
            if snap != expected:
                diffs.append(
                    f'{t}: 与基线不一致\n'
                    f'    基线: {json.dumps(expected, ensure_ascii=False)}\n'
                    f'    当前: {json.dumps(snap, ensure_ascii=False)}')
        else:
            with open(gf, 'w', encoding='utf-8') as f:
                json.dump(snap, f, ensure_ascii=False, indent=2, sort_keys=True)
            generated += 1

    # V3.0.1-T1-8: 双平面场景 golden
    dp_diffs, dp_generated = _run_dual_plane_scenarios(check)
    diffs.extend(dp_diffs)
    generated += dp_generated

    # V3.0.2-T2-1: ZCube 场景 golden
    zc_diffs, zc_generated = _run_zcube_scenarios(check)
    diffs.extend(zc_diffs)
    generated += zc_generated

    # V3.0.2-T2-3: 华为超节点场景 golden
    hs_diffs, hs_generated = _run_huawei_scenarios(check)
    diffs.extend(hs_diffs)
    generated += hs_generated

    if check:
        if diffs:
            print(f'golden --check 失败（{len(diffs)} 项差异）：')
            for d in diffs:
                print(f'  - {d}')
            sys.exit(1)
        print(f'golden --check 通过：{len(templates)}/{len(templates)} 模板与基线一致'
              f'（含 {len(_dual_plane_scenarios())} 个双平面 + '
              f'{len(_zcube_scenarios())} 个 ZCube + '
              f'{len(_huawei_scenarios())} 个华为超节点场景）')
    else:
        print(f'golden 基线生成完成：{generated} 个模板写入 {golden_dir}')
        if skipped:
            print(f'跳过（无 project_config.json）：{skipped}')


if __name__ == '__main__':
    main()
