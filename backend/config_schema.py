"""AutoLink v3.0.4-T3-4 统一配置 schema 层（配置体系重构）

四类配置统一模型（PRD 4.6 能力六 / R3.3）：
  - appSettings  应用设置（settings.json 语义：主题/语言/默认机柜/输出/代理等）
  - project      项目配置（project_config 扁平视图：拓扑/网络/机柜核心字段）
  - template     模板配置（project 字段的模板视图，复用同一字段定义）
  - wizard       向导配置（向导步骤默认值，复用 project 字段定义）

本版本只建模型/文件层并预留 CLI 接口（config get/set CLI 于 3.1.0/R4.1 落地）：
  - 每类 schema：版本号 + 字段元数据（key/type/default/group/enum）
  - 宽松校验：对已存在键做类型/枚举校验（缺失不报错）
  - 迁移链框架：migrate_config 按 schemaVersion 逐版本升级
  - 预设：按场景一键套用（overrides 覆盖设计配置扁平字段）
  - 导入导出：统一包裹格式 {format, version, appSettings, projectConfig}
"""
from __future__ import annotations

import json
from typing import Any, Dict, List, Optional

# ================================================================
#  四类配置 schema 定义
# ================================================================

CONFIG_TYPES = ('appSettings', 'project', 'template', 'wizard')
EXPORT_FORMAT = 'autolink-config'
EXPORT_VERSION = 1

# 字段类型（宽松校验用）
_TYPES = ('string', 'number', 'boolean')


def _f(key: str, ftype: str, default: Any, group: str, label: str,
       description: str = '', enum: Optional[List[Any]] = None) -> dict:
    """字段定义构造器"""
    return {
        'key': key,
        'type': ftype,
        'default': default,
        'group': group,
        'label': label,
        'description': description,
        'enum': enum or [],
    }


# --- 应用设置（与前端 localStorage keys 对齐） ---
APP_SETTINGS_FIELDS = [
    # 外观
    _f('theme', 'string', 'system', 'appearance', '主题模式', 'light/dark/system', ['light', 'dark', 'system']),
    _f('fontSize', 'number', 14, 'appearance', '字体大小', 'px', ),
    _f('animations', 'boolean', True, 'appearance', '动画效果', ''),
    # 语言
    _f('language', 'string', 'zh-CN', 'language', '界面语言', '', ['zh-CN', 'en', 'ja', 'ko', 'zh-TW']),
    # 项目默认值
    _f('defaultRack', 'number', 42, 'projectDefaults', '默认机柜 U 数', '', ),
    _f('defaultPowerLimit', 'number', 6000, 'projectDefaults', '默认机柜功率上限(W)', '', ),
    _f('defaultPortSpeed', 'string', '400G', 'projectDefaults', '默认端口速率', '', ['100G', '200G', '400G', '800G']),
    # 输出
    _f('outputFormat', 'string', 'xlsx', 'output', '默认导出格式', '', ['xlsx', 'csv', 'png']),
    _f('outputDir', 'string', '', 'output', '输出目录', '空 = 项目默认'),
    _f('autoSaveInterval', 'number', 5, 'output', '自动保存间隔(分钟)', ''),
    # 网络
    _f('autoUpdateCheck', 'boolean', True, 'network', '启动时检查更新', ''),
    _f('proxyHost', 'string', '', 'network', '代理主机', ''),
    _f('proxyPort', 'string', '', 'network', '代理端口', ''),
    # 设备库
    _f('deviceDataDir', 'string', '', 'deviceLibrary', '设备库数据目录', ''),
    _f('deviceAutoUpdate', 'boolean', True, 'deviceLibrary', '设备库自动更新', ''),
    _f('deviceTabReuse', 'boolean', True, 'deviceLibrary', '设备库复用标签页', ''),
    # 项目浏览器
    _f('explorerGroupMode', 'string', 'smart', 'explorer', '项目浏览器分组模式', '', ['smart', 'raw']),
]

# --- 项目配置（设计配置扁平核心字段，与前端 DesignConfig 对齐） ---
PROJECT_FIELDS = [
    _f('param_protocol', 'string', 'RoCE', 'param', '参数网协议', '', ['IB', 'RoCE', 'UEC']),
    _f('param_speed', 'string', '400G', 'param', '参数网速率', '', ['100G', '200G', '400G', '800G']),
    _f('storage_speed', 'string', '200G', 'storage', '存储网速率', '', ['100G', '200G', '400G']),
    _f('num_servers', 'number', 100, 'scale', 'GPU 服务器数', ''),
    _f('additional_storage_servers', 'number', 14, 'scale', '存储服务器数', ''),
    _f('additional_compute_servers', 'number', 20, 'scale', '通算服务器数', ''),
    _f('param_ports_per_server', 'number', 8, 'param', '每服务器参数端口数', ''),
    _f('storage_ports_per_server', 'number', 1, 'storage', '每服务器存储端口数', ''),
    _f('param_switch_ports', 'number', 64, 'param', '参数交换机端口数', ''),
    _f('storage_switch_ports', 'number', 40, 'storage', '存储交换机端口数', ''),
    _f('rail_mode', 'string', 'standard', 'param', 'Rail 模式', '', ['standard', 'rail_optimized']),
    _f('rail_count', 'number', 8, 'param', 'Rail 数量', ''),
    _f('rack_type', 'number', 42, 'rack', '机柜 U 数', '', ),
    _f('power_limit_per_rack', 'number', 6000, 'rack', '机柜功率上限(W)', ''),
    _f('cooling_method', 'string', 'air', 'rack', '散热方式', '', ['air', 'cold_plate', 'immersion']),
]

