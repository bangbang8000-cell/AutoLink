"""5.0.3-503-c：MCP 工具接入测试

覆盖 backend/autolink_hub/mcp/manager.py：
- 配置 CRUD：add/list/remove/set_enabled + 持久化 mcp_servers.json + 名称/命令校验
- 子进程生命周期与工具发现：_discover_tools（mock）→ sync_server → 动态注册 mcp:<server>:<tool>
- 执行分发：call_tool（SDK 未装友好错误 / mock 传输成功）
- 双引擎共享：工具注册进 tools.py 共享注册表（get_tool_definitions 可见）
- unregister_tool：删除 server 时清理动态注册工具

覆盖 agent/tools.py：
- execute_tool 参数校验（_validate_tool_args）：必填缺失/类型错误 → 可读失败；别名兼容

覆盖 HTTP：/api/chat/mcp（list/add/remove/reload）+ 审计断言（协议层允许）
"""
import asyncio
import json

import pytest

from autolink_hub.mcp.manager import (
    MCPManager, mcp_available, MCP_TOOL_PREFIX, get_mcp_manager, reset_mcp_manager,
)
from autolink_hub.agent.tools import (
    init_tools, get_tool_definitions, execute_tool, unregister_tool, _validate_tool_args,
)


@pytest.fixture(autouse=True)
def clean_state(tmp_path, monkeypatch):
    monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
    from autolink_hub.config import settings
    settings.user_data_dir = str(tmp_path)
    reset_mcp_manager()
    # 清理 tools 注册表中的 mcp 工具（跨测试隔离）
    from autolink_hub.agent import tools as tools_mod
    for name in list(tools_mod._tools.keys()):
        if name.startswith(MCP_TOOL_PREFIX):
            unregister_tool(name)
    yield
    reset_mcp_manager()


# ============================================================
# 配置 CRUD / 持久化
# ============================================================

class TestMcpConfig:
    def test_add_server_persists(self, tmp_path, monkeypatch):
        m = MCPManager(state_dir=str(tmp_path))
        r = asyncio.run(m.add_server('fs', 'npx', args=['-y', '@x/filesystem']))
        assert r['ok'] is True
        cfg = json.loads((tmp_path / 'mcp_servers.json').read_text(encoding='utf-8'))
        assert cfg['servers'][0]['name'] == 'fs'
        assert cfg['servers'][0]['command'] == 'npx'
        assert cfg['servers'][0]['args'] == ['-y', '@x/filesystem']

    def test_add_server_validation(self, tmp_path):
        m = MCPManager(state_dir=str(tmp_path))
        assert asyncio.run(m.add_server('', 'cmd'))['ok'] is False
        assert asyncio.run(m.add_server('bad name!', 'cmd'))['ok'] is False
        assert asyncio.run(m.add_server('ok-name', ''))['ok'] is False
        assert asyncio.run(m.add_server('ok-name', 'cmd'))['ok'] is True

    def test_list_and_reload_from_disk(self, tmp_path):
        m1 = MCPManager(state_dir=str(tmp_path))
        asyncio.run(m1.add_server('srv-a', 'python', args=['-m', 'mock_server']))
        m2 = MCPManager(state_dir=str(tmp_path))
        servers = m2.list_servers()
        assert len(servers) == 1
        assert servers[0]['name'] == 'srv-a'
        assert servers[0]['command'] == 'python'

    def test_remove_server(self, tmp_path):
        m = MCPManager(state_dir=str(tmp_path))
        asyncio.run(m.add_server('srv-a', 'cmd'))
        assert m.remove_server('srv-a')['ok'] is True
        assert m.list_servers() == []
        assert m.remove_server('__no_such__')['ok'] is False

    def test_set_enabled(self, tmp_path):
        m = MCPManager(state_dir=str(tmp_path))
        asyncio.run(m.add_server('srv-a', 'cmd'))
        m.set_enabled('srv-a', False)
        assert m.list_servers()[0]['enabled'] is False


# ============================================================
# 工具发现 / 动态注册 / 执行分发
# ============================================================

