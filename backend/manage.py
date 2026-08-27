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


# ============================================================
# 模板写操作（template:create / template:update / template:delete，M6）
# ============================================================

_TEMPLATE_RESERVED = {'device_library'}
_INVALID_NAME_CHARS = ('/', '\\', '..', ':', '*', '?', '"', '<', '>', '|')


def _now() -> str:
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).isoformat(timespec='seconds')


def _write_json(path, data):
    """写 JSON（自动建目录）"""
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def _safe_component_name(name: str, kind: str = '名称', max_len: int = 64) -> tuple:
    """校验模板/项目名：非空、无路径分隔/穿越、非保留名。返回 (name, error)"""
    name = (name or '').strip()
    if not name:
        return None, f'{kind}不能为空'
    if len(name) > max_len:
        return None, f'{kind}过长（> {max_len} 字符）'
    if any(c in name for c in _INVALID_NAME_CHARS):
        return None, f'{kind}含非法字符（不能包含路径分隔符等）'
    if name in _TEMPLATE_RESERVED:
        return None, f'{kind}是保留名'
    return name, None


def save_template(name: str, config: dict, description: str = '', scenario: str = '',
                  tags: list | None = None, overwrite: bool = False) -> dict:
    """保存用户模板：user_template_dir/<name>/template.json + project_config.json（M6 写操作）。
    config 必须是非空 ProjectConfig dict；overwrite=False 时同名已存在则报错。"""
    name, err = _safe_component_name(name, '模板名')
    if err:
        return {'success': False, 'error': err}
    if not isinstance(config, dict) or not config:
        return {'success': False, 'error': '缺少模板配置（config 必须是非空 JSON 对象）'}
    root = Path(user_template_dir()) / name
    if root.exists() and not overwrite:
        return {'success': False, 'error': f'模板已存在: {name}（可传 overwrite=true 覆盖）'}
    from project_config import create_default_config
    cfg = _deep_merge(create_default_config(name), json.loads(json.dumps(config)))
    cfg.setdefault('meta', {})['name'] = name
    _write_json(root / 'template.json', {
        'id': name, 'name': name, 'description': description or '',
        'scenario': scenario or '', 'tags': tags or [], 'source': 'user',
    })
    _write_json(root / 'project_config.json', cfg)
    return {'success': True, 'template': name, 'path': str(root)}


def update_template(name: str, config: dict) -> dict:
    """更新用户模板 project_config.json（M6 写操作）。内置模板只读不可改。"""
    name, err = _safe_component_name(name, '模板名')
    if err:
        return {'success': False, 'error': err}
    if not isinstance(config, dict) or not config:
        return {'success': False, 'error': '缺少模板配置（config 必须是非空 JSON 对象）'}
    root = Path(user_template_dir()) / name
    if not (root / 'template.json').exists():
        return {'success': False, 'error': f'用户模板不存在: {name}（内置模板只读）'}
    from project_config import create_default_config
    cfg = _deep_merge(create_default_config(name), json.loads(json.dumps(config)))
    cfg.setdefault('meta', {})['name'] = name
    _write_json(root / 'project_config.json', cfg)
    return {'success': True, 'template': name, 'path': str(root)}


def delete_template(name: str) -> dict:
    """删除用户模板（M6 写操作）。内置模板只读不可删。"""
    name, err = _safe_component_name(name, '模板名')
    if err:
        return {'success': False, 'error': err}
    builtin = Path(template_dir()) / name
    if builtin.is_dir():
        return {'success': False, 'error': f'内置模板只读不可删除: {name}'}
    root = Path(user_template_dir()) / name
    if not root.is_dir():
        return {'success': False, 'error': f'用户模板不存在: {name}'}
    import shutil
    shutil.rmtree(str(root), ignore_errors=True)
    return {'success': True, 'template': name}


