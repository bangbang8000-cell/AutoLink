"""
AutoLink V2.1 - 配置迁移模块
V2.0 network_config.ini → V2.1 project_config.json 自动迁移
"""
import os
import json
import configparser
import datetime
from project_config import validate_config, create_default_config


# ================================================================
#  配置键映射 (INI → JSON)
# ================================================================

# topology 字段从 INI [topology] section 映射
INI_TO_TOPOLOGY = {
    'downlink_mode': ('downlink_mode', str),
    'num_servers': ('num_gpu_servers', int),  # 旧的 num_servers → GPU 服务器数
    'num_storage_servers': ('num_all_flash_storage', int),  # 默认归入全闪存储
    'num_additional_servers': ('num_compute_servers', int),  # 旧的 additional → 通算
    'param_ports_per_server': ('param_ports_per_server', int),
    'storage_ports_per_server': ('storage_ports_per_server', int),
    'param_switch_ports': ('param_switch_ports', int),
    'storage_switch_ports': ('storage_switch_ports', int),
    'param_speed': ('param_speed', str),
    'storage_speed': ('storage_speed', str),
    'param_downlink_limit': ('param_downlink_limit', int),
    'storage_downlink_limit': ('storage_downlink_limit', int),
    'biz_downlink_limit': ('biz_downlink_limit', int),
    'oob_downlink_limit': ('oob_downlink_limit', int),
}

# 网络开关从 INI section 推断
NETWORK_SECTION_MAP = {
    'param_network': 'param_network',      # 默认启用
    'storage_network': 'storage_network',   # 如果有 storage_downlink_limit 则启用
    'oob_network': 'oob_network',          # 检查 oob_enabled
    'biz_network': 'biz_network',          # 检查 biz_enabled
}


