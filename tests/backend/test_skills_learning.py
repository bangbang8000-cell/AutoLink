"""5.0.3-503-b：技能自学习闭环测试

覆盖 backend/autolink_hub/skills/engine.py：
- record_feedback 持久化反馈（成功/失败/最近样本/成功率）+ 达阈值自动触发自学习修订
- maybe_optimize_skill / append_learning_record：追加结构化「自学习改进记录」到技能 md + 元数据
- save_skill 技能级元数据（伴生 <name>.metadata.json，保持纯 md 兼容）
- record_tool_outcome / skill_name_from_tool_args（run_stream 接线辅助）

覆盖 agent/tools.py：
- skill_update / skill_save（写技能内容，对齐 MC update_skill）
- skill_optimize（主动优化）

覆盖 run_stream 接线：技能工具执行成功 → record_usage + 反馈采集。
"""
import asyncio
import json

import pytest

from autolink_hub.skills import engine as skills_engine
from autolink_hub.skills.engine import (
    SkillsEngine, get_skills_engine, record_tool_outcome, skill_name_from_tool_args,
    SKILL_TOOL_NAMES,
)
from autolink_hub.agent.tools import init_tools, get_tool_definitions, execute_tool
from autolink_hub.agent.schemas import get_tool_permission, ToolPermission


def _isolate(tmp_path, monkeypatch):
    """把 SKILLS_DIR/用户数据重定向到临时目录并重置引擎单例，避免污染真实技能库。"""
    fake = tmp_path / 'skills'
    fake.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(skills_engine, 'SKILLS_DIR', fake)
    monkeypatch.setattr(skills_engine, '_engine', None)
    monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path / 'ud'))
    from autolink_hub.config import settings
    settings.user_data_dir = str(tmp_path / 'ud')
    return fake


@pytest.fixture(autouse=True)
def clean_state():
    yield
    skills_engine._engine = None


# ============================================================
# record_feedback / 反馈统计
# ============================================================

class TestSkillFeedback:
    def test_record_feedback_persists(self, tmp_path, monkeypatch):
        fake = _isolate(tmp_path, monkeypatch)
        (fake / 'alpha.md').write_text('# Alpha 技能', encoding='utf-8')
        engine = get_skills_engine()
        r = engine.record_feedback('alpha', True, '调用成功')
        assert r['ok'] is True
        assert r['feedback']['total'] == 1
        assert r['feedback']['success'] == 1
        assert r['feedback']['success_rate'] == 1.0
        assert r['feedback']['recent'][0]['detail'] == '调用成功'
        # 落盘
        fb_path = tmp_path / 'ud' / 'skill_feedback' / 'alpha.json'
        assert fb_path.exists()
        data = json.loads(fb_path.read_text(encoding='utf-8'))
        assert data['total'] == 1

    def test_record_feedback_success_rate(self, tmp_path, monkeypatch):
        fake = _isolate(tmp_path, monkeypatch)
        (fake / 'alpha.md').write_text('# Alpha 技能', encoding='utf-8')
        engine = get_skills_engine()
        engine.record_feedback('alpha', True)
        engine.record_feedback('alpha', False)
        engine.record_feedback('alpha', True)
        fb = engine.get_skill_feedback('alpha')
        assert fb['total'] == 3 and fb['success'] == 2 and fb['failure'] == 1
        assert fb['success_rate'] == pytest.approx(2 / 3, abs=0.001)

    def test_record_feedback_unknown_skill(self, tmp_path, monkeypatch):
        _isolate(tmp_path, monkeypatch)
        engine = get_skills_engine()
        r = engine.record_feedback('__no_such__', True)
        assert r['ok'] is False

    def test_get_skill_feedback_none_for_unknown(self, tmp_path, monkeypatch):
        _isolate(tmp_path, monkeypatch)
        assert get_skills_engine().get_skill_feedback('__no_such__') is None

    def test_recent_samples_capped(self, tmp_path, monkeypatch):
        fake = _isolate(tmp_path, monkeypatch)
        (fake / 'alpha.md').write_text('# Alpha 技能', encoding='utf-8')
        engine = get_skills_engine()
        for i in range(25):
            engine.record_feedback('alpha', True, f'sample-{i}')
        fb = engine.get_skill_feedback('alpha')
        assert len(fb['recent']) == 20
        assert fb['recent'][-1]['detail'] == 'sample-24'


# ============================================================
# 自学习触发器 / 改进记录
# ============================================================