def recommend_template(protocol: str = '', gpu_model: str = '', scale: str = '') -> dict:
    """模板推荐（M6，从 MC 互灌）：按参数网协议/GPU 型号/规模关键词对模板清单打分排序。"""
    data = list_templates()
    protocol_key = (protocol or '').strip().upper()
    scale_key = (scale or '').strip()
    gpu_key = (gpu_model or '').strip().lower()

    scored = []
    for tpl in data.get('templates', []):
        summary = tpl.get('summary') or {}
        s = 0
        if protocol_key and (summary.get('param_protocol') or '').upper() == protocol_key:
            s += 3
        elif protocol_key:
            s -= 1
        cfg = None
        if gpu_key or scale_key:
            view = view_template(tpl.get('name') or tpl.get('id'))
            if view.get('success'):
                cfg = view['template']['config']
        if gpu_key and cfg:
            name = ' '.join([cfg.get('meta', {}).get('name', ''), json.dumps(cfg, ensure_ascii=False)]).lower()
            if gpu_key in name:
                s += 2
        if scale_key and cfg and str((cfg.get('topology') or {}).get('num_gpu_servers', '')) == scale_key:
            s += 2
        scored.append({'template': tpl, 'score': s, 'summary': summary})

    scored.sort(key=lambda x: -x['score'])
    top = [{'name': t['template'].get('name') or t['template'].get('id'),
            'id': t['template'].get('id'), 'source': t['template'].get('source'),
            'score': t['score'], 'summary': t['summary']} for t in scored[:5]]
    return {'success': True, 'recommendations': top,
            'totalAvailable': len(scored), 'total': len(top)}


# ============================================================
# 项目写操作（project:create / project:delete / 文件读写，M6）
# ============================================================

def create_project(name: str, description: str = '', template: str = '') -> dict:
    """基于模板（或默认配置）创建工作区项目，并转 AIDC 项目（mint projectId + plan.json，幂等）。"""
    name, err = _safe_component_name(name, '项目名')
    if err:
        return {'success': False, 'error': err}
    d = Path(workspace_dir()) / name
    if d.exists():
        return {'success': False, 'error': f'项目已存在: {name}'}
    cfg = None
    if template:
        vt = view_template(template)
        if not vt.get('success'):
            return {'success': False, 'error': vt.get('error', f'模板不存在: {template}')}
        cfg = vt['template']['config']
    if cfg is None:
        from project_config import create_default_config
        cfg = create_default_config(name)
    cfg = json.loads(json.dumps(cfg))
    cfg.setdefault('meta', {})['name'] = name
    d.mkdir(parents=True, exist_ok=True)
    _write_json(d / 'project_config.json', cfg)
    _write_json(d / 'project.json', {
        'name': name, 'description': description or '',
        'createdAt': _now(), 'updatedAt': _now(), 'version': 1,
    })
    from aidc_project import init_aidc_project
    result = init_aidc_project(str(d), cfg.get('aidc_macro'))
    if isinstance(result, dict) and result.get('error'):
        return {'success': False, 'error': result['error']}
    return {'success': True, 'project': name, 'path': str(d),
            'projectId': result.get('projectId', ''), 'planVersion': result.get('planVersion', 1)}


def delete_project(name: str) -> dict:
    """删除工作区项目（M6 写操作，不可恢复）。"""
    name, err = _safe_component_name(name, '项目名')
    if err:
        return {'success': False, 'error': err}
    d = Path(workspace_dir()) / name
    if not d.is_dir():
        return {'success': False, 'error': f'项目不存在: {name}'}
    import shutil
    shutil.rmtree(str(d), ignore_errors=True)
    return {'success': True, 'project': name}


def _resolve_project_path(name: str, rel_path: str) -> str | None:
    """解析项目内文件绝对路径（防目录穿越）；非法返回 None"""
    root = Path(workspace_dir()) / name
    if not root.is_dir():
        return None
    target = (root / (rel_path or '')).resolve()
    root_res = root.resolve()
    if target != root_res and root_res not in target.parents:
        return None
    return str(target)


def project_list_files(name: str) -> dict:
    """列出项目目录文件树（跳过隐藏目录，不含二进制内容）"""
    root = Path(workspace_dir()) / name
    if not root.is_dir():
        return {'success': False, 'error': f'项目不存在: {name}'}
    files = []
    for p in sorted(root.rglob('*')):
        if p.is_dir():
            continue
        rel = p.relative_to(root)
        if any(part.startswith('.') for part in rel.parts):
            continue
        try:
            files.append({'path': rel.as_posix(), 'size': p.stat().st_size})
        except OSError:
            pass
    return {'success': True, 'project': name, 'files': files, 'total': len(files)}


def project_read_file(name: str, file_path: str) -> dict:
    """读取项目内文本文件（M6，从 MC 互灌 read_file）。"""
    path = _resolve_project_path(name, file_path)
    if not path:
        return {'success': False, 'error': '项目不存在或路径非法（不允许越出项目目录）'}
    if not os.path.isfile(path):
        return {'success': False, 'error': f'文件不存在: {file_path}'}
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return {'success': True, 'project': name, 'path': file_path, 'content': f.read()}
    except UnicodeDecodeError:
        return {'success': False, 'error': f'文件不是文本（二进制）: {file_path}'}


