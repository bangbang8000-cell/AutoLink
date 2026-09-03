"""48-c（F8-3）：技能库文件级导入导出（打包 skills/*.md + 状态 → zip，跨端可移植）。

5.0.3-503-b：manifest schema v2 升级支持技能级元数据（保持版本兼容读旧包）：
  manifest.json      {format:'autolink-skills', schemaVersion:2, exportedAt,
                      skills:[{name,enabled}], metadata:{<name>:{...}}}
  skills/<name>.md   技能正文（MC ai_hub/skills/skills/*.md 同格式，可互灌）
  skills/<name>.metadata.json  技能级元数据（自学习改进记录/使用统计，v2 新增）
  skills_state.json  启用状态（disabled 列表，与引擎持久化一致）

导入：解包安装 *.md（+ 可选 .metadata.json）到 SKILLS_DIR + 合并状态（默认保留目标端
同名技能，overwrite 覆盖），完成后 reload 引擎使提示词缓存失效。schemaVersion 1 旧包
（无 metadata）仍可正常导入（版本兼容读旧包）。
"""
import json
import os
import zipfile
from datetime import datetime
from pathlib import Path

from .engine import SKILLS_DIR

MANIFEST_FORMAT = 'autolink-skills'
MANIFEST_VERSION = 2
SUPPORTED_VERSIONS = (1, 2)


def list_skills_payload() -> dict:
    """技能清单（名称/启用/使用次数/最近使用），供前端技能库面板与 AI 工具共用。"""
    from .engine import get_skills_engine
    engine = get_skills_engine()
    return {'ok': True, 'skills': engine.list_skills()}


def export_skills_package(filepath: str) -> dict:
    """打包 skills/*.md（+ 技能级元数据）+ 状态 + manifest v2 到 zip，返回落盘路径。"""
    from .engine import get_skills_engine
    engine = get_skills_engine()
    skills = engine.list_skills()
    disabled = [s['name'] for s in skills if not s['enabled']]
    manifest = {
        'format': MANIFEST_FORMAT,
        'schemaVersion': MANIFEST_VERSION,
        'exportedAt': datetime.now().isoformat(timespec='seconds'),
        'skills': [{'name': s['name'], 'enabled': s['enabled']} for s in skills],
        'metadata': {},
    }
    if not filepath.lower().endswith('.zip'):
        filepath += '.zip'
    # 先收集各技能元数据，再一次性写 manifest（避免重复写入）
    meta_by_name: dict = {}
    for skill in engine.skills.values():
        meta_path = skill.file_path.with_suffix('.metadata.json')
        if skill.metadata or meta_path.exists():
            meta_by_name[skill.name] = skill.metadata or {}
    manifest['metadata'] = meta_by_name
    with zipfile.ZipFile(filepath, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
        z.writestr('skills_state.json', json.dumps({'disabled': disabled}, ensure_ascii=False, indent=2))
        for skill in engine.skills.values():
            z.writestr(f"skills/{skill.name}.md", skill.content)
            if skill.name in meta_by_name:
                z.writestr(f"skills/{skill.name}.metadata.json",
                           json.dumps(meta_by_name[skill.name], ensure_ascii=False, indent=2))
    return {'ok': True, 'path': filepath, 'count': len(skills),
            'metadata_count': len(meta_by_name)}


def import_skills_package(zip_path: str, overwrite: bool = False) -> dict:
    """解包安装技能（*.md → SKILLS_DIR，可选 .metadata.json）+ 合并状态；返回导入/跳过计数。"""
    if not os.path.exists(zip_path):
        return {'error': f'技能包不存在: {zip_path}'}
    if not os.path.isdir(SKILLS_DIR):
        SKILLS_DIR.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path, 'r') as z:
        names = z.namelist()
        md_entries = {Path(n).name: n for n in names
                      if n.startswith('skills/') and n.endswith('.md') and '/' not in Path(n).name}
        if not md_entries:
            return {'error': '技能包中未找到 skills/*.md，不是有效的技能库包'}
        state = {'disabled': []}
        if 'skills_state.json' in names:
            try:
                loaded = json.loads(z.read('skills_state.json').decode('utf-8'))
                if isinstance(loaded, dict):
                    state = loaded
            except Exception:
                state = {'disabled': []}
        disabled = set(state.get('disabled') or [])

        # 5.0.3-503-b: 技能级元数据（v2；v1 旧包无 metadata 字段/文件，兼容跳过）
        meta_entries = {
            Path(n).stem.rsplit('.', 1)[0]: n
            for n in names
            if n.startswith('skills/') and n.endswith('.metadata.json') and '/' not in Path(n).name
        }

        imported = 0
        skipped = 0
        for fname, entry in md_entries.items():
            safe_name = fname.lower().replace(' ', '-').replace('/', '-')
            md_key = safe_name[:-3] if safe_name.endswith('.md') else safe_name
            target = SKILLS_DIR / safe_name
            if target.exists() and not overwrite:
                skipped += 1
                continue
            target.write_text(z.read(entry).decode('utf-8'), encoding='utf-8')
            # 伴生元数据（存在则一并写入；键以技能名不含 .md 为准）
            meta_entry = meta_entries.get(md_key)
            if meta_entry:
                try:
                    meta_data = json.loads(z.read(meta_entry).decode('utf-8'))
                    (SKILLS_DIR / f"{md_key}.metadata.json").write_text(
                        json.dumps(meta_data, ensure_ascii=False, indent=2), encoding='utf-8')
                except Exception:
                    pass
            imported += 1

    # 合并状态：导入包的禁用列表仅对导入技能生效；持久化并 reload（失效 prompt 缓存）
    from .engine import get_skills_engine
    engine = get_skills_engine()
    for skill in engine.skills.values():
        if skill.name in disabled:
            skill.enabled = False
    engine._save_state()
    engine.reload()
    return {'ok': True, 'imported': imported, 'skipped': skipped}
