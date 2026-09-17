"""AL v5.2.2 修复版本：Agent Connect 对外契约用例（T1.11 / T2.17）。

与 MC 侧 ``ai_hub/tests/test_agent_connect_contract_522.py`` 同构（DP-MC-04：
双端契约必须一致，CI 做结构比对告警）。每条用例均按"改前失败 → 改后通过"双向留痕。

覆盖：
- 越权 4：``toolName`` 泄漏消除、只读工具不可路由到删除类、模式守卫兜底、
  源码态专用工具与破坏性工具编译态不可达
- schema 3：inputSchema 为真实参数、含参数说明、enum 透传（归一化不再丢弃）
- 错误语义 6：失败 isError=true / 成功 isError=false / 扁平化单层 / error_code 结构化 /
  未知工具 / **handler 级业务失败归一为 isError=true**
- 屏蔽规则 3：语义规则命中真实注册名、编译态选中集无破坏性工具、规则未命中即拒绝启动
- 门禁矩阵 4：notify 灰度不阻断且记账、enforce 缺凭据拒绝、enforce 带凭据放行、
  非 confirm 档不受门禁影响
- 开关 3：stdio 入口遵守总开关（exit 2）、selfcheck 真实读开关、selfcheck 含规则与门禁
- 注解与资源 3：tools/list 带 annotations、只读工具 readOnlyHint=true、prompts/resources 已注册
- 权限一致性 1：编译态下所有 confirm 档工具均不可见（门禁只对可达工具生效）
"""
import asyncio
import json
import sys
from pathlib import Path

import pytest


# =========================================================================
# 夹具
# =========================================================================

@pytest.fixture(autouse=True)
def _reset_all(tmp_path, monkeypatch):
    """每用例前后重置管理器、工具守卫与用户数据目录，避免全局状态串扰。"""
    monkeypatch.setenv("AUTOLINK_USER_DATA", str(tmp_path))
    from autolink_hub.agent import tools
    from autolink_hub.config import settings
    from autolink_hub.mcp_server.manager import reset_manager

    settings.user_data_dir = str(tmp_path)
    reset_manager()
    tools.set_execution_guard(None)
    yield
    reset_manager()
    tools.set_execution_guard(None)


def _enable(mode="compiled"):
    from autolink_hub.agent.tools import init_tools
    from autolink_hub.mcp_server.manager import get_agent_connect_manager

    init_tools()
    mgr = get_agent_connect_manager()
    ok, msg = mgr.enable(agent_mode=mode)
    assert ok, msg
    return mgr


def _enable_compiled():
    return _enable("compiled")


def _tm(mgr):
    return mgr.mcp._tool_manager


def _call(mgr, name, args):
    return asyncio.run(_tm(mgr).call_tool(name, args, convert_result=True))


def _body(res):
    return json.loads(res.content[0].text)


# =========================================================================
# 一、越权（AL-S1）——4 条
# =========================================================================

class TestPrivilegeEscalation:
    """用户反馈 P0-1：``toolName`` 入参可覆盖闭包绑定名 → 只读工具可路由到删除类工具。"""

    def test_no_tool_exposes_toolname_parameter(self):
        """改前：所有工具的 inputSchema 含 toolName；改后：0 个。"""
        mgr = _enable_compiled()
        tm = _tm(mgr)
        leaking = [
            n for n in tm._tools
            if "toolName" in json.dumps(tm.get_tool(n).parameters, ensure_ascii=False)
        ]
        assert leaking == [], f"以下工具仍暴露 toolName 入参：{leaking}"

    def test_readonly_tool_cannot_be_rerouted(self):
        """改前：list_projects 传 toolName=project_delete 会真的执行删除；
        改后：toolName 被参数模型丢弃，调用仍在 list_projects 上完成。"""
        mgr = _enable_compiled()
        res = _call(mgr, "list_projects", {"toolName": "project_delete"})
        body = _body(res)
        assert body["success"] is True
        assert "projects" in body["result"], "未返回项目列表（可能被越权路由）"

    def test_execution_guard_blocks_unselected_tool(self):
        """模式守卫兜底：编译态下直接调 execute_tool('run_cli') 被拒。"""
        from autolink_hub.agent.tools import execute_tool

        _enable_compiled()
        res = asyncio.run(execute_tool("run_cli", {"action": "device:list"}))
        assert res["success"] is False
        assert res["error_code"] == "AC_ERR_TOOL_NOT_ALLOWED"

    def test_destructive_and_source_tools_absent_in_compiled(self):
        """编译态不暴露源码态专用工具与破坏性工具。"""
        from autolink_hub.agent.tools import get_tool_definitions
        from autolink_hub.mcp_server.capabilities import SOURCE_ONLY_TOOLS, filter_tools_for_mode

        names = {t["name"] for t in filter_tools_for_mode("compiled", get_tool_definitions())}
        assert not (names & set(SOURCE_ONLY_TOOLS))
        for n in ("delete_project", "project_delete", "template_delete",
                  "run_cli", "read_file", "list_dir", "read_source"):
            assert n not in names, f"{n} 不应在编译态暴露"


