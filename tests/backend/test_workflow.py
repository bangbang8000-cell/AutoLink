"""5.0.3-503-a：多步自主任务编排（Plan→Execute→Verify 状态机）测试

覆盖 backend/autolink_hub/agent/workflow.py：
- WorkflowTask 状态机：plan 装载 / 审批 / 完成 / 失败 / 取消 / 快照
- 审批逻辑：full_auto 不审批 / advisor 每步 / semi_auto 关键步（CONFIRM）
- 审批回复分类（确认/取消）
- verify_tool_result 轻量结果一致性校验（校验类/设计类/写操作/通用）
- run_workflow 端到端：mock LLM → Plan 解析 → 逐步骤 Execute → Verify → completed
- 步骤审批续跑：advisor 下 awaiting_step → 「确认」续跑 / 「取消」中止
- WorkflowManager 会话/引擎隔离 + clear
- chat.py workflow 模式：/send workflow SSE + /workflow/status 端点
"""
import asyncio
import json

import pytest

from autolink_hub.agent.schemas import ToolPermission
from autolink_hub.agent.workflow import (
    WorkflowTask, WorkflowManager, get_workflow_manager, reset_workflow_manager,
    parse_plan_from_response, needs_step_approval, classify_approval_reply,
    verify_tool_result, run_workflow, run_workflow_chat,
    STATUS_PLANNING, STATUS_EXECUTING, STATUS_AWAITING_STEP, STATUS_COMPLETED,
    STATUS_FAILED, STATUS_CANCELLED, STEP_CONFIRM_PREFIX, WORKFLOW_MARKER_PREFIX,
)


def _chunk(text: str, size: int = 120) -> list[str]:
    return [text[i:i + size] for i in range(0, len(text), size)]


class ScriptedMockProvider:
    """按脚本逐次返回完整响应的 mock LLM Provider"""

    def __init__(self, script: list[str]):
        self.script = list(script)
        self.calls = 0
        self.last_reasoning_content = ""

    @property
    def provider_name(self) -> str:
        return "wf-mock"

    async def chat_stream(self, messages, system_prompt="", **kwargs):
        idx = min(self.calls, len(self.script) - 1)
        self.calls += 1
        text = self.script[idx]
        for piece in _chunk(text):
            yield piece


def _tool_call(name: str, args: dict) -> str:
    return f'```tool_call\n{json.dumps({"name": name, "arguments": args}, ensure_ascii=False)}\n```'


PLAN_TEXT = (
    "好的，我先制定执行计划：\n\n"
    "📋 执行计划：\n"
    "1. 查看配置 schema — 使用工具: list_config_schema\n"
    "2. 查看技能清单 — 使用工具: skill_list\n"
    "\n然后按计划执行。"
)

PLAN_TEXT_ONE = (
    "好的，我先制定执行计划：\n\n"
    "📋 执行计划：\n"
    "1. 查看配置 schema — 使用工具: list_config_schema\n"
    "\n然后按计划执行。"
)


@pytest.fixture(autouse=True)
def clean_workflow(tmp_path, monkeypatch):
    """隔离工作流注册表 + user_data + 会话 + 记忆目录（避免 run_stream 落盘仓库根）"""
    reset_workflow_manager()
    monkeypatch.setenv("AUTOLINK_USER_DATA", str(tmp_path))
    from autolink_hub.config import settings
    settings.user_data_dir = str(tmp_path)
    from autolink_hub.memory.engine import get_memory_engine
    get_memory_engine().init_dir(str(tmp_path))
    from autolink_hub.agent.agent import _sessions
    _sessions.clear()
    yield
    reset_workflow_manager()
    _sessions.clear()


def _collect(agen) -> str:
    async def run():
        parts = []
        async for chunk in agen:
            parts.append(chunk)
        return "".join(parts)
    return asyncio.run(run())


# ============================================================
# WorkflowTask 状态机
# ============================================================

