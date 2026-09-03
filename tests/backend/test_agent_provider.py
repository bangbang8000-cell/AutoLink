"""5.0.2-502：AgentProvider 抽象 + 引擎路由 + 配置 get/set + 会话隔离测试

覆盖：
- Provider 协议：AgentProvider ABC 四域接口（会话/工具/技能/记忆）+ 子类契约
- OwnAgentProvider：包装 AgentSession/Skills/Memory/tools（自有引擎适配）
- HermesAgentProvider：mock 探测成功/失败（未装 → AgentNotAvailableError 友好提示；
  已装 → 映射 hermes API + MEMORY.md/USER.md/SKILL.md）
- 引擎路由：get_engine/resolve_engine ∈ {own, hermes, auto}；auto 探测降级
- 配置 get/set：ai_engine 持久化 ai_secrets.json + diff 幂等
- 会话隔离：get_or_create_session 按 (engine, session_id) 命名空间，切换保留旧会话
"""
import asyncio
import json
import sys

import pytest

from autolink_hub.agent.provider import (
    AgentProvider, AgentNotAvailableError, OwnAgentProvider, HermesAgentProvider,
    hermes_available, get_engine, get_own_provider, get_hermes_provider,
    resolve_engine, engine_availability, reset_provider_registry,
    HERMES_INSTALL_HINT, HERMES_OFFICIAL_URL, ENGINE_OWN, ENGINE_HERMES, ENGINE_AUTO,
)
from autolink_hub.config import settings, AI_ENGINE_VALUES, AI_ENGINE_DEFAULT
from autolink_hub.agent.agent import get_or_create_session, clear_session, _sessions


@pytest.fixture(autouse=True)
def clean_state():
    """隔离全局状态：清空引擎注册表 + 复位引擎配置 + 隔离 secrets 目录"""
    reset_provider_registry()
    old_engine = settings.ai_engine
    old_ud = settings.user_data_dir
    settings.ai_engine = AI_ENGINE_DEFAULT
    yield
    settings.ai_engine = old_engine
    settings.user_data_dir = old_ud
    reset_provider_registry()


def _collect(agent: AgentProvider, **kwargs) -> str:
    async def run():
        parts = []
        async for chunk in agent.stream_chat(**kwargs):
            parts.append(chunk)
        return ''.join(parts)
    return asyncio.run(run())


# ============================================================
# Provider 协议 / 抽象基类
# ============================================================

class TestProviderProtocol:
    def test_agent_provider_is_abstract(self):
        """AgentProvider 是 ABC，不能直接实例化；四域方法为抽象接口"""
        with pytest.raises(TypeError):
            AgentProvider()  # type: ignore[abstract]
        for meth in ('stream_chat', 'clear_session', 'list_tools', 'execute_tool',
                     'list_skills', 'get_skill', 'get_memory_prompt'):
            assert hasattr(AgentProvider, meth)

    def test_providers_are_agent_provider_subclasses(self):
        assert issubclass(OwnAgentProvider, AgentProvider)
        assert issubclass(HermesAgentProvider, AgentProvider)

    def test_engine_name_contract(self):
        assert get_own_provider().engine_name == ENGINE_OWN
        assert (ENGINE_OWN, ENGINE_HERMES, ENGINE_AUTO) == ('own', 'hermes', 'auto')


# ============================================================
# OwnAgentProvider（自有引擎适配）
# ============================================================