# =========================================================================
# 二、schema（AL-A1）——3 条
# =========================================================================

class TestInputSchema:
    """用户反馈 P0-2：``tools/list`` 的 inputSchema 是空壳（只有 arguments/toolName）。"""

    def test_schema_reflects_real_parameters(self):
        mgr = _enable_compiled()
        t = _tm(mgr).get_tool("create_project")
        props = t.parameters.get("properties") or {}
        assert "projectName" in props
        assert "description" in props
        assert t.parameters.get("required") == ["projectName"]

    def test_schema_keeps_parameter_description(self):
        mgr = _enable_compiled()
        t = _tm(mgr).get_tool("create_project")
        assert t.parameters["properties"]["projectName"].get("description")

    def test_schema_keeps_enum(self):
        """参数 enum 不再被 schema 归一化丢弃（改前只保留 type/properties/required）。"""
        from autolink_hub.mcp_server.capabilities import normalize_mcp_schema

        raw = {
            "type": "object",
            "properties": {"outputTypes": {"type": "string", "enum": ["reportData", "bom"]}},
            "required": ["configFile"],
        }
        normalized = normalize_mcp_schema(raw)
        assert normalized["properties"]["outputTypes"]["enum"] == ["reportData", "bom"]

        # 端到端：编译态工具的 inputSchema 必须保真透传注册表 schema（说明字段不丢）
        mgr = _enable_compiled()
        tm = _tm(mgr)
        with_desc = [
            (n, k) for n in tm._tools
            for k, v in (tm.get_tool(n).parameters.get("properties") or {}).items()
            if isinstance(v, dict) and v.get("description")
        ]
        assert with_desc, "inputSchema 丢失了全部参数说明（schema 未接入）"


# =========================================================================
# 三、错误语义（AL-A2）——6 条
# =========================================================================

class TestErrorSemantics:

    def test_failure_sets_iserror_true(self):
        mgr = _enable_compiled()
        res = _call(mgr, "project_info", {})  # 缺必填参数 name
        assert res.isError is True

    def test_success_sets_iserror_false(self):
        mgr = _enable_compiled()
        res = _call(mgr, "list_projects", {})
        assert res.isError is False

    def test_response_is_single_layer(self):
        """改前：result 是转义 JSON 字符串；改后：result 直接是对象。"""
        mgr = _enable_compiled()
        res = _call(mgr, "list_projects", {})
        body = _body(res)
        assert body["success"] is True
        assert isinstance(body["result"], dict), "result 仍为字符串（未扁平化）"

    def test_failure_carries_error_code(self):
        mgr = _enable_compiled()
        res = _call(mgr, "project_info", {})
        body = _body(res)
        assert body["success"] is False
        assert body["error_code"] == "AC_ERR_INVALID_ARGS"
        assert body["error"]
        assert "缺少必填参数" in body["error"]

    def test_handler_business_failure_is_iserror_true(self):
        """handler 级业务失败（非参数错误）也必须是 isError=true。

        改前：handler 返回 ``{"success": False}`` 被包成
        ``{"success": True, "result": {...}}`` → 非写入工具的失败被当作成功放行。
        """
        from autolink_hub.agent.tools import execute_tool, init_tools

        init_tools()
        raw = asyncio.run(execute_tool("create_project", {"projectName": ""}))
        assert raw["success"] is True  # execute_tool 层仍是 {success, result} 包装
        assert raw["result"]["success"] is False  # handler 以嵌套形态报失败

        mgr = _enable_compiled()
        res = _call(mgr, "create_project", {"projectName": ""})
        assert res.isError is True, "handler 级业务失败未置 isError"
        body = _body(res)
        assert body["success"] is False
        assert body["error"]

    def test_unknown_tool_error(self):
        from autolink_hub.agent.tools import execute_tool

        res = asyncio.run(execute_tool("no_such_tool_xyz", {}))
        assert res["success"] is False
        assert res["error_code"] == "AC_ERR_UNKNOWN_TOOL"


