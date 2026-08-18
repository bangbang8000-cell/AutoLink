"""AIDC 项目化测试（P1 A-3/A-5/A-7）：backend/aidc_project.py。

覆盖：
  - create：目录结构 / mint projectId / project_config aidc_macro / v1 快照
  - save：无变更不升版；变更升版 + plan_history 快照；projectId 稳定
  - load / list
  - 重复创建报错
"""
import json
import os

from aidc_project import (create_aidc_project, list_aidc_projects,
                          load_aidc_project, save_aidc_project)

MACRO = {'gpu_count': 64, 'site': 'BJ01', 'pfc_queue': 3, 'cnp_queue': 6}


class TestCreate:
    def test_create_structure(self, tmp_path):
        d = str(tmp_path / 'proj')
        r = create_aidc_project(d, 'H3C-64台-BJ01', MACRO)
        assert r['ok'] and r['planVersion'] == 1 and r['projectId']
        assert os.path.exists(os.path.join(d, 'plan.json'))
        assert os.path.exists(os.path.join(d, 'project.json'))
        assert os.path.exists(os.path.join(d, 'plan_history', 'v1.plan.json'))
        assert os.path.isdir(os.path.join(d, 'output'))
        cfg = json.load(open(os.path.join(d, 'project_config.json'), encoding='utf-8'))
        assert cfg['aidc_macro']['gpuCount'] == 64  # aidc_macro 段承载完整宏观
        assert cfg['topology']['num_gpu_servers'] == 64
        plan = json.load(open(os.path.join(d, 'plan.json'), encoding='utf-8'))
        assert plan['meta']['planVersion'] == 1
        assert plan['meta']['projectId'] == r['projectId']

    def test_create_duplicate_errors(self, tmp_path):
        d = str(tmp_path / 'proj')
        create_aidc_project(d, 'p', MACRO)
        r = create_aidc_project(d, 'p', MACRO)
        assert '已存在' in r['error']

    def test_create_missing_name_errors(self, tmp_path):
        r = create_aidc_project(str(tmp_path / 'x'), '', MACRO)
        assert '缺项目名' in r['error']

    def test_create_invalid_scale_errors(self, tmp_path):
        r = create_aidc_project(str(tmp_path / 'x'), 'p', {'gpu_count': 96})
        assert 'error' in r


class TestSaveVersion:
    def test_save_no_change_keeps_version(self, tmp_path):
        d = str(tmp_path / 'proj')
        create_aidc_project(d, 'p', MACRO)
        r = save_aidc_project(d, MACRO)
        assert r['ok'] and r['changed'] is False and r['planVersion'] == 1
        assert os.path.exists(os.path.join(d, 'plan_history', 'v1.plan.json'))
        assert not os.path.exists(os.path.join(d, 'plan_history', 'v2.plan.json'))

    def test_save_change_bumps_version_and_snapshot(self, tmp_path):
        d = str(tmp_path / 'proj')
        create_aidc_project(d, 'p', MACRO)
        r = save_aidc_project(d, {**MACRO, 'pfc_queue': 4})
        assert r['ok'] and r['changed'] is True and r['planVersion'] == 2
        assert os.path.exists(os.path.join(d, 'plan_history', 'v2.plan.json'))
        plan = json.load(open(os.path.join(d, 'plan.json'), encoding='utf-8'))
        assert plan['meta']['planVersion'] == 2
        assert plan['macro']['pfcQueue'] == 4

    def test_project_id_stable_across_saves(self, tmp_path):
        d = str(tmp_path / 'proj')
        c = create_aidc_project(d, 'p', MACRO)
        s = save_aidc_project(d, {**MACRO, 'pfc_queue': 5})
        assert s['projectId'] == c['projectId']

    def test_plan_hash_version_driven(self, tmp_path):
        """同一 macro（同 planHash）重存不升版；改参数升版。"""
        d = str(tmp_path / 'proj')
        create_aidc_project(d, 'p', MACRO)
        assert save_aidc_project(d, MACRO)['planVersion'] == 1
        assert save_aidc_project(d, {**MACRO, 'cnp_queue': 7})['planVersion'] == 2


class TestLoadList:
    def test_load_returns_meta_macro_history(self, tmp_path):
        d = str(tmp_path / 'proj')
        create_aidc_project(d, 'H3C-64台-BJ01', MACRO)
        save_aidc_project(d, {**MACRO, 'pfc_queue': 4})
        ld = load_aidc_project(d)
        assert ld['ok'] and ld['name'] == 'H3C-64台-BJ01'
        assert ld['projectId']
        assert ld['macro']['gpuCount'] == 64
        assert ld['plan']['meta']['planVersion'] == 2
        assert [h['version'] for h in ld['history']] == [1, 2]

    def test_load_missing_plan_errors(self, tmp_path):
        d = str(tmp_path / 'proj')
        os.makedirs(d)
        r = load_aidc_project(d)
        assert '缺少 plan.json' in r['error']

    def test_load_rebase_template_derived_identity(self, tmp_path):
        """模板派生项目（project.json 无 projectId）→ 打开时 mint 本项目新身份，不沿用源 projectId。"""
        d = str(tmp_path / 'proj')
        create_aidc_project(d, 'p', MACRO)
        src_pid = json.load(open(os.path.join(d, 'project.json'), encoding='utf-8'))['projectId']
        # 模拟模板派生：project.json 去掉 projectId（plan.json 仍带源 projectId）
        meta = json.load(open(os.path.join(d, 'project.json'), encoding='utf-8'))
        meta.pop('projectId')
        json.dump(meta, open(os.path.join(d, 'project.json'), 'w', encoding='utf-8'), ensure_ascii=False)
        ld = load_aidc_project(d)
        assert ld['ok']
        assert ld['projectId'] != src_pid  # 新身份
        new_meta = json.load(open(os.path.join(d, 'project.json'), encoding='utf-8'))
        assert new_meta['projectId'] == ld['projectId']  # 已落盘
        plan = json.load(open(os.path.join(d, 'plan.json'), encoding='utf-8'))
        assert plan['meta']['projectId'] == ld['projectId']  # plan 同步本项目身份

    def test_load_regenerate_from_aidc_macro(self, tmp_path):
        """plan.json 缺失但 project_config.json 有 aidc_macro → 打开时确定性再生。"""
        d = str(tmp_path / 'proj')
        create_aidc_project(d, 'p', MACRO)
        os.remove(os.path.join(d, 'plan.json'))
        ld = load_aidc_project(d)
        assert ld['ok'] and ld['macro']['gpuCount'] == 64
        assert os.path.exists(os.path.join(d, 'plan.json'))  # 再生落盘

    def test_list_finds_aidc_projects(self, tmp_path):
        ws = tmp_path / 'ws'
        ws.mkdir()
        d = str(ws / 'proj')
        create_aidc_project(d, 'p', MACRO)
        ls = list_aidc_projects(str(ws))
        assert ls['ok']
        assert any(p['name'] == 'proj' and p['planVersion'] == 1 for p in ls['projects'])

    def test_list_ignores_non_plan_dirs(self, tmp_path):
        ws = tmp_path / 'ws'
        (ws / 'normal').mkdir(parents=True)
        (ws / 'normal' / 'project_config.json').write_text('{}', encoding='utf-8')
        ls = list_aidc_projects(str(ws))
        assert ls['projects'] == []
