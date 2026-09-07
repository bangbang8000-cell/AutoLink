"""5.1.8-518-a：客户端远程模式开关配置测试（AutoLink）。"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))


@pytest.fixture(autouse=True)
def _secrets(tmp_path, monkeypatch):
    from autolink_hub.config import settings

    monkeypatch.setenv("AUTOLINK_USER_DATA", str(tmp_path))
    settings.user_data_dir = str(tmp_path)
    yield


class TestRemoteModeConfig:
    def test_remote_mode_default_off(self):
        from autolink_hub.config import get_enable_remote_mode

        assert get_enable_remote_mode() is False

    def test_remote_mode_set_persists(self):
        from autolink_hub.config import get_enable_remote_mode, set_enable_remote_mode

        assert set_enable_remote_mode(True) is True
        assert get_enable_remote_mode() is True
        set_enable_remote_mode(False)
        assert get_enable_remote_mode() is False

    def test_remote_mode_excluded_from_provider_configs(self):
        from autolink_hub import config as ac_config

        ac_config.set_enable_remote_mode(True)
        ac_config.set_enable_agent_connect(True)
        ac_config.apply_secrets()
        assert "enable_remote_mode" not in ac_config.settings.provider_configs
        assert "enable_agent_connect" not in ac_config.settings.provider_configs
        assert "agent_mode" not in ac_config.settings.provider_configs

    def test_agent_connect_switches_regression(self):
        from autolink_hub.config import get_agent_mode, get_enable_agent_connect, set_agent_mode, set_enable_agent_connect

        assert get_enable_agent_connect() is False
        assert get_agent_mode() == "compiled"
        set_enable_agent_connect(True)
        set_agent_mode("source")
        assert get_enable_agent_connect() is True
        assert get_agent_mode() == "source"
