"""V3.1.1-T5-8: AI Hub 移植回归测试

覆盖：provider 注册 / 工具白名单 / 权限分级 / validator / recovery /
tool_call 解析（3 格式）/ agent 循环（mock LLM）/ 审计留痕与脱敏（R5.7）。
"""
import asyncio
import json

import pytest

from autolink_hub.agent.tools import init_tools, get_tool_definitions, execute_tool
from autolink_hub.agent.schemas import (
    ToolPermission, get_tool_permission, resolve_tool_name, normalize_params,
)
from autolink_hub.agent.validator import validate_tool_call
from autolink_hub.agent.recovery import analyze_error
from autolink_hub.agent.agent import AgentSession, _parse_tool_call
from autolink_hub.config import PROVIDER_CATALOG, settings
from autolink_hub.llm.provider import init_providers, registry
from autolink_hub.memory.engine import get_memory_engine
from cli import _redact


# ============================================================
# Provider 注册（9 厂商）
# ============================================================

class TestProviderRegistry:
    def test_catalog_has_9_vendors(self):
        assert len(PROVIDER_CATALOG) == 9
        for key in ('deepseek', 'openai', 'claude', 'gemini', 'qwen', 'glm', 'grok', 'ollama', 'custom'):
            assert key in PROVIDER_CATALOG

    def test_list_providers_structure(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        init_providers()
        providers = registry.list_providers()
        assert len(providers) == 9
        assert all('key' in p and 'name' in p and 'enabled' in p for p in providers)

    def test_configure_provider_persists_secrets(self, tmp_path, monkeypatch):
        from autolink_hub.hub import configure_provider, set_default_provider
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        r = configure_provider('deepseek', 'sk-test-123', 'deepseek-chat')
        assert r['status'] == 'ok'
        secrets = json.loads((tmp_path / 'ai_secrets.json').read_text(encoding='utf-8'))
        assert secrets['deepseek']['api_key'] == 'sk-test-123'
        r2 = set_default_provider('deepseek')
        assert r2['default_provider'] == 'deepseek'
        assert settings.default_provider == 'deepseek'


# ============================================================
# 工具白名单（直调 cli.execute）
# ============================================================

class TestTools:
    def test_whitelist_registered(self):
        init_tools()
        defs = get_tool_definitions()
        assert len(defs) >= 13
        names = {d['function']['name'] for d in defs}
        for expected in ('generate_design', 'validate_design', 'estimate', 'report',
                         'export_outputs', 'room_create', 'room_validate',
                         'list_config_schema', 'apply_config_preset', 'config_export',
                         'config_import', 'project_config_migrate', 'project_config_to_ini'):
            assert expected in names

    def test_unknown_tool_returns_error(self):
        result = asyncio.run(execute_tool('no_such_tool', {}))
        assert result['success'] is False
        assert '未知工具' in result['error']

    def test_readonly_tool_executes(self):
        result = asyncio.run(execute_tool('list_config_schema', {}))
        assert result['success'] is True
        assert 'schema' in str(result['result']).lower() or 'preset' in str(result['result']).lower()


# ============================================================
# 权限分级
# ============================================================

class TestPermissions:
    def test_permission_levels(self):
        assert get_tool_permission('validate_design') == ToolPermission.AUTO
        assert get_tool_permission('estimate') == ToolPermission.AUTO
        assert get_tool_permission('generate_design') == ToolPermission.NOTIFY
        assert get_tool_permission('room_create') == ToolPermission.NOTIFY
        assert get_tool_permission('delete_project') == ToolPermission.CONFIRM
        # 未注册工具默认 CONFIRM
        assert get_tool_permission('unknown_tool') == ToolPermission.CONFIRM


# ============================================================
# 别名 / 参数归一 / validator
# ============================================================

class TestAliases:
    def test_tool_name_alias(self):
        assert resolve_tool_name('validate')[0] == 'validate_design'
        assert resolve_tool_name('design')[0] == 'generate_design'
        assert resolve_tool_name('export')[0] == 'export_outputs'
        name, msg = resolve_tool_name('unknown_tool')
        assert name == 'unknown_tool' and msg is None

    def test_param_alias(self):
        assert normalize_params({'config': '/x.json'}) == {'configFile': '/x.json'}
        assert normalize_params({'project': 'p'}) == {'projectName': 'p'}
        assert normalize_params({'preset': 'ib-allflash'}) == {'presetId': 'ib-allflash'}

    def test_validator_correction_and_permission(self):
        available = {'validate_design', 'generate_design'}
        r = validate_tool_call('validate', {'config': '/tmp/a.json'}, available)
        assert r.name == 'validate_design'
        assert r.args == {'configFile': '/tmp/a.json'}
        assert r.has_corrections
        assert r.permission == ToolPermission.AUTO
        r2 = validate_tool_call('generate_design', {}, available)
        assert r2.permission == ToolPermission.NOTIFY


# ============================================================
# recovery 错误恢复策略
# ============================================================

class TestRecovery:
    def test_unknown_tool_retry_with_alias(self):
        r = analyze_error('validate', {}, '未知工具: foo', {'validate_design'})
        assert r.action == 'retry'
        assert r.modified_tool == 'validate_design'

    def test_timeout_retry(self):
        r = analyze_error('report', {}, 'Connection timeout', set())
        assert r.action == 'retry'

    def test_config_missing_ask_user(self):
        r = analyze_error('generate_design', {}, '配置文件不存在: /x', set())
        assert r.action == 'ask_user'

    def test_unknown_fallback_ask_user(self):
        r = analyze_error('report', {}, 'some other error', set())
        assert r.action == 'ask_user'


# ============================================================
# tool_call 解析（3 格式）
# ============================================================

class TestParseToolCall:
    def test_json_block(self):
        content = ('text\n```tool_call\n'
                   '{"name": "report", "arguments": {"configFile": "/a.json"}}\n'
                   '```\n')
        assert _parse_tool_call(content) == {'name': 'report', 'arguments': {'configFile': '/a.json'}}

    def test_inline_json(self):
        content = '{"name": "estimate", "arguments": {"configFile": "/a.json"}}'
        assert _parse_tool_call(content)['name'] == 'estimate'

    def test_xml_format(self):
        content = ('<tool_calls><invoke name="report">'
                   '<parameter name="configFile">/a.json</parameter>'
                   '</invoke></tool_calls>')
        call = _parse_tool_call(content)
        assert call['name'] == 'report'
        assert call['arguments'] == {'configFile': '/a.json'}

    def test_no_tool_call(self):
        assert _parse_tool_call('这里没有工具调用') is None


# ============================================================
# agent 循环（mock LLM）
# ============================================================

class MockProvider:
    """假 LLM Provider：按序吐出响应，首轮含 tool_call，次轮纯文本"""

    def __init__(self, responses):
        self._responses = list(responses)
        self.last_reasoning_content = ''

    @property
    def provider_name(self):
        return 'mock'

    async def chat_stream(self, messages, system_prompt='', **kwargs):
        for chunk in self._responses.pop(0):
            yield chunk


class TestAgentLoop:
    def test_run_stream_tool_then_answer(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        get_memory_engine().init_dir(str(tmp_path))
        init_tools()

        session = AgentSession()
        session.session_id = 'test-session'
        session.provider = MockProvider([
            ['我需要查询 schema。\n```tool_call\n{"name": "list_config_schema", "arguments": {}}\n```\n'],
            ['查询完成，以上是配置 schema 清单。'],
        ])
        session.add_user_message('列出配置 schema')

        async def collect():
            parts = []
            async for c in session.run_stream(max_tool_rounds=3):
                parts.append(c)
            return ''.join(parts)

        text = asyncio.run(collect())
        assert '正在调用工具' in text
        assert '配置 schema' in text

    def test_confirm_tool_interrupts_in_semi_auto(self):
        session = AgentSession()
        session.session_id = 'test-confirm'
        session.autonomy_mode = 'semi_auto'
        session.provider = MockProvider([
            ['删除项目。\n```tool_call\n{"name": "delete_project", "arguments": {"projectName": "p"}}\n```\n'],
        ])
        session.add_user_message('删除项目 p')

        async def collect():
            parts = []
            async for c in session.run_stream(max_tool_rounds=2):
                parts.append(c)
            return ''.join(parts)

        text = asyncio.run(collect())
        # CONFIRM 工具在半自动模式下中断等待用户确认
        assert '需要确认' in text

    def test_no_provider_returns_friendly_error(self):
        session = AgentSession()
        session.session_id = 'test-noprov'
        session.provider = None
        session.add_user_message('hi')

        async def collect():
            parts = []
            async for c in session.run_stream():
                parts.append(c)
            return ''.join(parts)

        text = asyncio.run(collect())
        assert 'AI Provider' in text


# ============================================================
# 审计留痕 + 脱敏（R5.7：AI 每调一次工具自动落 cli-audit.jsonl）
# ============================================================

class TestAuditTrail:
    def test_ai_tool_call_writes_audit(self, tmp_path, monkeypatch):
        audit_path = tmp_path / 'cli-audit.jsonl'
        monkeypatch.setenv('AUTOLINK_AUDIT_PATH', str(audit_path))
        init_tools()

        result = asyncio.run(execute_tool('list_config_schema', {}))
        assert result['success'] is True

        lines = audit_path.read_text(encoding='utf-8').strip().split('\n')
        assert len(lines) >= 1
        record = json.loads(lines[0])
        assert record['action'] == 'config:list-schema'
        # argv 带 ai: 前缀 —— AI 发起轨迹
        assert 'ai:config:list-schema' in record['argv']
        assert record['ok'] is True

    def test_audit_params_redacted(self):
        # 脱敏：apiKey 等敏感键被替换为 ***
        redacted = _redact({'apiKey': 'sk-secret-123', 'name': 'ok', 'token': 't'})
        assert redacted == {'apiKey': '***', 'name': 'ok', 'token': '***'}
