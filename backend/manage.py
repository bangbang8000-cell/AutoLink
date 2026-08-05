"""AutoLink 对话管理域只读查询（V3.1.3-T7-1）

backend 侧只读查询：设备库 / 模板 / 项目，供 AIHUB 管理工具与 CLI 使用。

路径约定与 electron/config.ts 保持一致：
  - 工作区:   $AUTOLINK_USER_DATA/workspace（未设置时 <cwd>/workspace）
  - 内置模板: <base>/template（base = sys._MEIPASS（打包）或 backend 上级）
  - 用户模板: $AUTOLINK_USER_DATA/user-templates（未设置时 <cwd>/user-templates）

全部为只读操作，不创建/修改任何文件（AIHUB 权限 AUTO，安全）。
"""
import json
import logging
import os
import sys
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)


# ============================================================
# 路径解析
# ============================================================

def _base_dir() -> str:
    """backend 数据基目录（打包走 sys._MEIPASS，dev 为仓库根）"""
    if getattr(sys, '_MEIPASS', None):
        return sys._MEIPASS
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _user_data_dir() -> str:
    return os.environ.get('AUTOLINK_USER_DATA', '')


def workspace_dir() -> str:
    """用户工作区目录（项目根）"""
    ud = _user_data_dir()
    if ud:
        return os.path.join(ud, 'workspace')
    return os.path.join(os.getcwd(), 'workspace')


def template_dir() -> str:
    """内置模板目录（含 device_library，打包后只读）"""
    return os.path.join(_base_dir(), 'template')


def user_template_dir() -> str:
    """用户模板目录（可读写）"""
    ud = _user_data_dir()
    if ud:
        return os.path.join(ud, 'user-templates')
    return os.path.join(os.getcwd(), 'user-templates')


def _safe_read_json(path: str) -> tuple:
    """读取 JSON，返回 (data, error)；失败时 data 为空 dict"""
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f), None
    except Exception as e:
        return {}, str(e)


# ============================================================
# 设备库（device:list）
# ============================================================

def list_devices(category: str = '', query: str = '', limit: int = 50) -> dict:
    """设备库列表：按 category（分类 id/厂商/型号）或关键词过滤，返回摘要字段"""
    from device_library import get_device_library
    library = get_device_library()
    devices = []
    for dev in library.get_all():
        vendor = getattr(dev, 'vendor', '') or ''
        model = getattr(dev, 'model', '') or ''
        cid = getattr(dev, 'category', '') or ''
        # 分类匹配：精确 id 或前缀（如 'switches' 匹配 switches_param/storage/...），兼匹配厂商/型号
        if category and not (category == cid or cid.startswith(category) or category in (vendor, model)):
            continue
        if query:
            hay = ' '.join([vendor, model, getattr(dev, 'description', '') or ''])
            if query.lower() not in hay.lower():
                continue
        devices.append({
            'id': getattr(dev, 'id', ''),
            'category': cid,
            'vendor': vendor,
            'model': model,
            'description': getattr(dev, 'description', ''),
            'power_watts': getattr(dev, 'power_watts', None),
            'u_height': getattr(dev, 'u_height', None),
            'gpu_count': getattr(dev, 'gpu_count', None),
            'gpu_model': getattr(dev, 'gpu_model', None),
            'port_count': getattr(dev, 'port_count', None),
            'port_speed': getattr(dev, 'port_speed', None),
        })
        if limit and len(devices) >= limit:
            break
    return {'devices': devices, 'total': len(devices)}


# ============================================================
# 模板（template:list / template:view）
# ============================================================

def _template_summary(cfg: dict) -> dict:
    """从模板 project_config 提取规模摘要（供列表展示，不返回完整配置）"""
    topo = (cfg or {}).get('topology', {}) or {}
    return {
        'num_gpu_servers': topo.get('num_gpu_servers'),
        'num_all_flash_storage': topo.get('num_all_flash_storage'),
        'num_hybrid_flash_storage': topo.get('num_hybrid_flash_storage'),
        'num_compute_servers': topo.get('num_compute_servers'),
        'param_protocol': topo.get('param_protocol'),
        'param_speed': topo.get('param_speed'),
        'rack_type': ((cfg or {}).get('rack_config') or {}).get('rack_type'),
    }


