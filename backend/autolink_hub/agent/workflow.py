"""AutoLink AI Hub 多步自主任务编排（5.0.3-503-a，与 MC ai_hub/agent/workflow.py 同构对齐）

Plan → Execute → Verify 状态机：
- Plan：LLM 输出「📋 执行计划」块（planner prompt 已注入 system prompt），经
  planner.parse_plan_from_response() 解析为 [{step, description, tool}]。
- Execute：逐步骤执行——复用 AgentSession.run_stream 的单轮工具循环（LLM → 工具调用
  → validator 校验 → execute_tool 执行 → 结果回填）作为 execute 步进原语；
  每步结果以 OpenAI tool 消息持久化到会话，供下一步上下文。
- Verify：verify_tool_result() 轻量结果一致性校验（工具声称结果 ↔ 结果结构/设计/磁盘），
  与 MC accuracy.py verify_tool_result 对齐；校验结果非致命（记录并展示，不阻断流程）。

autonomy_mode 审批：
- full_auto：全自主，无步骤审批
- semi_auto：关键步确认（工具权限为 CONFIRM 的步骤需确认）
- advisor：每步确认

状态：planning → executing ⇄ awaiting_step → verifying → completed / failed / cancelled。
待审批步骤以 `---STEP_CONFIRM:<task_id>:<step>---` 标记随流输出（前端渲染确认卡片），
用户「确认/取消」回复经 run_workflow_chat 检测后续跑（对齐 4.3 CONFIRM 流程）。

本模块不扩展 AgentProvider 抽象接口（外部引擎零改动）：workflow 由自有引擎
内部驱动，chat 层在 own 引擎 + workflow 模式时调用 run_workflow_chat。
"""
import json
import logging
import re
import uuid
from datetime import datetime
from typing import AsyncIterator, Optional

from autolink_hub.agent.planner import parse_plan_from_response
from autolink_hub.agent.schemas import ToolPermission, get_tool_permission

logger = logging.getLogger(__name__)

# ============================================================
# 状态常量
# ============================================================

STATUS_PLANNING = "planning"
STATUS_EXECUTING = "executing"
STATUS_AWAITING_STEP = "awaiting_step"
STATUS_VERIFYING = "verifying"
STATUS_COMPLETED = "completed"
STATUS_FAILED = "failed"
STATUS_CANCELLED = "cancelled"

STEP_PENDING = "pending"
STEP_RUNNING = "running"
STEP_COMPLETED = "completed"
STEP_FAILED = "failed"
STEP_SKIPPED = "skipped"

# 前端进度标记：---WORKFLOW:<json>---
WORKFLOW_MARKER_PREFIX = "---WORKFLOW:"
# 步骤审批标记：---STEP_CONFIRM:<task_id>:<step>---
STEP_CONFIRM_PREFIX = "---STEP_CONFIRM:"

# Plan 阶段指令（追加用户消息，要求只输出计划不执行工具）
PLAN_INSTRUCTION = (
    "（多步任务编排）请先为上面的任务制定执行计划：输出 📋 执行计划 块，"
    "每行格式「1. <步骤描述> — 使用工具: <工具名>」，最多 5 步。"
    "此阶段只输出计划，不要执行任何工具。"
)

# 单步执行指令模板
STEP_INSTRUCTION = (
    "请执行计划第 {index} 步（共 {total} 步）：{description}\n"
    "计划指定的工具：{tool}。请只执行这一步骤（调用一次工具），完成后简要汇报结果。"
)

APPROVE_KEYWORDS = ("确认", "是", "继续", "好的", "确定", "批准", "同意", "ok", "yes", "confirm", "y", "approve")
REJECT_KEYWORDS = ("取消", "拒绝", "中止", "停止", "不要", "no", "n", "cancel", "reject", "abort")


def classify_approval_reply(message: str) -> Optional[str]:
    """把用户回复归类为步骤审批：approve / reject / None（非审批回复）"""
    m = (message or "").strip().lower()
    if not m:
        return None
    if m in APPROVE_KEYWORDS:
        return "approve"
    if m in REJECT_KEYWORDS:
        return "reject"
    return None


