"""AIDC 规划器 plan:table 契约 v1.1 测试（G0：桥接标识 + camelCase + 补齐字段）。

覆盖 backend/aidc_planner.py：
  - plan_aidc 输出符合契约 v1.1（meta 桥接标识 / macro camelCase / topology / protocols.ospf）
  - deviceList 逐设备含 rack
  - 规模映射（64 台 = 22 设备）与非法档位报错
  - validate_macro 兼容 camelCase/snake_case 输入
"""
import io
import json

import pytest

from aidc_planner import DEFAULTS, SCN_ABBR, _SCALE, export_plan, plan_aidc, validate_macro


class TestPlanAidcContract:
    def test_bridge_meta(self):
        plan = plan_aidc({'gpu_count': 64})
        meta = plan['meta']
        assert meta['source'] == 'autolink'
        assert meta['projectType'] == 'aidc'
        assert meta['bridgeVersion'] == '1.0'
        assert meta['schema'] == 'plan:table/1.1'
        assert meta['version'] == '1.1'
        assert meta['generatedAt']
        assert meta['project'] == 'aidc_64'

    def test_macro_camelcase(self):
        plan = plan_aidc({'gpu_count': 64})
        m = plan['macro']
        assert m['gpuCount'] == 64
        assert m['pfcQueue'] == 3 and m['cnpQueue'] == 6 and m['bgpMaxPaths'] == 16
        assert m['naming']['abbr'] == SCN_ABBR
        assert set(m['ipSegments']) == {'loopback', 'compute', 'storage', 'biz', 'oob', 'interconnect'}
        assert m['ospf'] == {'process': 10, 'area': '0.0.0.0'}
        assert m['asRange'] == [65001, 65500]
        assert 'deviceModels' in m and 'vlanRanges' in m
        # 无 snake_case 残留
        assert 'pfc_queue' not in m and 'gpu_count' not in m

    def test_topology_and_protocols(self):
        plan = plan_aidc({'gpu_count': 64})
        assert plan['topology']['layers'] == 2
        assert plan['topology']['spines'] == 2 and plan['topology']['leaves'] == 8
        assert plan['protocols']['ospf']['process'] == 10
        assert plan['protocols']['bgp']['ecmp'] == 16

    def test_device_list_has_rack(self):
        plan = plan_aidc({'gpu_count': 64})
        assert len(plan['deviceList']) == 22
        for d in plan['deviceList']:
            assert d['name'] and 'rack' in d
            assert d['rack'] == int(d['name'].split('-R', 1)[1].split('-', 1)[0])

    def test_scale_mapping(self):
        for gpu, (spine, leaf) in ((32, (2, 4)), (64, (2, 8)), (1024, (8, 32))):
            plan = plan_aidc({'gpu_count': gpu})
            assert plan['topology']['spines'] == spine
            assert plan['topology']['leaves'] == leaf

    def test_unsupported_scale_errors(self):
        plan = plan_aidc({'gpu_count': 96})
        assert 'error' in plan
        assert '不在支持档位' in plan['error']

    def test_validate_macro_accepts_camelcase(self):
        assert validate_macro({'gpuCount': 64}) is None
        assert validate_macro({'gpuCount': 96}) is not None

    def test_output_serializable(self):
        plan = plan_aidc({'gpu_count': 64})
        json.dumps(plan)  # 可序列化（供 CLI/GUI 输出）


class TestExport:
    """REQ-A3（G2）：plan:table 导出 json/excel + design:from-gpus 后端 action。"""

    def test_export_json(self, tmp_path):
        path = export_plan({'gpu_count': 64}, str(tmp_path / 'p.json'), 'json')
        data = json.load(io.open(path, encoding='utf-8'))
        assert data['meta']['projectType'] == 'aidc'
        assert len(data['deviceList']) == 22

    def test_export_excel(self, tmp_path):
        from openpyxl import load_workbook
        path = export_plan({'gpu_count': 64}, str(tmp_path / 'p'), 'excel')
        assert path.endswith('.xlsx')
        wb = load_workbook(path)
        for sheet in ('设备清单', '接线', '终端', '宏观参数', '协议', '收敛比'):
            assert sheet in wb.sheetnames

    def test_export_invalid_scale_raises(self):
        with pytest.raises(ValueError):
            export_plan({'gpu_count': 96}, 'x.json', 'json')

    def test_design_from_gpus_action(self):
        from cli import execute
        out = execute('design:from-gpus', {'gpu_count': 64})
        assert out['meta']['projectType'] == 'aidc'
        assert len(out['deviceList']) == 22