class TestSelfLearning:
    def test_below_threshold_no_optimize(self, tmp_path, monkeypatch):
        fake = _isolate(tmp_path, monkeypatch)
        (fake / 'alpha.md').write_text('# Alpha 技能', encoding='utf-8')
        engine = get_skills_engine()
        engine.record_feedback('alpha', False)  # total=1 < threshold=3
        r = engine.maybe_optimize_skill('alpha')
        assert r['optimized'] is False
        assert '自学习改进记录' not in engine.get_skill('alpha').content

    def test_threshold_low_success_triggers_optimize(self, tmp_path, monkeypatch):
        fake = _isolate(tmp_path, monkeypatch)
        (fake / 'alpha.md').write_text('# Alpha 技能\n\n正文', encoding='utf-8')
        engine = get_skills_engine()
        engine.record_feedback('alpha', False, '步骤参数描述不清')
        engine.record_feedback('alpha', False, '步骤参数描述不清')
        engine.record_feedback('alpha', True, '正常')  # 第 3 条达阈值，成功率 1/3 < 0.5
        skill = engine.get_skill('alpha')
        assert '自学习改进记录' in skill.content
        assert '步骤参数描述不清' in skill.content
        # 元数据同步
        assert skill.metadata.get('optimized_count') == 1
        assert len(skill.metadata.get('learning_records', [])) == 1

    def test_force_optimize_appends_numbered_entries(self, tmp_path, monkeypatch):
        fake = _isolate(tmp_path, monkeypatch)
        (fake / 'alpha.md').write_text('# Alpha 技能', encoding='utf-8')
        engine = get_skills_engine()
        engine.maybe_optimize_skill('alpha', force=True, notes='第一轮')
        engine.maybe_optimize_skill('alpha', force=True, notes='第二轮')
        content = engine.get_skill('alpha').content
        assert content.count('原因:') == 2
        assert '1. ' in content and '2. ' in content
        assert engine.get_skill('alpha').metadata['optimized_count'] == 2

    def test_high_success_no_auto_optimize(self, tmp_path, monkeypatch):
        fake = _isolate(tmp_path, monkeypatch)
        (fake / 'alpha.md').write_text('# Alpha 技能', encoding='utf-8')
        engine = get_skills_engine()
        for _ in range(4):
            engine.record_feedback('alpha', True)
        assert '自学习改进记录' not in engine.get_skill('alpha').content

    def test_unknown_skill(self, tmp_path, monkeypatch):
        _isolate(tmp_path, monkeypatch)
        r = get_skills_engine().maybe_optimize_skill('__no_such__')
        assert r['ok'] is False


# ============================================================
# save_skill 技能级元数据（伴生 metadata）
# ============================================================

class TestSkillMetadata:
    def test_save_skill_with_metadata(self, tmp_path, monkeypatch):
        fake = _isolate(tmp_path, monkeypatch)
        engine = get_skills_engine()
        skill = engine.save_skill('我的技能', '# 我的技能', metadata={'learning_records': [], 'optimized_count': 0})
        assert (fake / '我的技能.md').exists()
        assert (fake / '我的技能.metadata.json').exists()
        assert skill.name == '我的技能'
        # 重新加载引擎 → metadata 自动读入
        skills_engine._engine = None
        engine2 = get_skills_engine()
        assert engine2.get_skill('我的技能').metadata.get('optimized_count') == 0

    def test_save_skill_keeps_pure_md(self, tmp_path, monkeypatch):
        fake = _isolate(tmp_path, monkeypatch)
        engine = get_skills_engine()
        engine.save_skill('plain', '# Plain 技能\n正文', metadata={'learning_records': []})
        content = (fake / 'plain.md').read_text(encoding='utf-8')
        assert content == '# Plain 技能\n正文'  # md 保持纯内容
        assert (fake / 'plain.metadata.json').exists()


# ============================================================
# 工具接线：skill_update / skill_save / skill_optimize
# ============================================================

class TestSkillTools:
    def test_tools_registered_with_permissions(self):
        init_tools()
        defs = {d['function']['name']: d['function'] for d in get_tool_definitions()}
        for name in ('skill_update', 'skill_save', 'skill_optimize'):
            assert name in defs
            assert get_tool_permission(name) == ToolPermission.NOTIFY

    def test_skill_update_writes_content(self, tmp_path, monkeypatch):
        fake = _isolate(tmp_path, monkeypatch)
        init_tools()
        r = asyncio.run(execute_tool('skill_update', {
            'name': 'new-skill', 'content': '# 新技能\n步骤 1...',
        }))
        assert r['success'] is True
        assert r['result']['skill'] == 'new-skill'
        assert (fake / 'new-skill.md').exists()
        assert (fake / 'new-skill.md').read_text(encoding='utf-8') == '# 新技能\n步骤 1...'

    def test_skill_update_validation(self, tmp_path, monkeypatch):
        _isolate(tmp_path, monkeypatch)
        init_tools()
        # 空技能名 → handler 空值校验（参数校验不拦截空串）
        r = asyncio.run(execute_tool('skill_update', {'name': '', 'content': 'x'}))
        assert r['success'] is True and r['result']['success'] is False
        assert '技能名不能为空' in r['result']['error']
        # 缺必填 content → execute_tool 参数校验拦截
        r0 = asyncio.run(execute_tool('skill_update', {'name': 'x'}))
        assert r0['success'] is True and r0['result']['success'] is False
        assert '缺少必填参数: content' in r0['result']['error']
        # 空内容 → handler 空值校验
        r2 = asyncio.run(execute_tool('skill_update', {'name': 'x', 'content': ''}))
        assert r2['success'] is True and r2['result']['success'] is False

    def test_skill_save_alias(self, tmp_path, monkeypatch):
        fake = _isolate(tmp_path, monkeypatch)
        init_tools()
        r = asyncio.run(execute_tool('skill_save', {'name': 'alias-skill', 'content': '# 别名技能'}))
        assert r['success'] is True and (fake / 'alias-skill.md').exists()

    def test_skill_optimize_tool(self, tmp_path, monkeypatch):
        fake = _isolate(tmp_path, monkeypatch)
        (fake / 'alpha.md').write_text('# Alpha 技能', encoding='utf-8')
        init_tools()
        r = asyncio.run(execute_tool('skill_optimize', {'name': 'alpha', 'notes': '参数需补充'}))
        assert r['success'] is True
        assert r['result']['optimized'] is True
        assert (fake / 'alpha.md').read_text(encoding='utf-8').count('## 🔄 自学习改进记录') == 1
        assert (fake / 'alpha.metadata.json').exists()

    def test_skill_optimize_unknown(self, tmp_path, monkeypatch):
        _isolate(tmp_path, monkeypatch)
        init_tools()
        r = asyncio.run(execute_tool('skill_optimize', {'name': '__no_such__'}))
        assert r['success'] is True and r['result']['success'] is False


