"""4.3 F3-4（测试计划 A-5）：项目/模板操作工具（双端统一命名）回归测试

覆盖 AI 对话可完成的 8 个工具：list_projects / create_project / update_project /
delete_project / import_project / export_project / create_from_template / preview_template。
工具校验（必填参数缺失 → 可读错误）+ 对话内可完成闭环。
"""
import asyncio
import zipfile

import pytest

from autolink_hub.agent.tools import init_tools, get_tool_definitions, execute_tool
from autolink_hub.agent.schemas import get_tool_permission, resolve_tool_name, ToolPermission


@pytest.fixture
def userdata(tmp_path, monkeypatch):
    monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
    return tmp_path


class TestF34ProjectTemplateTools:
    """A-5: 项目/模板操作工具（list/create/update/delete/导入导出/基于模板创建/预览）"""

    def test_eight_tools_registered(self):
        init_tools()
        defs = {d['function']['name']: d['function'] for d in get_tool_definitions()}
        for expected in ('list_projects', 'create_project', 'update_project', 'delete_project',
                         'import_project', 'export_project', 'create_from_template', 'preview_template'):
            assert expected in defs

    def test_tool_permissions(self):
        assert get_tool_permission('list_projects') == ToolPermission.AUTO
        assert get_tool_permission('create_project') == ToolPermission.NOTIFY
        assert get_tool_permission('update_project') == ToolPermission.NOTIFY
        assert get_tool_permission('delete_project') == ToolPermission.CONFIRM
        assert get_tool_permission('import_project') == ToolPermission.NOTIFY
        assert get_tool_permission('export_project') == ToolPermission.NOTIFY
        assert get_tool_permission('create_from_template') == ToolPermission.NOTIFY
        assert get_tool_permission('preview_template') == ToolPermission.AUTO

    def test_tool_aliases(self):
        assert resolve_tool_name('edit_project')[0] == 'update_project'
        assert resolve_tool_name('create_project_from_template')[0] == 'create_from_template'
        assert resolve_tool_name('template_preview')[0] == 'preview_template'
        assert resolve_tool_name('list_projects')[0] == 'list_projects'

    def test_list_projects(self, userdata):
        init_tools()
        r = asyncio.run(execute_tool('create_project', {'projectName': '列项目A'}))
        assert r['success'] is True and r['result']['success'] is True
        r = asyncio.run(execute_tool('list_projects', {}))
        assert r['success'] is True
        names = [p['name'] for p in r['result']['projects']]
        assert '列项目A' in names

    def test_create_and_update_project(self, userdata):
        """create_project → update_project 深合并 → project_info 校验摘要"""
        init_tools()
        r = asyncio.run(execute_tool('create_project', {'projectName': '更新项目', 'description': 'd'}))
        assert r['success'] is True and r['result']['success'] is True
        assert r['result']['projectId']
        # 深合并更新拓扑参数
        r = asyncio.run(execute_tool('update_project', {
            'projectName': '更新项目',
            'config': {'topology': {'num_gpu_servers': 64, 'param_protocol': 'IB'}},
        }))
        assert r['success'] is True and r['result']['success'] is True
        assert r['result']['config']['topology']['num_gpu_servers'] == 64
        assert r['result']['config']['topology']['param_protocol'] == 'IB'
        # 既有键保留（深合并不丢字段）
        assert r['result']['config']['meta']['name'] == '更新项目'
        # 落盘可读（对话内闭环）
        r = asyncio.run(execute_tool('project_info', {'name': '更新项目'}))
        assert r['success'] is True and r['result']['success'] is True
        assert r['result']['project']['config']['topology']['num_gpu_servers'] == 64

    def test_update_project_validation_errors(self, userdata):
        """update_project 缺参/项目不存在 → 可读错误（工具校验）"""
        init_tools()
        # 空项目名 → handler 空值校验（5.0.3-503-c 参数校验不拦截空串，交 handler）
        r = asyncio.run(execute_tool('update_project', {'projectName': '', 'config': {}}))
        assert r['success'] is True and r['result']['success'] is False
        assert '项目名不能为空' in r['result']['error']
        # 5.0.3-503-c: 缺必填 config → execute_tool 参数校验拦截
        r0 = asyncio.run(execute_tool('update_project', {'projectName': 'x'}))
        assert r0['success'] is True and r0['result']['success'] is False
        assert '缺少必填参数: config' in r0['result']['error']
        r = asyncio.run(execute_tool('update_project', {'projectName': '__no_such__', 'config': {'x': 1}}))
        assert r['success'] is True and r['result']['success'] is False
        assert '项目不存在' in r['result']['error']

    def test_create_from_template(self, userdata):
        """基于模板创建（templateName 必填）→ 模板配置生效"""
        init_tools()
        r = asyncio.run(execute_tool('create_from_template', {
            'projectName': '模板项目', 'templateName': 'DP3Tier-1024',
        }))
        assert r['success'] is True and r['result']['success'] is True
        assert r['result']['projectId']
        # 项目配置来自模板
        r = asyncio.run(execute_tool('project_info', {'name': '模板项目'}))
        assert r['success'] is True and r['result']['success'] is True
        cfg = r['result']['project']['config']
        assert cfg['topology']['num_gpu_servers'] > 0
        # 未知模板 → 可读错误
        r = asyncio.run(execute_tool('create_from_template', {
            'projectName': '坏模板', 'templateName': '__no_such_template__'}))
        assert r['success'] is True and r['result']['success'] is False

    def test_preview_template(self, userdata):
        """preview_template：按名称查看完整 ProjectConfig（只读）"""
        init_tools()
        r = asyncio.run(execute_tool('preview_template', {'name': 'DP3Tier-1024'}))
        assert r['success'] is True and r['result']['success'] is True
        assert 'config' in r['result']['template']
        assert r['result']['template']['config']['topology']['num_gpu_servers'] > 0
        # 未知模板 → 可读错误
        r = asyncio.run(execute_tool('preview_template', {'name': '__no_such__'}))
        assert r['success'] is True and r['result']['success'] is False

    def test_export_import_delete_roundtrip(self, userdata):
        """export_project → import_project → delete_project 闭环（对话内可完成）"""
        init_tools()
        r = asyncio.run(execute_tool('create_project', {'projectName': '往返项目'}))
        assert r['success'] is True and r['result']['success'] is True
        out_zip = userdata / 'proj.zip'
        r = asyncio.run(execute_tool('export_project', {'projectName': '往返项目', 'outputPath': str(out_zip)}))
        assert r['success'] is True and r['result']['success'] is True
        assert out_zip.exists()
        with zipfile.ZipFile(out_zip) as z:
            znames = set(z.namelist())
            assert 'project_config.json' in znames and 'project.json' in znames
        r = asyncio.run(execute_tool('import_project', {'source': str(out_zip), 'projectName': '导入往返'}))
        assert r['success'] is True and r['result']['success'] is True
        r = asyncio.run(execute_tool('project_info', {'name': '导入往返'}))
        assert r['success'] is True and r['result']['success'] is True
        # 重名导入默认拒绝（overwrite=false）
        r = asyncio.run(execute_tool('import_project', {'source': str(out_zip), 'projectName': '导入往返'}))
        assert r['success'] is True and r['result']['success'] is False
        assert '已存在' in r['result']['error']
        # 删除（CONFIRM 权限，execute_tool 直接执行仍可删除）
        r = asyncio.run(execute_tool('delete_project', {'projectName': '导入往返'}))
        assert r['success'] is True and r['result']['success'] is True
        r = asyncio.run(execute_tool('project_info', {'name': '导入往返'}))
        assert r['success'] is True and r['result']['success'] is False

    def test_delete_project_confirm_permission(self, userdata):
        """delete_project 权限为 CONFIRM：半自动 agent 需确认、full_auto 直接执行"""
        init_tools()
        # 先建项目再删，验证权限查询
        r = asyncio.run(execute_tool('create_project', {'projectName': '删除测试'}))
        assert r['success'] is True and r['result']['success'] is True
        assert get_tool_permission('delete_project') == ToolPermission.CONFIRM
        r = asyncio.run(execute_tool('delete_project', {'projectName': '删除测试'}))
        assert r['success'] is True and r['result']['success'] is True
