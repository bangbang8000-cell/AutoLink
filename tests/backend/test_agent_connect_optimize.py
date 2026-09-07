"""5.1.9-519-a/c + X-519：Agent 驱动优化迭代与安全约束测试（AutoLink）。"""
import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))


@pytest.fixture(autouse=True)
def _init(tmp_path, monkeypatch):
    from autolink_hub.agent.tools import init_tools
    from autolink_hub.config import settings
    from autolink_hub.mcp_server.manager import reset_manager
    from autolink_hub.mcp_server.tasks import reset_tasks

    monkeypatch.setenv("AUTOLINK_USER_DATA", str(tmp_path))
    settings.user_data_dir = str(tmp_path)
    reset_manager()
    reset_tasks()
    init_tools()
    yield


class TestFeedbackSelfOptimize:
    """519-a：反馈自优化。"""

    def test_feedback_records_and_suggests(self):
        from autolink_hub.agent.tools import execute_tool

        res = asyncio.run(execute_tool(
            "agent_feedback",
            {"tool": "generate_design", "result": "error", "notes": "布局约束冲突"},
        ))
        assert res["success"] is True
        data = res["result"]
        assert data["success"] is True
        assert data["feedback"]
        assert "建议" in data["suggestion"]

    def test_feedback_requires_tool(self):
        from autolink_hub.agent.tools import execute_tool

        res = asyncio.run(execute_tool("agent_feedback", {}))
        assert res["result"]["success"] is False
        assert "tool" in res["result"]["error"]

    def test_feedback_exposed_in_compiled(self):
        from autolink_hub.agent.tools import get_tool_definitions
        from autolink_hub.mcp_server.capabilities import filter_tools_for_mode

        names = {t["name"] for t in filter_tools_for_mode("compiled", get_tool_definitions())}
        assert "agent_feedback" in names


class TestRepairLoopExposed:
    """519-c：校验→建议→修复→复核闭环工具在编译态可用。"""

    def test_loop_tools_available(self):
        from autolink_hub.agent.tools import get_tool_definitions
        from autolink_hub.mcp_server.capabilities import filter_tools_for_mode

        names = {t["name"] for t in filter_tools_for_mode("compiled", get_tool_definitions())}
        loop_tools = {"validate_design", "repair_plan", "repair_apply", "optimize_suggest", "estimate"}
        assert loop_tools.issubset(names), loop_tools - names


class TestNoCodeWriteChannel:
    """X-519：不通过 MCP 暴露代码写入（安全约束）。"""

    def test_write_tools_project_scoped(self):
        from autolink_hub.agent.tools import get_tool_definitions
        from autolink_hub.mcp_server.capabilities import filter_tools_for_mode

        tools = filter_tools_for_mode("compiled", get_tool_definitions())
        write_names = {"project_write_file", "update_project", "template_update", "repair_apply"}
        for t in tools:
            if t["name"] in write_names:
                props = t["parameters"].get("properties", {})
                assert "projectName" in props or "project" in props or "templateName" in props or "configFile" in props, t["name"]

    def test_run_cli_whitelist_no_code_mutation(self):
        from autolink_hub.agent.tools import _AL_CLI_ALLOWED_ROOTS

        forbidden = {"git", "npm", "pip", "shell", "sh", "bash", "exec", "system", "install", "python"}
        assert not (set(_AL_CLI_ALLOWED_ROOTS) & forbidden), set(_AL_CLI_ALLOWED_ROOTS) & forbidden

    def test_no_source_write_tools(self):
        from autolink_hub.agent.tools import get_tool_definitions

        names = {t["function"]["name"] for t in get_tool_definitions()}
        for n in names:
            if "write" in n or "delete" in n or "update" in n:
                assert n not in ("write_source", "write_file_abs", "fs_write")
