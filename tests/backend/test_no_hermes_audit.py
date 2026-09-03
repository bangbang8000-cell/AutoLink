"""5.0.2-502-c：Hermes 并存接入审计（修订 4.3 A-7「无 Hermes/外部 Agent 平台」）

4.0 系列原「不引入 Hermes / 外部 Agent 平台（统一底座移 5.0）」在本版放宽为「Hermes 并存」：
- Hermes 必须经 AgentProvider 适配（backend/autolink_hub/agent/provider.py）注册并配置声明
  （config.py AI_ENGINE_VALUES），未安装（importlib find_spec 失败）时不可用（友好提示），
  不真实 pip 安装（依赖清单不硬依赖）
- 其他外部 Agent 平台（harness/langchain/langgraph/crewai/autogen/...）仍为 BANNED
- 其余不变：AI Hub 仍用内置 LLM Provider（openai 兼容直连）

静态审计：
- 依赖清单（requirements*.txt / package.json）不包含任何被禁平台，且不硬依赖 hermes
- 后端源码 hermes 相关 import 仅允许出现在 AgentProvider 适配器（provider.py）
- hermes 品牌标识仅允许出现在适配器/配置声明/引擎端点/测试中
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # 仓库根（AIDC AutoLink-Client）

# 外部 Agent 平台 / 编排框架黑名单（除 hermes 外全部保留拦截）
FORBIDDEN_DEPS = {
    'harness', 'langchain', 'langgraph', 'crewai', 'autogen', 'ag2',
    'openai-agents', 'agents-sdk', 'semantic-kernel', 'haystack', 'llamaindex',
}

FORBIDDEN_IMPORT_PATTERNS = [
    r'^\s*(from|import)\s+harness',
    r'^\s*(from|import)\s+langchain',
    r'^\s*(from|import)\s+crewai',
    r'^\s*(from|import)\s+autogen',
]

# Hermes 适配/声明允许出现的文件（相对仓库根，.py）
HERMES_ALLOWED_FILES = {
    'backend/autolink_hub/agent/provider.py',   # AgentProvider 适配器（探测 + 惰性 import）
    'backend/autolink_hub/agent/agent.py',       # 会话引擎命名空间隔离（502-b）
    'backend/autolink_hub/config.py',            # AI_ENGINE_VALUES 配置声明
    'backend/al_ai_hub/api/chat.py',             # /engine 端点 + 未安装提示
    'tests/backend/test_no_hermes_audit.py',     # 本审计文件自身
    'tests/backend/test_agent_provider.py',      # 502 新增测试
}


class TestNoHermesAudit:
    def test_backend_requirements_no_agent_platform(self):
        for req in [ROOT / 'backend' / 'requirements.txt', ROOT / 'backend' / 'requirements-dev.txt']:
            assert req.exists(), f'缺少依赖清单: {req}'
            text = req.read_text(encoding='utf-8').lower()
            for dep in FORBIDDEN_DEPS:
                assert dep not in text, f'依赖清单含被禁平台: {dep} in {req.name}'
            # 5.0.2-502-c：hermes 不作为硬依赖（探测式加载，未装不可用）
            assert 'hermes' not in text, f'依赖清单不应硬依赖 hermes（可选适配）：{req.name}'

    def test_package_json_no_agent_platform(self):
        pkg = ROOT / 'package.json'
        text = pkg.read_text(encoding='utf-8').lower()
        for dep in FORBIDDEN_DEPS:
            assert dep not in text, f'package.json 含被禁平台依赖: {dep}'
        assert 'hermes' not in text, 'package.json 不应声明 hermes 依赖'

    def test_backend_source_no_forbidden_imports(self):
        """backend 源码：无 harness/langchain/crewai/autogen 等被禁框架 import"""
        backend = ROOT / 'backend'
        hits = []
        for py in sorted(backend.rglob('*.py')):
            if 'backend-dist' in str(py):
                continue
            for i, line in enumerate(py.read_text(encoding='utf-8', errors='ignore').splitlines(), 1):
                for pat in FORBIDDEN_IMPORT_PATTERNS:
                    if re.match(pat, line):
                        hits.append(f'{py.relative_to(ROOT)}:{i}: {line.strip()}')
        assert not hits, f'发现被禁平台 import:\n' + '\n'.join(hits)

    def test_hermes_imports_only_in_provider_adapter(self):
        """Hermes import 仅允许在 AgentProvider 适配器（provider.py）中（探测确认后惰性加载）"""
        backend = ROOT / 'backend'
        hits = []
        for py in sorted(backend.rglob('*.py')):
            if 'backend-dist' in str(py):
                continue
            rel = py.relative_to(ROOT).as_posix()
            for i, line in enumerate(py.read_text(encoding='utf-8', errors='ignore').splitlines(), 1):
                m = re.match(r'^\s*(?:from\s+(hermes|hermes_agent)|import\s+(hermes|hermes_agent))', line)
                if m and rel != 'backend/autolink_hub/agent/provider.py':
                    hits.append(f'{rel}:{i}: {line.strip()}')
        assert not hits, f'Hermes import 必须在 provider.py 适配器内（AgentProvider 注册）:\n' + '\n'.join(hits)

    def test_hermes_registered_via_agent_provider(self):
        """Hermes 必须经 AgentProvider 注册且配置声明：provider.py 探测 + config.py 声明 + 引擎路由"""
        provider_file = ROOT / 'backend' / 'autolink_hub' / 'agent' / 'provider.py'
        config_file = ROOT / 'backend' / 'autolink_hub' / 'config.py'
        text = provider_file.read_text(encoding='utf-8')
        # 探测式加载：importlib find_spec，不真实 pip 安装
        assert 'importlib.util.find_spec' in text or 'find_spec' in text
        assert 'AgentNotAvailableError' in text
        assert 'pip install hermes-agent' in text
        assert 'get_engine' in text and 'resolve_engine' in text
        # 配置声明：AI_ENGINE_VALUES 含 hermes
        cfg = config_file.read_text(encoding='utf-8')
        assert 'hermes' in cfg and 'AI_ENGINE_VALUES' in cfg

    def test_hermes_brand_allowed_only_in_declared_files(self):
        """hermes 品牌标识仅允许出现在适配器/配置声明/引擎端点/测试中（其余 backend 文件禁止）"""
        backend = ROOT / 'backend'
        hits = []
        for f in sorted(backend.rglob('*')):
            if not f.is_file() or 'backend-dist' in str(f):
                continue
            if f.suffix not in ('.py', '.md', '.json', '.toml', '.ini'):
                continue
            rel = f.relative_to(ROOT).as_posix()
            if rel in HERMES_ALLOWED_FILES:
                continue
            try:
                text = f.read_text(encoding='utf-8', errors='ignore')
            except OSError:
                continue
            for i, line in enumerate(text.splitlines(), 1):
                if re.search(r'\bhermes\b', line, re.IGNORECASE):
                    hits.append(f'{rel}:{i}: {line.strip()[:80]}')
        assert not hits, 'hermes 引用必须在声明文件内（AgentProvider 适配/配置/引擎端点）:\n' + '\n'.join(hits)

    def test_ai_hub_uses_builtin_llm_provider(self):
        """AI Hub 使用内置 LLM Provider（openai 兼容直连），非外部 Agent 平台"""
        provider_file = ROOT / 'backend' / 'autolink_hub' / 'llm' / 'provider.py'
        assert provider_file.exists()
        text = provider_file.read_text(encoding='utf-8')
        assert 'openai' in text.lower()  # openai 兼容客户端（BYO-Key 直连，非平台托管）
        assert 'hermes' not in text.lower()

    def test_mcp_is_protocol_layer_allowed(self):
        """5.0.3-503-c: MCP 是协议层（非 Agent 框架），允许作为依赖并硬声明于 requirements.txt"""
        req = ROOT / 'backend' / 'requirements.txt'
        text = req.read_text(encoding='utf-8')
        assert 'mcp' in text.lower(), 'requirements.txt 应声明 mcp 依赖（协议层）'
        # MCP import 仅允许出现在 autolink_hub/mcp 模块内（工具接入协议层），
        # 不污染 LLM provider / Agent 适配器（AgentProvider 抽象不感知 MCP）
        backend = ROOT / 'backend'
        hits = []
        for py in sorted(backend.rglob('*.py')):
            if 'backend-dist' in str(py):
                continue
            rel = py.relative_to(ROOT).as_posix()
            for i, line in enumerate(py.read_text(encoding='utf-8', errors='ignore').splitlines(), 1):
                if re.match(r'^\s*(?:from\s+mcp(?:\s|\.)|import\s+mcp\b)', line):
                    if not rel.startswith('backend/autolink_hub/mcp/'):
                        hits.append(f'{rel}:{i}: {line.strip()}')
        assert not hits, 'mcp import 应仅位于 autolink_hub/mcp 模块内（协议层工具接入）:\n' + '\n'.join(hits)