def _collect_template_dir(root: str, source: str) -> list:
    """收集一个模板根目录（内置或用户）下的模板条目"""
    entries = []
    base = Path(root)
    if not base.is_dir():
        return entries
    for d in sorted(p for p in base.iterdir() if p.is_dir()):
        if d.name == 'device_library':
            continue
        meta, meta_err = _safe_read_json(str(d / 'template.json'))
        cfg, _ = _safe_read_json(str(d / 'project_config.json'))
        if meta_err and not meta:
            continue  # 缺 template.json 的目录不视为模板
        entries.append({
            'id': meta.get('id') or d.name,
            'name': meta.get('name') or d.name,
            'description': meta.get('description', ''),
            'scenario': meta.get('scenario', ''),
            'tags': meta.get('tags', []),
            'source': source,
            'summary': _template_summary(cfg),
        })
    return entries


def list_templates() -> dict:
    """模板列表（内置 + 用户模板，含规模摘要）"""
    templates = _collect_template_dir(template_dir(), 'builtin')
    templates += _collect_template_dir(user_template_dir(), 'user')
    return {'templates': templates, 'total': len(templates)}


def view_template(name: str) -> dict:
    """查看模板详情（含完整 ProjectConfig），内置优先、用户模板覆盖同名"""
    for source, root in (('user', user_template_dir()), ('builtin', template_dir())):
        d = Path(root) / name
        if not d.is_dir() or not (d / 'template.json').exists():
            continue
        meta, _ = _safe_read_json(str(d / 'template.json'))
        cfg, cfg_err = _safe_read_json(str(d / 'project_config.json'))
        if cfg_err:
            return {'success': False, 'error': cfg_err}
        return {'success': True, 'template': {
            'id': meta.get('id') or name,
            'name': meta.get('name') or name,
            'description': meta.get('description', ''),
            'scenario': meta.get('scenario', ''),
            'source': source,
            'config': cfg,
        }}
    return {'success': False, 'error': f'模板不存在: {name}'}


# ============================================================
# 项目（project:list / project:info）
# ============================================================

def list_projects() -> dict:
    """扫描工作区项目目录，返回摘要列表"""
    wsp = Path(workspace_dir())
    projects = []
    if wsp.is_dir():
        for d in sorted(p for p in wsp.iterdir() if p.is_dir()):
            meta, _ = _safe_read_json(str(d / 'project.json'))
            projects.append({
                'name': meta.get('name') or d.name,
                'description': meta.get('description', ''),
                'createdAt': meta.get('createdAt', ''),
                'updatedAt': meta.get('updatedAt', ''),
                'has_config': (d / 'project_config.json').exists(),
                'has_ini': (d / 'network_config.ini').exists(),
            })
    return {'projects': projects, 'total': len(projects)}


def project_info(name: str) -> dict:
    """项目详情（meta + 完整 ProjectConfig + 宽松校验摘要）"""
    d = Path(workspace_dir()) / name
    if not d.is_dir():
        return {'success': False, 'error': f'项目不存在: {name}'}
    meta, _ = _safe_read_json(str(d / 'project.json'))
    cfg, cfg_err = _safe_read_json(str(d / 'project_config.json'))
    validation = []
    if not cfg_err and cfg:
        try:
            from project_config import validate_config
            err = validate_config(cfg, strict=False)
            if err:
                validation.append(err)
        except Exception as e:
            validation.append(str(e))
    return {
        'success': True,
        'project': {
            'name': meta.get('name') or name,
            'description': meta.get('description', ''),
            'meta': meta,
            'has_config': bool(cfg),
            'has_ini': (d / 'network_config.ini').exists(),
            'validationIssues': validation,
            'config': cfg if cfg else None,
        },
    }


# ============================================================
# 需求生成（project:generate，V3.1.3-T7-2）
# ============================================================