# 模板/向导复用项目字段（同一字段定义，语义视图不同）
TEMPLATE_FIELDS = PROJECT_FIELDS
WIZARD_FIELDS = PROJECT_FIELDS

SCHEMAS: Dict[str, dict] = {
    'appSettings': {'schemaVersion': 1, 'fields': APP_SETTINGS_FIELDS},
    'project': {'schemaVersion': 1, 'fields': PROJECT_FIELDS},
    'template': {'schemaVersion': 1, 'fields': TEMPLATE_FIELDS},
    'wizard': {'schemaVersion': 1, 'fields': WIZARD_FIELDS},
}

DEFAULT_APP_SETTINGS = {f['key']: f['default'] for f in APP_SETTINGS_FIELDS}


# ================================================================
#  公共接口：schema / 校验 / 迁移
# ================================================================

def get_schema(config_type: str) -> Optional[dict]:
    """返回指定类型的 schema 元数据（不存在返回 None）"""
    return SCHEMAS.get(config_type)


def list_schemas() -> Dict[str, dict]:
    """返回四类配置的 schema 元数据"""
    return {t: {'schemaVersion': s['schemaVersion'], 'fields': s['fields']}
            for t, s in SCHEMAS.items()}


def validate_config(config_type: str, data: Any, strict: bool = False) -> List[str]:
    """宽松校验指定类型配置

    对已存在的键做类型/枚举校验（缺失键不报错，strict=True 时缺失即报错）。
    返回错误列表（空 = 合法）。
    """
    schema = SCHEMAS.get(config_type)
    if schema is None:
        return [f"未知配置类型: {config_type}（可选: {', '.join(CONFIG_TYPES)}）"]
    if not isinstance(data, dict):
        return [f"{config_type} 配置必须是 JSON 对象"]
    if strict:
        missing = [f['key'] for f in schema['fields'] if f['key'] not in data]
        if missing:
            return [f"缺少字段: {', '.join(missing)}"]

    errors: List[str] = []
    fields_by_key = {f['key']: f for f in schema['fields']}
    for key, value in data.items():
        field = fields_by_key.get(key)
        if field is None:
            continue  # 未知键宽松放行（前端可能携带扩展字段）
        ftype = field['type']
        if ftype == 'number' and not isinstance(value, (int, float)):
            errors.append(f"{key} 必须是数值")
        elif ftype == 'boolean' and not isinstance(value, bool):
            errors.append(f"{key} 必须是布尔值")
        elif ftype == 'string' and not isinstance(value, str):
            errors.append(f"{key} 必须是字符串")
        if field.get('enum') and value not in field['enum']:
            errors.append(f"{key} 值 {value!r} 不在枚举 {field['enum']} 内")
    return errors


def migrate_config(config_type: str, data: Dict[str, Any]) -> Dict[str, Any]:
    """按 schemaVersion 逐版本升级（当前各类型 v1，迁移链占位）

    未来新增版本时在 _MIGRATIONS[config_type] 注册迁移函数：
      {2: fn, 3: fn, ...}（目标版本 → 迁移函数）
    """
    schema = SCHEMAS.get(config_type)
    if schema is None or not isinstance(data, dict):
        return data
    result = json.loads(json.dumps(data))  # deep copy，不修改入参
    version = int(result.get('schemaVersion', 1) or 1)
    target = int(schema['schemaVersion'])
    migrations = _MIGRATIONS.get(config_type, {})
    while version < target:
        version += 1
        migrator = migrations.get(version)
        if migrator:
            result = migrator(result)
        else:
            result['schemaVersion'] = version
    if 'schemaVersion' not in result:
        result['schemaVersion'] = version
    return result


# 目标版本 → 迁移函数（当前均为 v1，暂无迁移；预留注册点）
_MIGRATIONS: Dict[str, Dict[int, callable]] = {
    'appSettings': {},
    'project': {},
    'template': {},
    'wizard': {},
}


def normalize_app_settings(data: Optional[dict]) -> dict:
    """用默认值补全应用设置缺失键（导入/前端初始化用）"""
    merged = dict(DEFAULT_APP_SETTINGS)
    if isinstance(data, dict):
        for key, value in data.items():
            if key in DEFAULT_APP_SETTINGS:
                merged[key] = value
    return merged


# ================================================================
#  配置模板与预设（按场景一键套用）
# ================================================================