class TestWorkflowTask:
    def test_initial_state(self):
        t = WorkflowTask("s1", "own", "semi_auto")
        assert t.status == STATUS_PLANNING
        assert t.plan == []
        assert t.current_step == 0
        assert t.task_id
        snap = t.snapshot()
        assert snap["status"] == STATUS_PLANNING
        assert snap["session_id"] == "s1" and snap["engine"] == "own"
        assert snap["autonomy_mode"] == "semi_auto"
        assert snap["total_steps"] == 0

    def test_set_plan_initializes_steps(self):
        t = WorkflowTask("s1", "own")
        plan = [
            {"step": 1, "description": "校验", "tool": "validate_design"},
            {"step": 2, "description": "导出", "tool": "export_outputs"},
        ]
        t.set_plan(plan)
        assert t.status == STATUS_EXECUTING
        assert len(t.plan) == 2
        assert t.plan[0]["status"] == "pending"
        assert t.plan[0]["approved"] is False
        assert t.plan[1]["tool"] == "export_outputs"

    def test_mark_step_and_approve(self):
        t = WorkflowTask("s1", "own")
        t.set_plan([{"step": 1, "description": "a", "tool": "list_config_schema"}])
        t.mark_step_running(0)
        assert t.plan[0]["status"] == "running"
        assert t.current_step == 0
        assert t.status == STATUS_EXECUTING
        t.approve_current_step()
        assert t.plan[0]["approved"] is True

    def test_mark_step_done_and_verify(self):
        t = WorkflowTask("s1", "own")
        t.set_plan([{"step": 1, "description": "a", "tool": "list_config_schema"}])
        result = {"success": True, "result": {"schemas": {}}}
        verify = {"ok": True, "checks": [], "summary": "ok"}
        t.mark_step_done(0, result, verify)
        assert t.plan[0]["status"] == "completed"
        assert t.plan[0]["result"] == result
        assert t.verify_result == verify

    def test_cancel_and_fail_and_complete(self):
        t = WorkflowTask("s1", "own")
        t.cancel("用户拒绝")
        assert t.status == STATUS_CANCELLED
        t2 = WorkflowTask("s2", "own")
        t2.fail("工具失败")
        assert t2.status == STATUS_FAILED and t2.error == "工具失败"
        t3 = WorkflowTask("s3", "own")
        t3.complete()
        assert t3.status == STATUS_COMPLETED


# ============================================================
# 审批逻辑
# ============================================================

class TestApproval:
    def test_full_auto_no_approval(self):
        assert needs_step_approval("full_auto", ToolPermission.CONFIRM) is False
        assert needs_step_approval("full_auto", ToolPermission.AUTO) is False

    def test_advisor_every_step(self):
        assert needs_step_approval("advisor", ToolPermission.AUTO) is True
        assert needs_step_approval("advisor", ToolPermission.NOTIFY) is True
        assert needs_step_approval("advisor", ToolPermission.CONFIRM) is True

    def test_semi_auto_only_confirm(self):
        assert needs_step_approval("semi_auto", ToolPermission.CONFIRM) is True
        assert needs_step_approval("semi_auto", ToolPermission.AUTO) is False
        assert needs_step_approval("semi_auto", ToolPermission.NOTIFY) is False

    def test_default_semi_auto(self):
        assert needs_step_approval("", ToolPermission.CONFIRM) is True
        assert needs_step_approval(None, ToolPermission.AUTO) is False

    def test_classify_approval_reply(self):
        assert classify_approval_reply("确认") == "approve"
        assert classify_approval_reply("继续") == "approve"
        assert classify_approval_reply(" 取消 ") == "reject"
        assert classify_approval_reply("你好") is None
        assert classify_approval_reply("") is None


# ============================================================
# verify_tool_result
# ============================================================

