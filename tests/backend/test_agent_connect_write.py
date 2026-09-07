"""5.1.3-513-b/c：写入语义层（L2 校验闸门 + L3 幂等）测试（AutoLink）。"""
import asyncio

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


from autolink_hub.mcp_server.write_gate import (  # noqa: E402
    check_idempotent,
    idempotency_key,
    is_write_tool,
    requires_l2_validation,
    validate_result,
)


@pytest.fixture(autouse=True)
def _restore_execute_tool():
    """每用例后恢复 tools.execute_tool，防止 fake 泄漏到其他测试文件。"""
    import autolink_hub.agent.tools as tools_mod

    orig = tools_mod.execute_tool
    yield
    tools_mod.execute_tool = orig


class TestWriteToolDetect:
    def test_write_tools_detected(self):
        for name in ("create_project", "update_project", "import_plan", "delete_project", "save_template", "apply_patch", "repair_design"):
            assert is_write_tool(name), name

    def test_read_tools_not_write(self):
        for name in ("list_projects", "get_project_info", "device_query", "validate_design", "export_bom", "room_validate"):
            assert not is_write_tool(name), name

    def test_l2_validation_required(self):
        for name in ("create_project", "update_project", "import_plan", "apply_patch", "repair_design"):
            assert requires_l2_validation(name), name


class TestIdempotency:
    def test_key_from_project_id(self):
        assert idempotency_key({"projectId": "49a-abc-0001"}) == "id=49a-abc-0001"

    def test_key_with_plan_hash(self):
        assert idempotency_key({"projectId": "p1", "planHash": "h1"}) == "id=p1;hash=h1"

    def test_key_from_name_fallback(self):
        assert idempotency_key({"name": "proj-a"}) == "name=proj-a"

    def test_no_key(self):
        assert idempotency_key({"a": 1}) is None

    def test_idempotent_hit(self):
        records = {"create_project:id=p1": True}
        res = check_idempotent(records, "create_project", {"projectId": "p1"})
        assert res is not None
        assert res["idempotent"] is True
        assert "已存在" in res["result"]["message"]

    def test_idempotent_miss(self):
        res = check_idempotent({}, "create_project", {"projectId": "p1"})
        assert res is None


class TestL2Validation:
    def test_validate_ok(self):
        res = validate_result("create_project", {"success": True, "result": {"projectId": "p1"}})
        assert res["success"] is True

    def test_validate_failed_result(self):
        res = validate_result("create_project", {"success": False, "error": "参数错误"})
        assert res["success"] is False
        assert "参数错误" in res["error"]

    def test_validate_business_error(self):
        res = validate_result("create_project", {"success": True, "result": {"status": "error", "error": "校验失败"}})
        assert res["success"] is False
        assert "校验失败" in res["error"]


class TestExecutionGate:
    def test_write_tool_l3_idempotent(self):
        from autolink_hub.mcp_server.manager import AgentConnectManager, reset_manager

        reset_manager()
        mgr = AgentConnectManager()

        async def _fake_execute(name, arguments):
            return {"success": True, "result": {"projectId": arguments.get("projectId"), "status": "created"}}

        import autolink_hub.agent.tools as tools_mod
        tools_mod.execute_tool = _fake_execute

        async def _call(m, n, a):
            return await m._execute_wrapped(n, a)

        r1 = asyncio.run(_call(mgr, "create_project", {"projectId": "p1"}))
        assert r1["success"] is True
        r2 = asyncio.run(_call(mgr, "create_project", {"projectId": "p1"}))
        assert r2["success"] is True
        assert r2["idempotent"] is True
        assert "已存在" in r2["result"]["message"]

    def test_write_tool_l2_failure(self):
        from autolink_hub.mcp_server.manager import AgentConnectManager, reset_manager

        reset_manager()
        mgr = AgentConnectManager()

        async def _fake_execute(name, arguments):
            return {"success": True, "result": {"status": "error", "error": "机房布局校验未通过"}}

        import autolink_hub.agent.tools as tools_mod
        tools_mod.execute_tool = _fake_execute

        async def _call(m, n, a):
            return await m._execute_wrapped(n, a)

        res = asyncio.run(_call(mgr, "create_project", {"projectId": "p2"}))
        assert res["success"] is False
        assert "机房布局校验未通过" in res["error"]

    def test_read_tool_no_gate(self):
        from autolink_hub.mcp_server.manager import AgentConnectManager, reset_manager

        reset_manager()
        mgr = AgentConnectManager()

        async def _fake_execute(name, arguments):
            return {"success": True, "result": ["p1"]}

        import autolink_hub.agent.tools as tools_mod
        tools_mod.execute_tool = _fake_execute

        async def _call(m, n, a):
            return await m._execute_wrapped(n, a)

        res = asyncio.run(_call(mgr, "list_projects", {}))
        assert res["success"] is True
        assert "idempotent" not in res