def project_write_file(name: str, file_path: str, content: str) -> dict:
    """写入项目内文本文件（M6，从 MC 互灌 write_file；覆盖已存在文件）。"""
    path = _resolve_project_path(name, file_path)
    if not path:
        return {'success': False, 'error': '项目不存在或路径非法（不允许越出项目目录）'}
    try:
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content or '')
        return {'success': True, 'project': name, 'path': file_path}
    except OSError as e:
        return {'success': False, 'error': f'写入失败: {e}'}


# ============================================================
# 模板/项目导入导出（AI-4，M6c 补齐：AI 对话内导入导出）
# ============================================================

def _manifest_files(src_dir: str, with_content: bool = True) -> list:
    """返回目录文件清单（path/size/content[文本]；隐藏/缓存文件跳过）"""
    src = Path(src_dir)
    files = []
    for p in sorted(src.rglob('*')):
        if p.is_dir():
            continue
        rel = p.relative_to(src).as_posix()
        if any(part.startswith('.') for part in rel.split('/')):
            continue
        try:
            size = p.stat().st_size
        except OSError:
            continue
        entry = {'path': rel, 'size': size}
        if with_content and size <= 2 * 1024 * 1024:
            try:
                entry['content'] = p.read_text(encoding='utf-8')
            except (UnicodeDecodeError, OSError):
                pass
        files.append(entry)
    return files


def _zip_dir(src_dir: str, out_zip: str) -> int:
    """把目录内所有文件打包为 zip（隐藏/缓存文件跳过），返回文件数"""
    import zipfile
    src = Path(src_dir)
    Path(out_zip).parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with zipfile.ZipFile(out_zip, 'w', zipfile.ZIP_DEFLATED) as z:
        for p in sorted(src.rglob('*')):
            if p.is_dir():
                continue
            rel = p.relative_to(src).as_posix()
            if any(part.startswith('.') for part in rel.split('/')):
                continue
            z.write(str(p), rel)
            count += 1
    return count


def _extract_zip_safe(zip_path: str, dest_dir: str) -> None:
    """安全解压 zip 到目录（防 zip-slip 路径穿越）"""
    import zipfile
    dest = Path(dest_dir).resolve()
    with zipfile.ZipFile(zip_path, 'r') as z:
        for member in z.infolist():
            target = (dest / member.filename).resolve()
            if not target.is_relative_to(dest):
                raise ValueError(f'zip 条目含非法路径: {member.filename}')
            z.extract(member, str(dest))


def _archive_root(extract_dir: str, marker: str) -> str | None:
    """定位含 marker 文件的根目录（支持外层单层包裹目录）"""
    base = Path(extract_dir)
    if (base / marker).is_file():
        return str(base)
    subdirs = [p for p in base.iterdir() if p.is_dir()]
    if len(subdirs) == 1 and (subdirs[0] / marker).is_file():
        return str(subdirs[0])
    return None


def _copy_tree(src: str, dst: str) -> int:
    """递归复制目录内所有文件（隐藏/缓存跳过），返回文件数"""
    import shutil
    src = Path(src)
    count = 0
    for p in src.rglob('*'):
        if p.is_dir():
            continue
        rel = p.relative_to(src)
        if any(part.startswith('.') for part in rel.parts):
            continue
        target = Path(dst) / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(str(p), str(target))
        count += 1
    return count


def _resolve_template_dir(name: str) -> str | None:
    """解析模板目录（用户优先、内置兜底）；不存在返回 None"""
    for root in (user_template_dir(), template_dir()):
        d = Path(root) / name
        if d.is_dir() and (d / 'template.json').exists():
            return str(d)
    return None


def export_template(name: str, output_path: str = '') -> dict:
    """导出模板（AI-4）：指定 output_path 打包 zip；否则返回文件清单+内容"""
    name, err = _safe_component_name(name, '模板名')
    if err:
        return {'success': False, 'error': err}
    src = _resolve_template_dir(name)
    if src is None:
        return {'success': False, 'error': f'模板不存在: {name}'}
    source = 'user' if src.startswith(user_template_dir()) else 'builtin'
    files = _manifest_files(src)
    result = {'success': True, 'template': name, 'source': source,
              'files': files, 'total': len(files)}
    if output_path:
        try:
            result['zipPath'] = output_path
            result['zipped'] = _zip_dir(src, output_path)
        except OSError as e:
            return {'success': False, 'error': f'导出失败: {e}'}
    return result


