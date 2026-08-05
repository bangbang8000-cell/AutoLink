"""V3.1.3-T7-1: 对话管理域只读查询测试

覆盖：device:list（分类/关键词过滤）/ template:list / template:view /
project:list / project:info（临时工作区隔离）/ project:generate（需求生成预览）。
"""
import json
import os

import pytest

from manage import (
    list_devices, list_templates, view_template,
    list_projects, project_info, generate_project,
)


# ============================================================
# 设备库（device:list）
# ============================================================

class TestDeviceList:
    def test_list_devices_returns_summary(self):
        result = list_devices()
        assert 'devices' in result
        assert result['total'] >= 1
        dev = result['devices'][0]
        assert 'id' in dev and 'vendor' in dev and 'model' in dev

    def test_list_devices_filter_by_query(self):
        result = list_devices(query='H100')
        assert result['total'] >= 1
        for d in result['devices']:
            hay = f"{d['vendor']} {d['model']} {d['description']}".lower()
            assert 'h100' in hay

    def test_list_devices_filter_by_category(self):
        result = list_devices(category='switches')
        assert result['total'] >= 1
        for d in result['devices']:
            assert d['category'].startswith('switches')

    def test_list_devices_limit(self):
        result = list_devices(limit=3)
        assert len(result['devices']) == 3
        assert result['total'] == 3


# ============================================================
# 模板（template:list / template:view）
# ============================================================

class TestTemplateList:
    def test_list_templates_has_builtin(self):
        result = list_templates()
        assert result['total'] >= 10
        ids = [t['id'] for t in result['templates']]
        assert 'DP3Tier-1024' in ids
        # 摘要字段
        dp = next(t for t in result['templates'] if t['id'] == 'DP3Tier-1024')
        assert dp['summary']['num_gpu_servers'] is not None
        assert dp['source'] == 'builtin'

    def test_view_template_ok(self):
        result = view_template('DP3Tier-1024')
        assert result['success'] is True
        assert result['template']['source'] == 'builtin'
        assert 'topology' in result['template']['config']

    def test_view_template_missing(self):
        result = view_template('no-such-template')
        assert result['success'] is False
        assert '不存在' in result['error']


# ============================================================
# 项目（project:list / project:info）—— 临时工作区隔离
# ============================================================

class TestProjectList:
    @pytest.fixture
    def workspace(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        proj = os.path.join(str(tmp_path), 'workspace', '测试项目A')
        os.makedirs(proj, exist_ok=True)
        with open(os.path.join(proj, 'project.json'), 'w', encoding='utf-8') as f:
            json.dump({'name': '测试项目A', 'description': 'desc',
                       'createdAt': '2026-08-05', 'updatedAt': '2026-08-05'}, f, ensure_ascii=False)
        cfg = {'meta': {'name': '测试项目A'},
               'networks': {'param_network': True},
               'topology': {'num_gpu_servers': 8, 'param_protocol': 'IB'}}
        with open(os.path.join(proj, 'project_config.json'), 'w', encoding='utf-8') as f:
            json.dump(cfg, f, ensure_ascii=False)
        return tmp_path

    def test_list_projects(self, workspace):
        result = list_projects()
        assert result['total'] == 1
        proj = result['projects'][0]
        assert proj['name'] == '测试项目A'
        assert proj['has_config'] is True
        assert proj['has_ini'] is False

    def test_project_info(self, workspace):
        result = project_info('测试项目A')
        assert result['success'] is True
        assert result['project']['has_config'] is True
        assert result['project']['config']['topology']['num_gpu_servers'] == 8

    def test_project_info_missing(self, workspace):
        result = project_info('不存在')
        assert result['success'] is False
        assert '不存在' in result['error']

    def test_empty_workspace(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        result = list_projects()
        assert result['total'] == 0


# ============================================================
# 需求生成（project:generate，V3.1.3-T7-2）—— 只预览不落盘
# ============================================================

class TestGenerateProject:
    def test_generate_minimal_config(self):
        result = generate_project(name='B300集群', config={
            'topology': {'num_gpu_servers': 1024, 'param_protocol': 'IB', 'param_speed': '800G'},
        })
        assert result['success'] is True
        cfg = result['config']
        # name 参数生效
        assert cfg['meta']['name'] == 'B300集群'
        # 缺失键默认补全
        assert cfg['topology']['num_gpu_servers'] == 1024
        assert cfg['topology']['num_compute_servers'] >= 0
        assert cfg['networks']['param_network'] is True
        assert cfg['rack_config']['rack_type'] is not None
        # 校验通过（宽松）：无 error，低完整度仅 warning
        assert not any(i['severity'] == 'error' for i in result['validationIssues'])

    def test_generate_missing_fields_annotated(self):
        result = generate_project(name='P', config={'topology': {'num_gpu_servers': 8}})
        ann = result['annotations']
        assert ann['confidence'] < 1.0
        assert 'topology.param_protocol' in ann['missingFields']
        assert 'rack_config.rack_type' in ann['missingFields']
        # 低完整度给出 warning
        assert any(i['severity'] == 'warning' for i in result['validationIssues'])

    def test_generate_complete_high_confidence(self):
        cfg = {
            'meta': {'name': '完整项目', 'description': 'd'},
            'networks': {'param_network': True, 'storage_network': True,
                         'biz_network': False, 'oob_network': True},
            'topology': {'num_gpu_servers': 128, 'num_all_flash_storage': 8,
                         'num_hybrid_flash_storage': 4, 'num_compute_servers': 16,
                         'param_protocol': 'RoCE', 'param_speed': '400G', 'storage_speed': '200G',
                         'param_ports_per_server': 8, 'storage_ports_per_server': 1,
                         'param_switch_ports': 64, 'storage_switch_ports': 40,
                         'downlink_mode': 'full'},
            'rack_config': {'rack_type': 42, 'power_limit_per_rack': 6000, 'naming_prefix': '机柜'},
            'device_refs': {},
        }
        result = generate_project(name='完整项目', config=cfg)
        assert result['success'] is True
        assert result['annotations']['confidence'] == 1.0
        assert result['annotations']['missingFields'] == []

    def test_generate_empty_config_error(self):
        result = generate_project(name='X', config={})
        assert result['success'] is False
        assert 'config' in result['error']

    def test_generate_invalid_enum_issue(self):
        result = generate_project(name='X', config={'topology': {'param_protocol': 'FOO'}})
        assert result['success'] is True
        assert any(i['severity'] == 'error' for i in result['validationIssues'])
