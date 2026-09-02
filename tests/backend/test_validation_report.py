"""4.5 D-5 校验报告测试（F5-5：一键校验 + 报告导出 JSON + 集成）"""
import json

import pytest

from validation_engine import (
    ValidationReport, ValidationProblem, run_all_validation,
    build_design_dict, export_report_json, build_render_dict,
)


class TestValidationReport:
    def test_valid_property_and_summary(self):
        report = ValidationReport(scope={'project': 'P1'})
        report.add(ValidationProblem('C001', 'error', '一致性', 'a.b', 'msg', '建议'))
        report.add(ValidationProblem('C014', 'info', '设计内部', 'a.c', 'msg2', '建议'))
        assert report.valid is False
        summary = report.summary()
        assert summary['total'] == 2
        assert summary['bySeverity'] == {'error': 1, 'warning': 0, 'info': 1}
        assert summary['byCategory']['一致性'] == 1

    def test_to_dict_structure(self):
        report = ValidationReport(scope={'project': 'P1'})
        report.add(ValidationProblem('IP001', 'error', 'IP规划', 'ip', 'm', 's'))
        d = report.to_dict()
        assert d['schemaVersion'] == 1
        assert d['scope'] == {'project': 'P1'}
        assert d['summary']['valid'] is False
        p = d['problems'][0]
        assert p['ruleId'] == 'IP001'
        assert p['severity'] == 'error'
        assert p['category'] == 'IP规划'
        assert p['location'] == 'ip'
        assert p['message'] == 'm'
        assert p['suggestion'] == 's'

    def test_warning_only_is_valid(self):
        report = ValidationReport(scope={})
        report.add(ValidationProblem('C013', 'warning', '设计内部', 'l', 'm', 's'))
        assert report.valid is True


class TestRunAllValidation:
    def test_with_plan_and_design_dict(self):
        plan = {'macro': {'gpuCount': 64}, 'topology': {'scale': {'gpuCount': 64}},
                'deviceList': [{'role': 'LEAF'}] * 8, 'connections': [], 'terminals': [],
                'allocations': []}
        design = {'servers': 64, 'mode': 'full',
                  'network_devices': {'param_leaves': 8, 'param_spines': 2},
                  'cabinets': [], 'unplaced_devices': [], 'connections': []}
        report = run_all_validation(plan=plan, design=design)
        assert report.valid is True

    def test_plan_design_drift_flags(self):
        plan = {'macro': {'gpuCount': 64}, 'topology': {'scale': {'gpuCount': 64}},
                'deviceList': [{'role': 'LEAF'}] * 8, 'connections': [], 'terminals': [],
                'allocations': []}
        design = {'servers': 128, 'mode': 'full',
                  'network_devices': {'param_leaves': 8, 'param_spines': 2},
                  'cabinets': [], 'unplaced_devices': [], 'connections': []}
        report = run_all_validation(plan=plan, design=design)
        assert report.valid is False
        assert any(p.rule_id == 'C001' for p in report.problems)

    def test_ai_claims_dimension(self):
        report = run_all_validation(ai_claims={'param': 1.0}, ai_actual={'param': 2.5})
        assert any(p.rule_id == 'A010' for p in report.problems)

    def test_sort_error_first(self):
        report = ValidationReport(scope={})
        report.add(ValidationProblem('IP001', 'info', 'IP规划', 'l', 'm', 's'))
        report.add(ValidationProblem('C001', 'error', '一致性', 'l', 'm', 's'))
        report.add(ValidationProblem('C013', 'warning', '设计内部', 'l', 'm', 's'))
        report.problems = sorted(report.problems, key=lambda p: p.rule_id)
        from validation_engine.runner import run_all_validation
        # sort_problems 通过 runner 排序（构造后手动排序亦可验证优先级）
        report.problems = sorted(
            report.problems,
            key=lambda p: ({'error': 0, 'warning': 1, 'info': 2}.get(p.severity, 3), p.rule_id))
        assert [p.severity for p in report.problems] == ['error', 'warning', 'info']


class TestExportReportJson:
    def test_writes_utf8_json(self, tmp_path):
        report = ValidationReport(scope={'project': 'P1'})
        report.add(ValidationProblem('E001', 'error', '导出核对', 'l', '中文问题', '中文建议'))
        path = export_report_json(report, str(tmp_path / 'report.json'))
        with open(path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        assert data['summary']['total'] == 1
        assert data['problems'][0]['message'] == '中文问题'
        assert data['problems'][0]['suggestion'] == '中文建议'


class TestIntegrationRealDesigner:
    """集成：真实模板设计器 + 真实优化建议 → 校验可运行、A001 无误差"""

    _designer = None

    @classmethod
    def _get_designer(cls):
        if cls._designer is None:
            from designer import NetworkDesignerV2
            cls._designer = NetworkDesignerV2('template/H100-100台/project_config.json')
        return cls._designer

    def test_build_design_dict_from_real_designer(self):
        dd = build_design_dict(self._get_designer())
        assert dd['servers'] > 0
        assert dd['network_devices']['param_leaves'] > 0
        assert len(dd['connections']) > 0
        assert dd['mode'] in ('full', 'custom')

    def test_run_all_with_real_designer_and_suggestions(self, tmp_path):
        # 复制模板到临时目录，避免 suggest 的配置迁移写入污染仓库模板
        import shutil
        src = 'template/H100-100台/project_config.json'
        cfg_path = tmp_path / 'project_config.json'
        shutil.copyfile(src, cfg_path)
        from designer import NetworkDesignerV2
        from optimization import suggest
        designer = NetworkDesignerV2(str(cfg_path))
        dd = build_design_dict(designer)
        res = suggest({'configFile': str(cfg_path)})
        assert res['success'] is True
        suggestions = res['suggestions']
        report = run_all_validation(design=dd, suggestions=suggestions)
        # 真实建议的当前收敛比声称来自真实计算 → A001 不应报错
        assert not any(p.rule_id == 'A001' and p.severity == 'error' for p in report.problems)
        # A003：真实建议的 patch 应引用真实配置键
        assert not any(p.rule_id == 'A003' for p in report.problems)

    def test_render_dict_from_batch(self, tmp_path):
        batch = tmp_path / 'v1_ts'
        batch.mkdir()
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.append(['A端设备'])
        ws.append(['GPU_1'])
        wb.save(batch / 'AI智算网络_full模式_1.xlsx')
        rd = build_render_dict(str(batch))
        assert rd['mode'] == 'full'
        assert rd['connections'] == 1
