"""5.1.1-511-a/b/c：Agent Connect MCP Server 框架测试（AutoLink）。

覆盖 backend/autolink_hub/mcp_server/：
- AgentConnectManager 状态机（disabled/enabled + agentMode 切换）
- 编译态/源码态能力域划分与权限映射（511-b/511-d）
- MCP 工具元数据标准化（name/description/inputSchema）
- 开关两态（enable_agent_connect 关=不暴露/开=暴露）
- 惰性导入 mcp SDK（未安装不阻断）
- HTTP /agent-connect/status + /agent-connect/config 端点
"""
import asyncio
import json

import pytest


@pytest.fixture(autouse=True)
def clean_state(tmp_path, monkeypatch):
    monkeypatch.setenv('AUTOLINK_USER_DATA', str(tmp_path))
    from autolink_hub.config import settings
    settings.user_data_dir = str(tmp_path)
    from autolink_hub.mcp_server.manager import reset_manager
    reset_manager()
    yield
    reset_manager()


# ============================================================
# 能力域
# ============================================================

class TestCapabilities:
    def test_capability_domains_defined(self):
        from autolink_hub.mcp_server.capabilities import CAPABILITY_DOMAINS

        assert "project" in CAPABILITY_DOMAINS
        assert "template" in CAPABILITY_DOMAINS
        assert "device" in CAPABILITY_DOMAINS
        assert "design" in CAPABILITY_DOMAINS
        assert "validate" in CAPABILITY_DOMAINS
        assert "room" in CAPABILITY_DOMAINS
        for domain, meta in CAPABILITY_DOMAINS.items():
            assert meta["name"]
            assert meta["description"]
            assert "compiled_visible" in meta
            assert meta["default_permission"] in ("auto", "notify", "confirm")

    def test_source_mode_includes_cli_and_fs(self):
        from autolink_hub.mcp_server.capabilities import SOURCE_ONLY_TOOLS

        assert {"run_cli", "read_file", "list_dir"}.issubset(set(SOURCE_ONLY_TOOLS))

    def test_compiled_blocked_tools(self):
        from autolink_hub.mcp_server.capabilities import COMPILED_BLOCKED_TOOLS

        assert "delete_project" in COMPILED_BLOCKED_TOOLS
        assert "delete_template" in COMPILED_BLOCKED_TOOLS
        assert "run_cli" in COMPILED_BLOCKED_TOOLS

    def test_permission_mapping(self):
        from autolink_hub.mcp_server.capabilities import mcp_permission_meta

        assert mcp_permission_meta("auto")["require_approval"] is False
        assert mcp_permission_meta("notify")["require_approval"] is True
        assert mcp_permission_meta("confirm")["require_approval"] is True
        assert mcp_permission_meta("confirm")["approval_level"] == "confirm"


# ============================================================
# Manager 状态机
# ============================================================

class TestManager:
    def test_disabled_by_default(self):
        from autolink_hub.mcp_server.manager import AgentConnectManager, reset_manager

        reset_manager()
        mgr = AgentConnectManager()
        assert mgr.status == "disabled"
        assert mgr.mcp is None

    def test_enable_starts_fastmcp(self):
        from autolink_hub.mcp_server.manager import AgentConnectManager, reset_manager

        reset_manager()
        mgr = AgentConnectManager()
        mgr.enable(agent_mode="compiled")
        assert mgr.status == "enabled"
        assert mgr.agent_mode == "compiled"
        assert mgr.mcp is not None

    def test_disable_cleans_up(self):
        from autolink_hub.mcp_server.manager import AgentConnectManager, reset_manager

        reset_manager()
        mgr = AgentConnectManager()
        mgr.enable(agent_mode="source")
        mgr.disable()
        assert mgr.status == "disabled"
        assert mgr.mcp is None

    def test_switch_mode(self):
        from autolink_hub.mcp_server.manager import AgentConnectManager, reset_manager

        reset_manager()
        mgr = AgentConnectManager()
        mgr.enable(agent_mode="compiled")
        mgr.set_agent_mode("source")
        assert mgr.agent_mode == "source"
        assert mgr.status == "enabled"

    def test_invalid_mode_clamped(self):
        from autolink_hub.mcp_server.manager import AgentConnectManager, reset_manager

        reset_manager()
        mgr = AgentConnectManager()
        mgr.enable(agent_mode="bogus")
        assert mgr.agent_mode == "compiled"

    def test_status_report_shape(self):
        from autolink_hub.mcp_server.manager import AgentConnectManager, reset_manager

        reset_manager()
        mgr = AgentConnectManager()
        status = mgr.status_report()
        assert "status" in status
        assert "enabled" in status
        assert "agent_mode" in status
        assert "tool_count" in status