def needs_step_approval(autonomy_mode: str, permission: ToolPermission) -> bool:
    """按自主模式判断步骤是否需要用户审批：
    - full_auto：不审批；advisor：每步审批；semi_auto：关键步（CONFIRM 权限）审批
    """
    mode = (autonomy_mode or "semi_auto").strip().lower()
    if mode == "full_auto":
        return False
    if mode == "advisor":
        return True
    return permission == ToolPermission.CONFIRM


# ============================================================
# WorkflowTask（状态机）
# ============================================================

class WorkflowTask:
    """单个多步任务的状态机实例（Plan/Execute/Verify）"""

    def __init__(self, session_id: str, engine: str, autonomy_mode: str = "semi_auto"):
        self.task_id: str = uuid.uuid4().hex[:12]
        self.session_id = session_id
        self.engine = engine
        self.autonomy_mode = (autonomy_mode or "semi_auto").strip().lower()
        self.status: str = STATUS_PLANNING
        self.plan: list[dict] = []
        self.current_step: int = 0
        self.verify_result: Optional[dict] = None
        self.error: str = ""
        self.created_at: str = datetime.now().isoformat()
        self.updated_at: str = self.created_at

    def _touch(self) -> None:
        self.updated_at = datetime.now().isoformat()

    def set_plan(self, plan: list[dict]) -> None:
        """装载解析后的计划，并初始化每步状态"""
        steps = []
        for s in plan:
            steps.append({
                "step": int(s.get("step", len(steps) + 1)),
                "description": s.get("description", ""),
                "tool": s.get("tool", ""),
                "status": STEP_PENDING,
                "result": None,
                "verify": None,
                "approved": False,
            })
        self.plan = steps
        self.current_step = 0
        self.status = STATUS_EXECUTING
        self._touch()

    def mark_step_running(self, index: int) -> None:
        if 0 <= index < len(self.plan):
            self.plan[index]["status"] = STEP_RUNNING
            self.current_step = index
            self.status = STATUS_EXECUTING
            self._touch()

    def mark_step_done(self, index: int, result: dict, verify: dict) -> None:
        if 0 <= index < len(self.plan):
            ok = bool(result.get("success"))
            self.plan[index]["status"] = STEP_COMPLETED if ok else STEP_FAILED
            self.plan[index]["result"] = result
            self.plan[index]["verify"] = verify
            self.verify_result = verify
            self._touch()

    def approve_current_step(self) -> None:
        """用户确认执行当前待审批步骤（保持 awaiting_step，由 run_workflow 续跑分支接管）"""
        if 0 <= self.current_step < len(self.plan):
            self.plan[self.current_step]["approved"] = True
            self._touch()

    def cancel(self, reason: str = "") -> None:
        """取消任务（用户拒绝/中断）"""
        self.status = STATUS_CANCELLED
        self.error = reason
        if 0 <= self.current_step < len(self.plan):
            self.plan[self.current_step]["status"] = STEP_SKIPPED
        self._touch()

    def fail(self, reason: str = "") -> None:
        self.status = STATUS_FAILED
        self.error = reason
        self._touch()

    def complete(self) -> None:
        self.status = STATUS_COMPLETED
        self.error = ""
        self._touch()

    def snapshot(self) -> dict:
        """任务状态快照（供会话任务状态 / 前端进度展示 / HTTP 查询）"""
        return {
            "task_id": self.task_id,
            "session_id": self.session_id,
            "engine": self.engine,
            "autonomy_mode": self.autonomy_mode,
            "status": self.status,
            "current_step": self.current_step,
            "total_steps": len(self.plan),
            "plan": [
                {
                    "step": s["step"],
                    "description": s["description"],
                    "tool": s["tool"],
                    "status": s["status"],
                }
                for s in self.plan
            ],
            "verify_result": self.verify_result,
            "error": self.error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }


def _progress_marker(task: WorkflowTask) -> str:
    """输出前端进度标记行（---WORKFLOW:{json}---，渲染时按行剥离）"""
    snap = task.snapshot()
    return (
        f"\n{WORKFLOW_MARKER_PREFIX}"
        f"{json.dumps(snap, ensure_ascii=False)}"
        f"---\n"
    )


def _step_confirm_marker(task: WorkflowTask, index: int) -> str:
    return f"\n{STEP_CONFIRM_PREFIX}{task.task_id}:{index}---\n"


# ============================================================
# WorkflowManager
# ============================================================