# ============================================================
# record_tool_outcome（run_stream 接线辅助）
# ============================================================

class TestToolOutcome:
    def test_skill_name_from_tool_args(self):
        assert skill_name_from_tool_args('skill_view', {'name': 'room-layout'}) == 'room-layout'
        assert skill_name_from_tool_args('skill_update', {'name': 'my skill'}) == 'my skill'
        assert skill_name_from_tool_args('list_config_schema', {}) == ''
        assert skill_name_from_tool_args('skill_view', {}) == ''

    def test_record_tool_outcome_success(self, tmp_path, monkeypatch):
        fake = _isolate(tmp_path, monkeypatch)
        (fake / 'alpha.md').write_text('# Alpha 技能', encoding='utf-8')
        r = record_tool_outcome('skill_view', {'name': 'alpha'}, True, '执行成功')
        assert r['ok'] is True and r['skill'] == 'alpha'
        engine = get_skills_engine()
        assert engine.get_skill('alpha').use_count == 1
        assert engine.get_skill_feedback('alpha')['total'] == 1

    def test_record_tool_outcome_failure_feedback(self, tmp_path, monkeypatch):
        fake = _isolate(tmp_path, monkeypatch)
        (fake / 'alpha.md').write_text('# Alpha 技能', encoding='utf-8')
        r = record_tool_outcome('skill_view', {'name': 'alpha'}, False, '失败原因')
        assert r['ok'] is True
        assert get_skills_engine().get_skill_feedback('alpha')['failure'] == 1
        # 失败不记使用
        assert get_skills_engine().get_skill('alpha').use_count == 0

    def test_record_tool_outcome_non_skill_noop(self, tmp_path, monkeypatch):
        _isolate(tmp_path, monkeypatch)
        r = record_tool_outcome('list_config_schema', {}, True)
        assert r['ok'] is False

    def test_record_tool_outcome_unknown_skill(self, tmp_path, monkeypatch):
        _isolate(tmp_path, monkeypatch)
        r = record_tool_outcome('skill_view', {'name': '__no_such__'}, True)
        assert r['ok'] is False


# ============================================================
# run_stream 接线：技能工具执行 → record_usage + 反馈采集
# ============================================================

class TestRunStreamWiring:
    def test_skill_tool_success_records_usage(self, tmp_path, monkeypatch):
        """mock LLM 调用 skill_view → run_stream 成功后 record_usage + record_feedback"""
        fake = _isolate(tmp_path, monkeypatch)
        (fake / 'alpha.md').write_text('# Alpha 技能', encoding='utf-8')
        from autolink_hub.agent.tools import init_tools
        from autolink_hub.llm.provider import registry
        from autolink_hub.agent.agent import get_or_create_session, _sessions
        from autolink_hub.memory.engine import get_memory_engine
        get_memory_engine().init_dir(str(tmp_path))
        init_tools()
        _sessions.clear()

        class MockProvider:
            @property
            def provider_name(self):
                return 'sk-mock'

            async def chat_stream(self, messages, system_prompt='', **kwargs):
                yield '```tool_call\n{"name": "skill_view", "arguments": {"name": "alpha"}}\n```'

        registry._providers.clear()
        registry.register('sk-mock', MockProvider())
        session = get_or_create_session('sk-s1', engine='own')
        session.set_provider('sk-mock')
        session.set_mode('general', '')
        session.add_user_message('看看 alpha 技能')

        async def run():
            out = ''
            async for c in session.run_stream(max_tool_rounds=1):
                out += c
            return out

        asyncio.run(run())
        engine = get_skills_engine()
        assert engine.get_skill('alpha').use_count == 1
        assert engine.get_skill_feedback('alpha')['total'] == 1