# 需标注缺失的字段域（created_at/updated_at/version 等技术字段自动生成，不算缺失）
_ANNOTATE_SECTIONS = (
    ('meta', ('name', 'description')),
    ('networks', ('param_network', 'storage_network', 'biz_network', 'oob_network')),
    ('topology', ('num_gpu_servers', 'num_all_flash_storage', 'num_hybrid_flash_storage',
                  'num_compute_servers', 'param_protocol', 'param_speed', 'storage_speed',
                  'param_ports_per_server', 'storage_ports_per_server',
                  'param_switch_ports', 'storage_switch_ports', 'downlink_mode')),
    ('rack_config', ('rack_type', 'power_limit_per_rack', 'naming_prefix')),
)
_ANNOTATE_TOP_KEYS = ('device_refs',)


def _deep_merge(base: dict, overlay: dict) -> dict:
    """递归合并：overlay 值覆盖 base；dict 深度合并（返回新对象，不修改入参）"""
    result = json.loads(json.dumps(base))
    for k, v in (overlay or {}).items():
        if isinstance(v, dict) and isinstance(result.get(k), dict):
            result[k] = _deep_merge(result[k], v)
        else:
            result[k] = json.loads(json.dumps(v))
    return result


def _annotate(raw: dict) -> dict:
    """置信度/缺失字段标注：LLM 抽取的原始 config 相对完整 schema 缺失的字段"""
    missing: list = []
    for section, keys in _ANNOTATE_SECTIONS:
        raw_s = raw.get(section) or {}
        for k in keys:
            if k not in raw_s:
                missing.append(f"{section}.{k}")
    for k in _ANNOTATE_TOP_KEYS:
        if k not in raw:
            missing.append(k)
    total = sum(len(ks) for _, ks in _ANNOTATE_SECTIONS) + len(_ANNOTATE_TOP_KEYS)
    confidence = round(1 - len(missing) / total, 2) if total else 1.0
    return {
        'missingFields': missing,
        'confidence': confidence,
        # 缺失字段将由默认值补全 → 即「推导字段」
        'derivedFields': missing,
    }


def generate_project(name: str = '', config: dict | None = None) -> dict:
    """V3.1.3-T7-2: 需求生成（轨道 B，只预览不落盘）

    LLM 抽取的 ProjectConfig → migrate_config 规范化 → 默认值补全缺失键 →
    validate_config(strict=False) 宽松校验 → 置信度/缺失字段标注。

    返回 {success, config(规范化+补全), validationIssues, annotations}；
    落盘由前端确认后走 electron `project:createWithConfig`。
    """
    raw = config if isinstance(config, dict) else {}
    if not raw:
        return {'success': False, 'error': '缺少项目配置（config 参数必须是非空 JSON 对象）'}

    # 1. schema 迁移（v1 → v2）
    from project_config import create_default_config, migrate_config, validate_config
    migrated = migrate_config(raw)

    # 2. 默认值打底 + 用户字段覆盖（缺失键补全为默认值）
    fallback_name = (migrated.get('meta') or {}).get('name') or name or '未命名项目'
    base = create_default_config(fallback_name)
    cfg = _deep_merge(base, migrated)
    if name and not (cfg.get('meta') or {}).get('name'):
        cfg['meta']['name'] = name

    # 3. 宽松校验（仅校验已存在字段的类型/枚举，缺失键不报错）
    issues = []
    try:
        err = validate_config(cfg, strict=False)
        if err:
            issues.append({'severity': 'error', 'message': err})
    except Exception as e:
        issues.append({'severity': 'error', 'message': str(e)})

    # 4. 标注
    annotations = _annotate(raw)
    if annotations['confidence'] < 0.6:
        issues.append({
            'severity': 'warning',
            'message': f"字段完整度 {annotations['confidence'] * 100:.0f}%，缺失字段为默认推导值，建议确认后再创建",
        })

    return {
        'success': True,
        'config': cfg,
        'validationIssues': issues,
        'annotations': annotations,
    }