class WorkflowManager:
    """进程内任务注册表（按 session_id + engine 隔离，与引擎命名空间一致）"""

    def __init__(self):
        self._tasks: dict[tuple[str, str], WorkflowTask] = {}

    def create(self, session_id: str, engine: str = "own", autonomy_mode: str = "semi_auto") -> WorkflowTask:
        task = WorkflowTask(session_id, engine, autonomy_mode)
        self._tasks[(session_id, engine)] = task
        return task

    def get(self, session_id: str, engine: str = "own") -> Optional[WorkflowTask]:
        return self._tasks.get((session_id, engine))

    def get_active(self, session_id: str, engine: str = "own") -> Optional[WorkflowTask]:
        """取会话进行中（未终结）的任务"""
        task = self._tasks.get((session_id, engine))
        if task is None or task.status in (STATUS_COMPLETED, STATUS_FAILED, STATUS_CANCELLED):
            return None
        return task

    def clear(self, session_id: str, engine: str = "own") -> None:
        self._tasks.pop((session_id, engine), None)

    def clear_all(self) -> None:
        self._tasks.clear()


_manager: Optional[WorkflowManager] = None


def get_workflow_manager() -> WorkflowManager:
    global _manager
    if _manager is None:
        _manager = WorkflowManager()
    return _manager


def reset_workflow_manager() -> None:
    """测试隔离：清空任务注册表"""
    global _manager
    if _manager is not None:
        _manager.clear_all()
    _manager = WorkflowManager()


# ============================================================
# 计划 / 执行 / 校验
# ============================================================

async def _collect_plan(session) -> str:
    """Plan 阶段：直接经 provider 流式收集计划文本（不执行工具）"""
    output = ""
    try:
        stream = session.provider.chat_stream(
            messages=list(session.messages),
            system_prompt=session.system_prompt,
        )
        async for chunk in stream:
            output += chunk
    except Exception as e:  # noqa: BLE001
        logger.error(f"Workflow plan error: {e}")
        output += f"\n\n> 错误: {e}"
    return output


def _extract_tool_result(output: str) -> Optional[dict]:
    """从 run_stream 单轮输出中提取工具执行结果（`> 工具执行结果:\n```json\n...`）"""
    m = re.search(r"工具执行结果:\s*\n```json\n(.*?)\n```", output, re.DOTALL)
    if not m:
        return None
    try:
        data = json.loads(m.group(1))
        return data if isinstance(data, dict) else None
    except (json.JSONDecodeError, TypeError):
        return None


def _persist_step_result(session, tool_name: str, args: dict, result: dict) -> None:
    """把单步工具结果以 OpenAI tool 消息持久化到会话（供下一步 LLM 上下文）"""
    tool_call_id = f"call_wf_{uuid.uuid4().hex[:8]}"
    session.add_message(
        "assistant", "",
        {"tool_calls": [{
            "id": tool_call_id,
            "type": "function",
            "function": {"name": tool_name, "arguments": json.dumps(args, ensure_ascii=False)},
        }]},
    )
    session.add_message(
        "tool", json.dumps(result, ensure_ascii=False), {"tool_call_id": tool_call_id},
    )


async def _execute_step(session, task: WorkflowTask, index: int) -> tuple[bool, dict, str]:
    """Execute 步进：复用 run_stream 单轮工具循环执行第 index 步。

    返回 (ok, result, output)：ok=False 表示工具执行失败或该步未调用工具。
    """
    step = task.plan[index]
    total = len(task.plan)
    session.add_message(
        "user",
        STEP_INSTRUCTION.format(index=index + 1, total=total,
                                description=step["description"], tool=step["tool"]),
    )
    output = ""
    async for chunk in session.run_stream(max_tool_rounds=1):
        output += chunk

    result = _extract_tool_result(output)
    if result is None:
        # 该步 LLM 未调用工具（可能直接给出文本/拒答，或工具失败未产出结果块）
        step["result"] = {"success": False, "error": "该步骤未调用任何工具（LLM 未产出工具调用）"}
        return False, step["result"], output

    # run_stream 的「工具执行结果」块为未包装 payload（即 execute_tool 返回的 result["result"]），
    # 此处包装为 {success, result} 供流程与校验统一处理
    wrapped = {"success": True, "result": result}
    # 持久化工具结果到会话消息（OpenAI 标准格式）
    _persist_step_result(session, step["tool"], {}, wrapped)
    return True, wrapped, output


