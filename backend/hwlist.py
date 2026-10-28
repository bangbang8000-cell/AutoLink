# -*- coding: utf-8 -*-
"""V5.4.3-W3: al-hwlist/1.0 硬件清单数据层（零价格契约）

对标《10240卡海光DCU集群-四方案终版-20260922》输出材料（hwlist.py 契约对齐，
自研实现、不引入反馈方源码）。与既有出口的关系：
  - bom          估价用（带价格区间）        —— 保留
  - deviceList   机柜/U 位视角               —— 保留
  - hwlist       零价格数量契约（本模块）    —— 新增（对外交付 / 价格库按 device_id join）

契约字段（与 al-hwlist/1.0 对齐）：
  network_profile / net_key / tier / line_type / device_id / name / model /
  qty / unit / spare_ratio / spare_qty / total_qty / qty_basis / speed_gbps /
  note / unmatched

零价格契约：全簿禁绝金额字段，check_no_price 自检兜底（清洗「294000/台」等
无元字写法）。行类型：hardware / optic_module / cable / license / software / service。
备件率（D4 拍板，反馈方默认）：光模块与线缆 5% / 交换机整机 3% / 服务器 1% /
授权与软件 0% / GPU 整机不备件；ratio_map 可整类覆盖。
"""
import math
import re

LINE_TYPES = ('hardware', 'optic_module', 'cable', 'license', 'software', 'service')

# 一级品类（文档 A16）：固定顺序，清单按此分节；无行则整节跳过
CATEGORY_ORDER = ('服务器', '交换机', '光模块', '线缆', '机柜', '空调', '辅材')

# 机房配套平面（机柜/空调行所在分项）
NET_ROOM = ('room', '机房配套')

# 网络平面（net_key → 展示名）；顺序即清单分项顺序
NET_ORDER = (
    ('node', '计算与存储节点'),
    ('param', '参数网'),
    ('stor', '存储网'),
    ('biz', '业务&管理网'),
    ('oob', '带外管理网'),
)
_NET_BY_TYPE = {
    'param': 'param', 'storage': 'stor', 'combined': 'stor',
    'biz': 'biz', 'oob': 'oob',
}
_NET_NAME = dict(NET_ORDER)
_NET_NAME[NET_ROOM[0]] = NET_ROOM[1]

_LINE_TYPE_CATEGORY = {
    'optic_module': '光模块',
    'cable': '线缆',
    'license': '辅材', 'software': '辅材', 'service': '辅材',
}


def category_of(line):
    """行所属一级品类：优先显式 category 字段，缺省按行类型/名称派生（旧行兼容）"""
    cat = str(line.get('category') or '')
    if cat:
        return cat
    lt = str(line.get('line_type') or '')
    if lt in _LINE_TYPE_CATEGORY:
        return _LINE_TYPE_CATEGORY[lt]
    if lt == 'hardware':
        return '交换机' if '交换机' in str(line.get('name') or '') else '服务器'
    return '辅材'

# 连接 network_type → 服务器侧聚合行的 net_key
_CONN_NET = {
    'param': 'param', 'storage': 'stor', 'combined': 'stor', 'biz': 'biz', 'oob': 'oob',
}

# 备件率（D4 拍板采纳反馈方默认；ratio_map 可覆盖）
SPARE_DEFAULT = {
    'hardware': 0.03,
    'optic_module': 0.05,
    'cable': 0.05,
    'license': 0.00,
    'software': 0.00,
    'service': 0.00,
}
SPARE_SERVER = 0.01
SPARE_GPU = 0.00

_ROLE_OF_TYPE = {
    'optic_module': 'mod', 'cable': 'cab', 'license': 'lic',
    'software': 'sw', 'service': 'svc', 'hardware': 'dev',
}

_TIER_RE = re.compile(r'(Leaf|Spine|Core|接入|汇聚|核心)')


def _tier_of(name):
    m = _TIER_RE.search(str(name or ''))
    if not m:
        return ''
    return {'Core': '核心', '接入': '接入', '汇聚': '汇聚', '核心': '核心',
            'Leaf': 'Leaf', 'Spine': 'Spine'}[m.group(1)]


