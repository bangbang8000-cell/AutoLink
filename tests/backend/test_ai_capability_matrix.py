"""4.3 F3-5（测试计划 A-6）：AI 能力矩阵标准化评测（双端统一维度）

维度（与 MC《AI能力测试矩阵》对齐）：工具 / 对话 / 流式 / 权限 / 自主 / 技能 / 记忆 / 规划器。
AL 侧全部用例落地，供双端矩阵全绿门禁使用。
"""
import asyncio
import json
import time

import pytest

from autolink_hub.agent.tools import init_tools, get_tool_definitions, execute_tool
from autolink_hub.agent.schemas import (
    ToolPermission, get_tool_permission, resolve_tool_name, normalize_params,
)
from autolink_hub.agent.agent import AgentSession, _parse_tool_call, _compress_history
from autolink_hub.skills.engine import get_skills_engine
from autolink_hub.memory.engine import get_memory_engine
from autolink_hub.prompts.loader import get_system_prompt
from autolink_hub.agent.planner import get_planner_prompt
from autolink_hub.config import settings


# ============================================================
# Mock LLM Provider（自主/确认闭环用）
# ============================================================

class MockProvider:
    def __init__(self, responses):
        self._responses = list(responses)
        self.last_reasoning_content = ''

    @property
    def provider_name(self):
        return 'mock'

    async def chat_stream(self, messages, system_prompt='', **kwargs):
        for chunk in self._responses.pop(0):
            yield chunk


def _collect(session, rounds=3):
    async def run():
        parts = []
        async for c in session.run_stream(max_tool_rounds=rounds):
            parts.append(c)
        return ''.join(parts)
    return asyncio.run(run())


# ============================================================
# 维度 1：工具 Tool
# ============================================================

