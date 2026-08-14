"""
AIDC 规划器（AL 侧，P1.3）。

自包含地由宏观参数生成 plan:table（AL→MC 接口契约，MC-AL 联合 PRD v2.0 §5）：
- 宏观参数（机房/GPU 规模/PFC-CNP 队列/收敛比/命名/AS 段）含默认值 + 校验
- 拓扑（参数网/存储网/业务&管理网/带外网 设备数）
- 接线（上联 + 终端，端口级 + 描述）
- 地址/VLAN 规划（合法、0-255 段内、跨 /24 进位）
- 输出 plan:table JSON

说明：本模块自包含（不依赖 MC 端），供 AL 后端 action 与 UI 调用。
"""

import ipaddress


# ---------------- 默认值（F10/F14/F16） ----------------
DEFAULTS = {
    'site': 'BJ01',
    'gpu_count': 64,          # 试点 64 台
    'pfc_queue': 3,           # F16
    'cnp_queue': 6,           # F16
    'bgp_max_paths': 16,
    'convergence': 1.0,
    'rails': 8,
    'as_range': [65001, 65500],
    'vlan_ranges': {'compute': [100, 199], 'storage': [200, 299],
                    'biz': [300, 399], 'oob': [400, 499]},
    'device_models': {
        'SPINE': 'H3C S9827', 'LEAF': 'H3C S9827',
        'STO_SPINE': 'H3C S9825-128B', 'STO_LEAF': 'H3C S9825-128B',
        'BIZ_AGG': 'H3C S9850', 'BIZ_ACCESS': 'H3C S6805',
        'OOB_AGG': 'H3C S5820V2', 'OOB_ACCESS': 'H3C S5820V2',
    },
}

# 场景缩写（命名规范表）
SCN_ABBR = {
    'SPINE': 'P-Spine', 'LEAF': 'P-Leaf', 'STO_SPINE': 'S-Spine', 'STO_LEAF': 'S-Leaf',
    'BIZAGG': 'BIZ-AGG', 'BIZACC': 'BIZ-ACC', 'OOBAGG': 'OOB-AGG', 'OOBACC': 'OOB-ACC',
}

# 每 GPU 规模 → 设备数（2 层 CLOS，D15；64 台为试点基准）
_SCALE = {
    32:  {'SPINE': 2, 'LEAF': 4},
    64:  {'SPINE': 2, 'LEAF': 8},
    128: {'SPINE': 4, 'LEAF': 8},
    256: {'SPINE': 4, 'LEAF': 16},
    512: {'SPINE': 8, 'LEAF': 16},
    1024: {'SPINE': 8, 'LEAF': 32},
}


class AddressPool:
    def __init__(self, base_net, start=0):
        self._net = ipaddress.ip_network(base_net)
        self._cur = int(self._net.network_address) + 1 + start
        self._end = int(self._net.broadcast_address)

    def take(self, n=1):
        out = []
        for _ in range(n):
            if self._cur >= self._end:
                raise ValueError(f'地址池 {self._net} 耗尽')
            out.append(str(ipaddress.ip_address(self._cur)))
            self._cur += 1
        return out


def _repeat(vals, n):
    return [vals[i % len(vals)] for i in range(n)]


def _adj(ip):
    return str(ipaddress.ip_address(ip) + 1)


def validate_macro(macro: dict) -> str | None:
    """宏观参数校验，返回错误信息或 None。"""
    if 'pfc_queue' in macro and not (0 <= int(macro['pfc_queue']) <= 7):
        return 'PFC 队列须在 0-7'
    if 'cnp_queue' in macro and not (0 <= int(macro['cnp_queue']) <= 7):
        return 'CNP 队列须在 0-7'
    gpu = int(macro.get('gpu_count', DEFAULTS['gpu_count']))
    if gpu not in _SCALE:
        return f'GPU 规模 {gpu} 不在支持档位（{sorted(_SCALE)}）'
    return None