def spare_ratio(line_type, is_server=False, is_gpu=False, ratio_map=None):
    """备件率：调用方 ratio_map[line_type] > 个体特例（GPU/服务器）> 默认表"""
    if ratio_map and line_type in ratio_map:
        return float(ratio_map[line_type])
    if line_type == 'hardware':
        if is_gpu:
            return SPARE_GPU
        if is_server:
            return SPARE_SERVER
        return SPARE_DEFAULT['hardware']
    return SPARE_DEFAULT.get(line_type, SPARE_DEFAULT['hardware'])


def spare_qty(qty, ratio):
    """备件数量 = ceil(qty × ratio)，与 Excel CEILING(x,1) 同口径"""
    if not ratio:
        return 0
    return int(math.ceil(float(qty) * float(ratio)))


# ---------------------------------------------------------------- 金额清洗
_MONEY_RE = re.compile(
    r'\d[\d,\.]*\s*(?:万元|万|元)(?:\s*/\s*[\u4e00-\u9fa5A-Za-z]+)?'
    r'|\d[\d,\.]{3,}\s*/\s*(?:台|个|根|对|套|点|片|块|人天|年)')
_MONEY_WORD = ('单价', '金额', '总价', '报价', '元/', '万元', '¥', '折后价')


def clean_basis(text, fallback=''):
    """数量口径清洗：剔除金额片段与只剩价格措辞的短句（不整句丢「不计价」类说明）"""
    if not text:
        return fallback
    parts = re.split(r'\s*[·；;]\s*', str(text))
    keep = []
    for p in parts:
        p2 = _MONEY_RE.sub('', p).strip(' \u3000，,。;；')
        if p2 and not any(w in p2 for w in _MONEY_WORD):
            keep.append(p2)
    return ' · '.join(keep) or fallback


def check_no_price(lines):
    """自检：清单行里不得含金额特征串。返回命中的 (device_id, 字段, 片段) 列表"""
    hits = []
    for ln in lines:
        for f in ('name', 'model', 'qty_basis', 'note', 'unit'):
            v = str(ln.get(f) or '')
            if _MONEY_RE.search(v) or any(w in v for w in _MONEY_WORD):
                hits.append((ln.get('device_id', ''), f, v[:60]))
    return hits


# ---------------------------------------------------------------- 机房矩阵真值
# 柜型展示名（与 rack_allocation.CABINET_TYPE_* 取值一致）
ROOM_CABINET_LABELS = {
    'gpu': 'GPU 柜', 'network': '网络柜', 'storage': '存储柜', 'compute': '通算柜',
    'combined': '组合柜', 'scaleup': 'Scale-Up 柜', 'security': '安全柜',
    'custom': '自定义柜', 'power': '电源柜', 'empty': '未标柜型',
}
_ROOM_CAB_ORDER = ('gpu', 'network', 'storage', 'compute', 'combined',
                   'scaleup', 'security', 'custom', 'power', 'empty')


def room_counts(matrix):
    """机房矩阵真值（A17）：机柜数 = 已落柜 + 可建柜格（按柜型计数）；空调数 = ac 占位格数。

    matrix 可为 room_layout.json 的 dict、RoomMatrix 实例或 None。
    矩阵缺失/无任何单元 → 返回 None（调用方据此产出「未建模」而不是 0）。
    """
    if matrix is None:
        return None
    if hasattr(matrix, 'cells'):
        raw = [(c.placeholder, c.cabinet_id, c.type) for c in matrix.cells.values()]
    elif isinstance(matrix, dict):
        cells = matrix.get('cells') or []
        raw = [(c.get('placeholder'), c.get('cabinetId'), c.get('type') or 'empty')
               for c in cells if isinstance(c, dict)]
    else:
        return None
    if not raw:
        return None
    ac = 0
    buckets = {}
    for placeholder, cabinet_id, ctype in raw:
        if placeholder == 'ac':
            ac += 1
            continue
        if placeholder is not None:
            continue  # 柱子等其他占位：既非机柜也非空调
        if cabinet_id is None and (ctype or 'empty') == 'empty':
            continue  # 空白格：未规划，不计
        key = ctype or 'empty'
        buckets[key] = buckets.get(key, 0) + 1
    by_type = [(k, buckets[k]) for k in _ROOM_CAB_ORDER if k in buckets]
    by_type += [(k, v) for k, v in buckets.items() if k not in _ROOM_CAB_ORDER]
    return {
        'cells': len(raw),
        'cabinets': sum(v for _, v in by_type),
        'ac': ac,
        'by_type': by_type,
    }


