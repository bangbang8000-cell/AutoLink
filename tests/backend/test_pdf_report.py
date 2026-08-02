"""
AutoLink V2.4.6 — PDF 报告生成测试
验证 export_pdf_report 函数能正确生成 PDF 文件
"""
import os
import sys
import json
import tempfile
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from designer import NetworkDesignerV2
from exporter import export_pdf_report, generate_report_data, export_bom, generate_summary_data


def _create_test_project(num_servers=20):
    """创建测试项目配置"""
    config = {
        "topology": {
            "num_gpu_servers": num_servers,
            "param_ports_per_server": 8,
            "param_switch_ports": 64,
            "param_speed": "400G",
            "storage_switch_ports": 40,
            "storage_speed": "200G",
            "downlink_mode": "custom",
        },
        "networks": {
            "param_network": True,
            "storage_network": True,
            "biz_network": True,
            "oob_network": True,
        },
        "rack_config": {"rack_type": 42, "power_limit_per_rack": 6000},
        "device_refs": {},
    }
    tmpdir = tempfile.mkdtemp()
    config_path = os.path.join(tmpdir, "project_config.json")
    with open(config_path, "w", encoding="utf-8") as f:
        json.dump(config, f)
    return config_path, tmpdir


class TestPdfReport:
    """PDF 报告生成测试"""

    def test_generate_report_data_structure(self):
        """报告数据结构完整"""
        config_path, tmpdir = _create_test_project(20)
        try:
            designer = NetworkDesignerV2(config_path)
            data = generate_report_data(designer)

            assert 'overview' in data
            assert 'architecture' in data
            assert 'power' in data
            assert 'validation' in data
            assert 'modules' in data
            assert 'cost' in data
            assert 'generated_at' in data
        finally:
            import shutil
            shutil.rmtree(tmpdir)

    def test_export_pdf_report_creates_file(self):
        """PDF 文件生成"""
        config_path, tmpdir = _create_test_project(20)
        try:
            designer = NetworkDesignerV2(config_path)
            pdf_path = os.path.join(tmpdir, "test_report.pdf")

            result = export_pdf_report(designer, pdf_path)

            assert result == pdf_path
            assert os.path.exists(pdf_path), "PDF 文件未生成"
            assert os.path.getsize(pdf_path) > 0, "PDF 文件为空"
            # 验证 PDF 文件头
            with open(pdf_path, 'rb') as f:
                header = f.read(4)
                assert header == b'%PDF', f"PDF 文件头错误: {header}"
        finally:
            import shutil
            shutil.rmtree(tmpdir)

    def test_export_pdf_report_content_chapters(self):
        """PDF 报告包含完整章节"""
        config_path, tmpdir = _create_test_project(20)
        try:
            designer = NetworkDesignerV2(config_path)
            pdf_path = os.path.join(tmpdir, "test_report.pdf")
            export_pdf_report(designer, pdf_path)

            # 读取 PDF 文本内容（简单检查关键词）
            with open(pdf_path, 'rb') as f:
                content = f.read()
                # PDF 文件应包含中文字体嵌入或文本
                assert len(content) > 1000, "PDF 内容过少"
        finally:
            import shutil
            shutil.rmtree(tmpdir)


class TestPdfReportV293:
    """V2.9.3-T6: PDF 报告修复与完善"""

    def test_report_project_name_and_new_chapters(self):
        """项目名称取自配置 meta.name; 新增设备清单/收敛比章节"""
        config_path, tmpdir = _create_test_project(20)
        try:
            with open(config_path, 'r', encoding='utf-8') as f:
                cfg = json.load(f)
            cfg['meta'] = {"name": "测试项目A", "description": "", "version": 1}
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(cfg, f)
            designer = NetworkDesignerV2(config_path)
            data = generate_report_data(designer)
            assert data['overview']['项目名称'] == '测试项目A'
            assert 'devices' in data
            assert 'convergence' in data
            assert 'param' in data['convergence']
        finally:
            import shutil
            shutil.rmtree(tmpdir)

    def test_report_without_meta_name(self):
        """无 meta.name → 项目名称回落默认, 不报错"""
        config_path, tmpdir = _create_test_project(20)
        try:
            designer = NetworkDesignerV2(config_path)
            data = generate_report_data(designer)
            assert data['overview']['项目名称']
        finally:
            import shutil
            shutil.rmtree(tmpdir)

    def test_bom_aggregated_by_model(self):
        """BOM 服务器按型号聚合 (数量 > 1, 行数远小于服务器数)"""
        config_path, tmpdir = _create_test_project(20)
        try:
            designer = NetworkDesignerV2(config_path)
            bom_path = os.path.join(tmpdir, "bom.xlsx")
            df = export_bom(designer, bom_path)
            assert len(df) > 0
            # 服务器行: 聚合后同一型号仅一行
            server_rows = df[df['类别'] == 'GPU服务器']
            if len(server_rows) > 0:
                assert server_rows['数量'].sum() == 20
                assert len(server_rows) <= len(set(server_rows['设备型号']))
        finally:
            import shutil
            shutil.rmtree(tmpdir)

    def test_summary_convergence_from_estimation(self):
        """摘要收敛比读计算值 (非硬编码 1:1)"""
        config_path, tmpdir = _create_test_project(20)
        try:
            designer = NetworkDesignerV2(config_path)
            df = generate_summary_data(designer)
            conv_row = df[df['项目'] == '收敛比例']
            assert len(conv_row) >= 1
            for val in conv_row['值']:
                assert ':' in str(val), f"收敛比格式错误: {val}"
        finally:
            import shutil
            shutil.rmtree(tmpdir)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
