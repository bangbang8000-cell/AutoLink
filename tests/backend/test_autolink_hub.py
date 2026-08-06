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

    def test_configure_provider_idempotent(self, tmp_path, monkeypatch):
        """T6-1: 相同配置重复下发不重建（changed=False），配置变化时重建（changed=True）"""
        from autolink_hub.hub import configure_provider
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        r1 = configure_provider('deepseek', 'sk-test', 'deepseek-chat', '')
        assert r1['changed'] is True
        r2 = configure_provider('deepseek', 'sk-test', 'deepseek-chat', '')
        assert r2['changed'] is False
        # 任一字段变化（apiKey/model/base_url）都触发重建
        r3 = configure_provider('deepseek', 'sk-test', 'deepseek-v4', '')
        assert r3['changed'] is True
        r4 = configure_provider('deepseek', 'sk-test', 'deepseek-v4', 'https://api.example.com/v1')
        assert r4['changed'] is True

    def test_set_default_provider_idempotent(self, tmp_path, monkeypatch):
        """T6-1: 默认 Provider 未变化不重载（changed=False）"""
        from autolink_hub.hub import configure_provider, set_default_provider
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        configure_provider('deepseek', 'sk-test', 'deepseek-chat')
        r1 = set_default_provider('deepseek')
        assert r1['changed'] is True
        r2 = set_default_provider('deepseek')
        assert r2['changed'] is False
        r3 = set_default_provider('openai')
        assert r3['changed'] is True


# ============================================================
# 工具白名单（直调 cli.execute）
# ============================================================

