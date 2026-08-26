"""AL AI 独立进程 SSE Chat 集成测试（M3e）

用 mock Provider 验证 /api/chat/send 完整链路：会话 → run_stream → SSE 流式事件。
"""
import json
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['AUTOLINK_USER_DATA'] = ''  # 测试各自用 settings.user_data_dir 覆盖

from al_ai_hub.main import create_app  # noqa: E402
from autolink_hub.config import settings  # noqa: E402
from autolink_hub.llm.provider import registry, LLMProvider  # noqa: E402


class MockProvider(LLMProvider):
    @property
    def provider_name(self) -> str:
        return 'mock'

    async def chat_stream(self, messages, system_prompt='', temperature=0.7, max_tokens=4096):
        for piece in ['你好', '，', '世界']:
            yield piece

    async def chat(self, messages, system_prompt='', temperature=0.7, max_tokens=4096):
        return '你好，世界'


@pytest.fixture(autouse=True)
def clean_state(tmp_path):
    settings.user_data_dir = str(tmp_path)
    registry._providers.clear()
    yield
    registry._providers.clear()


class TestAlAiHubChat:
    def test_sse_chat_streams_content(self, tmp_path):
        registry.register('mock', MockProvider())
        client = TestClient(create_app())
        with client.stream('POST', '/api/chat/send', json={
            'session_id': 's1', 'message': 'hi', 'provider': 'mock',
        }) as resp:
            assert resp.status_code == 200
            lines = [l for l in resp.iter_lines() if l and l.startswith('data: ')]
        content = ''.join(
            json.loads(l[6:]).get('content', '')
            for l in lines if l.startswith('data: {"content"')
        )
        assert '你好' in content
        # 结束事件
        assert any('"status": "completed"' in l for l in lines)

    def test_send_unknown_provider_400(self, tmp_path):
        client = TestClient(create_app())
        r = client.post('/api/chat/send', json={
            'session_id': 's1', 'message': 'hi', 'provider': '__no_such__',
        })
        assert r.status_code == 400

    def test_clear_session(self, tmp_path):
        registry.register('mock', MockProvider())
        client = TestClient(create_app())
        # 先建立会话，再清除（不报错即可）
        with client.stream('POST', '/api/chat/send', json={
            'session_id': 's2', 'message': 'hi', 'provider': 'mock',
        }) as resp:
            list(resp.iter_lines())
        r = client.post('/api/chat/clear?session_id=s2')
        assert r.status_code == 200