class TestVerify:
    def test_validate_ok(self):
        r = verify_tool_result("validate_design", {}, {"success": True, "result": {"validationIssues": []}})
        assert r["ok"] is True
        assert any(c["check"] == "no_error_issues" and c["ok"] for c in r["checks"])

    def test_validate_with_errors(self):
        r = verify_tool_result("validate_design", {}, {
            "success": True,
            "result": {"validationIssues": [{"severity": "error", "message": "V002 功率超限"}]},
        })
        assert r["ok"] is False
        assert any(c["check"] == "no_error_issues" and not c["ok"] for c in r["checks"])

    def test_design_artifacts(self):
        ok = verify_tool_result("generate_design", {}, {"success": True, "result": {"topology": {}}})
        assert ok["ok"] is True
        bad = verify_tool_result("generate_design", {}, {"success": True, "result": {}})
        assert bad["ok"] is False

    def test_write_success(self):
        ok = verify_tool_result("project_write_file", {}, {"success": True, "result": {}})
        assert ok["ok"] is True
        bad = verify_tool_result("project_write_file", {}, {"success": False, "error": "写失败"})
        assert bad["ok"] is False

    def test_generic_result_present(self):
        assert verify_tool_result("list_config_schema", {}, {"success": True, "result": {"x": 1}})["ok"] is True
        assert verify_tool_result("list_config_schema", {}, {"success": True, "result": {}})["ok"] is False

    def test_tool_failure_detected(self):
        r = verify_tool_result("anything", {}, {"success": False, "error": "boom"})
        assert r["ok"] is False
        assert r["checks"][0]["check"] == "tool_success"

    def test_non_dict_result(self):
        r = verify_tool_result("list_config_schema", {}, "not-a-dict")
        assert r["ok"] is False


# ============================================================
# WorkflowManager 隔离
# ============================================================

class TestManager:
    def test_create_and_get(self):
        m = get_workflow_manager()
        task = m.create("s1", "own", "full_auto")
        assert m.get("s1", "own") is task
        assert m.get_active("s1", "own") is task
        assert m.get("s1", "hermes") is None  # 引擎隔离

    def test_active_excludes_terminal(self):
        m = get_workflow_manager()
        t = m.create("s1", "own")
        t.complete()
        assert m.get_active("s1", "own") is None
        assert m.get("s1", "own") is t  # 已完成任务仍可查询

    def test_clear(self):
        m = get_workflow_manager()
        m.create("s1", "own")
        m.clear("s1", "own")
        assert m.get("s1", "own") is None

    def test_clear_all(self):
        m = get_workflow_manager()
        m.create("s1", "own")
        m.create("s2", "own")
        m.clear_all()
        assert m.get("s1", "own") is None and m.get("s2", "own") is None


# ============================================================
# 端到端：run_workflow / run_workflow_chat（mock LLM）
# ============================================================