# ============================================================
# Verify：轻量结果一致性校验（对齐 MC accuracy.py verify_tool_result）
# ============================================================

def verify_tool_result(tool_name: str, arguments: dict, result: dict,
                       project_name: str = "") -> dict:
    """校验工具声称结果 ↔ 结果结构/设计/磁盘一致性。

    返回 {ok, checks:[{check, ok, detail}], summary}。非致命：仅记录并随流展示。
    """
    checks: list[dict] = []
    ok = True

    if not isinstance(result, dict):
        return {
            "ok": False,
            "checks": [{"check": "result_type", "ok": False, "detail": "工具结果非 JSON 对象"}],
            "summary": "结果格式异常",
        }

    if result.get("success") is False:
        ok = False
        checks.append({"check": "tool_success", "ok": False,
                       "detail": str(result.get("error", "工具执行失败"))})
    else:
        checks.append({"check": "tool_success", "ok": True, "detail": "工具执行成功"})

    payload = result.get("result", result)
    tool = (tool_name or "").lower()

    if tool in ("validate_design", "validate"):
        issues = payload.get("validationIssues") if isinstance(payload, dict) else None
        if issues is None and isinstance(payload, dict):
            validation = payload.get("validation") or {}
            issues = validation.get("issues") if isinstance(validation, dict) else None
        errors = [i for i in (issues or []) if str((i or {}).get("severity", "")).lower() == "error"]
        checks.append({"check": "no_error_issues", "ok": len(errors) == 0,
                       "detail": f"{len(errors)} 个 error 级问题" if errors else "无 error 级问题"})
        ok = ok and len(errors) == 0

    elif tool in ("generate_design", "design"):
        has_artifacts = bool(payload) and (
            (isinstance(payload, dict) and ("topology" in payload or "nodes" in payload
                                            or "design" in payload or "valid" in payload))
            or isinstance(payload, (list, str))
        )
        checks.append({"check": "design_artifacts", "ok": has_artifacts,
                       "detail": "生成设计产物" if has_artifacts else "缺少拓扑/设计产物"})
        ok = ok and has_artifacts

    elif tool in ("project_write_file", "template_create", "project_create",
                  "update_project", "create_project", "create_from_template",
                  "room_set_type", "room_place", "repair_apply", "optimize_apply",
                  "skill_update", "skill_save", "skill_optimize"):
        checks.append({"check": "write_success", "ok": bool(result.get("success")),
                       "detail": "写操作已落盘" if result.get("success") else "写操作未成功"})
        ok = ok and bool(result.get("success"))

    else:
        present = bool(payload) and (not isinstance(payload, dict) or len(payload) > 0)
        checks.append({"check": "result_present", "ok": present,
                       "detail": "工具返回了结果" if present else "工具返回为空"})
        ok = ok and present

    summary = "；".join(
        f"{'✓' if c['ok'] else '✗'} {c['check']}: {c['detail']}" for c in checks
    ) or "无校验项"
    return {"ok": ok, "checks": checks, "summary": summary}


# ============================================================
# 工作流主循环（异步生成器：产出 SSE 文本 chunk + 结构化标记）
# ============================================================

async def run_workflow(session, task: WorkflowTask) -> AsyncIterator[str]:
    """驱动一个任务的状态机，产出流式文本与标记。

    - 首次调用：Plan（收集计划 → parse_plan_from_response）→ 逐步骤 Execute/Verify
    - 待审批返回后由 run_workflow_chat 再次调用（task 处于 awaiting_step）续跑
    """
    # 续跑分支：任务已确认/恢复，从当前步骤继续
    if task.status == STATUS_AWAITING_STEP:
        task.status = STATUS_EXECUTING
        async for chunk in _run_steps(session, task):
            yield chunk
        return

    # ---- Plan 阶段 ----
    task.status = STATUS_PLANNING
    yield _progress_marker(task)
    session.add_message("user", PLAN_INSTRUCTION)
    plan_output = await _collect_plan(session)
    plan = parse_plan_from_response(plan_output)

    if not plan:
        # 未能解析计划 → 降级为普通对话（直接输出 LLM 文本）
        session.add_message("assistant", plan_output)
        task.complete()
        task.error = "未能从回复中解析出 📋 执行计划，已按普通对话处理"
        yield plan_output
        yield _progress_marker(task)
        return

    task.set_plan(plan)
    # 把计划文本写入会话，供后续步骤上下文
    session.add_message("assistant", plan_output)
    yield plan_output
    yield _progress_marker(task)

    # ---- Execute / Verify 阶段 ----
    async for chunk in _run_steps(session, task):
        yield chunk


