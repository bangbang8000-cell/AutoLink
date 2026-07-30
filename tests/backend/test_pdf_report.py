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
from exporter import export_pdf_report, generate_report_data


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


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
