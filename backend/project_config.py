"""
AutoLink V2.1 - 项目配置文件管理模块
独立的 project_config.json 读/写/校验/创建
"""
import os
import json
import datetime


# ================================================================
#  默认值
# ================================================================

DEFAULT_PROJECT_CONFIG = {
    "meta": {
        "name": "",
        "description": "",
        "version": 1,
        # V3.0.0-T0-2: 独立 schema 演进字段（缺失视为 1，兼容 2.9.9）
        "schema_version": 2,
        "created_at": "",
        "updated_at": ""
    },
    "networks": {
        "param_network": True,
        "storage_network": True,
        "biz_network": True,
        "oob_network": True,
    },
    "topology": {
        "downlink_mode": "custom",
        "param_protocol": "RoCE",
        "num_gpu_servers": 100,
        "num_all_flash_storage": 8,
        "num_hybrid_flash_storage": 6,
        "num_compute_servers": 20,
        "param_ports_per_server": 8,
        "storage_ports_per_server": 1,
        "param_switch_ports": 64,
        "storage_switch_ports": 40,
        "param_speed": "400G",
        "storage_speed": "200G",
        "param_downlink_limit": 25,
        "storage_downlink_limit": 20,
        "biz_downlink_limit": 25,
        "oob_downlink_limit": 25,
    },
    "device_refs": {},
    "rack_config": {
        "rack_type": 42,
        "power_limit_per_rack": 6000,
        "naming_prefix": "机柜",
    },
    # V2.9.3-T1: 可选 Scale-Up 配置段 (未启用时为空对象)
    "scale_up": {}
}

REQUIRED_TOP_KEYS = {'meta', 'networks', 'topology', 'device_refs', 'rack_config'}
REQUIRED_META_KEYS = {'name', 'description', 'version', 'created_at', 'updated_at'}
REQUIRED_NETWORK_KEYS = {'param_network', 'storage_network', 'biz_network', 'oob_network'}
REQUIRED_TOPOLOGY_KEYS = {
    'downlink_mode', 'param_protocol',
    'num_gpu_servers', 'num_all_flash_storage', 'num_hybrid_flash_storage', 'num_compute_servers',
    'param_ports_per_server', 'storage_ports_per_server',
    'param_switch_ports', 'storage_switch_ports',
    'param_speed', 'storage_speed',
    'param_downlink_limit', 'storage_downlink_limit', 'biz_downlink_limit', 'oob_downlink_limit',
}
REQUIRED_RACK_KEYS = {'rack_type', 'power_limit_per_rack', 'naming_prefix'}


# ================================================================
#  V3.0.0-T0-2: 配置 schema 版本化与迁移链
# ================================================================

# 当前配置 schema 版本（2.9.9 隐式 = 1；3.0.0 起显式演进，新增字段全部可选）
SCHEMA_VERSION = 2
_SCHEMA_VERSION_KEY = 'schema_version'


def get_schema_version(config: dict) -> int:
    """读取配置 schema 版本（缺失视为 1，兼容 2.9.9 旧配置）"""
    if not isinstance(config, dict):
        return 1
    try:
        return int((config.get('meta') or {}).get(_SCHEMA_VERSION_KEY, 1))
    except (TypeError, ValueError):
        return 1


def _migrate_v1_to_v2(config: dict) -> dict:
    """v1 → v2：补齐 schema_version 标记（结构不变；v2 起新增字段全部可选）"""
    config.setdefault('meta', {})[_SCHEMA_VERSION_KEY] = 2
    return config


# 目标版本 → 迁移函数（迁移方向：from 版本+1 → 该版本）
_MIGRATIONS = {
    2: _migrate_v1_to_v2,
}


def migrate_config(config: dict) -> dict:
    """
    按 meta.schema_version 逐版本升级到当前 SCHEMA_VERSION。
    返回迁移后的新配置（不修改入参）；已是当前版本时原样返回。
    """
    if not isinstance(config, dict):
        return config
    version = get_schema_version(config)
    if version >= SCHEMA_VERSION:
        return config

    result = json.loads(json.dumps(config))  # deep copy，不修改入参
    while version < SCHEMA_VERSION:
        version += 1
        migrator = _MIGRATIONS.get(version)
        if migrator:
            result = migrator(result)
        else:
            result.setdefault('meta', {})[_SCHEMA_VERSION_KEY] = version
    return result


# ================================================================
#  公共接口
# ================================================================

def create_default_config(project_name: str, description: str = "") -> dict:
    """创建默认项目配置"""
    now = datetime.datetime.now().isoformat()
    config = json.loads(json.dumps(DEFAULT_PROJECT_CONFIG))  # deep copy
    config["meta"]["name"] = project_name
    config["meta"]["description"] = description
    config["meta"]["created_at"] = now
    config["meta"]["updated_at"] = now
    return config


