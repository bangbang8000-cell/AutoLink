"""5.1.7-517-a/b + X-517：源码态无限制通道（CLI 透传 + 文件系统沙箱）测试（AutoLink）。

AL 契约：handler 返回领域结果 dict；execute_tool 包装为 {success, result}，
业务失败在 result.success=False 内层表达。
"""
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


def _filtered(mode):
    from autolink_hub.agent.tools import get_tool_definitions
    from autolink_hub.mcp_server.capabilities import filter_tools_for_mode

    return {t["name"] for t in filter_tools_for_mode(mode, get_tool_definitions())}


class TestModeExposure:
    def test_source_exposes_source_tools(self):
        names = _filtered("source")
        assert {"run_cli", "read_file", "list_dir", "read_source"}.issubset(names)

    def test_compiled_blocks_source_tools(self):
        names = _filtered("compiled")
        for n in ("run_cli", "list_dir", "read_source"):
            assert n not in names
        assert "read_file" not in names


class TestSandbox:
    async def _run(self, name, args):
        from autolink_hub.agent.tools import execute_tool

        return await execute_tool(name, args)

    def test_read_file_in_sandbox_ok(self, tmp_path):
        f = tmp_path / "hello.txt"
        f.write_text("你好 sandbox", encoding="utf-8")
        res = asyncio.run(self._run("read_source", {"path": str(f)}))
        assert res["success"] is True
        data = res["result"]
        assert data["success"] is True
        assert "你好 sandbox" in data["content"]

    def test_read_file_outside_sandbox_rejected(self, tmp_path):
        outside = tmp_path.parent / "secret.txt"
        res = asyncio.run(self._run("read_source", {"path": str(outside)}))
        assert res["result"]["success"] is False
        assert "越权" in res["result"]["error"]

    def test_list_dir_outside_rejected(self, tmp_path):
        res = asyncio.run(self._run("list_dir", {"path": str(tmp_path.parent)}))
        assert res["result"]["success"] is False
        assert "越权" in res["result"]["error"]

    def test_list_dir_in_sandbox_ok(self, tmp_path):
        res = asyncio.run(self._run("list_dir", {"path": str(tmp_path)}))
        assert res["result"]["success"] is True
        assert isinstance(res["result"]["entries"], list)

    def test_read_source_reads_repo(self):
        tools_path = str(Path(__file__).resolve().parents[2] / "backend" / "autolink_hub" / "agent" / "tools.py")
        res = asyncio.run(self._run("read_source", {"path": tools_path}))
        assert res["result"]["success"] is True
        assert "def register_tool" in res["result"]["content"]


class TestRunCli:
    def test_run_cli_rejects_non_whitelist(self):
        from autolink_hub.agent.tools import execute_tool

        res = asyncio.run(execute_tool("run_cli", {"action": "rm:all"}))
        assert res["result"]["success"] is False
        assert "白名单" in res["result"]["error"]

    def test_run_cli_requires_action(self):
        from autolink_hub.agent.tools import execute_tool

        res = asyncio.run(execute_tool("run_cli", {}))
        assert res["result"]["success"] is False
        assert "action" in res["result"]["error"]

    def test_run_cli_whitelist_passes(self, monkeypatch):
        from autolink_hub.agent.tools import execute_tool

        captured = {}

        def _fake_execute(action, params, argv=None):
            captured["action"] = action
            captured["params"] = params
            return {"success": True, "summary": "done"}

        import cli
        monkeypatch.setattr(cli, "execute", _fake_execute)
        res = asyncio.run(execute_tool("run_cli", {"action": "project:list", "params": {"limit": 5}}))
        assert res["result"]["success"] is True
        assert captured["action"] == "project:list"
        assert captured["params"] == {"limit": 5}