class TestTools:
    def test_whitelist_registered(self):
        init_tools()
        defs = get_tool_definitions()
        assert len(defs) >= 21
        names = {d['function']['name'] for d in defs}
        for expected in ('generate_design', 'validate_design', 'estimate', 'report',
                         'export_outputs', 'room_create', 'room_validate',
                         'room_optimize', 'room_set_type', 'room_place',
                         'list_config_schema', 'apply_config_preset', 'config_export',
                         'config_import', 'project_config_migrate', 'project_config_to_ini',
                         'device_query', 'template_list', 'template_view',
                         'project_list', 'project_info', 'generate_project', 'parse_file',
                         'capacity_recommend'):
            assert expected in names

    def test_unknown_tool_returns_error(self):
        result = asyncio.run(execute_tool('no_such_tool', {}))
        assert result['success'] is False
        assert '未知工具' in result['error']

    def test_readonly_tool_executes(self):
        result = asyncio.run(execute_tool('list_config_schema', {}))
        assert result['success'] is True
        assert 'schema' in str(result['result']).lower() or 'preset' in str(result['result']).lower()

    def test_manage_tools_readonly(self):
        # device_query：分类前缀过滤
        r = asyncio.run(execute_tool('device_query', {'category': 'switches'}))
        assert r['success'] is True
        assert r['result']['total'] >= 1
        for d in r['result']['devices']:
            assert d['category'].startswith('switches')
        # template_list / template_view
        r = asyncio.run(execute_tool('template_list', {}))
        assert r['success'] is True and r['result']['total'] >= 10
        r = asyncio.run(execute_tool('template_view', {'name': 'DP3Tier-1024'}))
        assert r['success'] is True and 'config' in r['result']['template']
        # project_list / project_info（未知项目返回成功但 success=False）
        r = asyncio.run(execute_tool('project_list', {}))
        assert r['success'] is True and 'projects' in r['result']
        r = asyncio.run(execute_tool('project_info', {'name': '__no_such_project__'}))
        assert r['success'] is True and r['result']['success'] is False

    def test_generate_project_tool(self):
        # 需求生成：规范化 + 标注（只预览不落盘）
        r = asyncio.run(execute_tool('generate_project', {
            'name': 'B300集群',
            'config': {'topology': {'num_gpu_servers': 1024, 'param_protocol': 'IB'}},
        }))
        assert r['success'] is True
        res = r['result']
        assert res['config']['meta']['name'] == 'B300集群'
        assert res['config']['topology']['num_gpu_servers'] == 1024
        assert 'annotations' in res
        assert res['annotations']['confidence'] < 1.0
        # 缺 config 参数 → 返回 success False
        r2 = asyncio.run(execute_tool('generate_project', {}))
        assert r2['success'] is True and r2['result']['success'] is False

    def test_parse_file_tool(self, tmp_path):
        # 文本示例解析
        p = tmp_path / '需求.txt'
        p.write_text('1024 台 B300 双平面 800G IB', encoding='utf-8')
        r = asyncio.run(execute_tool('parse_file', {'path': str(p)}))
        assert r['success'] is True
        res = r['result']
        assert res['file']['type'] == 'text'
        assert 'B300' in res['parsed']['content']
        # 不存在文件 → success False
        r2 = asyncio.run(execute_tool('parse_file', {'path': '/no/such/file.xlsx'}))
        assert r2['success'] is True and r2['result']['success'] is False

    def test_capacity_recommend_tool(self):
        r = asyncio.run(execute_tool('capacity_recommend', {'model': 'deepseek-v3', 'num_gpus': 1024}))
        assert r['success'] is True
        rec = r['result']['recommendation']
        assert rec['scale_out_protocol'] == 'UEC'
        assert rec['scale_out_speed'] == '800G'
        assert rec['convergence_ratio'] <= 1.2
        # 缺参数 → success False
        r2 = asyncio.run(execute_tool('capacity_recommend', {'model': 'llama3-8b'}))
        assert r2['success'] is True and r2['result']['success'] is False

    def test_repair_tools(self, tmp_path):
        """智能修复闭环（V3.2.0-T9-4）：repair_plan 产出修复项 → repair_apply 应用并复核"""
        from project_config import create_default_config
        cfg = create_default_config('hub-repair')
        cfg['topology'].update({
            'downlink_mode': 'custom',
            'num_gpu_servers': 100,
            'num_all_flash_storage': 0,
            'num_compute_servers': 0,
            'param_protocol': 'IB',
            'param_speed': '800G',
            'param_ports_per_server': 8,
            'param_switch_ports': 64,
            'param_downlink_limit': 55,   # V010 收敛比阻塞
        })
        cfg['rack_config']['power_limit_per_rack'] = 100  # V002/V019
        p = tmp_path / 'project_config.json'
        p.write_text(json.dumps(cfg, ensure_ascii=False), encoding='utf-8')

        plan = asyncio.run(execute_tool('repair_plan', {'configFile': str(p)}))
        assert plan['success'] is True
        res = plan['result']
        assert res['success'] is True
        assert res['fixable'] > 0
        assert any(fx['rule_id'] == 'V010' for fx in res['fixes'])

        apply = asyncio.run(execute_tool('repair_apply', {
            'configFile': str(p), 'fixes': res['fixes']}))
        assert apply['success'] is True
        ares = apply['result']
        assert ares['success'] is True
        assert ares['validation'] is not None
        assert not any(i['rule_id'] == 'V010' for i in ares['validation']['issues'])


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
        # 管理域只读工具 AUTO（V3.1.3-T7-1）
        assert get_tool_permission('device_query') == ToolPermission.AUTO
        assert get_tool_permission('template_list') == ToolPermission.AUTO
        assert get_tool_permission('template_view') == ToolPermission.AUTO
        assert get_tool_permission('project_list') == ToolPermission.AUTO
        assert get_tool_permission('project_info') == ToolPermission.AUTO
        # 需求生成 NOTIFY（V3.1.3-T7-2：生成预览，前端确认后落盘）
        assert get_tool_permission('generate_project') == ToolPermission.NOTIFY
        # 示例文件解析 AUTO（V3.1.3-T7-3：只读）
        assert get_tool_permission('parse_file') == ToolPermission.AUTO
        # 容量规划推荐 AUTO（V3.1.3-T7-4：纯计算）
        assert get_tool_permission('capacity_recommend') == ToolPermission.AUTO
        # ATOP 自动拓扑优化 AUTO（V3.2.0-T9-2：只读计算）
        assert get_tool_permission('atop_recommend') == ToolPermission.AUTO
        # 批量优化（V3.2.0-T9-3：建议只读 AUTO / 应用写操作 NOTIFY）
        assert get_tool_permission('optimize_suggest') == ToolPermission.AUTO
        assert get_tool_permission('optimize_apply') == ToolPermission.NOTIFY
        # 智能修复（V3.2.0-T9-4：方案只读 AUTO / 应用修复写操作 NOTIFY）
        assert get_tool_permission('repair_plan') == ToolPermission.AUTO
        assert get_tool_permission('repair_apply') == ToolPermission.NOTIFY
        # 机房智能落位 NOTIFY（V3.1.4-T8-3：返回方案/写操作，前端确认应用）
        assert get_tool_permission('room_optimize') == ToolPermission.NOTIFY
        assert get_tool_permission('room_set_type') == ToolPermission.NOTIFY
        assert get_tool_permission('room_place') == ToolPermission.NOTIFY
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
        # 智能修复别名（V3.2.0-T9-4）
        assert resolve_tool_name('auto_fix')[0] == 'repair_plan'
        assert resolve_tool_name('repair')[0] == 'repair_plan'
        assert resolve_tool_name('apply_repairs')[0] == 'repair_apply'
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

    def test_room_tool_aliases(self):
        assert resolve_tool_name('optimize_room')[0] == 'room_optimize'
        assert resolve_tool_name('mark_room_type')[0] == 'room_set_type'
        assert resolve_tool_name('place_cabinet')[0] == 'room_place'
        # validator 会把 project → projectName（room 系列 action 兼容）
        r = validate_tool_call('room_set_type', {'project': 'P', 'position': 'A1', 'type': 'gpu'}, {'room_set_type'})
        assert r.name == 'room_set_type'
        assert r.args['projectName'] == 'P'


