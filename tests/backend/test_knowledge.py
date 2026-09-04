"""5.0.5-505-b/505-c: 知识库引擎 + 工具 + Chat 端点 + 上下文注入 测试

覆盖：
- KnowledgeEngine CRUD（md + 伴生 metadata 持久化）
- search Top-K 打分 + category/project 过滤
- get_knowledge_prompt 检索式注入格式
- knowledge 工具（list_knowledge / search_knowledge / add_knowledge）
- /api/chat/knowledge* 端点（TestClient）
- prompts/loader 知识库上下文注入 + 缓存失效刷新
"""
import json
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['AUTOLINK_USER_DATA'] = ''

from autolink_hub.knowledge.engine import (  # noqa: E402
    get_knowledge_engine, DEFAULT_TOP_K, _tokenize, _score_entry,
)
from autolink_hub.agent.tools import init_tools, get_tool_definitions, execute_tool  # noqa: E402
from autolink_hub.config import settings  # noqa: E402
from autolink_hub.prompts.loader import get_system_prompt, invalidate_system_prompt_cache  # noqa: E402

import asyncio  # noqa: E402


@pytest.fixture(autouse=True)
def knowledge_env(tmp_path, monkeypatch):
    """每个测试隔离知识库目录（强制重载）"""
    monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
    settings.user_data_dir = str(tmp_path)
    get_knowledge_engine().init_dir(str(tmp_path))
    yield tmp_path
    get_knowledge_engine().init_dir(str(tmp_path))  # 复位为干净目录


def _add_demo(engine, name, content, metadata=None):
    engine.add_entry(name, content, metadata or {})


class TestKnowledgeEngine:
    def test_crud(self):
        engine = get_knowledge_engine()
        _add_demo(engine, 'roce-convergence', 'RoCE 网络收敛比建议 ≤ 1.2', {
            'title': 'RoCE 收敛比规范', 'category': '设计规范', 'project': 'demo', 'tags': ['roce', '收敛比'],
        })
        # list
        entries = engine.list_entries()
        assert len(entries) == 1
        assert entries[0]['name'] == 'roce-convergence'
        assert entries[0]['title'] == 'RoCE 收敛比规范'
        # get
        got = engine.get_entry('roce-convergence')
        assert got['content'] == 'RoCE 网络收敛比建议 ≤ 1.2'
        assert got['category'] == '设计规范'
        # 伴生 metadata 文件落盘
        meta_path = engine._entry_path('roce-convergence').with_suffix('.metadata.json')
        assert meta_path.exists()
        meta = json.loads(meta_path.read_text(encoding='utf-8'))
        assert meta['title'] == 'RoCE 收敛比规范'
        assert 'updated_at' in meta
        # update
        upd = engine.update_entry('roce-convergence', content='RoCE 收敛比建议 ≤ 1.5（更新）', metadata={'category': '设计规范'})
        assert upd['content'] == 'RoCE 收敛比建议 ≤ 1.5（更新）'
        # delete
        assert engine.delete_entry('roce-convergence') is True
        assert engine.get_entry('roce-convergence') is None
        assert engine.delete_entry('roce-convergence') is False

    def test_name_normalize_and_duplicate(self):
        engine = get_knowledge_engine()
        engine.add_entry('IB 选型规范', 'IB 交换机选型建议', {'title': 'IB 选型'})
        assert engine.get_entry('ib-选型规范') is not None  # 归一命中
        with pytest.raises(ValueError):
            engine.add_entry('IB 选型规范', '重复')
        with pytest.raises(ValueError):
            engine.add_entry('', '空名')
        with pytest.raises(ValueError):
            engine.add_entry('only-meta', '   ')

    def test_search_scoring_and_filters(self):
        engine = get_knowledge_engine()
        _add_demo(engine, 'roc-conv', 'RoCE 收敛比 ≤1.2 建议', {'category': '设计规范', 'tags': ['roce', '收敛比']})
        _add_demo(engine, 'ib-switch', 'IB 交换机 800G 选型', {'category': '设备选型', 'tags': ['ib', 'switch']})
        _add_demo(engine, 'uec-proj', 'UEC 项目专项规范', {'category': '项目规范', 'project': 'project-x'})
        # 关键词命中 Top-1
        hits = engine.search('roce 收敛比')
        assert len(hits) >= 1
        assert hits[0]['name'] == 'roc-conv'
        # 分类过滤
        sel = engine.search('', category='设备选型')
        assert [s['name'] for s in sel] == ['ib-switch']
        # 项目过滤：命中指定项目 + 通用条目（无 project 始终可检索，供上下文注入）
        selp = engine.search('', project='project-x')
        assert 'uec-proj' in [s['name'] for s in selp]
        assert 'roc-conv' in [s['name'] for s in selp]
        assert 'ib-switch' in [s['name'] for s in selp]
        # top_k 截断
        hits2 = engine.search('规范', top_k=1)
        assert len(hits2) == 1

    def test_meta_white_list(self):
        engine = get_knowledge_engine()
        engine.add_entry('wl', '内容', {'title': 'T', 'category': 'C', 'project': 'P',
                                       'tags': ['a'], 'enabled': True, 'evil': 'drop',
                                       'description': 'desc'})
        meta_path = engine._entry_path('wl').with_suffix('.metadata.json')
        meta = json.loads(meta_path.read_text(encoding='utf-8'))
        assert 'evil' not in meta
        assert meta['title'] == 'T'

    def test_get_knowledge_prompt_format(self):
        engine = get_knowledge_engine()
        _add_demo(engine, 'roc-conv', 'RoCE 收敛比 ≤1.2', {'title': 'RoCE 规范', 'category': '设计规范', 'tags': ['roce']})
        prompt = engine.get_knowledge_prompt('roce 收敛比')
        assert '## 知识库上下文' in prompt
        assert 'RoCE 规范' in prompt
        assert 'RoCE 收敛比 ≤1.2' in prompt
        # 无命中返回空
        assert engine.get_knowledge_prompt('zzz-none-zzz') == ''

    def test_tokenize_and_score(self):
        tokens = _tokenize('收敛比建议')
        # 中文整体大词 + 双字滑动窗口
        assert '收敛比建议' in tokens
        assert '收敛' in tokens and '敛比' in tokens and '建议' in tokens
        engine = get_knowledge_engine()
        _add_demo(engine, 'score-x', '内容', {'title': '收敛比规范', 'category': '设计规范'})
        scored = engine.search('收敛比')
        assert scored[0]['name'] == 'score-x'
        assert scored[0]['score'] > 0