class TestOwnAgentProvider:
    def test_list_tools_and_execute(self):
        from autolink_hub.agent.tools import init_tools
        init_tools()
        provider = get_own_provider()
        defs = provider.list_tools()
        assert len(defs) >= 21
        names = {d['function']['name'] for d in defs}
        assert 'list_config_schema' in names
        # 只读工具执行
        r = asyncio.run(provider.execute_tool('list_config_schema', {}))
        assert r['success'] is True
        r2 = asyncio.run(provider.execute_tool('no_such_tool', {}))
        assert r2['success'] is False and '未知工具' in r2['error']

    def test_list_skills_and_get_skill(self):
        provider = get_own_provider()
        skills = provider.list_skills()
        assert len(skills) >= 7
        assert 'room-layout' in [s['name'] for s in skills]
        detail = provider.get_skill('room-layout')
        assert detail is not None and 'content' in detail and detail['enabled'] is True
        assert provider.get_skill('__no_such__') is None

    def test_get_memory_prompt(self, tmp_path, monkeypatch):
        from autolink_hub.memory.engine import get_memory_engine
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        get_memory_engine().init_dir(str(tmp_path))
        get_memory_engine().update_user_profile(preferred_vendors=['Huawei'])
        provider = get_own_provider()
        prompt = provider.get_memory_prompt('proj')
        assert 'Huawei' in prompt

    def test_stream_chat_routes_to_agent_session(self, tmp_path, monkeypatch):
        """own 引擎流式对话：注册 mock LLM Provider，走 AgentSession 完整链路"""
        from autolink_hub.agent.tools import init_tools
        from autolink_hub.llm.provider import registry
        from autolink_hub.memory.engine import get_memory_engine
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        get_memory_engine().init_dir(str(tmp_path))
        init_tools()

        class MockProvider:
            @property
            def provider_name(self):
                return 'mock-provider'

            async def chat_stream(self, messages, system_prompt='', **kwargs):
                yield '你好'
                yield '，世界'

        registry.register('mock-provider', MockProvider())
        provider = get_own_provider()
        text = _collect(provider, session_id='own-s1', message='hi',
                        provider='mock-provider', mode='general')
        assert '你好，世界' in text

    def test_clear_session(self, tmp_path, monkeypatch):
        from autolink_hub.agent.agent import get_or_create_session as _goc
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        _goc('own-clear', engine='own')
        _goc('own-clear', engine='hermes')
        assert ('own', 'own-clear') in _sessions
        get_own_provider().clear_session('own-clear')
        assert ('own', 'own-clear') not in _sessions
        assert ('hermes', 'own-clear') in _sessions  # 其他引擎保留


# ============================================================
# HermesAgentProvider（mock 探测成功/失败）
# ============================================================

class FakeHermesModule:
    """模拟 hermes 运行时（适配契约：stream_chat / chat）"""

    def __init__(self):
        self.calls = []

    async def stream_chat(self, messages, system_prompt='', tools=None):
        self.calls.append(('stream_chat', list(messages), system_prompt, tools))
        yield '你好'
        yield '，世界'

    async def chat(self, messages, system_prompt='', tools=None):
        self.calls.append(('chat', list(messages), system_prompt, tools))
        return '你好，世界'