# ============================================================
# 审计
# ============================================================

class TestAudit:
    def test_audit_log_entry(self, tmp_path):
        from autolink_hub.mcp_server.manager import AgentConnectManager, reset_manager

        reset_manager()
        mgr = AgentConnectManager()
        mgr.set_audit_path(tmp_path / "audit.jsonl")
        mgr.record_audit("external-agent", "validate_design", {"projectName": "p1"}, "ok")
        lines = (tmp_path / "audit.jsonl").read_text(encoding="utf-8").strip().splitlines()
        assert len(lines) == 1
        entry = json.loads(lines[0])
        assert entry["agent"] == "external-agent"
        assert entry["tool"] == "validate_design"
        assert entry["result"] == "ok"


# ============================================================
# 511-c：双开关配置
# ============================================================

class TestConfig:
    def test_defaults(self, tmp_path, monkeypatch):
        from autolink_hub import config as al_config

        monkeypatch.setattr(al_config, "get_secrets_path", lambda: tmp_path / "ai_secrets.json")
        assert al_config.get_enable_agent_connect() is False
        assert al_config.get_agent_mode() == "compiled"

    def test_set_persist(self, tmp_path, monkeypatch):
        from autolink_hub import config as al_config

        monkeypatch.setattr(al_config, "get_secrets_path", lambda: tmp_path / "ai_secrets.json")
        assert al_config.set_enable_agent_connect(True) is True
        assert al_config.set_agent_mode("source") == "source"
        assert al_config.get_enable_agent_connect() is True
        assert al_config.get_agent_mode() == "source"

    def test_mode_clamp(self):
        from autolink_hub import config as al_config

        assert al_config.clamp_agent_mode("bogus") == "compiled"
        assert al_config.clamp_agent_mode("source") == "source"
        assert al_config.clamp_agent_mode(None) == "compiled"


# ============================================================
# HTTP 端点
# ============================================================

class TestHttp:
    def _make_client(self):
        from fastapi.testclient import TestClient
        from al_ai_hub.main import create_app

        return TestClient(create_app())

    def test_status_endpoint(self, tmp_path, monkeypatch):
        from autolink_hub import config as al_config
        from autolink_hub.mcp_server import manager as mgr_mod

        monkeypatch.setattr(al_config, "get_secrets_path", lambda: tmp_path / "ai_secrets.json")
        mgr_mod.reset_manager()
        client = self._make_client()
        r = client.get("/api/chat/agent-connect/status")
        assert r.status_code == 200
        data = r.json()["data"]
        assert data["enabled"] is False
        assert data["agent_mode"] == "compiled"

    def test_config_endpoint_enable(self, tmp_path, monkeypatch):
        from autolink_hub import config as al_config
        from autolink_hub.mcp_server import manager as mgr_mod

        monkeypatch.setattr(al_config, "get_secrets_path", lambda: tmp_path / "ai_secrets.json")
        mgr_mod.reset_manager()
        client = self._make_client()
        r = client.post("/api/chat/agent-connect/config", json={"enable": True, "agent_mode": "source"})
        assert r.status_code == 200
        data = r.json()["data"]
        assert data["enabled"] is True
        assert data["agent_mode"] == "source"
        assert data["status"] == "enabled"
        assert al_config.get_enable_agent_connect() is True
        assert al_config.get_agent_mode() == "source"

    def test_config_endpoint_disable(self, tmp_path, monkeypatch):
        from autolink_hub import config as al_config
        from autolink_hub.mcp_server import manager as mgr_mod

        monkeypatch.setattr(al_config, "get_secrets_path", lambda: tmp_path / "ai_secrets.json")
        mgr_mod.reset_manager()
        client = self._make_client()
        client.post("/api/chat/agent-connect/config", json={"enable": True})
        r = client.post("/api/chat/agent-connect/config", json={"enable": False})
        assert r.status_code == 200
        data = r.json()["data"]
        assert data["enabled"] is False
        assert data["status"] == "disabled"