# =========================================================================
# 四、屏蔽规则（AL-S2）——3 条
# =========================================================================

class TestBlockedRules:
    """用户反馈 P0-3：屏蔽表用枚举名单（delete_template）与实际注册名（template_delete）不符。"""

    def test_semantic_rules_match_real_registered_names(self):
        from autolink_hub.mcp_server.capabilities import audit_block_rules, is_destructive_tool

        # 实际注册名是 template_delete / project_delete（不是 delete_template）
        assert is_destructive_tool("template_delete") is True
        assert is_destructive_tool("project_delete") is True
        assert is_destructive_tool("delete_project") is True
        # 正常工具不应误伤
        assert is_destructive_tool("list_projects") is False
        assert is_destructive_tool("generate_design") is False
        audit = audit_block_rules(
            ["delete_project", "template_delete", "project_delete", "list_projects"], "compiled"
        )
        assert "template_delete" in audit["compiled_blocked"]
        assert "project_delete" in audit["compiled_blocked"]

    def test_compiled_selection_contains_no_destructive_tool(self):
        from autolink_hub.agent.tools import get_tool_definitions
        from autolink_hub.mcp_server.capabilities import (
            assert_compiled_selection_safe,
            filter_tools_for_mode,
        )

        defs = get_tool_definitions()
        names = [(d.get("function") or d).get("name") for d in defs]
        selected = [t["name"] for t in filter_tools_for_mode("compiled", defs)]
        assert assert_compiled_selection_safe(selected, names) == []

    def test_rules_hitting_nothing_refuses_to_start(self, monkeypatch):
        """fail-fast：规则未命中任何注册工具时拒绝启动（防规则静默失效）。"""
        from autolink_hub.mcp_server import capabilities

        monkeypatch.setattr(capabilities, "_DESTRUCTIVE_PATTERNS", ())
        monkeypatch.setattr(capabilities, "_SOURCE_ONLY_PATTERNS", ())
        monkeypatch.setattr(capabilities, "SOURCE_ONLY_TOOLS", [])
        monkeypatch.setattr(capabilities, "COMPILED_BLOCKED_TOOLS", [])

        from autolink_hub.agent.tools import init_tools
        from autolink_hub.mcp_server.manager import get_agent_connect_manager

        init_tools()
        ok, msg = get_agent_connect_manager().enable(agent_mode="compiled")
        assert ok is False
        assert "安全断言失败" in msg


# =========================================================================
# 五、门禁矩阵（AL-S4）——4 条
# =========================================================================

class TestPermissionGate:
    """用户反馈 P1：``require_approval`` 只写进工具描述，无任何拦截。

    门禁只对 ``permission=confirm`` 的工具生效。AL 的 confirm 档工具
    （``delete_project`` / ``project_delete`` / ``template_delete`` / ``run_cli`` /
    ``read_file`` / ``list_dir`` / ``read_source``）在编译态全部不可见，
    因此**编译态门禁无可达对象**，机制验证在源码态进行（见 §八 的一致性用例）。
    """

    def test_notify_mode_records_without_blocking(self):
        mgr = _enable("source")
        mgr.set_gate_mode("notify")
        res = _call(mgr, "template_delete", {"templateName": "___nonexistent___"})
        body = _body(res)
        assert body.get("error_code") != "AC_ERR_PERMISSION_REQUIRED"
        assert len(mgr.gate_hits) >= 1

    def test_enforce_mode_blocks_without_token(self):
        mgr = _enable("source")
        mgr.set_gate_mode("enforce")
        res = _call(mgr, "template_delete", {"templateName": "___nonexistent___"})
        assert res.isError is True
        body = _body(res)
        assert body["error_code"] == "AC_ERR_PERMISSION_REQUIRED"

    def test_enforce_mode_passes_with_token(self):
        mgr = _enable("source")
        mgr.set_gate_mode("enforce")
        res = _call(mgr, "template_delete",
                    {"templateName": "___nonexistent___", "approvalToken": "ok"})
        body = _body(res)
        assert body.get("error_code") != "AC_ERR_PERMISSION_REQUIRED"

    def test_auto_permission_unaffected_by_gate(self):
        mgr = _enable_compiled()
        mgr.set_gate_mode("enforce")
        res = _call(mgr, "list_projects", {})
        assert res.isError is False