def import_template(source: str, name: str = '', overwrite: bool = False) -> dict:
    """导入模板（AI-4）：从 zip 或目录导入到用户模板中心，校验 template.json 结构。
    重名默认拒绝，overwrite=true 覆盖。"""
    import shutil
    import tempfile
    if not source:
        return {'success': False, 'error': '缺少导入源（source 必须是非空路径）'}
    tmp = None
    try:
        if os.path.isdir(source):
            root = _archive_root(source, 'template.json')
            if root is None:
                return {'success': False, 'error': '导入源缺少 template.json（非模板包）'}
            src_root = root
        elif os.path.isfile(source) and source.lower().endswith('.zip'):
            tmp = tempfile.mkdtemp(prefix='al_tpl_import_')
            _extract_zip_safe(source, tmp)
            root = _archive_root(tmp, 'template.json')
            if root is None:
                return {'success': False, 'error': 'zip 缺少 template.json（非模板包）'}
            src_root = root
        else:
            return {'success': False, 'error': f'导入源不存在或不是 zip/目录: {source}'}
        meta, meta_err = _safe_read_json(str(Path(src_root) / 'template.json'))
        if meta_err or not meta:
            return {'success': False, 'error': 'template.json 解析失败或为空'}
        tpl_name = (name or '').strip() or meta.get('name') or meta.get('id') or ''
        tpl_name, err = _safe_component_name(tpl_name, '模板名')
        if err:
            return {'success': False, 'error': err}
        target = Path(user_template_dir()) / tpl_name
        if target.exists() and not overwrite:
            return {'success': False, 'error': f'模板已存在: {tpl_name}（可传 overwrite=true 覆盖）'}
        if target.exists():
            shutil.rmtree(str(target), ignore_errors=True)
        count = _copy_tree(src_root, str(target))
        return {'success': True, 'template': tpl_name, 'path': str(target),
                'source': source, 'files': count}
    except (ValueError, OSError) as e:
        return {'success': False, 'error': f'导入失败: {e}'}
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)


def export_project(name: str, output_path: str = '') -> dict:
    """导出项目（AI-4）：指定 output_path 打包为项目交付 zip；否则返回文件清单+内容"""
    name, err = _safe_component_name(name, '项目名')
    if err:
        return {'success': False, 'error': err}
    d = Path(workspace_dir()) / name
    if not d.is_dir():
        return {'success': False, 'error': f'项目不存在: {name}'}
    files = _manifest_files(str(d))
    result = {'success': True, 'project': name,
              'files': files, 'total': len(files),
              'has_plan': (d / 'plan.json').exists()}
    if output_path:
        try:
            result['zipPath'] = output_path
            result['zipped'] = _zip_dir(str(d), output_path)
        except OSError as e:
            return {'success': False, 'error': f'导出失败: {e}'}
    return result


def import_project(source: str, name: str = '', overwrite: bool = False) -> dict:
    """导入项目（AI-4）：从 zip 导入到工作区，校验 project.json/project_config.json。
    重名默认拒绝，overwrite=true 覆盖。AI 对话场景 source 来自用户附件路径。"""
    import shutil
    import tempfile
    if not source:
        return {'success': False, 'error': '缺少导入源（source 必须是非空 zip 路径）'}
    if not (os.path.isfile(source) and source.lower().endswith('.zip')):
        return {'success': False, 'error': f'项目导入仅支持 zip 包: {source}'}
    tmp = None
    try:
        tmp = tempfile.mkdtemp(prefix='al_proj_import_')
        _extract_zip_safe(source, tmp)
        root = _archive_root(tmp, 'project.json')
        if root is None:
            root = _archive_root(tmp, 'project_config.json')
        if root is None:
            return {'success': False, 'error': 'zip 缺少 project.json（非项目包）'}
        meta, _ = _safe_read_json(str(Path(root) / 'project.json'))
        proj_name = (name or '').strip() or (meta or {}).get('name') or Path(root).name or ''
        proj_name, err = _safe_component_name(proj_name, '项目名')
        if err:
            return {'success': False, 'error': err}
        target = Path(workspace_dir()) / proj_name
        if target.exists() and not overwrite:
            return {'success': False, 'error': f'项目已存在: {proj_name}（可传 overwrite=true 覆盖）'}
        if target.exists():
            shutil.rmtree(str(target), ignore_errors=True)
        count = _copy_tree(root, str(target))
        return {'success': True, 'project': proj_name, 'path': str(target),
                'source': source, 'files': count}
    except (ValueError, OSError) as e:
        return {'success': False, 'error': f'导入失败: {e}'}
    finally:
        if tmp:
            shutil.rmtree(tmp, ignore_errors=True)