def plan_aidc(macro: dict) -> dict:
    """由宏观参数生成 plan:table。"""
    err = validate_macro(macro)
    if err:
        return {'error': err}
    m = dict(DEFAULTS)
    m.update(macro)
    site = m['site']
    gpu = int(m['gpu_count'])
    topo = _SCALE[gpu]
    pfc, cnp = int(m['pfc_queue']), int(m['cnp_queue'])

    lo = AddressPool('10.1.0.0/20')
    mg = AddressPool('10.1.64.0/21')
    ic = AddressPool('10.1.72.0/21')
    cgw = AddressPool('10.1.16.0/20')

    devices = []
    conns = []
    terms = []
    rack_no = 0

    def _hname(scn, idx):
        nonlocal rack_no
        rack_no += 1
        return f'{site}-R{rack_no:02d}-AIDC-H3C-{SCN_ABBR[scn]}-{idx:02d}'

    # 参数网
    spine_n = topo['SPINE']
    leaf_n = topo['LEAF']
    for s in range(1, spine_n + 1):
        devices.append({'role': 'SPINE', 'scenario': 'SPINE', 'model': m['device_models']['SPINE'],
                        'name': _hname('SPINE', s), 'asn': 65110 + s})
    for lf in range(1, leaf_n + 1):
        h = _hname('LEAF', lf)
        devices.append({'role': 'LEAF', 'scenario': 'LEAF', 'model': m['device_models']['LEAF'],
                        'name': h, 'asn': 65100 + lf})
        # GPU 下联（每 Leaf 64×200G，1-32 分光）
        for p in range(1, 33):
            for sub in (1, 2):
                terms.append({'src': h, 'src_port': f'TwoHundredGigE1/0/{p}:{sub}',
                              'vlan': 100 + (lf - 1) * 2 + (sub - 1),
                              'desc': f'GPU-R{lf}-{p * 2 + sub - 2}'})
        # 上联 Spine（/31）
        for i in range(32):
            local_ip = ic.take(1)[0]
            conns.append({'src': h, 'src_port': f'FourHundredGigE1/0/{33 + i}', 'src_ip': local_ip,
                          'dst': 'SPINE', 'dst_ip': _adj(local_ip), 'rate': '400G',
                          'desc': f'to-P-Spine-{(i // 16) + 1}'})
        # 网关
        gws = [cgw.take(1)[0] for _ in (0, 1)]
        devices[-1]['gateways'] = gws

    # 存储网（S9825-128B，200G）
    for s in range(1, 2):
        devices.append({'role': 'STO_SPINE', 'scenario': 'STO_SPINE', 'model': m['device_models']['STO_SPINE'],
                        'name': _hname('STO_SPINE', s), 'asn': 65121})
    for lf in range(1, 3):
        h = _hname('STO_LEAF', lf)
        devices.append({'role': 'STO_LEAF', 'scenario': 'STO_LEAF', 'model': m['device_models']['STO_LEAF'],
                        'name': h, 'asn': 65130 + lf})
        for i in range(1, 33):
            terms.append({'src': h, 'src_port': f'TwoHundredGigE1/0/{i}',
                          'vlan': 200 + (i % 10), 'desc': f'STO-{lf}-{i}'})
        for i in range(1):
            local_ip = ic.take(1)[0]
            conns.append({'src': h, 'src_port': 'TwoHundredGigE1/0/33', 'src_ip': local_ip,
                          'dst': 'STO_SPINE', 'dst_ip': _adj(local_ip), 'rate': '200G',
                          'desc': 'to-S-Spine'})

    # 业务&管理网（BIZ-AGG 100G 下行，ACC MLAG）
    for a in range(1, 3):
        devices.append({'role': 'BIZ_AGG', 'scenario': 'BIZAGG', 'model': m['device_models']['BIZ_AGG'],
                        'name': _hname('BIZAGG', a), 'asn': 65150 + a})
    for c in range(1, 5):
        h = _hname('BIZACC', c)
        devices.append({'role': 'BIZ_ACCESS', 'scenario': 'BIZACC', 'model': m['device_models']['BIZ_ACCESS'],
                        'name': h, 'asn': 65140 + c,
                        'mlag_pair': (c - 1) // 2 + 1, 'mlag_system_number': (c - 1) % 2 + 1})
        for i in range(1, 33):
            terms.append({'src': h, 'src_port': f'Twenty-FiveGigE1/0/{i}',
                          'vlan': 300 + (c % 2), 'desc': f'BIZ-{c}-{i}'})
        for i in range(2):
            local_ip = ic.take(1)[0]
            conns.append({'src': h, 'src_port': f'HundredGigE1/0/{i + 1}', 'src_ip': local_ip,
                          'dst': 'BIZ_AGG', 'dst_ip': _adj(local_ip), 'rate': '100G',
                          'desc': f'to-BIZ-AGG-{i + 1}'})

    # 带外网
    devices.append({'role': 'OOB_AGG', 'scenario': 'OOBAGG', 'model': m['device_models']['OOB_AGG'],
                    'name': _hname('OOBAGG', 1), 'asn': 65161})
    for o in range(1, 3):
        h = _hname('OOBACC', o)
        devices.append({'role': 'OOB_ACCESS', 'scenario': 'OOBACC', 'model': m['device_models']['OOB_ACCESS'],
                        'name': h, 'asn': 65170 + o})
        for i in range(1, 9):
            terms.append({'src': h, 'src_port': f'GigabitEthernet1/0/{i}',
                          'vlan': 400, 'desc': f'OOB-{o}-{i}'})
        local_ip = ic.take(1)[0]
        conns.append({'src': h, 'src_port': 'GigabitEthernet1/0/25', 'src_ip': local_ip,
                      'dst': 'OOB_AGG', 'dst_ip': _adj(local_ip), 'rate': '1G',
                      'desc': 'to-OOB-AGG', 'trunk': True})

    return {
        'meta': {'project': f'aidc_{gpu}', 'site': site, 'version': '1.0'},
        'macro': {
            'site': site, 'gpu_count': gpu, 'pfc_queue': pfc, 'cnp_queue': cnp,
            'bgp_max_paths': m['bgp_max_paths'], 'convergence': m['convergence'],
            'rails': m['rails'], 'as_range': m['as_range'],
            'vlan_ranges': m['vlan_ranges'], 'device_models': m['device_models'],
        },
        'deviceList': devices,
        'connections': conns,
        'terminals': terms,
        'protocols': {'bgp': {'as_range': m['as_range'], 'ecmp': m['bgp_max_paths']}},
        'convergence': {'compute': m['convergence'], 'storage': m['convergence'], 'biz': m['convergence']},
    }
