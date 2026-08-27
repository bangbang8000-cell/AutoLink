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

class TestAlAiHubModelsExposure:
    """AI-3（AL 侧）：已持久化 models 透出 + /providers、/health 供前端水合下拉"""

    def test_config_models_persisted_and_exposed(self, tmp_path):
        from autolink_hub.config import get_provider_persisted_models
        settings.user_data_dir = str(tmp_path)
        client = TestClient(create_app())
        # 保存 Provider 配置 + 携带最新拉取 models（模拟自动拉取后回写）
        r = client.post('/api/chat/config', json={
            'provider': 'deepseek',
            'api_key': 'sk-test',
            'model': 'deepseek-chat',
            'base_url': '',
            'models': ['deepseek-v4-pro', 'deepseek-r1-0528'],
        })
        assert r.status_code == 200
        assert r.json().get('status') == 'ok'
        # 持久化读取函数命中
        assert get_provider_persisted_models('deepseek') == ['deepseek-v4-pro', 'deepseek-r1-0528']
        # /providers 水合：返回已持久化 models（优先于静态目录），并含 key
        r2 = client.get('/api/chat/providers')
        assert r2.status_code == 200
        info = {p['key']: p for p in r2.json()['providers']}
        assert info['deepseek']['models'] == ['deepseek-v4-pro', 'deepseek-r1-0528']
        # /health 同样透出
        r3 = client.get('/api/chat/health')
        info3 = {p['key']: p for p in r3.json()['providers']}
        assert info3['deepseek']['models'] == ['deepseek-v4-pro', 'deepseek-r1-0528']

    def test_providers_fallback_to_catalog_without_persisted_models(self, tmp_path):
        settings.user_data_dir = str(tmp_path)
        client = TestClient(create_app())
        r = client.get('/api/chat/providers')
        assert r.status_code == 200
        info = {p['key']: p for p in r.json()['providers']}
        # 未持久化时回退静态目录，且透出 key
        assert info['deepseek']['models'] == ['deepseek-v4-pro', 'deepseek-v4', 'deepseek-chat']
        assert 'key' in info['deepseek']
        assert 'models' in info['deepseek']