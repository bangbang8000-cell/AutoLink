"""AL AI 独立进程服务器测试（M3b：al_ai_hub FastAPI 服务）

覆盖：health / providers / config 持久化 / auth 中间件。
SSE chat 与 mock provider 的流式测试见 test_al_ai_hub_chat.py（M3e）。
"""
import os
import sys

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.environ['AUTOLINK_USER_DATA'] = ''  # 测试各自用 settings.user_data_dir 覆盖

from al_ai_hub.main import create_app  # noqa: E402
from autolink_hub.config import settings  # noqa: E402
from autolink_hub.llm.provider import registry  # noqa: E402


@pytest.fixture(autouse=True)
def clean_state():
    """隔离全局状态：清空 Provider 注册表 + 复位默认 provider + 隔离 secrets 目录"""
    registry._providers.clear()
    old_default = settings.default_provider
    old_ud = settings.user_data_dir
    settings.default_provider = 'deepseek'
    yield
    settings.default_provider = old_default
    settings.user_data_dir = old_ud
    registry._providers.clear()


class TestAlAiHubServer:
    def test_health(self, tmp_path):
        settings.user_data_dir = str(tmp_path)
        client = TestClient(create_app())
        r = client.get('/api/chat/health')
        assert r.status_code == 200
        data = r.json()
        assert data['status'] == 'ok'
        assert data['version'] == '1.0.0'

    def test_providers(self, tmp_path):
        settings.user_data_dir = str(tmp_path)
        client = TestClient(create_app())
        r = client.get('/api/chat/providers')
        assert r.status_code == 200
        data = r.json()
        assert data['default'] == 'deepseek'
        assert any(p['name'] == 'DeepSeek' for p in data['providers'])

    def test_config_persists(self, tmp_path):
        settings.user_data_dir = str(tmp_path)
        client = TestClient(create_app())
        r = client.post('/api/chat/config', json={
            'provider': 'deepseek',
            'api_key': 'sk-test',
            'model': 'deepseek-chat',
            'base_url': '',
        })
        assert r.status_code == 200
        assert r.json().get('status') == 'ok'
        # 落盘到 AUTOLINK_USER_DATA
        assert os.path.exists(os.path.join(str(tmp_path), 'ai_secrets.json'))

    def test_config_default(self, tmp_path):
        settings.user_data_dir = str(tmp_path)
        client = TestClient(create_app())
        r = client.post('/api/chat/config/default', json={'provider': 'qwen'})
        assert r.status_code == 200
        assert r.json().get('default_provider') == 'qwen'
        r2 = client.get('/api/chat/providers')
        assert r2.json()['default'] == 'qwen'

    def test_send_without_provider_returns_400(self, tmp_path):
        settings.user_data_dir = str(tmp_path)
        client = TestClient(create_app())
        r = client.post('/api/chat/send', json={
            'session_id': 's1', 'message': 'hi', 'provider': '__no_such_provider__',
        })
        assert r.status_code == 400

    def test_auth_middleware(self, tmp_path):
        settings.user_data_dir = str(tmp_path)
        client = TestClient(create_app(auth_token='sec-token'))
        assert client.get('/api/chat/health').status_code == 401
        assert client.get('/api/chat/health', headers={'X-AL-Auth-Token': 'bad'}).status_code == 401
        assert client.get('/api/chat/health', headers={'X-AL-Auth-Token': 'sec-token'}).status_code == 200
