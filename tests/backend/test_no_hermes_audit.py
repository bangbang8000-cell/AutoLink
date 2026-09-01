"""4.3（测试计划 A-7）：无 Hermes / 外部 Agent 平台引入（代码审计）

4.0 系列明确「不引入 Hermes / 外部 Agent 平台（统一底座移 5.0）」。本测试做静态审计：
- 依赖清单（requirements*.txt / package.json）不包含外部 Agent 平台
- 后端源码不 import hermes / harness / 外部 agent 框架
- 未出现 hermes 平台标识
"""
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # 仓库根（AIDC AutoLink-Client）


# 外部 Agent 平台 / 编排框架黑名单（4.0 系列禁止引入）
FORBIDDEN_DEPS = {
    'hermes', 'harness', 'langchain', 'langgraph', 'crewai', 'autogen', 'ag2',
    'openai-agents', 'agents-sdk', 'semantic-kernel', 'haystack', 'llamaindex',
}

FORBIDDEN_IMPORT_PATTERNS = [
    r'^\s*(from|import)\s+hermes',
    r'^\s*(from|import)\s+harness',
    r'^\s*(from|import)\s+langchain',
    r'^\s*(from|import)\s+crewai',
    r'^\s*(from|import)\s+autogen',
]


class TestNoHermesAudit:
    def test_backend_requirements_no_agent_platform(self):
        for req in [ROOT / 'backend' / 'requirements.txt', ROOT / 'backend' / 'requirements-dev.txt']:
            assert req.exists(), f'缺少依赖清单: {req}'
            text = req.read_text(encoding='utf-8').lower()
            for dep in FORBIDDEN_DEPS:
                assert dep not in text, f'依赖清单含被禁平台: {dep} in {req.name}'

    def test_package_json_no_agent_platform(self):
        pkg = ROOT / 'package.json'
        text = pkg.read_text(encoding='utf-8').lower()
        for dep in FORBIDDEN_DEPS:
            assert dep not in text, f'package.json 含被禁平台依赖: {dep}'

    def test_backend_source_no_hermes_imports(self):
        """扫描 backend 源码：无 hermes/harness/外部 agent 框架 import"""
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

    def test_no_hermes_brand_in_backend(self):
        """backend 不应出现 hermes 平台标识（README/配置除外）"""
        backend = ROOT / 'backend'
        hits = []
        for f in sorted(backend.rglob('*')):
            if not f.is_file() or 'backend-dist' in str(f):
                continue
            if f.suffix not in ('.py', '.md', '.json', '.toml', '.ini'):
                continue
            try:
                text = f.read_text(encoding='utf-8', errors='ignore')
            except OSError:
                continue
            for i, line in enumerate(text.splitlines(), 1):
                if re.search(r'\bhermes\b', line, re.IGNORECASE):
                    hits.append(f'{f.relative_to(ROOT)}:{i}: {line.strip()[:80]}')
        assert not hits, '发现 hermes 平台引用:\n' + '\n'.join(hits)

    def test_ai_hub_uses_builtin_llm_provider(self):
        """AI Hub 使用内置 LLM Provider（openai 兼容直连），非外部 Agent 平台"""
        provider_file = ROOT / 'backend' / 'autolink_hub' / 'llm' / 'provider.py'
        assert provider_file.exists()
        text = provider_file.read_text(encoding='utf-8')
        assert 'openai' in text.lower()  # openai 兼容客户端（BYO-Key 直连，非平台托管）
        assert 'hermes' not in text.lower()