# ============================================================
# 机房智能落位工具（V3.1.4-T8-3）
# ============================================================

class TestRoomLayoutTools:
    def test_room_optimize_tool(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        r = asyncio.run(execute_tool('room_create', {'rows': ['A', 'B', 'C'], 'cols': [1, 2, 3], 'project': 'P'}))
        assert r['success'] is True
        r = asyncio.run(execute_tool('room_optimize', {'project': 'P', 'counts': {'gpu': 4}}))
        assert r['success'] is True
        assert r['result']['success'] is True
        assert r['result']['stats']['placed'] == 4

    def test_room_set_type_and_place_tools(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        r = asyncio.run(execute_tool('room_create', {'rows': ['A', 'B', 'C'], 'cols': [1, 2, 3], 'project': 'P'}))
        assert r['success'] is True
        r = asyncio.run(execute_tool('room_set_type', {'project': 'P', 'position': 'A1', 'type': 'network'}))
        assert r['success'] is True and r['result']['success'] is True
        # 类型匹配上架成功
        r = asyncio.run(execute_tool('room_place', {'project': 'P', 'position': 'A1', 'cabinet_id': 5, 'cabinet_type': 'network'}))
        assert r['success'] is True and r['result']['success'] is True
        # 类型域不匹配拒绝（gpu 放 network 格）
        r = asyncio.run(execute_tool('room_place', {'project': 'P', 'position': 'B1', 'cabinet_id': 6, 'cabinet_type': 'gpu'}))
        assert r['success'] is True and r['result']['success'] is True  # B1 是 empty 格，任意类型可放
        r = asyncio.run(execute_tool('room_set_type', {'project': 'P', 'position': 'B1', 'type': 'gpu'}))
        assert r['success'] is True and r['result']['success'] is True
        r = asyncio.run(execute_tool('room_place', {'project': 'P', 'position': 'B1', 'cabinet_id': 7, 'cabinet_type': 'network'}))
        assert r['success'] is True and r['result']['success'] is False
        assert '不允许放置' in r['result']['error']

    def test_room_tools_accept_project_name(self, tmp_path, monkeypatch):
        """对话链路 validator 归一后传 projectName，engine 兼容"""
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        r = asyncio.run(execute_tool('room_create', {'rows': ['A', 'B', 'C'], 'cols': [1, 2, 3], 'projectName': 'P'}))
        assert r['success'] is True and r['result']['success'] is True
        r = asyncio.run(execute_tool('room_optimize', {'projectName': 'P', 'counts': {'network': 3}}))
        assert r['success'] is True and r['result']['success'] is True
        assert r['result']['stats']['placed'] == 3


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
# 附件路径注入（V3.1.3-T7-3，parse_file 前置）
# ============================================================

class TestAttachmentPaths:
    def test_add_user_message_includes_paths(self):
        session = AgentSession()
        session.add_user_message('按示例生成配置', [
            {'name': '需求清单.xlsx', 'type': 'excel', 'path': 'C:/tmp/需求清单.xlsx'},
        ])
        user_msg = session.messages[0]['content']
        assert '需求清单.xlsx' in user_msg
        assert 'C:/tmp/需求清单.xlsx' in user_msg
        assert 'parse_file' in user_msg

    def test_add_user_message_without_attachments(self):
        session = AgentSession()
        session.add_user_message('普通消息')
        assert session.messages[0]['content'] == '普通消息'


# ============================================================
# 工具调用流式早停（T6-5）
# ============================================================

class TestEarlyStop:
    def _run(self, responses, msg='查 schema'):
        session = AgentSession()
        session.session_id = 'test-early'
        session.provider = MockProvider(list(responses))
        session.add_user_message(msg)

        async def collect():
            parts = []
            async for c in session.run_stream(max_tool_rounds=3):
                parts.append(c)
            return ''.join(parts)

        return asyncio.run(collect())

    def test_early_stop_json_block(self):
        """T6-5: ```tool_call 代码块完整后立即早停，后续文本不再消费"""
        text = self._run([
            ['我查一下。\n```tool_call\n{"name": "list_config_schema", "arguments": {}}\n```\n',
             '这后面是多余的文本，不应被消费'],
            [],
        ])
        assert '正在调用工具' in text
        assert '多余的文本' not in text

    def test_early_stop_inline_json(self):
        """T6-5: 独立 JSON 完整闭合后早停"""
        text = self._run([
            ['{"name": "list_config_schema", "arguments": {}}', '后缀文本'],
            [],
        ])
        assert '正在调用工具' in text
        assert '后缀文本' not in text

    def test_early_stop_xml(self):
        """T6-5: XML <invoke>...</invoke> 完整闭合后早停（无需等 </tool_calls>）"""
        text = self._run([
            ['<tool_calls><invoke name="list_config_schema"><parameter name="configFile">/a.json</parameter></invoke>',
             '</tool_calls>多余'],
            [],
        ])
        assert '正在调用工具' in text
        assert '多余' not in text

    def test_no_early_stop_without_complete_call(self):
        """T6-5: 无完整 tool call 时不早停，普通文本流正常完整消费"""
        text = self._run([
            ['这是一个普通回答', '，继续输出。', '结束。'],
        ], msg='hi')
        assert '这是一个普通回答，继续输出。结束。' in text


# ============================================================
# 历史摘要压缩（T6-7）
# ============================================================

class TestHistoryCompression:
    def test_compress_over_threshold(self):
        """T6-7: 超阈值时压缩历史，保留最近消息 + 摘要占位"""
        from autolink_hub.agent.agent import _compress_history
        messages = [{'role': 'user', 'content': 'x' * 5000}] * 8  # 40000 字符 > 24000
        compressed = _compress_history(messages, max_chars=24000, keep_recent=3)
        assert len(compressed) == 4  # 1 摘要占位 + 3 保留
        assert '压缩' in compressed[0]['content']
        assert compressed[-3:] == messages[-3:]
        # 占位消息中带省略轮数
        assert '5 轮' in compressed[0]['content']

    def test_no_compress_under_threshold(self):
        """T6-7: 未超阈值不压缩（原样返回）"""
        from autolink_hub.agent.agent import _compress_history
        small = [{'role': 'user', 'content': 'hi'}, {'role': 'assistant', 'content': 'hello'}]
        assert _compress_history(small) == small


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


# ============================================================
# system prompt 缓存（T6-2）
# ============================================================

class TestSystemPromptCache:
    def test_get_system_prompt_cached(self):
        """T6-2: 相同 (mode, project) 命中缓存（同一对象）；不同 project 不共享"""
        from autolink_hub.prompts.loader import get_system_prompt
        p1 = get_system_prompt('general', 'proj-a')
        p2 = get_system_prompt('general', 'proj-a')
        assert p1 is p2
        p3 = get_system_prompt('general', 'proj-b')
        assert p1 is not p3
        # 不同 mode 不共享
        p4 = get_system_prompt('config', 'proj-a')
        assert p1 is not p4

    def test_reload_prompts_invalidates_cache(self):
        """T6-2: reload_prompts 后缓存失效重建"""
        from autolink_hub.prompts.loader import get_system_prompt, reload_prompts
        p1 = get_system_prompt('config', '')
        reload_prompts()
        p2 = get_system_prompt('config', '')
        assert p1 is not p2
        # 重建后再次命中缓存
        p3 = get_system_prompt('config', '')
        assert p2 is p3

    def test_memory_update_invalidates_cache(self, tmp_path, monkeypatch):
        """T6-2: 用户画像更新后 prompt 重建并包含新记忆"""
        from autolink_hub.prompts.loader import get_system_prompt
        from autolink_hub.memory.engine import get_memory_engine
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        get_memory_engine().init_dir(str(tmp_path))
        p1 = get_system_prompt('general', '')
        get_memory_engine().update_user_profile(preferred_vendors=['Huawei'])
        p2 = get_system_prompt('general', '')
        assert p1 is not p2
        assert 'Huawei' in p2


# ============================================================
# asyncio 事件循环复用（T6-3）
# ============================================================

class TestAIEventLoop:
    def test_ai_loop_reused(self):
        """T6-3: _get_ai_loop 返回同一实例且未关闭（避免每次对话新建/泄漏）"""
        from engine import _get_ai_loop
        l1 = _get_ai_loop()
        l2 = _get_ai_loop()
        assert l1 is l2
        assert not l1.is_closed()


# ============================================================
# AI Hub 启动预热（T6-4）
# ============================================================

class TestStartupWarmup:
    def test_engine_warmup_idempotent(self, tmp_path, monkeypatch):
        """T6-4: engine 预热函数幂等（重复调用不重复初始化）"""
        from engine import _init_ai_hub
        from autolink_hub import hub as hub_module
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        _init_ai_hub()
        assert hub_module._hub_initialized is True
        _init_ai_hub()
        assert hub_module._hub_initialized is True
