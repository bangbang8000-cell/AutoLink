"""5.4.5-AC-grant：外部 Agent 授权档位（readonly / semi / full）契约测试。

覆盖：
- 常量契约：GRANTS 取值、GRANT_DEFAULT=semi、非法值回落
- 三档对 AUTO/NOTIFY/CONFIRM 工具的实际放行行为
- full 档 fail-fast：未配审计路径拒绝启动
- ★ 关键边界：full 档**不豁免**编译态屏蔽规则（delete_* / run_cli / read_file 仍不可见）
- 授权档位写入审计（可追溯）
- selfcheck / status_report 暴露 grant
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from autolink_hub.mcp_server.manager import (  # noqa: E402
    AC_ERR_GRANT_DENIED,
    AC_ERR_PERMISSION_REQUIRED,
    GRANT_DEFAULT,
    GRANTS,
    AgentConnectManager,
)

# 注册期权限快照样本：auto / notify / confirm 各一
TOOLS = {
    "list_projects": "auto",
    "create_project": "notify",
    "project_delete": "confirm",
}


def _mgr(grant: str, gate: str = "enforce", audit=None) -> AgentConnectManager:
    """构造已设定授权档位与门禁模式的 manager（不真正 enable，直接设内部状态）。"""
    m = AgentConnectManager()
    m.set_grant(grant)
    m._gate_mode = gate
    m._tool_permissions = dict(TOOLS)
    if audit:
        m.set_audit_path(Path(audit))
    return m


# ============================================================
# 常量契约
# ============================================================

class TestGrantConstants:
    def test_grants_values(self):
        """GRANTS 三档且顺序稳定。"""
        assert GRANTS == ("readonly", "semi", "full")

    def test_default_is_semi(self):
        """默认档位为 semi（与程序内 AI 助手 semi_auto 同义，安全基线不降级）。"""
        assert GRANT_DEFAULT == "semi"
        assert AgentConnectManager().grant == "semi"

    def test_illegal_grant_falls_back(self):
        """非法档位回落默认值（不因错值放权）。"""
        m = AgentConnectManager()
        assert m._clamp_grant("bogus") == "semi"
        assert m._clamp_grant(None) == "semi"
        assert m._clamp_grant("FULL") == "semi"  # 大小写敏感，不认
        assert m._clamp_grant("full") == "full"

    def test_set_grant(self):
        """set_grant 生效并归一。"""
        m = AgentConnectManager()
        assert m.set_grant("readonly") == "readonly"
        assert m.grant == "readonly"
        assert m.set_grant("nonsense") == "semi"
        assert m.grant == "semi"


# ============================================================
# 三档放行矩阵（gate_mode=enforce 最严场景）
# ============================================================

class TestGrantMatrix:
    def test_readonly_allows_auto_only(self):
        """readonly：仅 AUTO 放行；NOTIFY/CONFIRM 一律拒绝（AC_ERR_GRANT_DENIED）。"""
        m = _mgr("readonly")
        assert m._permission_gate("list_projects", {}, {}, record=False) is None
        for tool in ("create_project", "project_delete"):
            r = m._permission_gate(tool, {}, {}, record=False)
            assert r is not None, f"{tool} 在 readonly 档应被拒绝"
            assert r["error_code"] == AC_ERR_GRANT_DENIED

    def test_semi_allows_auto_notify_blocks_confirm(self):
        """semi：AUTO/NOTIFY 放行；CONFIRM 在 enforce 下需凭据。"""
        m = _mgr("semi")
        assert m._permission_gate("list_projects", {}, {}, record=False) is None
        assert m._permission_gate("create_project", {}, {}, record=False) is None
        r = m._permission_gate("project_delete", {}, {}, record=False)
        assert r is not None
        assert r["error_code"] == AC_ERR_PERMISSION_REQUIRED

    def test_semi_confirm_passes_with_token(self):
        """semi + enforce + 携带凭据 → 放行。"""
        from autolink_hub.mcp_server.capabilities import CONFIRM_APPROVAL_FIELD

        m = _mgr("semi")
        r = m._permission_gate(
            "project_delete", {}, {CONFIRM_APPROVAL_FIELD: "tok"}, record=False
        )
        assert r is None

    def test_full_allows_everything(self):
        """full：全部工具放行（等价程序内 full_auto）。"""
        m = _mgr("full")
        for tool in TOOLS:
            assert m._permission_gate(tool, {}, {}, record=False) is None, \
                f"{tool} 在 full 档应放行"

    def test_grant_takes_precedence_over_gate_mode(self):
        """授权档优先于门禁模式：full 档在 enforce 下同样放行。"""
        m_full = _mgr("full", gate="enforce")
        m_semi = _mgr("semi", gate="enforce")
        assert m_full._permission_gate("project_delete", {}, {}, record=False) is None
        assert m_semi._permission_gate("project_delete", {}, {}, record=False) is not None


# ============================================================
# full 档 fail-fast（必须配审计）
# ============================================================

class TestFullRequiresAudit:
    def test_full_without_audit_refused(self):
        """full 档未配审计路径 → enable 拒绝启动。"""
        m = AgentConnectManager()
        ok, msg = m.enable(agent_mode="compiled", grant="full")
        assert ok is False
        assert "审计" in msg

    def test_invalid_grant_clamped_to_semi_not_full(self):
        """非法 grant 归一到 semi —— 不会意外获得 full。"""
        m = AgentConnectManager()
        assert m._clamp_grant("full_auto") == "semi"
        assert m._clamp_grant("") == "semi"


# ============================================================
# ★ 关键边界：full 不豁免编译态屏蔽规则（AG-3 裁定）
# ============================================================

class TestFullDoesNotBypassBlockedRules:
    """授权档与工具可见性是**正交**维度：授权管"要不要确认"，模式管"可不可见"。"""

    def test_full_grant_does_not_unblock_destructive(self):
        """full 档下，编译态屏蔽的破坏性工具仍不可见。"""
        from autolink_hub.agent.tools import get_tool_definitions, init_tools
        from autolink_hub.mcp_server.capabilities import filter_tools_for_mode

        init_tools()
        defs = get_tool_definitions()
        selected = filter_tools_for_mode("compiled", defs)
        names = {d["name"] for d in selected}
        # 这些在编译态必须被屏蔽，与 grant 取值无关
        for blocked in ("project_delete", "template_delete", "run_cli", "read_file"):
            assert blocked not in names, f"{blocked} 泄漏到编译态（grant=full 不得豁免）"

    def test_compiled_selection_assertion_still_holds(self):
        """编译态安全断言在 full 档语义下依然通过（屏蔽规则未被绕过）。"""
        from autolink_hub.mcp_server.capabilities import (
            assert_compiled_selection_safe,
            filter_tools_for_mode,
        )

        defs = [
            {"name": n, "permission": p, "description": "", "parameters": {}}
            for n, p in list(TOOLS.items()) + [
                ("run_cli", "confirm"), ("read_file", "confirm"),
                ("list_dir", "confirm"), ("read_source", "confirm"),
                ("template_delete", "confirm"),
            ]
        ]
        selected = [d["name"] for d in filter_tools_for_mode("compiled", defs)]
        assert assert_compiled_selection_safe(selected, [d["name"] for d in defs]) == []


# ============================================================
# 审计 / 自检 / 状态报告
# ============================================================

class TestGrantAuditAndSelfcheck:
    def test_grant_denied_writes_audit(self, tmp_path):
        """readonly 档拒绝写操作时留下审计（可追溯）。"""
        audit = tmp_path / "audit.jsonl"
        m = _mgr("readonly", audit=str(audit))
        m._permission_gate("create_project", {"name": "x"}, {}, record=True)
        assert audit.exists()
        entry = json.loads(audit.read_text(encoding="utf-8").strip())
        assert entry["result"] == "grant-denied"
        assert entry["tool"] == "create_project"

    def test_full_writes_granted_audit(self, tmp_path):
        """full 档放行时同样留痕（result=granted-full）。"""
        audit = tmp_path / "audit.jsonl"
        m = _mgr("full", audit=str(audit))
        m._permission_gate("project_delete", {}, {}, record=True)
        entry = json.loads(audit.read_text(encoding="utf-8").strip())
        assert entry["result"] == "granted-full"

    def test_gate_hits_carry_grant(self):
        """门禁命中记录带 grant 字段，便于区分授权来源。"""
        m = _mgr("readonly")
        m._permission_gate("create_project", {}, {}, record=True)
        hits = m.gate_hits
        assert hits and hits[-1]["grant"] == "readonly"
        assert hits[-1]["approved"] is False

    def test_status_report_exposes_grant(self):
        """status_report 暴露 grant 与 gate_mode。"""
        m = _mgr("readonly")
        r = m.status_report()
        assert r["grant"] == "readonly"
        assert r["gate_mode"] == "enforce"

    def test_selfcheck_includes_grant_check(self):
        """selfcheck 含 grant 检查项；semi 档恒 ok。"""
        m = _mgr("semi")
        result = m.selfcheck()
        assert result["grant"] == "semi"
        names = [c["name"] for c in result["checks"]]
        assert "grant" in names
        grant_check = next(c for c in result["checks"] if c["name"] == "grant")
        assert grant_check["ok"] is True

    def test_selfcheck_full_without_audit_not_ok(self):
        """selfcheck：full 档无审计 → grant 检查项不 ok（缺口可见）。"""
        m = AgentConnectManager()
        m.set_grant("full")
        result = m.selfcheck()
        grant_check = next(c for c in result["checks"] if c["name"] == "grant")
        assert grant_check["ok"] is False


# ---------------------------------------------------------------------------
# AG-4 复核：权限表 ↔ 注册表一致性守卫
# ---------------------------------------------------------------------------
# 背景：MC 侧 register_tool 从不显式传 permission ⇒ 未登记即被兜底 CONFIRM，
# 只读/编排类工具被误伤为高危。AL 侧 register 显式传值，行为正确，但「表与实现
# 不一致」本身是隐患。本守卫把「表 == 实现」钉死，防再度静默漂移。
#
# 白名单：3 个历史别名/预留条目（未注册，大师 2026-09-27 裁定保留）。
_DEAD_ENTRY_WHITELIST = {"get_project_info", "list_project_files", "list_templates"}


class TestPermissionTableMatchesRegistry:
    """权限表与注册表必须一致（除显式白名单）。"""

    @staticmethod
    def _registered_tool_permissions() -> dict:
        from autolink_hub.agent.tools import init_tools, get_tool_definitions

        init_tools()
        out = {}
        for d in get_tool_definitions():
            fn = d.get("function", d)
            out[fn["name"]] = fn.get("permission")
        return out

    def test_no_unregistered_but_used(self):
        """实现有、表中无 ⇒ 失败（会被兜底 CONFIRM 静默误伤）。"""
        from autolink_hub.agent.schemas import TOOL_PERMISSIONS

        impl = self._registered_tool_permissions()
        missing = sorted(set(impl) - set(TOOL_PERMISSIONS))
        assert not missing, f"以下已注册工具未在权限表登记（将兜底 CONFIRM）: {missing}"

    def test_no_dead_entries_outside_whitelist(self):
        """表中有、实现无 ⇒ 失败（除白名单 3 个历史预留条目）。"""
        from autolink_hub.agent.schemas import TOOL_PERMISSIONS

        impl = self._registered_tool_permissions()
        dead = sorted(set(TOOL_PERMISSIONS) - set(impl) - _DEAD_ENTRY_WHITELIST)
        assert not dead, f"权限表存在未注册死条目（应删除或加入白名单）: {dead}"

    def test_whitelist_entries_still_unregistered(self):
        """白名单条目若已被注册，应移出白名单（防白名单腐化）。"""
        impl = self._registered_tool_permissions()
        stale = sorted(_DEAD_ENTRY_WHITELIST & set(impl))
        assert not stale, f"白名单条目已注册，请从 _DEAD_ENTRY_WHITELIST 移除: {stale}"

    def test_table_matches_register_declaration(self):
        """表中值须与 register 声明一致（防止两边各说各话）。"""
        from autolink_hub.agent.schemas import TOOL_PERMISSIONS

        impl = self._registered_tool_permissions()
        mismatch = {
            n: (impl[n], TOOL_PERMISSIONS[n].value)
            for n in (set(impl) & set(TOOL_PERMISSIONS))
            if impl[n] != TOOL_PERMISSIONS[n].value
        }
        assert not mismatch, f"权限表与 register 声明不一致（工具: register值, 表值）: {mismatch}"

    def test_task_orchestration_permission(self):
        """AG-4 裁定：task_list/query/wait=AUTO；task_submit/cancel=NOTIFY。"""
        from autolink_hub.agent.schemas import get_tool_permission

        for t in ("task_list", "task_query", "task_wait"):
            assert get_tool_permission(t).value == "auto", t
        for t in ("task_submit", "task_cancel"):
            assert get_tool_permission(t).value == "notify", t

    def test_readonly_query_tools_not_confirm(self):
        """只读查询类不得被兜底成 CONFIRM（compile/audit 查询、知识库只读）。"""
        from autolink_hub.agent.schemas import get_tool_permission

        for t in ("list_knowledge", "search_knowledge", "audit_query"):
            assert get_tool_permission(t).value == "auto", t

    def test_source_only_tools_are_confirm(self):
        """源码态专用工具须显式 CONFIRM（不再依赖兜底）。"""
        from autolink_hub.agent.schemas import get_tool_permission

        for t in ("run_cli", "read_file", "list_dir", "read_source"):
            assert get_tool_permission(t).value == "confirm", t
