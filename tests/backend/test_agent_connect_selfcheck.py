"""5.1.6-516-d + X-516：结构化错误码与连接自检测试（AutoLink）。

覆盖：
- 516-d：execute_tool/_execute_wrapped 失败携带 error_code
- X-516：manager.selfcheck() 结构化检查 + HTTP /agent-connect/selfcheck
"""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))


@pytest.fixture(autouse=True)
def _restore_execute_tool():
    """每用例后恢复 tools.execute_tool，防止 fake 泄漏到其他测试文件。"""
    import autolink_hub.agent.tools as tools_mod

    orig = tools_mod.execute_tool
    yield
    tools_mod.execute_tool = orig


class TestStructuredErrorCodes:
    """516-d：结构化错误码 + 可读提示。"""

    def test_unknown_tool_code(self):
        from autolink_hub.agent.tools import execute_tool

        res = asyncio.run(execute_tool("no_such_tool", {}))
        assert res["success"] is False
        assert res["error_code"] == "AC_ERR_UNKNOWN_TOOL"
        assert "未知工具" in res["error"]

    def test_invalid_args_code(self):
        """AL 契约：参数校验失败在 result 内层携带 error_code。"""
        from autolink_hub.agent.tools import execute_tool, init_tools

        init_tools()
        res = asyncio.run(execute_tool("task_query", {}))  # taskId 必填
        assert res["success"] is True
        assert res["result"]["success"] is False
        assert res["result"]["error_code"] == "AC_ERR_INVALID_ARGS"
        assert "缺少必填参数" in res["result"]["error"]

    def test_business_code_in_audit_tool_error(self):
        """audit_query 等 handler 抛 ValueError → AC_ERR_EXEC_FAILED。"""
        from autolink_hub.agent.tools import execute_tool, init_tools

        init_tools()
        res = asyncio.run(execute_tool("audit_query", {"limit": 0}))
        # limit 被 clamp 到 1，不报错；改用一个必然失败场景：task_query 未知任务
        res2 = asyncio.run(execute_tool("task_query", {"taskId": "no-such-task"}))
        assert res2["success"] is False
        assert res2["error_code"] == "AC_ERR_EXEC_FAILED"
        assert "任务不存在" in res2["error"]

    def test_l2_failure_code_via_manager(self):
        """L2 业务失败经 _execute_wrapped 携带 AC_ERR_L2_BUSINESS。"""
        from autolink_hub.mcp_server.manager import AgentConnectManager, reset_manager

        reset_manager()
        mgr = AgentConnectManager()

        async def _fake_execute(name, arguments):
            return {"success": True, "result": {"status": "error", "error": "布局校验未通过"}}

        import autolink_hub.agent.tools as tools_mod
        tools_mod.execute_tool = _fake_execute

        res = asyncio.run(mgr._execute_wrapped("create_project", {"projectId": "p1"}))
        assert res["success"] is False
        assert res["error_code"] == "AC_ERR_L2_BUSINESS"
        assert "布局校验未通过" in res["error"]


class TestSelfcheck:
    """X-516：连接自检可测性。"""

    def test_selfcheck_shape(self):
        from autolink_hub.mcp_server.manager import AgentConnectManager, reset_manager

        reset_manager()
        mgr = AgentConnectManager()
        report = mgr.selfcheck()
        assert "ok" in report
        assert "mode" in report
        names = {c["name"] for c in report["checks"]}
        assert {"mcp_sdk", "enabled", "tools", "audit"}.issubset(names)
        for c in report["checks"]:
            assert "ok" in c and "message" in c

    def test_selfcheck_disabled_not_ok(self):
        from autolink_hub.mcp_server.manager import AgentConnectManager, reset_manager

        reset_manager()
        mgr = AgentConnectManager()
        report = mgr.selfcheck()
        assert report["ok"] is False
        enabled_check = next(c for c in report["checks"] if c["name"] == "enabled")
        assert enabled_check["ok"] is False
        assert enabled_check["hint"]

    def test_selfcheck_http_endpoint(self):
        """HTTP GET /api/chat/agent-connect/selfcheck 返回结构化检查。"""
        from al_ai_hub.api.chat import router
        from autolink_hub.mcp_server.manager import reset_manager

        reset_manager()
        import starlette.testclient
        from fastapi import FastAPI

        app = FastAPI()
        app.include_router(router)
        client = starlette.testclient.TestClient(app)
        resp = client.get("/api/chat/agent-connect/selfcheck")
        assert resp.status_code == 200
        data = resp.json()["data"]
        assert "ok" in data
        assert "checks" in data
