"""48-c（F8-3）：技能库文件级导入导出（跨端可移植）测试

覆盖 backend/autolink_hub/skills/portable.py：
  - export_skills_package：打包 skills/*.md + skills_state.json + manifest.json（契约与前端一致）
  - import_skills_package：解包安装（默认合并保留目标端同名，overwrite 覆盖）+ 状态合并
  - engine.py action 层开放（skills:list / skills:export / skills:import）
"""
import zipfile

from autolink_hub.skills import engine as skills_engine
from autolink_hub.skills import portable as skills_portable


def _isolate(tmp_path, monkeypatch):
    """把 SKILLS_DIR 重定向到临时目录并重置引擎单例，避免污染真实技能库。"""
    fake = tmp_path / 'skills'
    fake.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(skills_engine, 'SKILLS_DIR', fake)
    monkeypatch.setattr(skills_portable, 'SKILLS_DIR', fake)
    monkeypatch.setattr(skills_engine, '_engine', None)
    monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path / 'ud'))
    return fake


def _write_pkg(zip_path, skills, disabled=(), schema_version=1):
    """构造可移植技能包 zip（缺省 v1 旧包，验证版本兼容读旧包）。"""
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('manifest.json', __import__('json').dumps({
            'format': 'autolink-skills', 'schemaVersion': schema_version,
            'exportedAt': '2026-01-01T00:00:00', 'skills': skills,
        }, ensure_ascii=False))
        for s in skills:
            z.writestr(f"skills/{s['name']}.md", s['content'])
        z.writestr('skills_state.json', __import__('json').dumps({'disabled': list(disabled)}, ensure_ascii=False))