class TestHermesAgentProvider:
    def test_not_installed_raises_friendly_error(self, monkeypatch):
        """未安装：构造抛 AgentNotAvailableError，文案含 pip install + 官网"""
        import autolink_hub.agent.provider as prov_mod
        monkeypatch.setattr(prov_mod.importlib.util, 'find_spec',
                            lambda name: None)
        assert hermes_available() is False
        with pytest.raises(AgentNotAvailableError) as exc:
            HermesAgentProvider()
        msg = str(exc.value)
        assert 'pip install hermes-agent' in msg
        assert HERMES_OFFICIAL_URL in msg
        assert HERMES_INSTALL_HINT in msg

    @pytest.fixture
    def hermes_installed(self, tmp_path, monkeypatch):
        """模拟 hermes 已安装：find_spec 命中 + sys.modules 注入假模块"""
        import sys
        import autolink_hub.agent.provider as prov_mod
        fake = FakeHermesModule()
        monkeypatch.setattr(
            prov_mod.importlib.util, 'find_spec',
            lambda name: object() if name in prov_mod.HERMES_MODULES else None,
        )
        monkeypatch.setitem(sys.modules, 'hermes', fake)
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        return fake

    def test_installed_probe_and_engine_name(self, hermes_installed):
        assert hermes_available() is True
        provider = HermesAgentProvider()
        assert provider.engine_name == ENGINE_HERMES
        assert provider._load() is hermes_installed

    def test_stream_chat_async_api(self, hermes_installed, tmp_path):
        provider = HermesAgentProvider()
        text = _collect(provider, session_id='hermes-s1', message='hi', mode='general')
        assert '你好，世界' in text
        # 历史追加 user/assistant
        history = provider._sessions['hermes-s1']
        assert [m['role'] for m in history] == ['user', 'assistant']
        assert history[0]['content'] == 'hi'
        # hermes 收到 messages/system_prompt/tools（AutoLink 白名单）
        kind, messages, system_prompt, tools = hermes_installed.calls[0]
        assert kind == 'stream_chat'
        assert 'AutoLink' in system_prompt
        assert tools and isinstance(tools, list)

    def test_stream_chat_sync_fallback(self, hermes_installed, tmp_path):
        """hermes 仅提供同步 chat（无 stream_chat）时回退非流式"""
        hermes_installed.stream_chat = None  # 实例属性遮蔽类方法 → 走 chat 回退
        provider = HermesAgentProvider()
        text = _collect(provider, session_id='hermes-s2', message='hi')
        assert '你好，世界' in text
        assert hermes_installed.calls[0][0] == 'chat'

    def test_clear_session(self, hermes_installed):
        provider = HermesAgentProvider()
        _collect(provider, session_id='hermes-c1', message='a')
        assert 'hermes-c1' in provider._sessions
        provider.clear_session('hermes-c1')
        assert 'hermes-c1' not in provider._sessions

    def test_memory_and_skills_native_files(self, hermes_installed, tmp_path):
        """Hermes 原生 MEMORY.md / USER.md / SKILL.md 映射"""
        hermes_dir = tmp_path / 'hermes'
        hermes_dir.mkdir()
        (hermes_dir / 'USER.md').write_text('常用厂商: Huawei', encoding='utf-8')
        (hermes_dir / 'MEMORY.md').write_text('用户偏好 800G IB', encoding='utf-8')
        (hermes_dir / 'SKILL.md').write_text('# 技能\n机房布局技能', encoding='utf-8')
        provider = HermesAgentProvider()
        memory = provider.get_memory_prompt('proj')
        assert 'Huawei' in memory and '800G IB' in memory
        skills = provider.list_skills()
        assert len(skills) == 1 and 'SKILL.md' == skills[0]['name']
        assert '机房布局技能' in skills[0]['content']
        detail = provider.get_skill('skill.md')
        assert detail is not None and 'content' in detail
        assert provider.get_skill('__no_such__') is None
        # 无记忆文件 → 空 prompt
        (hermes_dir / 'MEMORY.md').unlink()
        (hermes_dir / 'USER.md').unlink()
        assert provider.get_memory_prompt() == ''


# ============================================================
# 引擎路由（get_engine / resolve_engine / auto 探测降级）
# ============================================================

class TestEngineRouting:
    def test_resolve_engine_modes(self, monkeypatch):
        import autolink_hub.agent.provider as prov_mod
        monkeypatch.setattr(prov_mod.importlib.util, 'find_spec', lambda name: None)
        assert resolve_engine('own') == ENGINE_OWN
        assert resolve_engine('hermes') == ENGINE_HERMES
        assert resolve_engine('auto') == ENGINE_OWN  # hermes 未安装 → 降级 own
        assert resolve_engine('  OWN ') == ENGINE_OWN
        assert resolve_engine('') == ENGINE_OWN

    def test_resolve_auto_uses_hermes_when_installed(self, hermes_installed_fixture):
        assert resolve_engine('auto') == ENGINE_HERMES

    @pytest.fixture
    def hermes_installed_fixture(self, monkeypatch):
        import sys
        import autolink_hub.agent.provider as prov_mod
        monkeypatch.setattr(
            prov_mod.importlib.util, 'find_spec',
            lambda name: object() if name in prov_mod.HERMES_MODULES else None,
        )
        monkeypatch.setitem(sys.modules, 'hermes', FakeHermesModule())
        return True

    def test_get_engine_own(self, monkeypatch):
        import autolink_hub.agent.provider as prov_mod
        monkeypatch.setattr(prov_mod.importlib.util, 'find_spec', lambda name: None)
        eng = get_engine('own')
        assert isinstance(eng, OwnAgentProvider)
        # auto（hermes 未安装）→ own 单例
        assert get_engine('auto') is get_own_provider()

    def test_get_engine_hermes_not_installed_raises(self, monkeypatch):
        import autolink_hub.agent.provider as prov_mod
        monkeypatch.setattr(prov_mod.importlib.util, 'find_spec', lambda name: None)
        with pytest.raises(AgentNotAvailableError):
            get_engine('hermes')

    def test_get_engine_auto_falls_back_to_own(self, monkeypatch):
        import autolink_hub.agent.provider as prov_mod
        monkeypatch.setattr(prov_mod.importlib.util, 'find_spec', lambda name: None)
        eng = get_engine('auto')
        assert isinstance(eng, OwnAgentProvider)

    def test_get_engine_hermes_installed(self, hermes_installed_fixture):
        reset_provider_registry()
        eng = get_engine('hermes')
        assert isinstance(eng, HermesAgentProvider)

    def test_engine_availability(self, monkeypatch):
        import autolink_hub.agent.provider as prov_mod
        monkeypatch.setattr(prov_mod.importlib.util, 'find_spec', lambda name: None)
        avail = engine_availability()
        assert avail['own']['available'] is True
        assert avail['hermes']['available'] is False
        assert 'pip install hermes-agent' in avail['hermes']['install_hint']
        assert HERMES_OFFICIAL_URL == avail['hermes']['official_url']