def load_project_config(config_path: str) -> dict:
    """
    加载 project_config.json
    返回 (config_dict, error_message)
    成功时 error_message 为 None
    """
    if not os.path.exists(config_path):
        return {}, f"配置文件不存在: {config_path}"

    try:
        with open(config_path, 'r', encoding='utf-8') as f:
            config = json.load(f)
    except json.JSONDecodeError as e:
        return {}, f"JSON 解析错误: {e}"
    except Exception as e:
        return {}, f"读取配置文件失败: {e}"

    # V3.0.0-T0-2: 自动迁移旧 schema 到当前版本
    migrated = migrate_config(config)
    if migrated is not config:
        config = migrated
        # 尝试回写（只读目录如打包内置模板失败时忽略，内存态已迁移即可）
        try:
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(config, f, ensure_ascii=False, indent=2)
        except OSError:
            pass

    error = validate_config(config)
    if error:
        return config, error  # 返回已加载的 config 但带警告

    return config, None


def save_project_config(config_path: str, config: dict) -> tuple:
    """
    保存 project_config.json
    返回 (success: bool, error_message: str | None)
    """
    if not isinstance(config, dict):
        return False, "config 必须是字典类型"

    # 自动更新时间戳
    if 'meta' not in config:
        config['meta'] = {}
    config['meta']['updated_at'] = datetime.datetime.now().isoformat()
    if not config['meta'].get('created_at'):
        config['meta']['created_at'] = config['meta']['updated_at']

    try:
        # 确保目录存在
        config_dir = os.path.dirname(config_path)
        if config_dir and not os.path.exists(config_dir):
            os.makedirs(config_dir, exist_ok=True)

        with open(config_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        return True, None
    except Exception as e:
        return False, f"保存配置文件失败: {e}"


def _validate_clusters(config: dict) -> str | None:
    """V3.0.0-T0-5: 可选 clusters 段结构校验（GPU 池化 + 正交集群模型）

    返回错误描述或 None。clusters 缺失/为空视为未启用多集群（兼容 2.9.9）。
    """
    clusters = config.get('clusters')
    if clusters is None:
        return None
    if not isinstance(clusters, list):
        return "clusters 必须是 JSON 数组"
    for cl in clusters:
        if not isinstance(cl, dict):
            return "clusters 每项必须是 JSON 对象"
        if not isinstance(cl.get('cluster_id'), str):
            return "clusters[].cluster_id 必须是字符串"
        if cl.get('role') not in ('P', 'D'):
            return "clusters[].role 必须是 'P' / 'D'"
        pools = cl.get('gpu_pools', [])
        if not isinstance(pools, list):
            return "clusters[].gpu_pools 必须是 JSON 数组"
        for pool in pools:
            if not isinstance(pool, dict):
                return "gpu_pools 每项必须是 JSON 对象"
            if not isinstance(pool.get('pool_id'), str):
                return "gpu_pools[].pool_id 必须是字符串"
            if not isinstance(pool.get('count'), (int, float)) or pool.get('count', 0) <= 0:
                return "gpu_pools[].count 必须是正数"
            ref = pool.get('profile_ref')
            if ref is not None and not isinstance(ref, dict):
                return "gpu_pools[].profile_ref 必须是 JSON 对象"
    return None


def validate_config(config: dict, strict: bool = True) -> str | None:
    """
    校验 project_config.json 格式完整性
    返回 None 表示校验通过，否则返回错误描述字符串

    strict=True（默认）：REQUIRED_* 键全部必须存在，缺失即报错（兼容 2.9.9 行为）。
    strict=False（宽松）：缺失键不报错（供 AIHUB 生成/对话补全等"先宽松后补全"场景），
                         对存在的键仍做类型与枚举校验。
    """
    if not isinstance(config, dict):
        return "配置根必须是 JSON 对象"

    # ============ 宽松模式（strict=False）：仅校验已存在键的类型/枚举 ============
    if not strict:
        topo = config.get('topology') or {}
        for k in ['num_gpu_servers', 'num_all_flash_storage', 'num_hybrid_flash_storage', 'num_compute_servers',
                  'param_ports_per_server', 'storage_ports_per_server', 'param_switch_ports',
                  'storage_switch_ports', 'param_downlink_limit', 'storage_downlink_limit',
                  'biz_downlink_limit', 'oob_downlink_limit']:
            if k in topo and not isinstance(topo.get(k), (int, float)):
                return f"topology.{k} 必须是数值"
        if 'param_protocol' in topo and topo.get('param_protocol') not in ('IB', 'RoCE', 'UEC'):
            return f"topology.param_protocol 必须是 'IB' / 'RoCE' / 'UEC'"
        if 'downlink_mode' in topo and topo.get('downlink_mode') not in ('full', 'custom'):
            return f"topology.downlink_mode 必须是 'full' 或 'custom'"
        su = config.get('scale_up')
        if su is not None and not isinstance(su, dict):
            return "scale_up 必须是 JSON 对象"
        clusters_err = _validate_clusters(config)
        if clusters_err:
            return clusters_err
        return None

    # ============ 严格模式（默认）：完整 REQUIRED 校验 ============
    # 检查顶层 key
    missing_top = REQUIRED_TOP_KEYS - set(config.keys())
    if missing_top:
        return f"缺少顶层字段: {', '.join(sorted(missing_top))}"

    # 检查 meta
    meta = config.get('meta', {})
    missing_meta = REQUIRED_META_KEYS - set(meta.keys())
    if missing_meta:
        return f"meta 缺少字段: {', '.join(sorted(missing_meta))}"

    # 检查 networks
    networks = config.get('networks', {})
    missing_net = REQUIRED_NETWORK_KEYS - set(networks.keys())
    if missing_net:
        return f"networks 缺少字段: {', '.join(sorted(missing_net))}"
    for k in REQUIRED_NETWORK_KEYS:
        if not isinstance(networks.get(k), bool):
            return f"networks.{k} 必须是布尔值"

    # 检查 topology
    topo = config.get('topology', {})
    missing_topo = REQUIRED_TOPOLOGY_KEYS - set(topo.keys())
    if missing_topo:
        return f"topology 缺少字段: {', '.join(sorted(missing_topo))}"
    # 值类型检查
    for k in ['num_gpu_servers', 'num_all_flash_storage', 'num_hybrid_flash_storage', 'num_compute_servers',
              'param_ports_per_server', 'storage_ports_per_server', 'param_switch_ports',
              'storage_switch_ports', 'param_downlink_limit', 'storage_downlink_limit',
              'biz_downlink_limit', 'oob_downlink_limit']:
        if not isinstance(topo.get(k), (int, float)):
            return f"topology.{k} 必须是数值"
    # V2.7.6-T2 + V2.9.3-T8: 支持 UEC (Ultra Ethernet) 协议
    if topo.get('param_protocol') not in ('IB', 'RoCE', 'UEC'):
        return f"topology.param_protocol 必须是 'IB' / 'RoCE' / 'UEC'"
    if topo.get('downlink_mode') not in ('full', 'custom'):
        return f"topology.downlink_mode 必须是 'full' 或 'custom'"

    # 检查 rack_config
    rack = config.get('rack_config', {})
    missing_rack = REQUIRED_RACK_KEYS - set(rack.keys())
    if missing_rack:
        return f"rack_config 缺少字段: {', '.join(sorted(missing_rack))}"

    # V2.9.3-T1: 可选 scale_up 段校验 (缺失/为空对象视为未启用)
    su = config.get('scale_up')
    if su is not None:
        if not isinstance(su, dict):
            return "scale_up 必须是 JSON 对象"
        for k in ['num_gpus', 'gpus_per_node', 'domain_size']:
            if k in su and not isinstance(su.get(k), (int, float)):
                return f"scale_up.{k} 必须是数值"
        if 'protocol' in su and su['protocol'] not in ('NVLink', 'UALink', 'UB'):
            return f"scale_up.protocol 必须是 'NVLink' / 'UALink' / 'UB'"

    # V3.0.0-T0-5: 可选 clusters 段结构校验（GPU 池化 + 正交集群模型）
    clusters_err = _validate_clusters(config)
    if clusters_err:
        return clusters_err

    return None  # 校验通过


def get_config_for_designer(config: dict) -> dict:
    """
    将 project_config 扁平化为适合 designer.py 使用的参数字典
    返回包含所有设计参数的 dict
    """
    return {
        **config.get('meta', {}),
        **config.get('networks', {}),
        **config.get('topology', {}),
        **config.get('rack_config', {}),
        'device_refs': config.get('device_refs', {}),
    }


def find_config_file(project_dir: str) -> str | None:
    """
    在项目目录中查找配置文件，优先返回 project_config.json
    如果 JSON 不存在，查找 network_config.ini
    返回配置文件路径或 None
    """
    json_path = os.path.join(project_dir, 'project_config.json')
    if os.path.exists(json_path):
        return json_path

    ini_path = os.path.join(project_dir, 'network_config.ini')
    if os.path.exists(ini_path):
        return ini_path

    return None


def update_device_ref(config: dict, key: str, library_id: str) -> dict:
    """更新设备引用"""
    if 'device_refs' not in config:
        config['device_refs'] = {}
    config['device_refs'][key] = {'library_id': library_id}
    return config


def remove_device_ref(config: dict, key: str) -> dict:
    """删除设备引用"""
    config.get('device_refs', {}).pop(key, None)
    return config


def update_topology(config: dict, updates: dict) -> dict:
    """更新拓扑参数"""
    if 'topology' not in config:
        config['topology'] = {}
    config['topology'].update(updates)
    return config


def update_networks(config: dict, updates: dict) -> dict:
    """更新网络开关"""
    if 'networks' not in config:
        config['networks'] = {}
    config['networks'].update(updates)
    return config


def update_rack(config: dict, updates: dict) -> dict:
    """更新机柜配置"""
    if 'rack_config' not in config:
        config['rack_config'] = {}
    config['rack_config'].update(updates)
    return config
