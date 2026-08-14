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

import datetime
import io
import ipaddress
import json


# ---------------- 桥接标识（plan:table 契约 v1.1，MC-AL/docs/plan_table_契约v1.1） ----------------
BRIDGE_META = {
    'source': 'autolink',          # 来源系统：AL 产出
    'projectType': 'aidc',         # 项目类型：AIDC 桥接
    'bridgeVersion': '1.0',        # 桥接契约能力版本
    'schema': 'plan:table/1.1',    # schema 标识
}


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
    'ip_segments': {           # F10：单个 /16 裂解（默认 10.1.0.0/16）
        'loopback': '10.1.0.0/20',
        'compute': '10.1.16.0/20',
        'storage': '10.1.32.0/20',
        'biz': '10.1.48.0/20',
        'oob': '10.1.64.0/21',
        'interconnect': '10.1.72.0/21',
    },
    'ospf': {'process': 10, 'area': '0.0.0.0'},
    'naming_format': '{site}-R{rack:02d}-AIDC-{vendor}-{abbr}-{seq:02d}',
    'device_models': {
        'SPINE': 'H3C S9827', 'LEAF': 'H3C S9827',
        'STO_SPINE': 'H3C S9825-128B', 'STO_LEAF': 'H3C S9825-128B',
        'BIZ_AGG': 'H3C S9850-32H', 'BIZ_ACCESS': 'H3C S6850-56HF',
        'OOB_AGG': 'H3C S6805-56HF-G', 'OOB_ACCESS': 'H3C S5560X-54C-EI',
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


AS_MIN, AS_MAX = 65001, 65500
VLAN_MAX = 4094


def validate_macro(macro: dict) -> str | None:
    """宏观参数校验，返回错误信息或 None（契约 v1.1：高级参数也校验）。"""
    if 'pfc_queue' in macro and not (0 <= int(macro['pfc_queue']) <= 7):
        return 'PFC 队列须在 0-7'
    if 'cnp_queue' in macro and not (0 <= int(macro['cnp_queue']) <= 7):
        return 'CNP 队列须在 0-7'
    gpu = int(macro.get('gpu_count', macro.get('gpuCount', DEFAULTS['gpu_count'])))
    if gpu not in _SCALE:
        return f'GPU 规模 {gpu} 不在支持档位（{sorted(_SCALE)}）'
    if 'convergence' in macro and not (0 < float(macro['convergence']) <= 4):
        return '收敛比须在 (0,4]'
    if 'rails' in macro and not (1 <= int(macro['rails']) <= 16):
        return '多轨数须在 1-16'
    if 'as_range' in macro:
        lo, hi = int(macro['as_range'][0]), int(macro['as_range'][1])
        if not (AS_MIN <= lo <= hi <= AS_MAX):
            return f'AS 段须在 {AS_MIN}-{AS_MAX} 且 lo<=hi'
    if 'vlan_ranges' in macro:
        for plane, (lo, hi) in macro['vlan_ranges'].items():
            if not (0 <= int(lo) <= int(hi) <= VLAN_MAX):
                return f'{plane} VLAN 段非法: [{lo},{hi}]'
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

    # 地址段来源：macro.ip_segments（契约 v1.1，F10 裂解）
    seg = m.get('ip_segments', DEFAULTS['ip_segments'])
    lo = AddressPool(seg['loopback'])
    mg = AddressPool(seg['oob'])
    ic = AddressPool(seg['interconnect'])
    cgw = AddressPool(seg['compute'])

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

    # 设备 rack（契约 v1.1：从命名解析）
    for d in devices:
        d['rack'] = int(d['name'].split('-R', 1)[1].split('-', 1)[0])

    now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')
    return {
        'meta': {
            'project': f'aidc_{gpu}', 'site': site,
            'version': '1.1', 'schema': BRIDGE_META['schema'],
            'generatedAt': now,
            'source': BRIDGE_META['source'],
            'projectType': BRIDGE_META['projectType'],
            'bridgeVersion': BRIDGE_META['bridgeVersion'],
        },
        'macro': {
            'site': site, 'gpuCount': gpu,
            'pfcQueue': pfc, 'cnpQueue': cnp, 'bgpMaxPaths': m['bgp_max_paths'],
            'convergence': m['convergence'], 'rails': m['rails'],
            'naming': {'format': m['naming_format'], 'abbr': SCN_ABBR},
            'ipSegments': seg,
            'vlanRanges': m['vlan_ranges'], 'asRange': m['as_range'],
            'ospf': m['ospf'],
            'deviceModels': m['device_models'],
        },
        'topology': {
            'layers': 2, 'spines': spine_n, 'leaves': leaf_n, 'pods': None,
            'scale': {'gpuCount': gpu, 'spine': spine_n, 'leaf': leaf_n},
        },
        'deviceList': devices,
        'connections': conns,
        'terminals': terms,
        'protocols': {
            'ospf': m['ospf'],
            'bgp': {'asRange': m['as_range'], 'ecmp': m['bgp_max_paths']},
        },
        'convergence': {'compute': m['convergence'], 'storage': m['convergence'], 'biz': m['convergence']},
    }


# ---------------- 导出（REQ-A3，G2） ----------------
def _write_plan_excel(plan: dict, filepath: str) -> None:
    """plan:table → Excel（设备/接线/终端/宏观参数/协议 分 sheet）。"""
    import pandas as pd

    def _scalar(v):
        if isinstance(v, (str, int, float, bool)) or v is None:
            return v
        return json.dumps(v, ensure_ascii=False, default=str)

    sheets = {
        '设备清单': pd.DataFrame([{**d, 'gateways': json.dumps(d.get('gateways', []), ensure_ascii=False)
                              if d.get('gateways') else ''} for d in plan['deviceList']]),
        '接线': pd.DataFrame(plan['connections']),
        '终端': pd.DataFrame(plan['terminals']),
        '宏观参数': pd.DataFrame({'字段': list(plan['macro'].keys()),
                              '值': [_scalar(v) for v in plan['macro'].values()]}),
        '协议': pd.DataFrame({'字段': list(plan.get('protocols', {}).keys()),
                            '值': [_scalar(v) for v in plan.get('protocols', {}).values()]}),
        '收敛比': pd.DataFrame({'平面': list(plan.get('convergence', {}).keys()),
                             '比值': list(plan.get('convergence', {}).values())}),
    }
    with pd.ExcelWriter(filepath, engine='openpyxl') as w:
        for name, df in sheets.items():
            df.to_excel(w, sheet_name=name, index=False)


def export_plan(macro: dict, filepath: str, fmt: str = 'json') -> str:
    """G2：plan:table → 文件（json | excel），返回落盘路径。"""
    plan = plan_aidc(macro)
    if 'error' in plan:
        raise ValueError(plan['error'])
    if fmt == 'excel':
        if not filepath.lower().endswith('.xlsx'):
            filepath += '.xlsx'
        _write_plan_excel(plan, filepath)
    else:
        if not filepath.lower().endswith('.json'):
            filepath += '.json'
        with io.open(filepath, 'w', encoding='utf-8') as f:
            json.dump(plan, f, ensure_ascii=False, indent=2)
    return filepath