# ============================================================
# 配置 get/set（ai_engine 三选一，持久化 ai_secrets.json）
# ============================================================

class TestEngineConfig:
    def test_default_engine_is_own(self):
        assert AI_ENGINE_DEFAULT == 'own'
        assert AI_ENGINE_VALUES == ('own', 'hermes', 'auto')
        from autolink_hub.config import get_ai_engine
        assert get_ai_engine() == 'own'

    def test_set_persists_and_apply(self, tmp_path, monkeypatch):
        from autolink_hub.config import set_ai_engine, get_ai_engine, apply_secrets
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        r = set_ai_engine('hermes')
        assert r['status'] == 'ok' and r['ai_engine'] == 'hermes' and r['changed'] is True
        assert settings.ai_engine == 'hermes'
        assert get_ai_engine() == 'hermes'
        secrets = json.loads((tmp_path / 'ai_secrets.json').read_text(encoding='utf-8'))
        assert secrets['ai_engine'] == 'hermes'
        # apply_secrets 重新加载（模拟重启）
        settings.ai_engine = 'own'
        apply_secrets()
        assert settings.ai_engine == 'hermes'

    def test_set_idempotent(self, tmp_path, monkeypatch):
        from autolink_hub.config import set_ai_engine
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        assert set_ai_engine('auto')['changed'] is True
        assert set_ai_engine('auto')['changed'] is False

    def test_set_invalid_raises(self, tmp_path, monkeypatch):
        from autolink_hub.config import set_ai_engine
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        with pytest.raises(ValueError):
            set_ai_engine('bogus')

    def test_ai_engine_excluded_from_provider_configs(self, tmp_path, monkeypatch):
        from autolink_hub.config import set_ai_engine, apply_secrets
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        set_ai_engine('hermes')
        apply_secrets()
        assert 'ai_engine' not in settings.provider_configs


# ============================================================
# 会话隔离（engine 维度命名空间）
# ============================================================

class TestSessionIsolation:
    def test_same_engine_reuses_same_session(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        s1 = get_or_create_session('sess', engine='own')
        s2 = get_or_create_session('sess', engine='own')
        assert s1 is s2
        assert s1.engine == 'own'

    def test_different_engine_distinct_namespace(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        own = get_or_create_session('sess', engine='own')
        hermes = get_or_create_session('sess', engine='hermes')
        assert own is not hermes
        assert own.engine == 'own' and hermes.engine == 'hermes'
        # 切换引擎保留旧会话（own 命名空间仍存在）
        assert ('own', 'sess') in _sessions
        assert ('hermes', 'sess') in _sessions

    def test_clear_only_target_engine(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        get_or_create_session('sess', engine='own')
        get_or_create_session('sess', engine='hermes')
        clear_session('sess', engine='own')
        assert ('own', 'sess') not in _sessions
        assert ('hermes', 'sess') in _sessions
        # 向后兼容：单参调用默认 own
        get_or_create_session('s2', engine='own')
        clear_session('s2')
        assert ('own', 's2') not in _sessions

    def test_default_engine_backward_compatible(self, tmp_path, monkeypatch):
        monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        s = get_or_create_session('legacy')
        assert s.engine == 'own'