class TestDimTool:
    def test_whitelist_registered_and_executes(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        init_tools()
        names = {d['function']['name'] for d in get_tool_definitions()}
        # 设计/校验/导出/项目/模板/技能/容量/修复域均有注册
        for t in ('generate_design', 'validate_design', 'export_outputs', 'project_list',
                  'list_projects', 'update_project', 'create_from_template', 'preview_template',
                  'template_list', 'skill_list', 'capacity_recommend', 'repair_plan'):
            assert t in names
        # 只读工具可执行
        r = asyncio.run(execute_tool('list_config_schema', {}))
        assert r['success'] is True
        # 未知工具 → 可读错误
        r = asyncio.run(execute_tool('no_such_tool', {}))
        assert r['success'] is False and '未知工具' in r['error']

    def test_tool_name_alias_and_param_normalization(self):
        assert resolve_tool_name('edit_project')[0] == 'update_project'
        assert normalize_params({'project': 'p'}) == {'projectName': 'p'}
        assert normalize_params({'config': '/x.json'}) == {'configFile': '/x.json'}


# ============================================================
# 维度 2：对话 Chat
# ============================================================

class TestDimChat:
    def test_agent_session_add_and_run(self):
        session = AgentSession()
        session.session_id = 'chat-dim'
        session.add_user_message('你好')
        assert session.messages[-1]['role'] == 'user'
        assert session.messages[-1]['content'] == '你好'
        # 无 provider → 友好错误
        text = _collect(session)
        assert 'AI Provider' in text

    def test_attachment_paths_injected(self):
        session = AgentSession()
        session.add_user_message('解析附件', [
            {'name': 'a.xlsx', 'type': 'excel', 'path': 'C:/tmp/a.xlsx'},
        ])
        assert 'a.xlsx' in session.messages[-1]['content']
        assert 'C:/tmp/a.xlsx' in session.messages[-1]['content']


# ============================================================
# 维度 3：流式 SSE
# ============================================================

class TestDimSSE:
    def test_sse_send_streams_and_done(self):
        from al_ai_hub.main import create_app
        from autolink_hub.llm.provider import registry, LLMProvider
        from fastapi.testclient import TestClient

        class SseProvider(LLMProvider):
            @property
            def provider_name(self):
                return 'mock-sse'

            async def chat_stream(self, messages, system_prompt='', **kwargs):
                for piece in ['甲', '乙', '丙']:
                    yield piece

            async def chat(self, messages, system_prompt='', **kwargs):
                return '甲乙丙'

        try:
            registry.register('mock-sse', SseProvider())
            client = TestClient(create_app())
            with client.stream('POST', '/api/chat/send', json={
                'session_id': 'sse-dim', 'message': 'hi', 'provider': 'mock-sse',
            }) as resp:
                assert resp.status_code == 200
                lines = [l for l in resp.iter_lines() if l and l.startswith('data: ')]
            content = ''.join(
                json.loads(l[6:]).get('content', '')
                for l in lines if l.startswith('data: {"content"')
            )
            assert '甲乙丙' == content
            assert any('"status": "completed"' in l for l in lines)
        finally:
            registry._providers.clear()


# ============================================================
# 维度 4：权限（AUTO / NOTIFY / CONFIRM）
# ============================================================

class TestDimPermission:
    def test_permission_levels(self):
        assert get_tool_permission('list_projects') == ToolPermission.AUTO
        assert get_tool_permission('create_project') == ToolPermission.NOTIFY
        assert get_tool_permission('update_project') == ToolPermission.NOTIFY
        assert get_tool_permission('delete_project') == ToolPermission.CONFIRM
        assert get_tool_permission('unknown_tool') == ToolPermission.CONFIRM


# ============================================================
# 维度 5：自主 Autonomy（CONFIRM 需确认 / full_auto 直行 / 确认闭环）
# ============================================================

class TestDimAutonomy:
    @pytest.fixture
    def userdata(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        return tmp_path

    def test_semi_auto_confirm_interrupts(self, userdata):
        init_tools()
        session = AgentSession()
        session.session_id = 'auto-confirm'
        session.autonomy_mode = 'semi_auto'
        session.provider = MockProvider([
            ['删除项目。\n```tool_call\n{"name": "delete_project", "arguments": {"projectName": "p"}}\n```\n'],
        ])
        session.add_user_message('删除项目 p')
        text = _collect(session)
        assert '---CONFIRM:delete_project---' in text      # 结构化确认标记（确认卡片）
        assert '需要确认' in text
        assert session.pending_confirmation['name'] == 'delete_project'

    def test_confirm_loop_confirm_then_execute(self, userdata):
        """用户回复「确认」→ 执行 pending 工具 → LLM 汇总（确认流闭环）"""
        init_tools()
        # 先建一个真实项目，确认后执行删除
        r = asyncio.run(execute_tool('create_project', {'projectName': '确认删除项目'}))
        assert r['success'] is True and r['result']['success'] is True

        session = AgentSession()
        session.session_id = 'auto-confirm-loop'
        session.autonomy_mode = 'semi_auto'
        session.provider = MockProvider([
            ['```tool_call\n{"name": "delete_project", "arguments": {"projectName": "确认删除项目"}}\n```\n'],
            ['已删除该项目。'],
        ])
        session.add_user_message('删除项目 确认删除项目')
        text1 = _collect(session)
        assert session.pending_confirmation is not None

        # 用户回复「确认」→ 第二轮直接执行
        session.add_user_message('确认')
        text2 = _collect(session)
        assert '已确认，正在执行工具' in text2
        assert '确认删除项目' in text2
        assert session.pending_confirmation is None
        # 项目确实被删除（对话内完成）
        r = asyncio.run(execute_tool('project_info', {'name': '确认删除项目'}))
        assert r['success'] is True and r['result']['success'] is False

    def test_confirm_loop_cancel_aborts(self, userdata):
        init_tools()
        session = AgentSession()
        session.session_id = 'auto-cancel'
        session.autonomy_mode = 'semi_auto'
        session.provider = MockProvider([
            ['```tool_call\n{"name": "delete_project", "arguments": {"projectName": "x"}}\n```\n'],
        ])
        session.add_user_message('删除项目 x')
        _collect(session)
        assert session.pending_confirmation is not None
        session.add_user_message('取消')
        text = _collect(session)
        assert '已取消' in text
        assert session.pending_confirmation is None

    def test_full_auto_executes_confirm_tool(self, userdata):
        init_tools()
        session = AgentSession()
        session.session_id = 'auto-full'
        session.autonomy_mode = 'full_auto'
        session.provider = MockProvider([
            ['```tool_call\n{"name": "delete_project", "arguments": {"projectName": "y"}}\n```\n'],
        ])
        session.add_user_message('删除项目 y')
        text = _collect(session)
        assert '正在调用工具' in text
        assert session.pending_confirmation is None  # full_auto 不挂起确认


# ============================================================
# 维度 6：技能 Skills（库补齐：list/详情/启用禁用/保存/重载/使用统计）
# ============================================================

class TestDimSkills:
    @pytest.fixture
    def userdata(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        return tmp_path

    def test_skills_loaded(self):
        engine = get_skills_engine()
        names = [s['name'] for s in engine.list_skills()]
        assert 'room-layout' in names
        assert len(names) >= 7

    def test_skill_list_and_view_tools(self, userdata):
        init_tools()
        r = asyncio.run(execute_tool('skill_list', {}))
        assert r['success'] is True
        assert r['result']['total'] >= 7
        r = asyncio.run(execute_tool('skill_view', {'name': 'room-layout'}))
        assert r['success'] is True and 'content' in r['result']['skill']
        r = asyncio.run(execute_tool('skill_view', {'name': '__no_such__'}))
        assert r['success'] is True and r['result']['success'] is False

    def test_skill_enable_disable_persists(self, userdata):
        """禁用 → 持久化 → 重新加载引擎后仍禁用；启用恢复"""
        engine = get_skills_engine()
        assert engine.set_enabled('room-layout', False) is True
        assert engine.get_skill('room-layout').enabled is False
        # 重新加载（模拟重启）→ 状态从 skills_state.json 恢复
        engine.reload()
        assert engine.get_skill('room-layout').enabled is False
        assert engine.set_enabled('room-layout', True) is True
        # 禁用技能排除出 prompt
        engine.set_enabled('room-layout', False)
        prompt = get_skills_engine().get_skills_prompt()
        assert 'room-layout' not in prompt
        engine.set_enabled('room-layout', True)
        prompt2 = get_skills_engine().get_skills_prompt()
        assert 'room-layout' in prompt2
        # 未知技能 → False
        assert engine.set_enabled('__no_such__', True) is False

    def test_skill_save_and_record_usage(self, userdata, tmp_path, monkeypatch):
        # 隔离：save_skill 写入临时技能目录，避免污染仓库 skills/
        import autolink_hub.skills.engine as skills_mod
        monkeypatch.setattr(skills_mod, 'SKILLS_DIR', tmp_path / 'skills')
        (tmp_path / 'skills').mkdir(parents=True, exist_ok=True)
        engine = get_skills_engine()
        engine.save_skill('测试技能', '# 测试技能\n用于单测')
        assert engine.get_skill('测试技能') is not None
        engine.record_usage('测试技能')
        s = engine.get_skill('测试技能')
        assert s.use_count == 1 and s.last_used
        # 未知技能 record_usage 不崩溃
        engine.record_usage('__no_such__')


# ============================================================
# 维度 7：记忆 Memory（去抖写盘 / flush / prompt 缓存失效）
# ============================================================

class TestDimMemory:
    def test_debounce_flush_and_prompt_invalidation(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        engine = get_memory_engine()
        engine.init_dir(str(tmp_path))
        # 去抖窗口内高频 collect 不立即落盘
        engine.record_operation('projA', '调用 tool1')
        engine.record_operation('projA', '调用 tool2')
        history_file = tmp_path / 'memory' / 'project_history' / 'projA.json'
        assert not history_file.exists()
        # flush 强制落盘 → 数据完整（两次合并一次写）
        engine.flush()
        assert history_file.exists()
        data = json.loads(history_file.read_text(encoding='utf-8'))
        assert data['last_operations'] == ['调用 tool1', '调用 tool2']
        # 用户画像更新 → system prompt 缓存失效并包含新记忆
        p1 = get_system_prompt('general', '')
        engine.update_user_profile(preferred_vendors=['Huawei'])
        p2 = get_system_prompt('general', '')
        assert p1 is not p2
        assert 'Huawei' in p2

    def test_history_compression(self):
        messages = [{'role': 'user', 'content': 'x' * 5000}] * 8
        compressed = _compress_history(messages, max_chars=24000, keep_recent=3)
        assert len(compressed) == 4
        assert '压缩' in compressed[0]['content']
        assert compressed[-3:] == messages[-3:]


# ============================================================
# 维度 8：规划器 Planner
# ============================================================

class TestDimPlanner:
    def test_planner_prompt_structure(self):
        prompt = get_planner_prompt()
        assert '执行计划' in prompt
        assert '使用工具' in prompt
        assert '📋' in prompt

    def test_system_prompt_includes_planner(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        system = get_system_prompt('general', '')
        assert '执行规划' in system
        assert '执行计划' in system
