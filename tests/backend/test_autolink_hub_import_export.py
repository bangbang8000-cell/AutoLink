"""AI-4（M6c 补齐）: AI 对话内模板/项目「导入导出」工具回归测试

覆盖：template_export / template_import / project_export / project_import
（工具注册、模板导出产物结构、导入后模板可用、重名冲突、项目导出 zip 含 plan.json、
项目导入往返；AI 工具经 execute_tool 可调用）。
"""
import asyncio
import zipfile

import pytest

from autolink_hub.agent.tools import init_tools, get_tool_definitions, execute_tool


@pytest.fixture
def userdata(tmp_path, monkeypatch):
    monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
    return tmp_path


class TestImportExportTools:
    """AI-4: 模板/项目导入导出工具"""

    def test_import_export_tools_registered(self):
        init_tools()
        defs = {d['function']['name']: d['function'] for d in get_tool_definitions()}
        for expected in ('template_export', 'template_import', 'project_export', 'project_import'):
            assert expected in defs
        # 导入导出均为写操作（落盘）→ NOTIFY
        assert defs['template_export']['permission'] == 'notify'
        assert defs['template_import']['permission'] == 'notify'
        assert defs['project_export']['permission'] == 'notify'
        assert defs['project_import']['permission'] == 'notify'

    def test_template_export_manifest(self, userdata):
        """无 outputPath → 返回模板文件清单 + 内容（template.json / project_config.json）"""
        init_tools()
        r = asyncio.run(execute_tool('template_create', {
            'templateName': '导出模板', 'config': {'topology': {'num_gpu_servers': 8, 'param_protocol': 'IB'}}}))
        assert r['success'] is True and r['result']['success'] is True
        r = asyncio.run(execute_tool('template_export', {'name': '导出模板'}))
        assert r['success'] is True and r['result']['success'] is True
        res = r['result']
        paths = {f['path'] for f in res['files']}
        assert {'template.json', 'project_config.json'} <= paths
        proj = next(f for f in res['files'] if f['path'] == 'project_config.json')
        assert 'num_gpu_servers' in proj['content']

    def test_template_export_zip(self, userdata):
        """指定 outputPath → 打包为 zip（含 template.json / project_config.json）"""
        init_tools()
        r = asyncio.run(execute_tool('template_create', {
            'templateName': '导出模板zip', 'config': {'topology': {'num_gpu_servers': 4}}}))
        assert r['success'] is True and r['result']['success'] is True
        out_zip = userdata / 'tpl-export.zip'
        r = asyncio.run(execute_tool('template_export', {'name': '导出模板zip', 'outputPath': str(out_zip)}))
        assert r['success'] is True and r['result']['success'] is True
        assert r['result']['zipPath'] == str(out_zip)
        assert out_zip.exists()
        with zipfile.ZipFile(out_zip) as z:
            znames = set(z.namelist())
            assert 'template.json' in znames and 'project_config.json' in znames

    def test_template_import_roundtrip(self, userdata):
        """内置模板导出 zip → 导入为用户模板 → 模板可用"""
        init_tools()
        out_zip = userdata / 'dp3.zip'
        r = asyncio.run(execute_tool('template_export', {'name': 'DP3Tier-1024', 'outputPath': str(out_zip)}))
        assert r['success'] is True and r['result']['success'] is True
        assert out_zip.exists()
        r = asyncio.run(execute_tool('template_import', {'source': str(out_zip), 'name': '导入模板'}))
        assert r['success'] is True and r['result']['success'] is True
        assert r['result']['template'] == '导入模板'
        r = asyncio.run(execute_tool('template_view', {'name': '导入模板'}))
        assert r['success'] is True and r['result']['success'] is True
        assert r['result']['template']['source'] == 'user'
        assert r['result']['template']['config']['topology']['num_gpu_servers'] > 0

    def test_template_import_conflict(self, userdata):
        """重名导入默认拒绝，overwrite=true 可覆盖"""
        init_tools()
        r = asyncio.run(execute_tool('template_create', {
            'templateName': '同名模板', 'config': {'topology': {'num_gpu_servers': 4}}}))
        assert r['success'] is True and r['result']['success'] is True
        out_zip = userdata / 't.zip'
        r = asyncio.run(execute_tool('template_export', {'name': '同名模板', 'outputPath': str(out_zip)}))
        assert r['success'] is True and r['result']['success'] is True
        r = asyncio.run(execute_tool('template_import', {'source': str(out_zip), 'name': '同名模板'}))
        assert r['success'] is True and r['result']['success'] is False
        assert '已存在' in r['result']['error']
        r = asyncio.run(execute_tool('template_import',
                                     {'source': str(out_zip), 'name': '同名模板', 'overwrite': True}))
        assert r['success'] is True and r['result']['success'] is True

    def test_template_import_invalid_source(self, userdata):
        """非法 zip / 缺 template.json → 明确报错"""
        init_tools()
        r = asyncio.run(execute_tool('template_import', {'source': str(userdata / 'no-such.zip')}))
        assert r['success'] is True and r['result']['success'] is False
        bad = userdata / 'bad.zip'
        with zipfile.ZipFile(bad, 'w') as z:
            z.writestr('foo.txt', 'hi')
        r = asyncio.run(execute_tool('template_import', {'source': str(bad)}))
        assert r['success'] is True and r['result']['success'] is False
        assert 'template.json' in r['result']['error']

    def test_project_export_zip(self, userdata):
        """项目导出 zip：存在且含 plan.json / project.json / project_config.json"""
        init_tools()
        r = asyncio.run(execute_tool('project_create', {'projectName': '导出项目'}))
        assert r['success'] is True and r['result']['success'] is True
        assert r['result']['projectId']
        out_zip = userdata / 'proj-export.zip'
        r = asyncio.run(execute_tool('project_export', {'name': '导出项目', 'outputPath': str(out_zip)}))
        assert r['success'] is True and r['result']['success'] is True
        assert out_zip.exists()
        with zipfile.ZipFile(out_zip) as z:
            znames = set(z.namelist())
            assert 'plan.json' in znames
            assert 'project.json' in znames
            assert 'project_config.json' in znames

    def test_project_import_roundtrip(self, userdata):
        """项目导出 zip → 导入为新项目 → project_info 可用"""
        init_tools()
        r = asyncio.run(execute_tool('project_create', {'projectName': '源项目'}))
        assert r['success'] is True and r['result']['success'] is True
        out_zip = userdata / 'src.zip'
        r = asyncio.run(execute_tool('project_export', {'name': '源项目', 'outputPath': str(out_zip)}))
        assert r['success'] is True and r['result']['success'] is True
        r = asyncio.run(execute_tool('project_import',
                                     {'source': str(out_zip), 'projectName': '导入项目'}))
        assert r['success'] is True and r['result']['success'] is True
        assert r['result']['project'] == '导入项目'
        r = asyncio.run(execute_tool('project_info', {'name': '导入项目'}))
        assert r['success'] is True and r['result']['success'] is True
        assert r['result']['project']['has_config'] is True