class TestWorkflowRun:
    def _setup(self, script, monkeypatch):
        from autolink_hub.agent.tools import init_tools
        from autolink_hub.llm.provider import registry
        init_tools()
        mock = ScriptedMockProvider(script)
        registry._providers.clear()
        registry.register("wf-mock", mock)
        return mock

    def test_full_auto_end_to_end(self, tmp_path, monkeypatch):
        """full_auto：Plan → 2 步 Execute → Verify → completed（无审批）"""
        from autolink_hub.config import settings
        monkeypatch.setenv("AUTOLINK_USER_DATA", str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        script = [
            PLAN_TEXT,
            _tool_call("list_config_schema", {}),
            _tool_call("skill_list", {}),
        ]
        self._setup(script, monkeypatch)
        out = _collect(run_workflow_chat(
            session_id="wf-full", message="帮我梳理配置项和技能", mode="general",
            provider="wf-mock", autonomy_mode="full_auto", engine="own",
        ))
        task = get_workflow_manager().get("wf-full", "own")
        assert task is not None
        assert task.status == STATUS_COMPLETED
        assert len(task.plan) == 2
        assert all(s["status"] == "completed" for s in task.plan)
        assert task.verify_result is not None
        # 流含进度标记与步骤文本
        assert WORKFLOW_MARKER_PREFIX in out
        assert "执行计划第 1/2 步" in out
        assert "多步任务完成" in out

    def test_step_execution_uses_real_tools(self, tmp_path, monkeypatch):
        """步骤经 run_stream 单轮工具循环真实执行（execute_tool → cli.execute）"""
        from autolink_hub.config import settings
        monkeypatch.setenv("AUTOLINK_USER_DATA", str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        script = [
            PLAN_TEXT,
            _tool_call("list_config_schema", {}),
        ]
        self._setup(script, monkeypatch)
        out = _collect(run_workflow_chat(
            session_id="wf-real", message="查看配置 schema", mode="general",
            provider="wf-mock", autonomy_mode="full_auto", engine="own",
        ))
        task = get_workflow_manager().get("wf-real", "own")
        assert task.status == STATUS_COMPLETED
        # 工具结果真实存在（list_config_schema 返回 schemas）
        result = task.plan[0]["result"]
        assert result["success"] is True
        assert "schemas" in result["result"] or "presets" in result["result"]

    def test_advisor_waits_for_approval_then_resumes(self, tmp_path, monkeypatch):
        """advisor：每步审批 → awaiting_step → 「确认」续跑 → completed"""
        from autolink_hub.config import settings
        monkeypatch.setenv("AUTOLINK_USER_DATA", str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        script = [PLAN_TEXT_ONE, _tool_call("list_config_schema", {})]
        self._setup(script, monkeypatch)

        out1 = _collect(run_workflow_chat(
            session_id="wf-adv", message="梳理配置项", mode="general",
            provider="wf-mock", autonomy_mode="advisor", engine="own",
        ))
        task = get_workflow_manager().get("wf-adv", "own")
        assert task.status == STATUS_AWAITING_STEP
        assert STEP_CONFIRM_PREFIX in out1
        assert "需要确认" in out1
        assert task.plan[0]["approved"] is False

        # 用户确认 → 续跑
        out2 = _collect(run_workflow_chat(
            session_id="wf-adv", message="确认", mode="general",
            provider="wf-mock", autonomy_mode="advisor", engine="own",
        ))
        assert task.status == STATUS_COMPLETED
        assert task.plan[0]["approved"] is True
        assert task.plan[0]["status"] == "completed"
        assert "多步任务完成" in out2

    def test_semi_auto_auto_step_runs_without_approval(self, tmp_path, monkeypatch):
        """semi_auto：AUTO 权限步骤不审批（关键步才确认）"""
        from autolink_hub.config import settings
        monkeypatch.setenv("AUTOLINK_USER_DATA", str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        script = [PLAN_TEXT, _tool_call("list_config_schema", {})]
        self._setup(script, monkeypatch)
        out = _collect(run_workflow_chat(
            session_id="wf-semi", message="梳理配置项", mode="general",
            provider="wf-mock", autonomy_mode="semi_auto", engine="own",
        ))
        task = get_workflow_manager().get("wf-semi", "own")
        assert task.status == STATUS_COMPLETED
        assert STEP_CONFIRM_PREFIX not in out  # AUTO 步骤不审批

    def test_advisor_reject_cancels(self, tmp_path, monkeypatch):
        """advisor：取消 → 任务中止（cancelled）"""
        from autolink_hub.config import settings
        monkeypatch.setenv("AUTOLINK_USER_DATA", str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        script = [PLAN_TEXT_ONE, _tool_call("list_config_schema", {})]
        self._setup(script, monkeypatch)
        _collect(run_workflow_chat(
            session_id="wf-rej", message="梳理配置项", mode="general",
            provider="wf-mock", autonomy_mode="advisor", engine="own",
        ))
        task = get_workflow_manager().get("wf-rej", "own")
        assert task.status == STATUS_AWAITING_STEP
        out = _collect(run_workflow_chat(
            session_id="wf-rej", message="取消", mode="general",
            provider="wf-mock", autonomy_mode="advisor", engine="own",
        ))
        assert task.status == STATUS_CANCELLED
        assert task.plan[0]["status"] == "skipped"
        assert "已取消任务" in out

    def test_fallback_when_no_plan(self, tmp_path, monkeypatch):
        """无法解析计划 → 降级普通对话输出，任务仍完成"""
        from autolink_hub.config import settings
        monkeypatch.setenv("AUTOLINK_USER_DATA", str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        script = ["这是一个没有计划的普通回答"]
        self._setup(script, monkeypatch)
        out = _collect(run_workflow_chat(
            session_id="wf-noplan", message="随便聊聊", mode="general",
            provider="wf-mock", autonomy_mode="full_auto", engine="own",
        ))
        task = get_workflow_manager().get("wf-noplan", "own")
        assert task.status == STATUS_COMPLETED
        assert "普通回答" in out

    def test_session_active_workflow_set(self, tmp_path, monkeypatch):
        from autolink_hub.config import settings
        monkeypatch.setenv("AUTOLINK_USER_DATA", str(tmp_path))
        settings.user_data_dir = str(tmp_path)
        script = [PLAN_TEXT, _tool_call("list_config_schema", {})]
        self._setup(script, monkeypatch)
        _collect(run_workflow_chat(
            session_id="wf-sess", message="梳理配置项", mode="general",
            provider="wf-mock", autonomy_mode="full_auto", engine="own",
        ))
        from autolink_hub.agent.agent import get_or_create_session
        session = get_or_create_session("wf-sess", engine="own")
        assert session.active_workflow is not None
        assert session.active_workflow.task_id == get_workflow_manager().get("wf-sess", "own").task_id


# ============================================================
# chat.py workflow 模式（HTTP SSE）
# ============================================================

class TestWorkflowHttp:
    @pytest.fixture(autouse=True)
    def clean(self, tmp_path):
        from autolink_hub.config import settings
        settings.user_data_dir = str(tmp_path)
        settings.ai_engine = "own"
        yield

    def test_send_workflow_sse_and_status(self, tmp_path):
        from al_ai_hub.main import create_app
        from autolink_hub.llm.provider import registry
        from fastapi.testclient import TestClient

        registry._providers.clear()
        registry.register("wf-mock", ScriptedMockProvider([PLAN_TEXT_ONE, _tool_call("list_config_schema", {})]))
        client = TestClient(create_app())

        with client.stream("POST", "/api/chat/send", json={
            "session_id": "wf-http", "message": "梳理配置项",
            "provider": "wf-mock", "workflow": True, "autonomy_mode": "full_auto",
        }) as resp:
            assert resp.status_code == 200
            lines = [l for l in resp.iter_lines() if l and l.startswith("data: ")]
        content = "".join(
            json.loads(l[6:]).get("content", "") for l in lines if l.startswith('data: {"content"')
        )
        assert WORKFLOW_MARKER_PREFIX in content
        assert "多步任务完成" in content
        # done 事件附带任务状态
        done = [l for l in lines if '"status": "completed"' in l]
        assert done
        data = json.loads(done[0][6:])
        assert data.get("task") is not None
        assert data["task"]["status"] == "completed"

        # workflow/status 端点
        r = client.get("/api/chat/workflow/status", params={"session_id": "wf-http", "engine": "own"})
        assert r.status_code == 200
        body = r.json()
        assert body["task"] is not None
        assert body["task"]["status"] == "completed"
        assert body["task"]["total_steps"] == 1

    def test_workflow_status_no_task(self, tmp_path):
        from al_ai_hub.main import create_app
        from fastapi.testclient import TestClient
        client = TestClient(create_app())
        r = client.get("/api/chat/workflow/status", params={"session_id": "__none__"})
        assert r.status_code == 200
        assert r.json()["task"] is None

    def test_clear_removes_task(self, tmp_path):
        from al_ai_hub.main import create_app
        from autolink_hub.llm.provider import registry
        from fastapi.testclient import TestClient
        registry._providers.clear()
        registry.register("wf-mock", ScriptedMockProvider([PLAN_TEXT, _tool_call("list_config_schema", {})]))
        client = TestClient(create_app())
        with client.stream("POST", "/api/chat/send", json={
            "session_id": "wf-clr", "message": "梳理配置项",
            "provider": "wf-mock", "workflow": True, "autonomy_mode": "full_auto",
        }) as resp:
            list(resp.iter_lines())
        assert get_workflow_manager().get("wf-clr", "own") is not None
        client.post("/api/chat/clear?session_id=wf-clr")
        assert get_workflow_manager().get("wf-clr", "own") is None