def ini_to_project_config(ini_path: str, project_name: str = None) -> dict:
    """
    将 V2.0 network_config.ini 迁移为 V2.1 project_config.json
    
    Args:
        ini_path: network_config.ini 文件路径
        project_name: 项目名称（如果不提供，从目录名推断）
    
    Returns:
        (config_dict, warnings_list)
        成功时 config_dict 是完整的 ProjectConfig，warnings 是迁移过程中的警告
    """
    if not os.path.exists(ini_path):
        return None, [f"INI 文件不存在: {ini_path}"]

    # 推断项目名称
    if not project_name:
        project_dir = os.path.dirname(ini_path) or '.'
        project_name = os.path.basename(os.path.abspath(project_dir))

    warnings = []
    config = create_default_config(project_name)

    # 解析 INI
    ini = configparser.ConfigParser()
    try:
        with open(ini_path, 'r', encoding='utf-8') as f:
            ini.read_file(f)
    except Exception as e:
        return None, [f"INI 文件解析失败: {e}"]

    # --- 迁移 topology section ---
    if ini.has_section('topology'):
        for ini_key, (json_key, value_type) in INI_TO_TOPOLOGY.items():
            if ini.has_option('topology', ini_key):
                raw = ini.get('topology', ini_key)
                try:
                    value = value_type(raw)
                except (ValueError, TypeError):
                    warnings.append(f"topology.{ini_key} 值 '{raw}' 无法转换为 {value_type.__name__}，使用默认值")
                    continue
                config['topology'][json_key] = value
    else:
        warnings.append("INI 文件缺少 [topology] section，使用默认拓扑参数")

    # --- 迁移服务器数量 ---
    if ini.has_option('topology', 'num_servers'):
        config['topology']['num_gpu_servers'] = ini.getint('topology', 'num_servers')

    # num_additional_servers → compute_servers
    if ini.has_option('topology', 'num_additional_servers'):
        config['topology']['num_compute_servers'] = ini.getint('topology', 'num_additional_servers')
        warnings.append("num_additional_servers 已映射为 num_compute_servers")

    # num_storage_servers → 如果存在则映射到全闪存储，混闪设为0
    if ini.has_option('topology', 'num_storage_servers'):
        storage_count = ini.getint('topology', 'num_storage_servers')
        # 拆分为全闪和混闪（默认各一半，至少1台）
        all_flash = max(1, storage_count // 2 + storage_count % 2)
        hybrid = storage_count // 2
        config['topology']['num_all_flash_storage'] = all_flash
        config['topology']['num_hybrid_flash_storage'] = hybrid
        warnings.append(f"num_storage_servers ({storage_count}) 已拆分为 全闪({all_flash}) + 混闪({hybrid})")

    # --- 迁移网络开关 ---
    # 检查 oob_enabled
    if ini.has_option('topology', 'oob_enabled'):
        oob_enabled = ini.getboolean('topology', 'oob_enabled')
        config['networks']['oob_network'] = oob_enabled
    else:
        # 如果有 oob_downlink_limit > 0，认为 OOB 启用
        oob_dl = config['topology'].get('oob_downlink_limit', 0)
        config['networks']['oob_network'] = oob_dl > 0

    # check biz_enabled
    if ini.has_option('topology', 'biz_enabled'):
        biz_enabled = ini.getboolean('topology', 'biz_enabled')
        config['networks']['biz_network'] = biz_enabled
    else:
        biz_dl = config['topology'].get('biz_downlink_limit', 0)
        config['networks']['biz_network'] = biz_dl > 0

    # param_network: 有 num_servers > 0 则启用
    gpu_servers = config['topology'].get('num_gpu_servers', 0)
    config['networks']['param_network'] = gpu_servers > 0

    # storage_network: 有 storage 配置则启用
    storage_dl = config['topology'].get('storage_downlink_limit', 0) or config['topology'].get('num_hybrid_flash_storage', 0)
    config['networks']['storage_network'] = (config['topology'].get('num_hybrid_flash_storage', 0) + config['topology'].get('num_all_flash_storage', 0)) > 0

    # --- 迁移 rack_config ---
    if ini.has_section('rack'):
        if ini.has_option('rack', 'rack_type'):
            try:
                rack_type = ini.getint('rack', 'rack_type')
                if rack_type in (42, 49):
                    config['rack_config']['rack_type'] = rack_type
            except (ValueError, TypeError):
                pass
        if ini.has_option('rack', 'power_limit_per_rack'):
            try:
                pl = ini.getint('rack', 'power_limit_per_rack')
                config['rack_config']['power_limit_per_rack'] = pl
            except (ValueError, TypeError):
                pass
        if ini.has_option('rack', 'naming_prefix'):
            config['rack_config']['naming_prefix'] = ini.get('rack', 'naming_prefix')

    # --- 迁移默认 device_refs ---
    config['device_refs'] = _get_default_device_refs(config)

    # 更新版本号和时间戳
    config['meta']['version'] = 1
    config['meta']['created_at'] = datetime.datetime.now().isoformat()
    config['meta']['updated_at'] = config['meta']['created_at']

    # 校验
    error = validate_config(config)
    if error:
        warnings.append(f"迁移后的配置校验警告: {error}")

    return config, warnings


def _get_default_device_refs(config: dict) -> dict:
    """根据网络开关生成默认设备引用"""
    refs = {}
    networks = config.get('networks', {})
    protocol = config.get('topology', {}).get('param_protocol', 'RoCE')

    if networks.get('param_network'):
        if protocol == 'IB':
            refs['param_leaf_switch'] = {'library_id': 'nvidia_mqm9700_64_400g_ib'}
            refs['param_spine_switch'] = {'library_id': 'nvidia_q3200_72_800g_ib'}
            refs['param_core_switch'] = {'library_id': 'nvidia_q3400_144_800g_ib'}
        else:
            refs['param_leaf_switch'] = {'library_id': 'h3c_s9850_64h'}
            refs['param_spine_switch'] = {'library_id': 'h3c_s9820_64h'}
            refs['param_core_switch'] = {'library_id': 'h3c_s9820_8c'}

    if networks.get('storage_network'):
        # T5: 存储交换机按协议分流
        # IB: 复用 Quantum HDR 交换机(IB 存储与参数面共用 Quantum 系列)
        # RoCE: 专用存储接入交换机(ce6881,支持 RoCEv2/FC-NVMe)
        if protocol == 'IB':
            refs['storage_leaf_switch'] = {'library_id': 'nvidia_mqm8700_40_200g_ib'}
            refs['storage_spine_switch'] = {'library_id': 'nvidia_mqm8700_40_200g_ib'}
        else:
            refs['storage_leaf_switch'] = {'library_id': 'huawei_ce6881_48s6cq'}
            refs['storage_spine_switch'] = {'library_id': 'huawei_ce6881_48s6cq'}
        refs['all_flash_storage_server'] = {'library_id': 'generic_all_flash'}
        refs['hybrid_flash_storage_server'] = {'library_id': 'generic_hybrid_flash'}

    if networks.get('biz_network'):
        # T9: 业务接入交换机对齐 biz_port_speed=25G(原 h3c_s5560x_54s_ei 为 10G)
        refs['biz_access_switch'] = {'library_id': 'h3c_s6850_56hf'}
        refs['biz_agg_switch'] = {'library_id': 'h3c_s6520x_54qc_ei'}
        refs['compute_server'] = {'library_id': 'generic_2u_compute'}

    if networks.get('oob_network'):
        refs['oob_access_switch'] = {'library_id': 'h3c_s5130s_52p_ei'}
        refs['oob_agg_switch'] = {'library_id': 'h3c_s5120v3_52p_ei'}

    return refs


def migrate_project(project_dir: str) -> tuple:
    """
    迁移整个项目目录：将 network_config.ini 转换为 project_config.json
    
    如果 project_config.json 已存在，不覆盖（返回 None）。
    如果 network_config.ini 不存在，返回 None。
    
    Returns:
        (json_path: str | None, warnings: list)
    """
    ini_path = os.path.join(project_dir, 'network_config.ini')
    json_path = os.path.join(project_dir, 'project_config.json')

    # 如果 JSON 已存在，不覆盖
    if os.path.exists(json_path):
        return None, ["project_config.json 已存在，跳过迁移"]

    # 如果 INI 不存在，无法迁移
    if not os.path.exists(ini_path):
        return None, ["network_config.ini 不存在，无法迁移"]

    config, warnings = ini_to_project_config(ini_path)
    if config is None:
        return None, warnings

    try:
        with open(json_path, 'w', encoding='utf-8') as f:
            json.dump(config, f, ensure_ascii=False, indent=2)
        return json_path, warnings
    except Exception as e:
        return None, [f"写入 project_config.json 失败: {e}"]


def needs_migration(project_dir: str) -> bool:
    """检查项目是否需要迁移（有 INI 但没有 JSON）"""
    ini_path = os.path.join(project_dir, 'network_config.ini')
    json_path = os.path.join(project_dir, 'project_config.json')
    return os.path.exists(ini_path) and not os.path.exists(json_path)


def batch_migrate(workspace_dir: str) -> list:
    """
    批量迁移工作区下的所有项目
    
    Returns:
        [(project_name, success: bool, message: str), ...]
    """
    results = []
    if not os.path.isdir(workspace_dir):
        return [("", False, f"工作区目录不存在: {workspace_dir}")]

    for entry in os.listdir(workspace_dir):
        project_dir = os.path.join(workspace_dir, entry)
        if not os.path.isdir(project_dir):
            continue

        json_path, warnings = migrate_project(project_dir)
        if json_path:
            results.append((entry, True, f"迁移成功: {json_path}" + (f" ({'; '.join(warnings)})" if warnings else "")))
        elif warnings and warnings[0] != "project_config.json 已存在，跳过迁移":
            results.append((entry, False, f"迁移失败: {'; '.join(warnings)}"))

    return results
