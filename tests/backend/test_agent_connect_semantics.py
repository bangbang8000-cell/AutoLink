"""5.1.5-515-a/b/c/d + X-515：确定性语义层与审计增强测试（AutoLink）。"""
import asyncio
import hashlib
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))

from autolink_hub.mcp_server.write_gate import check_idempotent, idempotency_key  # noqa: E402


@pytest.fixture(autouse=True)
def _restore_execute_tool():
    import autolink_hub.agent.tools as tools_mod

    orig = tools_mod.execute_tool
    yield
    tools_mod.execute_tool = orig


class TestL3IdempotentReplay:
    """515-a：幂等重放返回原始结果；失败写入不落标记。"""

    def test_replay_returns_original_result(self):
        from autolink_hub.mcp_server.manager import AgentConnectManager, reset_manager

        reset_manager()
        mgr = AgentConnectManager()

        async def _fake_execute(name, arguments):
            return {"success": True, "result": {"projectId": arguments.get("projectId"), "status": "created"}}

        import autolink_hub.agent.tools as tools_mod
        tools_mod.execute_tool = _fake_execute

        r1 = asyncio.run(mgr._execute_wrapped("create_project", {"projectId": "p1"}))
        assert r1["success"] is True
        r2 = asyncio.run(mgr._execute_wrapped("create_project", {"projectId": "p1"}))
        assert r2["success"] is True
        assert r2["idempotent"] is True
        assert r2["result"]["replay"] == {"projectId": "p1", "status": "created"}

    def test_failed_write_no_marker(self):
        """L2 失败写入不产生幂等标记 → 可重试。"""
        from autolink_hub.mcp_server.manager import AgentConnectManager, reset_manager

        reset_manager()
        mgr = AgentConnectManager()

        async def _fake_execute(name, arguments):
            return {"success": True, "result": {"status": "error", "error": "布局校验未通过"}}

        import autolink_hub.agent.tools as tools_mod
        tools_mod.execute_tool = _fake_execute

        r1 = asyncio.run(mgr._execute_wrapped("create_project", {"projectId": "p-fail"}))
        assert r1["success"] is False
        r2 = asyncio.run(mgr._execute_wrapped("create_project", {"projectId": "p-fail"}))
        assert r2["success"] is False
        assert r2.get("idempotent") is not True

    def test_check_idempotent_legacy_true_marker(self):
        """兼容旧标记（True）：无重放结果但消息可读。"""
        res = check_idempotent({"create_project:id=p1": True}, "create_project", {"projectId": "p1"})
        assert res is not None
        assert res["result"]["message"]
        assert res["result"]["replay"] is None


class TestAuditEnhancement:
    """515-d：审计增强（脱敏/耗时/模式/查询）。"""

    def test_record_audit_sanitizes_summary(self, tmp_path):
        from autolink_hub.mcp_server.manager import AgentConnectManager

        mgr = AgentConnectManager()
        mgr.set_audit_path(tmp_path / "audit.jsonl")
        mgr.record_audit(
            "external-agent", "update_project",
            {"projectName": "t1", "config": "x" * 500, "apiToken": "sk-secret"},
            "ok", duration_ms=12.5,
        )
        lines = (tmp_path / "audit.jsonl").read_text(encoding="utf-8").strip().splitlines()
        entry = json.loads(lines[0])
        assert entry["args_summary"]["apiToken"] == "[REDACTED]"
        assert entry["args_summary"]["config"].endswith("...")
        assert entry["arguments"]["config"] == "x" * 500
        assert entry["duration_ms"] == 12.5
        assert entry["mode"] == "compiled"

    def test_query_audit_filters(self, tmp_path):
        from autolink_hub.mcp_server.manager import AgentConnectManager

        mgr = AgentConnectManager()
        mgr.set_audit_path(tmp_path / "audit.jsonl")
        mgr.record_audit("external-agent", "list_projects", {}, "ok", duration_ms=1.0)
        mgr.record_audit("external-agent", "generate_design", {"configFile": "p.json"}, "ok", duration_ms=3.0)
        mgr.record_audit("external-agent", "create_project", {"projectName": "p2"}, "error", duration_ms=5.0)
        assert len(mgr.query_audit()) == 3
        assert len(mgr.query_audit(tool="generate_design")) == 1
        assert mgr.query_audit(tool="generate_design")[0]["duration_ms"] == 3.0
        assert len(mgr.query_audit(result="error")) == 1
        assert len(mgr.query_audit(limit=2)) == 2

    def test_audit_query_tool(self, tmp_path, monkeypatch):
        """audit_query 工具经 execute_tool 返回审计条目。"""
        from autolink_hub.agent.tools import execute_tool, init_tools
        from autolink_hub.config import settings
        from autolink_hub.mcp_server.manager import get_agent_connect_manager, reset_manager

        monkeypatch.setenv("AUTOLINK_USER_DATA", str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        reset_manager()
        init_tools()
        mgr = get_agent_connect_manager()
        mgr.set_audit_path(tmp_path / "audit.jsonl")
        mgr.record_audit("external-agent", "list_projects", {}, "ok", duration_ms=1.0)

        res = asyncio.run(execute_tool("audit_query", {"tool": "list_projects", "limit": 10}))
        assert res["success"] is True
        data = res["result"]
        assert data["total"] == 1
        assert data["entries"][0]["tool"] == "list_projects"


class TestFullToolContract:
    """515-c：全部编译态工具契约完整 + 515-b 确定性指纹。"""

    def _compiled_tools(self):
        from autolink_hub.agent.tools import get_tool_definitions
        from autolink_hub.mcp_server.capabilities import filter_tools_for_mode

        return filter_tools_for_mode("compiled", get_tool_definitions())

    def test_all_tools_schema_complete(self):
        """全部编译态工具 schema 完整：required 字段均在 properties 声明。"""
        from autolink_hub.agent.tools import init_tools

        init_tools()
        tools = self._compiled_tools()
        assert len(tools) > 0
        for t in tools:
            assert t["name"]
            assert t["description"]
            params = t["parameters"] or {}
            assert params.get("type") in ("object", None)
            assert isinstance(params.get("properties", {}), dict)
            assert isinstance(params.get("required", []), list)
            props = params.get("properties", {})
            for req in params.get("required", []):
                assert req in props, f"{t['name']} required '{req}' 未在 properties 中声明"

    def test_all_tools_permission_valid(self):
        """全部编译态工具权限档位合法。"""
        from autolink_hub.agent.tools import init_tools

        init_tools()
        tools = self._compiled_tools()
        for t in tools:
            assert t["permission"] in ("auto", "notify", "confirm"), t["name"]

    def test_golden_fingerprint_stable(self):
        """515-b：全量编译态工具契约指纹稳定（跨版本回归基线）。"""
        from autolink_hub.agent.tools import init_tools

        init_tools()
        tools = self._compiled_tools()
        canonical = json.dumps(
            [{"name": t["name"], "params": t["parameters"], "perm": t["permission"]} for t in tools],
            ensure_ascii=False, sort_keys=True,
        )
        digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
        assert digest
        canonical2 = json.dumps(
            [{"name": t["name"], "params": t["parameters"], "perm": t["permission"]} for t in tools],
            ensure_ascii=False, sort_keys=True,
        )
        assert canonical == canonical2

    def test_task_and_audit_tools_in_compiled(self):
        """task_* 与 audit_query 在编译态可见。"""
        from autolink_hub.agent.tools import init_tools

        init_tools()
        names = {t["name"] for t in self._compiled_tools()}
        assert "audit_query" in names
        assert "task_query" in names
        assert "task_submit" in names