class TestSkillsPortable:
    def test_export_packages_md_and_manifest(self, tmp_path, monkeypatch):
        fake = _isolate(tmp_path, monkeypatch)
        (fake / 'alpha.md').write_text('# Alpha 技能', encoding='utf-8')
        (fake / 'beta.md').write_text('# Beta 技能', encoding='utf-8')
        out = tmp_path / 'skills_export.zip'
        r = skills_portable.export_skills_package(str(out))
        assert r['ok'] is True and r['count'] == 2
        assert out.exists()
        with zipfile.ZipFile(out) as z:
            names = set(z.namelist())
            assert {'manifest.json', 'skills_state.json', 'skills/alpha.md', 'skills/beta.md'} <= names
            manifest = __import__('json').loads(z.read('manifest.json').decode('utf-8'))
            assert manifest['format'] == 'autolink-skills'
            assert manifest['schemaVersion'] == 2
            assert {s['name'] for s in manifest['skills']} == {'alpha', 'beta'}
            assert z.read('skills/alpha.md').decode('utf-8') == '# Alpha 技能'

    def test_export_includes_skill_metadata(self, tmp_path, monkeypatch):
        """5.0.3-503-b：导出含技能级元数据（skills/<name>.metadata.json + manifest.metadata）"""
        fake = _isolate(tmp_path, monkeypatch)
        (fake / 'alpha.md').write_text('# Alpha 技能', encoding='utf-8')
        (fake / 'alpha.metadata.json').write_text(
            __import__('json').dumps({'name': 'alpha', 'learning_records': [{'ts': '2026-01-01T00:00:00', 'reason': '自学习触发'}]}),
            encoding='utf-8',
        )
        out = tmp_path / 'skills_meta_export.zip'
        r = skills_portable.export_skills_package(str(out))
        assert r['ok'] is True and r['metadata_count'] == 1
        with zipfile.ZipFile(out) as z:
            assert 'skills/alpha.metadata.json' in set(z.namelist())
            manifest = __import__('json').loads(z.read('manifest.json').decode('utf-8'))
            assert manifest['metadata']['alpha']['learning_records'][0]['reason'] == '自学习触发'

    def test_import_restores_metadata(self, tmp_path, monkeypatch):
        """5.0.3-503-b：导入还原技能级元数据（v2 包）"""
        fake = _isolate(tmp_path, monkeypatch)
        pkg = tmp_path / 'pkg_meta.zip'
        with zipfile.ZipFile(pkg, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr('manifest.json', __import__('json').dumps({
                'format': 'autolink-skills', 'schemaVersion': 2,
                'exportedAt': '2026-01-01T00:00:00',
                'skills': [{'name': 'meta-skill', 'enabled': True}],
                'metadata': {'meta-skill': {'optimized_count': 1}},
            }, ensure_ascii=False))
            z.writestr('skills/meta-skill.md', '# Meta 技能')
            z.writestr('skills/meta-skill.metadata.json',
                       __import__('json').dumps({'optimized_count': 1}))
            z.writestr('skills_state.json', '{"disabled": []}')
        r = skills_portable.import_skills_package(str(pkg))
        assert r['ok'] is True and r['imported'] == 1
        assert (fake / 'meta-skill.metadata.json').exists()
        engine = skills_engine.get_skills_engine()
        assert engine.get_skill('meta-skill').metadata.get('optimized_count') == 1

    def test_import_v1_legacy_package(self, tmp_path, monkeypatch):
        """5.0.3-503-b：schemaVersion=1 旧包仍可正常导入（版本兼容读旧包）"""
        fake = _isolate(tmp_path, monkeypatch)
        pkg = tmp_path / 'legacy.zip'
        _write_pkg(pkg, [{'name': 'legacy-skill', 'content': '# 旧包技能'}], schema_version=1)
        r = skills_portable.import_skills_package(str(pkg))
        assert r['ok'] is True and r['imported'] == 1
        assert (fake / 'legacy-skill.md').exists()

    def test_import_installs_new_skills(self, tmp_path, monkeypatch):
        fake = _isolate(tmp_path, monkeypatch)
        pkg = tmp_path / 'pkg.zip'
        _write_pkg(pkg, [{'name': 'new-skill', 'content': '# 新技能\n正文'}], disabled=['new-skill'])
        r = skills_portable.import_skills_package(str(pkg), overwrite=False)
        assert r['ok'] is True and r['imported'] == 1 and r['skipped'] == 0
        assert (fake / 'new-skill.md').exists()
        assert (fake / 'new-skill.md').read_text(encoding='utf-8') == '# 新技能\n正文'
        # 引擎加载到新技能，且按状态合并禁用
        engine = skills_engine.get_skills_engine()
        assert engine.get_skill('new-skill') is not None
        assert engine.get_skill('new-skill').enabled is False

    def test_import_default_merge_keeps_existing(self, tmp_path, monkeypatch):
        fake = _isolate(tmp_path, monkeypatch)
        (fake / 'keep.md').write_text('本地内容', encoding='utf-8')
        pkg = tmp_path / 'pkg2.zip'
        _write_pkg(pkg, [{'name': 'keep', 'content': '包内内容'}, {'name': 'other', 'content': 'x'}])
        r = skills_portable.import_skills_package(str(pkg), overwrite=False)
        assert r['imported'] == 1 and r['skipped'] == 1
        assert (fake / 'keep.md').read_text(encoding='utf-8') == '本地内容'
        assert (fake / 'other.md').exists()

    def test_import_overwrite_replaces_existing(self, tmp_path, monkeypatch):
        fake = _isolate(tmp_path, monkeypatch)
        (fake / 'keep.md').write_text('本地内容', encoding='utf-8')
        pkg = tmp_path / 'pkg3.zip'
        _write_pkg(pkg, [{'name': 'keep', 'content': '包内内容'}])
        r = skills_portable.import_skills_package(str(pkg), overwrite=True)
        assert r['imported'] == 1
        assert (fake / 'keep.md').read_text(encoding='utf-8') == '包内内容'

    def test_import_rejects_non_skill_package(self, tmp_path, monkeypatch):
        _isolate(tmp_path, monkeypatch)
        pkg = tmp_path / 'bad.zip'
        with zipfile.ZipFile(pkg, 'w') as z:
            z.writestr('readme.txt', 'not a skill pkg')
        r = skills_portable.import_skills_package(str(pkg))
        assert 'error' in r
        assert not (tmp_path / 'skills' / 'readme.md').exists()

    def test_import_missing_file(self, tmp_path, monkeypatch):
        _isolate(tmp_path, monkeypatch)
        r = skills_portable.import_skills_package(str(tmp_path / 'nope.zip'))
        assert 'error' in r

    def test_actions_via_cli(self, tmp_path, monkeypatch):
        """engine.py action 层开放（skills:list / skills:export / skills:import）。"""
        fake = _isolate(tmp_path, monkeypatch)
        (fake / 'act.md').write_text('# Act', encoding='utf-8')
        from cli import execute
        lst = execute('skills:list', {})
        assert lst['ok'] is True and any(s['name'] == 'act' for s in lst['skills'])
        out = tmp_path / 'act_export.zip'
        exp = execute('skills:export', {'filepath': str(out)})
        assert exp['ok'] is True and exp['count'] >= 1
        imp = execute('skills:import', {'zipPath': str(out)})
        assert imp['ok'] is True