# 预设：overrides 覆盖设计配置扁平字段（DesignConfig 语义，宽松校验放行未知键）
PRESETS: List[dict] = [
    {
        'id': 'ib-allflash',
        'name': 'IB 全闪 H100 集群',
        'description': '100 台 H100 GPU + 全闪存储，IB 400G 参数网（经典规模）',
        'overrides': {
            'param_protocol': 'IB',
            'param_speed': '400G',
            'storage_speed': '200G',
            'num_servers': 100,
            'additional_storage_servers': 14,
            'additional_compute_servers': 20,
            'param_switch_ports': 64,
            'storage_switch_ports': 40,
            'param_ports_per_server': 8,
            'storage_ports_per_server': 1,
            'rail_mode': 'standard',
            'rail_count': 8,
        },
    },
    {
        'id': 'roce-general',
        'name': 'RoCE 通用场景',
        'description': '通用 RoCE 400G 组网，GPU + 存储 + 通算混合部署',
        'overrides': {
            'param_protocol': 'RoCE',
            'param_speed': '400G',
            'storage_speed': '200G',
            'num_servers': 100,
            'additional_storage_servers': 14,
            'additional_compute_servers': 20,
            'param_switch_ports': 64,
            'storage_switch_ports': 40,
            'param_ports_per_server': 8,
            'storage_ports_per_server': 1,
        },
    },
    {
        'id': 'l20-inference',
        'name': 'L20 推理集群',
        'description': '64 台 L20 推理 GPU，RoCE 400G，轻量存储',
        'overrides': {
            'param_protocol': 'RoCE',
            'param_speed': '400G',
            'num_servers': 64,
            'additional_storage_servers': 8,
            'additional_compute_servers': 12,
            'param_switch_ports': 64,
            'storage_switch_ports': 40,
        },
    },
    {
        'id': 'uec-datacenter',
        'name': 'UEC 数据中心',
        'description': 'UEC 800G 大集群，200 台 GPU + 大规模存储',
        'overrides': {
            'param_protocol': 'UEC',
            'param_speed': '800G',
            'storage_speed': '400G',
            'num_servers': 200,
            'additional_storage_servers': 16,
            'additional_compute_servers': 32,
            'param_switch_ports': 144,
            'storage_switch_ports': 48,
            'param_ports_per_server': 8,
            'storage_ports_per_server': 1,
        },
    },
]


def list_presets() -> List[dict]:
    """返回预设列表（不含 overrides 内部细节的简要信息）"""
    return [
        {'id': p['id'], 'name': p['name'], 'description': p['description']}
        for p in PRESETS
    ]


def apply_preset(preset_id: str, config: Optional[dict]) -> tuple:
    """套用预设：将 overrides 覆盖到现有配置（深拷贝，不修改入参）

    Returns:
        (config: dict, errors: [str])
    """
    preset = next((p for p in PRESETS if p['id'] == preset_id), None)
    if preset is None:
        return (config or {}), [f"预设不存在: {preset_id}"]
    merged = dict(config or {})
    merged.update(preset['overrides'])
    errors = validate_config('project', merged)
    return merged, errors


# ================================================================
#  配置导入导出（统一包裹格式）
# ================================================================

def export_config(app_settings: Optional[dict], project_config: Optional[dict]) -> dict:
    """导出统一配置包裹：
    {format, version, exportedAt, appSettings, projectConfig}
    """
    import datetime
    return {
        'format': EXPORT_FORMAT,
        'version': EXPORT_VERSION,
        'exportedAt': datetime.datetime.now().isoformat(),
        'appSettings': normalize_app_settings(app_settings),
        'projectConfig': dict(project_config or {}),
    }


def import_config(payload: Any) -> dict:
    """导入配置包裹，返回 {appSettings, projectConfig, errors}

    - 校验格式/版本
    - appSettings：默认值补全 + 宽松校验
    - projectConfig：宽松校验（未知键放行）
    """
    if not isinstance(payload, dict):
        return {'appSettings': None, 'projectConfig': None, 'errors': ['导入内容必须是 JSON 对象']}
    if payload.get('format') != EXPORT_FORMAT:
        return {'appSettings': None, 'projectConfig': None,
                'errors': [f"不支持的配置格式: {payload.get('format')!r}（期望 {EXPORT_FORMAT}）"]}
    if int(payload.get('version', 1)) > EXPORT_VERSION:
        return {'appSettings': None, 'projectConfig': None,
                'errors': [f"配置版本过新: v{payload.get('version')}（当前支持 v{EXPORT_VERSION}）"]}

    errors: List[str] = []
    app_settings = normalize_app_settings(payload.get('appSettings'))
    app_errors = validate_config('appSettings', app_settings)
    if app_errors:
        errors.extend(f"appSettings.{e}" for e in app_errors)

    project_config = payload.get('projectConfig')
    if project_config is not None:
        proj_errors = validate_config('project', project_config)
        errors.extend(f"projectConfig.{e}" for e in proj_errors)
    else:
        project_config = {}

    return {'appSettings': app_settings, 'projectConfig': project_config, 'errors': errors}