class TestMcpTools:
    def test_sync_server_registers_mcp_tools(self, tmp_path, monkeypatch):
        """发现工具 → 注册 mcp:<server>:<tool> 到共享注册表（双引擎透传）"""
        init_tools()
        m = MCPManager(state_dir=str(tmp_path))

        async def fake_discover(cfg):
            return [
                {'name': 'read_file', 'description': '读文件',
                 'inputSchema': {'type': 'object',
                                 'properties': {'path': {'type': 'string'}},
                                 'required': ['path']}},
                {'name': 'list_dir', 'description': '列目录',
                 'inputSchema': {'type': 'object', 'properties': {}, 'required': []}},
            ]

        monkeypatch.setattr(m, '_discover_tools', fake_discover)
        r = asyncio.run(m.add_server('fs', 'npx'))
        assert r['ok'] is True
        assert set(r['sync'].get('tools', [])) == {'read_file', 'list_dir'}

        # 共享注册表可见（own/hermes get_tool_definitions 均能看到）
        defs = {d['function']['name']: d['function'] for d in get_tool_definitions()}
        assert 'mcp:fs:read_file' in defs
        assert 'mcp:fs:list_dir' in defs
        assert defs['mcp:fs:read_file']['parameters']['required'] == ['path']

    def test_sync_server_mcp_sdk_missing(self, tmp_path, monkeypatch):
        """未安装 mcp SDK → 同步返回友好错误，配置仍保留"""
        m = MCPManager(state_dir=str(tmp_path))
        monkeypatch.setattr('autolink_hub.mcp.manager.mcp_available', lambda: False)
        r = asyncio.run(m.add_server('fs', 'npx'))
        assert r['ok'] is True  # 配置保存成功
        assert r['sync']['ok'] is False
        assert 'MCP Python SDK 未安装' in r['sync']['error']

    def test_call_tool_sdk_missing_friendly_error(self, tmp_path, monkeypatch):
        m = MCPManager(state_dir=str(tmp_path))
        monkeypatch.setattr('autolink_hub.mcp.manager.mcp_available', lambda: False)
        m._servers['fs'] = {'name': 'fs', 'command': 'npx', 'args': [], 'enabled': True}
        result = asyncio.run(m.call_tool('fs', 'read_file', {'path': '/tmp'}))
        assert result['success'] is False
        assert 'MCP Python SDK 未安装' in result['error']

    def test_call_tool_unknown_server(self, tmp_path):
        m = MCPManager(state_dir=str(tmp_path))
        result = asyncio.run(m.call_tool('__no_such__', 't', {}))
        assert result['success'] is False

    def test_call_tool_disabled_server(self, tmp_path):
        m = MCPManager(state_dir=str(tmp_path))
        m._servers['fs'] = {'name': 'fs', 'command': 'npx', 'args': [], 'enabled': False}
        result = asyncio.run(m.call_tool('fs', 't', {}))
        assert result['success'] is False and '未启用' in result['error']

    def test_call_tool_success_via_mock_impl(self, tmp_path, monkeypatch):
        """注入 mock _call_tool_impl → call_tool 成功包装"""
        m = MCPManager(state_dir=str(tmp_path))
        m._servers['fs'] = {'name': 'fs', 'command': 'npx', 'args': [], 'enabled': True}

        async def fake_impl(cfg, tool, args, timeout):
            return {'content': f'ok:{tool}'}

        monkeypatch.setattr(m, '_call_tool_impl', fake_impl)
        result = asyncio.run(m.call_tool('fs', 'read_file', {'path': '/tmp'}))
        assert result['success'] is True
        assert result['result'] == {'content': 'ok:read_file'}

    def test_mcp_tool_execute_via_handler(self, tmp_path, monkeypatch):
        """注册的 mcp 工具经 execute_tool 调用 → handler → call_tool"""
        init_tools()
        m = MCPManager(state_dir=str(tmp_path))

        async def fake_impl(cfg, tool, args, timeout):
            return {'content': f'echo:{tool}:{json.dumps(args, ensure_ascii=False)}'}

        async def fake_discover(cfg):
            return [{'name': 'ping', 'description': 'ping',
                     'inputSchema': {'type': 'object', 'properties': {}, 'required': []}}]

        monkeypatch.setattr(m, '_call_tool_impl', fake_impl)
        monkeypatch.setattr(m, '_discover_tools', fake_discover)
        asyncio.run(m.add_server('echo', 'python'))
        r = asyncio.run(execute_tool('mcp:echo:ping', {}))
        assert r['success'] is True
        assert 'echo:ping' in json.dumps(r['result'], ensure_ascii=False)

    def test_remove_server_unregisters_tools(self, tmp_path, monkeypatch):
        init_tools()
        m = MCPManager(state_dir=str(tmp_path))

        async def fake_discover(cfg):
            return [{'name': 'a', 'description': 'a',
                     'inputSchema': {'type': 'object', 'properties': {}, 'required': []}}]

        monkeypatch.setattr(m, '_discover_tools', fake_discover)
        asyncio.run(m.add_server('s', 'python'))
        assert 'mcp:s:a' in {d['function']['name'] for d in get_tool_definitions()}
        m.remove_server('s')
        assert 'mcp:s:a' not in {d['function']['name'] for d in get_tool_definitions()}


# ============================================================
# execute_tool 参数校验（对齐 MC _validate_tool_args）
# ============================================================

