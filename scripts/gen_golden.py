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
        list(getattr(d, 'scale_up_gpus', []))
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

    if check:
        if diffs:
            print(f'golden --check 失败（{len(diffs)} 项差异）：')
            for d in diffs:
                print(f'  - {d}')
            sys.exit(1)
        print(f'golden --check 通过：{len(templates)}/{len(templates)} 模板与基线一致')
    else:
        print(f'golden 基线生成完成：{generated} 个模板写入 {golden_dir}')
        if skipped:
            print(f'跳过（无 project_config.json）：{skipped}')


if __name__ == '__main__':
    main()