def _fmt_speed(s):
    return str(s or '')


# ---------------------------------------------------------------- 构建清单行
def build_lines(designer, ratio_map=None, matrix=None):
    """从 designer 产出标准清单行（不含任何价格字段）。

    数据源（与 bom/deviceList 同一次解析，无重复计算）：
      - 整机：servers / all_switches 按 (类别, 设备库档案) 聚合
      - 光模块：逐连接 resolve_module_selection（三态解析，未匹配显式成行）
      - 线缆：按 (平面, cable_type, 分光系数) 聚合 —— 分光链路每根承载 count 条连接
      - 机柜/空调：机房矩阵真值（matrix 为 room_layout.json 的 dict 或 RoomMatrix）
    """
    from device_library import get_device_library
    try:
        library = get_device_library()
    except Exception:  # noqa: BLE001
        library = None

    lines = []

    def _add(net_key, line_type, device_id, name, model, qty, unit, ratio, basis,
             speed='', note='', tier='', category='', not_modeled=False):
        sq = spare_qty(qty, ratio)
        line = {
            'network_profile': _NET_NAME.get(net_key, net_key),
            'net_key': net_key,
            'tier': tier or _tier_of(name),
            'line_type': line_type,
            'device_id': device_id,
            'name': name,
            'model': model,
            'qty': int(qty),
            'unit': unit,
            'spare_ratio': ratio,
            'spare_qty': sq,
            'total_qty': int(qty) + sq,
            'qty_basis': clean_basis(basis),
            'speed_gbps': speed,
            'note': clean_basis(note),
            'unmatched': str(device_id).endswith('_unknown'),
        }
        if not_modeled:
            # A17 边界：矩阵未建模 → 数量列显示「未建模」（不写 0，避免误读为「不需要」）
            line['not_modeled'] = True
        line['category'] = category or category_of(line)
        lines.append(line)

    # ---- 1. 服务器（计算与存储节点）
    server_groups = {}
    for s in designer.servers:
        profile = getattr(s, 'device_profile', None)
        pid = getattr(profile, 'id', None) if profile is not None else (profile if isinstance(profile, str) else None)
        dev = library.get(pid) if (library and pid) else None
        group = s.group or '服务器'
        is_gpu = 'GPU' in group or 'GPU' in str(getattr(dev, 'description', '') or '')
        key = (group, pid)
        if key not in server_groups:
            server_groups[key] = {
                'count': 0, 'is_gpu': is_gpu,
                'model': getattr(dev, 'model', '') or getattr(dev, 'id', '') or '',
                'desc': getattr(dev, 'description', '') or '',
                'power': s.power_watts or 0,
            }
        server_groups[key]['count'] += 1
    for (group, pid), info in server_groups.items():
        did = f"node_{('srv_gpu' if info['is_gpu'] else 'srv')}_{pid or 'unknown'}"
        _add('node', 'hardware', did, group, info['model'], info['count'], '台',
             spare_ratio('hardware', is_server=True, is_gpu=info['is_gpu'], ratio_map=ratio_map),
             '按设计服务器清单聚合', speed='', note=info['desc'], category='服务器')

    # ---- 2. 交换机（按平面 + 层级 + 档案聚合）
    sw_pools = (
        ('param', designer.param_leaves + designer.param_spines + designer.param_cores),
        ('stor', designer.storage_leaves + designer.storage_spines + designer.storage_cores),
        ('oob', designer.oob_access + designer.oob_agg),
        ('biz', designer.biz_access + designer.biz_agg),
    )
    for net_key, pool in sw_pools:
        agg = {}
        for sw in pool:
            profile = getattr(sw, 'device_profile', None)
            pid = getattr(profile, 'id', None) if profile is not None else (profile if isinstance(profile, str) else None)
            dev = library.get(pid) if (library and pid) else None
            label = sw.obj_type.replace('param_', '').replace('storage_', '').replace('oob_', '').replace('biz_', '')
            tier = {'leaf': 'Leaf', 'spine': 'Spine', 'core': '核心',
                    'access': '接入', 'agg': '汇聚'}.get(label, label)
            key = (tier, pid)
            if key not in agg:
                agg[key] = {'count': 0, 'model': getattr(dev, 'model', '') or getattr(dev, 'id', '') or '',
                            'desc': getattr(dev, 'description', '') or '', 'tier': tier}
            agg[key]['count'] += 1
        for (tier, pid), info in agg.items():
            did = f"{net_key}_dev_{pid or ('sw_' + tier)}"
            _add(net_key, 'hardware', did, f"{_NET_NAME[net_key]}交换机 · {tier}层",
                 info['model'], info['count'], '台',
                 spare_ratio('hardware', ratio_map=ratio_map),
                 '按设计交换机清单聚合', note=info['desc'], tier=tier, category='交换机')

    # ---- 3. 光模块 + 线缆（逐连接解析，方向敏感去重 —— 与 bom/cablingGuide 同源）
    all_switches = (designer.param_leaves + designer.param_spines + designer.param_cores +
                    designer.storage_leaves + designer.storage_spines + designer.storage_cores +
                    getattr(designer, 'combined_leaves', []) +
                    designer.oob_access + designer.oob_agg + designer.biz_access + designer.biz_agg)
    seen = set()
    mod_agg = {}
    cab_agg = {}
    unmatched_count = 0
    for dev in designer.servers + all_switches:
        for conn in dev.connections:
            if conn.a_device != dev.name:
                continue
            pair_key = (conn.a_device, conn.z_device, conn.a_port)
            if pair_key in seen:
                continue
            seen.add(pair_key)

            net_key = _CONN_NET.get(getattr(conn, 'network_type', '') or '', 'other')
            # 光模块：三态解析（not_applicable=双绞线不进 BOM；unmatched 显式成行）
            try:
                from optical_selector import resolve_module_selection
                outcome = resolve_module_selection(conn, library)
                sel = outcome.selection
                if outcome.status == 'not_applicable':
                    sel = None
                elif sel is None:
                    unmatched_count += 1
            except Exception:  # noqa: BLE001
                sel = None
            if sel is not None:
                key = (net_key, sel.module_id)
                if key not in mod_agg:
                    mod_agg[key] = {'count': 0, 'desc': sel.description,
                                    'speed': _fmt_speed(getattr(conn, 'speed', '') or '')}
                mod_agg[key]['count'] += 1

            # 线缆：按 (平面, cable_type, 承载系数) 聚合。
            # 分光链路每根物理线缆承载 breakout.count 条逻辑连接（qty = conns / count）。
            cable_type = str(getattr(conn, 'cable_type', '') or '未知线缆')
            brk = getattr(conn, 'breakout', None)
            links_per_cable = 1
            if isinstance(brk, dict):
                try:
                    links_per_cable = max(1, int(brk.get('count', 1) or 1))
                except (TypeError, ValueError):
                    links_per_cable = 1
            ckey = (net_key, cable_type, links_per_cable)
            cab = cab_agg.setdefault(ckey, {'conns': 0, 'speed': _fmt_speed(getattr(conn, 'speed', '') or '')})
            cab['conns'] += 1

    for (net_key, module_id), info in mod_agg.items():
        _add(net_key, 'optic_module', f"{net_key}_mod_{module_id}", module_id, module_id,
             info['count'], '个', spare_ratio('optic_module', ratio_map=ratio_map),
             '逐链路选型聚合（每条链路两端各计 1 个，与连接表同源）',
             speed=info['speed'], note=info['desc'], category='光模块')
    if unmatched_count:
        _add('param', 'optic_module', 'param_mod_unknown', '未匹配（需人工确认）', '',
             unmatched_count, '个', 0.0,
             '设备库无同速率档位，显式成行不计备件', note='补齐档位后需重新生成',
             category='光模块')

    for (net_key, cable_type, lpc), info in cab_agg.items():
        cables = int(-(-info['conns'] // lpc))  # ceil
        basis = (f'{info["conns"]} 条连接 ÷ 每根承载 {lpc} 条（分光系数）'
                 if lpc > 1 else f'{info["conns"]} 条连接每条 1 根')
        slug = re.sub(r'[^0-9A-Za-z]+', '_', cable_type).strip('_')[:40] or 'cable'
        _add(net_key, 'cable', f'{net_key}_cab_{slug}', cable_type, cable_type,
             cables, '根', spare_ratio('cable', ratio_map=ratio_map), basis,
             speed=info['speed'], category='线缆')

    # ---- 4. 机柜 / 空调（机房矩阵真值，A17）
    counts = room_counts(matrix)
    if counts is None:
        _add(NET_ROOM[0], 'hardware', 'room_not_modeled', '机柜 / 空调（未建模）', '',
             0, '未建模', 0.0, '机房矩阵未建模，机柜数与空调数无法统计',
             note='请在机房设计页完成矩阵建模后重新导出', category='机柜',
             not_modeled=True)
    else:
        for ctype, cnt in counts['by_type']:
            _add(NET_ROOM[0], 'hardware', f'room_cab_{ctype}',
                 f"机柜 · {ROOM_CABINET_LABELS.get(ctype, ctype)}", '',
                 cnt, '台', 0.0,
                 f"机房矩阵真值：该柜型可建柜格 {cnt} 个（含已落柜）",
                 note='机柜为结构件，不计备件', category='机柜')
        if counts['ac']:
            _add(NET_ROOM[0], 'hardware', 'room_ac', '空调（机房矩阵占位）', '',
                 counts['ac'], '台', 0.0,
                 f"机房矩阵 placeholder='ac' 格数 {counts['ac']} 个",
                 note='空调为整机设备，不计备件', category='空调')

    return lines


def summarize(lines):
    """按品类 / 分项 / 单位 / 行类型汇总（量纲隔离：台/个/根不相加）

    「未建模」占位行（not_modeled）不计入数量汇总，只计行数。
    """
    by_net, by_unit, by_type = [], {}, {}
    order = []
    cat_rows = {}
    for ln in lines:
        cat = category_of(ln)
        node = cat_rows.setdefault(cat, {'name': cat, 'row_count': 0, 'qty': 0,
                                         'spare': 0, 'total': 0})
        node['row_count'] += 1
        if ln.get('not_modeled'):
            continue
        node['qty'] += ln['qty']
        node['spare'] += ln['spare_qty']
        node['total'] += ln['total_qty']
        u = ln['unit']
        by_unit[u] = by_unit.get(u, {'n': 0, 'qty': 0, 'spare': 0, 'total': 0})
        by_unit[u]['n'] += 1
        by_unit[u]['qty'] += ln['qty']
        by_unit[u]['spare'] += ln['spare_qty']
        by_unit[u]['total'] += ln['total_qty']
        t = ln['line_type']
        by_type[t] = by_type.get(t, {'n': 0, 'qty': 0, 'spare': 0})
        by_type[t]['n'] += 1
        by_type[t]['qty'] += ln['qty']
        by_type[t]['spare'] += ln['spare_qty']
        k = ln['network_profile']
        if k not in order:
            order.append(k)
            by_net.append({'name': k, 'row_count': 0, 'qty': 0, 'spare': 0, 'total': 0})
        net_node = by_net[order.index(k)]
        net_node['row_count'] += 1
        net_node['qty'] += ln['qty']
        net_node['spare'] += ln['spare_qty']
        net_node['total'] += ln['total_qty']
    by_category = [cat_rows[c] for c in CATEGORY_ORDER if c in cat_rows]
    by_category += [v for k, v in cat_rows.items() if k not in CATEGORY_ORDER]
    counted = [x for x in lines if not x.get('not_modeled')]
    return {
        'row_count': len(lines),
        'by_category': by_category,
        'by_network': by_net,
        'by_unit': by_unit,
        'by_line_type': by_type,
        'qty': sum(x['qty'] for x in counted),
        'spare': sum(x['spare_qty'] for x in counted),
        'total': sum(x['total_qty'] for x in counted),
        'device_id_count': len({x['device_id'] for x in lines}),
    }


def warnings_of(lines, extra=None):
    """口径告警：未命中 ID 的设备 + 数量为 0 的行 + 未建模品类"""
    out = list(extra or [])
    un = sorted({x['device_id'] for x in lines if x['unmatched']})
    if un:
        out.append('以下设备未命中稳定 ID，已按内容摘要生成兜底主键：%s' % ', '.join(un))
    zero = sorted({x['name'] for x in lines if x['qty'] == 0 and not x.get('not_modeled')})
    if zero:
        out.append('以下设备数量为 0，请核对：%s' % ', '.join(zero))
    unmodeled = sorted({category_of(x) for x in lines if x.get('not_modeled')})
    if unmodeled:
        out.append('机房矩阵未建模，以下品类数量未统计：%s（请在机房设计页建模后重新导出）'
                   % ', '.join(unmodeled))
    return out