# =========================================================================
# 六、开关（AL-S3）——3 条
# =========================================================================

class TestSwitch:

    def test_stdio_entry_respects_switch(self, monkeypatch, tmp_path):
        """改前：stdio 入口直接 enable，开关关掉也能拉起；改后：开关关闭 → exit 2。"""
        from autolink_hub.mcp_server import run as run_mod

        monkeypatch.setattr("autolink_hub.config.get_enable_agent_connect", lambda: False, raising=False)
        monkeypatch.setattr(sys, "argv",
                            ["run", "--mode", "compiled", "--user-data", str(tmp_path)])
        assert run_mod.main() == 2

    def test_selfcheck_reads_real_switch(self, monkeypatch):
        """改前：selfcheck 只看内存状态；改后：真实读开关。"""
        from autolink_hub.mcp_server.manager import AgentConnectManager

        mgr = AgentConnectManager()
        monkeypatch.setattr(AgentConnectManager, "_read_switch", staticmethod(lambda: False))
        result = mgr.selfcheck()
        item = next(c for c in result["checks"] if c["name"] == "enabled")
        assert item["ok"] is False
        assert "开关=False" in item["message"]

    def test_selfcheck_includes_rule_and_gate_status(self):
        mgr = _enable_compiled()
        result = mgr.selfcheck()
        names = {c["name"] for c in result["checks"]}
        assert {"blocked_rules", "gate"} <= names
        rules = next(c for c in result["checks"] if c["name"] == "blocked_rules")
        assert rules["ok"] is True
        assert "编译态屏蔽" in rules["message"]
        gate = next(c for c in result["checks"] if c["name"] == "gate")
        assert gate["message"].startswith("写工具门禁=")


# =========================================================================
# 七、注解与资源（AL-S4 / AL-A3）——3 条
# =========================================================================

class TestAnnotationsAndResources:

    def test_all_tools_have_annotations(self):
        mgr = _enable_compiled()
        tm = _tm(mgr)
        missing = [n for n in tm._tools if tm.get_tool(n).annotations is None]
        assert missing == [], f"缺少 annotations 的工具：{missing}"

    def test_readonly_tool_marked_readonly(self):
        mgr = _enable_compiled()
        t = _tm(mgr).get_tool("list_projects")
        assert t.annotations.readOnlyHint is True

    def test_prompts_and_resources_registered(self):
        mgr = _enable_compiled()
        prompts = sorted(mgr.mcp._prompt_manager._prompts.keys())
        resources = sorted(mgr.mcp._resource_manager._resources.keys())
        assert prompts, "未注册任何 prompt"
        assert resources, "未注册任何 resource"


# =========================================================================
# 八、双端一致性与权限一致性
# =========================================================================

class TestConsistency:

    def test_legacy_arguments_wrapper_still_works(self):
        """旧客户端沿用 {"arguments": {...}} 包裹时仍可正常调用。"""
        mgr = _enable_compiled()
        res = _call(mgr, "list_projects", {"arguments": {}})
        assert res.isError is False

    def test_confirm_tools_all_hidden_in_compiled(self):
        """编译态下所有 confirm 档工具必须不可见（否则门禁在编译态形同虚设）。"""
        from autolink_hub.agent.tools import get_tool_definitions
        from autolink_hub.mcp_server.capabilities import filter_tools_for_mode

        defs = get_tool_definitions()
        selected = {t["name"] for t in filter_tools_for_mode("compiled", defs)}
        confirm_tools = {
            (d.get("function") or d).get("name") for d in defs
            if ((d.get("function") or d).get("permission") or "").lower() == "confirm"
        }
        assert not (selected & confirm_tools), \
            f"编译态暴露了 confirm 档工具：{sorted(selected & confirm_tools)}"