async def _run_steps(session, task: WorkflowTask) -> AsyncIterator[str]:
    """逐步骤执行（含审批等待）与校验"""
    while task.current_step < len(task.plan):
        index = task.current_step
        step = task.plan[index]
        tool_name = step["tool"]

        # 审批检查
        if not step.get("approved") and needs_step_approval(
            task.autonomy_mode, get_tool_permission(tool_name),
        ):
            task.status = STATUS_AWAITING_STEP
            yield _step_confirm_marker(task, index)
            yield _progress_marker(task)
            yield (
                f"\n> ⚠️ 计划第 {index + 1} 步「{step['description']}」（工具: `{tool_name}`）"
                f"需要确认。请回复 '确认' 继续，或 '取消' 中止。\n\n"
            )
            return

        # Execute
        task.mark_step_running(index)
        yield f"\n> 🔧 执行计划第 {index + 1}/{len(task.plan)} 步：{step['description']}（工具: `{tool_name}`）\n\n"
        ok, result, output = await _execute_step(session, task, index)
        if output:
            yield output

        # Verify
        verify = verify_tool_result(tool_name, {}, result)
        task.mark_step_done(index, result, verify)
        task.verify_result = verify
        yield _progress_marker(task)
        yield f"\n> ✅ 第 {index + 1} 步完成，校验：{verify['summary']}\n\n"

        if not ok:
            task.fail(result.get("error", f"第 {index + 1} 步执行失败"))
            yield _progress_marker(task)
            yield f"\n\n> ❌ 任务中止：{task.error}\n\n"
            return

        task.current_step += 1

    task.complete()
    yield _progress_marker(task)
    yield f"\n\n> ✅ 多步任务完成（共 {len(task.plan)} 步）。\n\n"


# ============================================================
# 顶层入口：own 引擎 workflow 对话（不扩展 AgentProvider 抽象接口）
# ============================================================

async def run_workflow_chat(
    session_id: str,
    message: str,
    mode: str = "general",
    provider: Optional[str] = None,
    attachments: Optional[list[dict]] = None,
    autonomy_mode: str = "semi_auto",
    project_name: Optional[str] = None,
    engine: str = "own",
) -> AsyncIterator[str]:
    """workflow 模式对话入口（自有引擎内部驱动，外部引擎零改动）。

    与 OwnAgentProvider.stream_chat 等价的生命周期，但：
    - 有待审批任务时把「确认/取消」回复接入步骤审批续跑
    - 否则创建新任务进入 Plan → Execute → Verify 状态机
    """
    from autolink_hub.agent.agent import get_or_create_session
    session = get_or_create_session(session_id, engine=engine)
    session.set_provider(provider)
    session.set_mode(mode, project_name or "")
    session.autonomy_mode = autonomy_mode

    manager = get_workflow_manager()
    task = manager.get_active(session_id, engine)

    if task is not None and task.status == STATUS_AWAITING_STEP:
        verdict = classify_approval_reply(message)
        if verdict == "approve":
            task.approve_current_step()
            session.add_message(
                "user", f"（已确认）继续执行计划第 {task.current_step + 1} 步。",
            )
            async for chunk in run_workflow(session, task):
                yield chunk
            return
        if verdict == "reject":
            task.cancel("用户拒绝执行当前步骤")
            session.add_message("user", f"（用户已取消计划第 {task.current_step + 1} 步执行）")
            yield _progress_marker(task)
            yield f"\n\n> ⏹ 已取消任务，后续步骤未执行。\n\n"
            return
        # 非审批回复 → 视为普通对话（任务保持待审批，可稍后确认）
        session.add_user_message(message, attachments)
        async for chunk in session.run_stream():
            yield chunk
        return

    # 新任务
    task = manager.create(session_id, engine, autonomy_mode)
    session.active_workflow = task
    session.add_user_message(message, attachments)
    async for chunk in run_workflow(session, task):
        yield chunk
