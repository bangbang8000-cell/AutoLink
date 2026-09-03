"""5.0.1-501-c: 设备库对账校验（索引 ↔ 目录一致性 / id 唯一 / 字段完整 / 分类合法 / 可互灌）

自动发现 template/device_library/ 并校验：
  - 索引 ↔ 目录文件对账：索引注册的每个设备在目录中存在对应 JSON；目录中每个设备 JSON
    都已在索引注册（消灭“死文件”——只注册目录文件而漏注册，或只落盘文件而漏索引）
  - id 唯一：同一设备 id 不得跨分类重复注册；JSON 内 id 字段与文件名（=索引 device_id）一致
  - 分类合法：JSON category 字段须与索引分类一致，且须为索引声明的分类
  - 字段完整（MC 设备库互灌前置）：
      · 交换机（switches_*）须有 port_speed / port_type / port_count
      · 光模块（optical_modules）须有 speed / form_factor / spec / distance_m / fiber_type / vendors
      · 服务器（gpu/compute/storage_*）须有 interface_models / power_watts / vendor / model
      · 非光模块设备须有 model/vendor（MC 归一化 normalizeMcDevice 必需字段）
  - 加载自检：DeviceLibrary 实际加载数量 == 索引注册数量（无解析失败/告警级漂移）

用法：
  python scripts/validate_device_library.py            # 校验内置设备库
  python scripts/validate_device_library.py --lib <dir>  # 校验指定设备库目录
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

# 索引分类 → 目录（与 backend/device_library.py 的 _LEGACY_CATEGORY_PATHS 保持一致）
_LEGACY_CATEGORY_PATHS = {
    'gpu_servers': 'gpu_servers',
    'compute_servers': 'compute_servers',
    'storage_servers_all_flash': 'storage_servers/all_flash',
    'storage_servers_hybrid_flash': 'storage_servers/hybrid_flash',
    'storage_servers_parallel_fs': 'storage_servers/parallel_fs',
    'switches_param': 'switches/param',
    'switches_storage': 'switches/storage',
    'switches_biz': 'switches/biz',
    'switches_oob': 'switches/oob',
    'optical_modules': 'optical_modules',
    'custom': 'custom',
}

_SWITCH_CATEGORIES = {'switches_param', 'switches_storage', 'switches_biz', 'switches_oob'}
_SERVER_CATEGORIES = {
    'gpu_servers', 'compute_servers',
    'storage_servers_all_flash', 'storage_servers_hybrid_flash', 'storage_servers_parallel_fs',
}
_OPTICAL_CATEGORY = 'optical_modules'


def _default_library_path():
    return os.path.join(os.path.dirname(__file__), '..', 'template', 'device_library')


def _resolve_category_dir(cat: dict) -> str:
    return cat.get('directory') or _LEGACY_CATEGORY_PATHS.get(cat.get('id') or '', cat.get('id') or '')


def _check_device(cid: str, dev: dict, did: str, problems: list) -> None:
    """单设备字段完整 + 分类合法 + id==文件名"""
    if dev.get('id') != did:
        problems.append(f'{cid}/{did}.json: id 字段({dev.get("id")!r}) 与文件名不一致')
    if dev.get('category') != cid:
        problems.append(f'{cid}/{did}.json: category({dev.get("category")!r}) != 索引分类({cid})')
    if cid == _OPTICAL_CATEGORY:
        for k in ('speed', 'form_factor', 'spec', 'distance_m', 'fiber_type', 'vendors'):
            if not dev.get(k):
                problems.append(f'{cid}/{did}.json: 光模块缺 {k}')
    else:
        # 非光模块（交换机/服务器）：MC 归一化 normalizeMcDevice 必需 model/vendor
        if not dev.get('model'):
            problems.append(f'{cid}/{did}.json: 缺 model（MC 互灌必需）')
        if not dev.get('vendor'):
            problems.append(f'{cid}/{did}.json: 缺 vendor（MC 互灌必需）')
        if cid in _SWITCH_CATEGORIES:
            for k in ('port_speed', 'port_type', 'port_count'):
                if not dev.get(k):
                    problems.append(f'{cid}/{did}.json: 交换机缺 {k}')
        elif cid in _SERVER_CATEGORIES:
            if not dev.get('interface_models'):
                problems.append(f'{cid}/{did}.json: 服务器缺 interface_models')
            if not dev.get('power_watts'):
                problems.append(f'{cid}/{did}.json: 服务器缺 power_watts')


def check_device_library(library_path=None) -> list:
    """设备库对账校验，返回问题列表（空 = 通过）"""
    problems: list = []
    if library_path is None:
        library_path = _default_library_path()
    index_path = os.path.join(library_path, 'library_index.json')
    if not os.path.isfile(index_path):
        return [f'缺少设备库索引: {index_path}']

    try:
        with open(index_path, encoding='utf-8') as f:
            index = json.load(f)
    except (OSError, ValueError) as e:
        return [f'library_index.json 解析失败: {e}']

    cats = index.get('categories') or []
    registered_ids = set()
    index_ids = set()
    for cat in cats:
        cid = cat.get('id') or ''
        cd = _resolve_category_dir(cat)
        cat_dir = os.path.join(library_path, cd)
        reg = list(cat.get('device_ids') or [])

        # ① 索引注册 → 目录文件存在
        for did in reg:
            if not os.path.isfile(os.path.join(cat_dir, f'{did}.json')):
                problems.append(f'{cid}: 索引注册 {did} 但目录 {cd} 下无 {did}.json（文件缺失）')
        # ② 目录文件 → 索引已注册（死文件）
        if os.path.isdir(cat_dir):
            for fn in sorted(os.listdir(cat_dir)):
                if not fn.endswith('.json'):
                    continue
                stem = fn[:-5]
                if stem not in reg:
                    problems.append(f'{cid}: 目录 {cd} 存在 {fn} 但未在索引注册（死文件）')
        # ③ id 唯一（跨分类）
        for did in reg:
            if did in registered_ids:
                problems.append(f'设备 id 重复注册: {did}')
            registered_ids.add(did)
            index_ids.add(did)
        # ④ 逐设备字段完整 / 分类合法 / id==文件名
        for did in reg:
            fp = os.path.join(cat_dir, f'{did}.json')
            if not os.path.isfile(fp):
                continue
            try:
                with open(fp, encoding='utf-8') as f:
                    dev = json.load(f)
            except (OSError, ValueError) as e:
                problems.append(f'{cid}/{did}.json 解析失败: {e}')
                continue
            _check_device(cid, dev, did, problems)

    # ⑤ 加载自检：实际加载数量 == 索引注册数量（解析失败/告警级漂移即暴露）
    try:
        from device_library import DeviceLibrary
        lib = DeviceLibrary(library_path)
        lib.load()
        if len(lib.devices) != len(index_ids):
            problems.append(f'设备库加载数量({len(lib.devices)}) != 索引注册数量({len(index_ids)})')
    except Exception as e:  # noqa: BLE001
        problems.append(f'设备库加载失败: {e}')

    return problems


def main(argv=None):
    argv = list(sys.argv[1:] if argv is None else argv)
    lib_path = None
    if '--lib' in argv:
        i = argv.index('--lib')
        if i + 1 < len(argv):
            lib_path = argv[i + 1]
    problems = check_device_library(lib_path)
    if problems:
        print(f'设备库对账校验失败（{len(problems)} 项）：')
        for p in problems:
            print(f'  - {p}')
        return 1
    print('设备库对账校验通过：索引 ↔ 目录一致，id 唯一，字段完整，分类合法，可互灌')
    return 0


if __name__ == '__main__':
    sys.exit(main())