class TestExecuteToolValidation:
    def test_missing_required_param(self, tmp_path, monkeypatch):
        init_tools()
        r = asyncio.run(execute_tool('preview_template', {}))
        # 与既有工具缺参约定一致：外层 success=True，内层 result.success=False
        assert r['success'] is True
        assert r['result']['success'] is False
        assert '缺少必填参数: name' in r['result']['error']

    def test_missing_required_with_alias_ok(self, tmp_path, monkeypatch):
        """别名兼容：schema 必填 name，但 validator 归一化为 projectName 仍算存在"""
        init_tools()
        r = asyncio.run(execute_tool('preview_template', {'projectName': 'DP3Tier-1024'}))
        assert r['success'] is True  # 别名通过必填校验并执行

    def test_number_type_check(self):
        tool = {'parameters': {'type': 'object',
                               'properties': {'limit': {'type': 'number'}},
                               'required': ['limit']}}
        assert _validate_tool_args(tool, {'limit': 5}) == []
        assert _validate_tool_args(tool, {'limit': 'abc'}) != []
        assert _validate_tool_args(tool, {'limit': True}) != []

    def test_array_type_check(self):
        tool = {'parameters': {'type': 'object',
                               'properties': {'items': {'type': 'array'}},
                               'required': ['items']}}
        assert _validate_tool_args(tool, {'items': [1, 2]}) == []
        assert _validate_tool_args(tool, {'items': 'x'}) != []

    def test_string_param_lenient(self):
        """string 参数宽松（既有工具 string 参数常承载对象/数值，避免破坏兼容）"""
        tool = {'parameters': {'type': 'object',
                               'properties': {'config': {'type': 'string'}},
                               'required': ['config']}}
        assert _validate_tool_args(tool, {'config': {'a': 1}}) == []  # dict 不拒绝
        assert _validate_tool_args(tool, {'config': 123}) == []       # 数值不拒绝

    def test_none_required_is_error(self):
        tool = {'parameters': {'type': 'object',
                               'properties': {'a': {'type': 'string'}},
                               'required': ['a']}}
        # None 视为缺失；空字符串交给 handler 自行校验（与既有 handler 约定一致）
        assert _validate_tool_args(tool, {'a': None}) != []
        assert _validate_tool_args(tool, {'a': ''}) == []

    def test_existing_tools_still_work(self, tmp_path, monkeypatch):
        """参数校验不破坏既有工具调用（回归）"""
        init_tools()
        r = asyncio.run(execute_tool('list_config_schema', {}))
        assert r['success'] is True


# ============================================================
# HTTP 端点（/api/chat/mcp*）
# ============================================================

class TestMcpHttp:
    @pytest.fixture(autouse=True)
    def clean(self, tmp_path):
        from autolink_hub.config import settings
        settings.user_data_dir = str(tmp_path)
        settings.ai_engine = 'own'
        yield

    def test_mcp_list_endpoint(self, tmp_path):
        from al_ai_hub.main import create_app
        from fastapi.testclient import TestClient
        client = TestClient(create_app())
        r = client.get('/api/chat/mcp')
        assert r.status_code == 200
        body = r.json()
        assert body['ok'] is True
        assert 'sdk_installed' in body
        assert body['servers'] == []

    def test_mcp_add_remove_endpoints(self, tmp_path):
        from al_ai_hub.main import create_app
        from fastapi.testclient import TestClient
        client = TestClient(create_app())
        r = client.post('/api/chat/mcp/add', json={'name': 's1', 'command': 'python'})
        assert r.status_code == 200
        # 配置已保存（未装 SDK 时 sync 失败但配置在）
        lst = client.get('/api/chat/mcp').json()
        assert any(s['name'] == 's1' for s in lst['servers'])
        r2 = client.post('/api/chat/mcp/remove', json={'name': 's1'})
        assert r2.status_code == 200
        lst2 = client.get('/api/chat/mcp').json()
        assert all(s['name'] != 's1' for s in lst2['servers'])

    def test_mcp_add_invalid_name(self, tmp_path):
        from al_ai_hub.main import create_app
        from fastapi.testclient import TestClient
        client = TestClient(create_app())
        r = client.post('/api/chat/mcp/add', json={'name': 'bad name!', 'command': 'x'})
        assert r.status_code == 400

    def test_mcp_reload_endpoint(self, tmp_path):
        from al_ai_hub.main import create_app
        from fastapi.testclient import TestClient
        client = TestClient(create_app())
        r = client.post('/api/chat/mcp/reload')
        assert r.status_code == 200
        assert r.json()['ok'] is True

    def test_mcp_servers_share_dual_engine(self, tmp_path, monkeypatch):
        """MCP 工具注册进共享注册表 → get_tool_definitions 可见（own/hermes 透传）"""
        init_tools()
        m = MCPManager(state_dir=str(tmp_path))

        async def fake_discover(cfg):
            return [{'name': 'tool-x', 'description': 'x',
                     'inputSchema': {'type': 'object', 'properties': {}, 'required': []}}]

        monkeypatch.setattr(m, '_discover_tools', fake_discover)
        asyncio.run(m.add_server('shared', 'python'))
        names = {d['function']['name'] for d in get_tool_definitions()}
        assert 'mcp:shared:tool-x' in names
