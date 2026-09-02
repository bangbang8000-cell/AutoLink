"""48-c（F8-3）：技能库文件级导入导出（打包 skills/*.md + 状态 → zip，跨端可移植）。

导出包结构（zip，与 src/utils/skillsPortable.ts manifest 契约一致）：
  manifest.json      {format:'autolink-skills', schemaVersion:1, exportedAt, skills:[{name,enabled}]}
  skills/<name>.md   技能正文（MC ai_hub/skills/skills/*.md 同格式，可互灌）
  skills_state.json  启用状态（disabled 列表，与引擎持久化一致）

导入：解包安装 *.md 到 SKILLS_DIR + 合并状态（默认保留目标端同名技能，overwrite 覆盖），
      完成后 reload 引擎使提示词缓存失效。
"""
import json
import os
import zipfile
from datetime import datetime
from pathlib import Path

from .engine import SKILLS_DIR

MANIFEST_FORMAT = 'autolink-skills'
MANIFEST_VERSION = 1


def list_skills_payload() -> dict:
    """技能清单（名称/启用/使用次数/最近使用），供前端技能库面板与 AI 工具共用。"""
    from .engine import get_skills_engine
    engine = get_skills_engine()
    return {'ok': True, 'skills': engine.list_skills()}


def export_skills_package(filepath: str) -> dict:
    """打包 skills/*.md + 状态 + manifest 到 zip，返回落盘路径。"""
    from .engine import get_skills_engine
    engine = get_skills_engine()
    skills = engine.list_skills()
    disabled = [s['name'] for s in skills if not s['enabled']]
    manifest = {
        'format': MANIFEST_FORMAT,
        'schemaVersion': MANIFEST_VERSION,
        'exportedAt': datetime.now().isoformat(timespec='seconds'),
        'skills': [{'name': s['name'], 'enabled': s['enabled']} for s in skills],
    }
    if not filepath.lower().endswith('.zip'):
        filepath += '.zip'
    with zipfile.ZipFile(filepath, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2))
        z.writestr('skills_state.json', json.dumps({'disabled': disabled}, ensure_ascii=False, indent=2))
        for skill in engine.skills.values():
            z.writestr(f"skills/{skill.name}.md", skill.content)
    return {'ok': True, 'path': filepath, 'count': len(skills)}


def import_skills_package(zip_path: str, overwrite: bool = False) -> dict:
    """解包安装技能（*.md → SKILLS_DIR）+ 合并状态；返回导入/跳过计数。"""
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

        imported = 0
        skipped = 0
        for fname, entry in md_entries.items():
            safe_name = fname.lower().replace(' ', '-').replace('/', '-')
            target = SKILLS_DIR / safe_name
            if target.exists() and not overwrite:
                skipped += 1
                continue
            target.write_text(z.read(entry).decode('utf-8'), encoding='utf-8')
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