class TestKnowledgeTools:
    def test_tools_registered(self):
        init_tools()
        names = {d['function']['name'] for d in get_tool_definitions()}
        for expected in ('list_knowledge', 'search_knowledge', 'add_knowledge'):
            assert expected in names

    def test_add_and_search_via_tools(self):
        init_tools()
        r = asyncio.run(execute_tool('add_knowledge', {
            'name': 'tool-k', 'content': '通过工具添加的知识', 'metadata': {'category': '测试', 'tags': ['t']},
        }))
        assert r['success'] is True and r['result']['added'] is True
        r2 = asyncio.run(execute_tool('list_knowledge', {}))
        assert r2['success'] is True and r2['result']['total'] >= 1
        assert 'tool-k' in [e['name'] for e in r2['result']['entries']]
        r3 = asyncio.run(execute_tool('search_knowledge', {'query': '工具添加'}))
        assert r3['success'] is True and r3['result']['entries'][0]['name'] == 'tool-k'
        # 缺参校验
        r4 = asyncio.run(execute_tool('search_knowledge', {}))
        assert r4['success'] is True and r4['result']['success'] is False
        r5 = asyncio.run(execute_tool('add_knowledge', {'name': 'k', 'content': ''}))
        assert r5['success'] is True and r5['result']['success'] is False


class TestKnowledgeChatEndpoints:
    @pytest.fixture(autouse=True)
    def client(self):
        from al_ai_hub.main import create_app
        return TestClient(create_app())

    def test_knowledge_crud_api(self, client):
        # add
        r = client.post('/api/chat/knowledge', json={
            'name': 'api-k', 'content': 'API 添加的知识', 'metadata': {'category': 'API', 'project': 'p1'},
        })
        assert r.status_code == 200 and r.json()['ok'] is True
        # list
        r = client.get('/api/chat/knowledge')
        assert r.status_code == 200
        data = r.json()
        assert data['ok'] is True and data['total'] >= 1
        assert 'API' in data['categories']
        # get
        r = client.get('/api/chat/knowledge/api-k')
        assert r.status_code == 200 and r.json()['entry']['content'] == 'API 添加的知识'
        # update
        r = client.put('/api/chat/knowledge/api-k', json={'content': 'API 更新后的知识'})
        assert r.status_code == 200 and r.json()['entry']['content'] == 'API 更新后的知识'
        # search
        r = client.post('/api/chat/knowledge/search', json={'query': '更新后的知识'})
        assert r.status_code == 200
        assert r.json()['entries'][0]['name'] == 'api-k'
        # delete
        r = client.delete('/api/chat/knowledge/api-k')
        assert r.status_code == 200 and r.json()['deleted'] == 'api-k'
        r = client.get('/api/chat/knowledge/api-k')
        assert r.status_code == 404

    def test_knowledge_api_errors(self, client):
        r = client.get('/api/chat/knowledge/no-such')
        assert r.status_code == 404
        r = client.post('/api/chat/knowledge', json={'name': '', 'content': 'x'})
        assert r.status_code == 400


class TestKnowledgeContextInjection:
    def test_system_prompt_injects_knowledge(self):
        engine = get_knowledge_engine()
        engine.add_entry('ctx-roce', 'RoCE 收敛比规范内容', {'title': 'RoCE 收敛比', 'category': '设计规范'})
        prompt = get_system_prompt('general', 'proj', query='roce 收敛比')
        assert '知识库上下文' in prompt
        assert 'RoCE 收敛比' in prompt
        assert 'RoCE 收敛比规范内容' in prompt

    def test_system_prompt_project_fallback_and_cache_invalidation(self):
        engine = get_knowledge_engine()
        # 无知识时（干净目录）缓存命中同一对象
        p1 = get_system_prompt('general', 'proj-a')
        p2 = get_system_prompt('general', 'proj-a')
        assert p1 is p2
        # 新增知识 → 缓存失效刷新（重建后含知识库上下文）
        engine.add_entry('proj-rule', 'proj-a 项目专项规范', {'project': 'proj-a', 'category': '项目规范'})
        p3 = get_system_prompt('general', 'proj-a')
        assert '知识库上下文' in p3

    def test_system_prompt_query_not_cached(self):
        engine = get_knowledge_engine()
        engine.add_entry('q1', '第一段知识', {'title': '一'})
        engine.add_entry('q2', '第二段知识', {'title': '二'})
        a = get_system_prompt('general', '', query='第一段知识')
        b = get_system_prompt('general', '', query='第二段知识')
        assert '第一段知识' in a and '第二段知识' in b
