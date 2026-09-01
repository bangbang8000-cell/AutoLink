"""AutoLink AI Hub Agent 编排层（v3.1.1-T5-1.4，移植 MC ai_hub/agent/agent.py，autolink 化）

负责 Tool Calling 编排、上下文管理、多步骤推理。
run_stream 为核心：LLM 流式输出 → 解析工具调用 → validator 校验 → 权限检查
→ 执行工具（cli.execute）→ recovery 错误恢复 → 回填上下文 → 下一轮。
"""
import json
import logging
import re
import uuid
from typing import AsyncIterator, Optional

from autolink_hub.llm.provider import registry, LLMProvider
from autolink_hub.agent.tools import get_tool_definitions, execute_tool
from autolink_hub.prompts.loader import get_system_prompt
from autolink_hub.agent.validator import validate_tool_call
from autolink_hub.agent.recovery import analyze_error
from autolink_hub.agent.context import get_project_context, clear_project_context
from autolink_hub.agent.schemas import ToolPermission
from autolink_hub.skills.engine import get_skills_engine
from autolink_hub.memory.engine import get_memory_engine

logger = logging.getLogger(__name__)


class AgentSession:
    """Agent 会话，管理对话上下文和工具调用"""

    def __init__(self):
        self.messages: list[dict] = []
        self.system_prompt: str = get_system_prompt()
        self.provider: Optional[LLMProvider] = None
        self.mode: str = "general"
        self.autonomy_mode: str = "semi_auto"
        self.current_project: str = ""
        self.session_id: str = ""
        # 4.3 F3-2: 待用户确认的工具调用（CONFIRM 权限分级，等待下一条回复确认/取消）
        self.pending_confirmation: dict | None = None

    def set_provider(self, name: Optional[str] = None):
        self.provider = registry.get(name)

    def set_mode(self, mode: str, project_name: str = ""):
        """设置对话模式，自动加载对应 prompt"""
        self.mode = mode
        self.current_project = project_name
        self.system_prompt = get_system_prompt(mode, project_name)

    def add_message(self, role: str, content: str, extra: dict | None = None):
        msg = {"role": role, "content": content}
        if extra:
            msg.update(extra)
        self.messages.append(msg)

    def add_user_message(self, content: str, attachments: Optional[list[dict]] = None):
        """添加用户消息，可选附件信息（含路径，供 parse_file 工具使用）"""
        msg = content
        if attachments:
            file_list = "\n".join(
                f"- {a.get('name')} ({a.get('type')}) — {a.get('path')}" for a in attachments
            )
            # V3.1.3-T7-3: 提示 LLM 用 parse_file 解析附件
            msg = (
                "用户上传了以下附件（如需解析请调用 parse_file 工具，参数 path=附件路径）：\n"
                f"{file_list}\n\n用户消息：{content}"
            )
        self.add_message("user", msg)

    async def run_stream(self, max_tool_rounds: int = 5) -> AsyncIterator[str]:
        """运行 Agent 推理，流式返回结果"""
        if not self.provider:
            yield "错误: 没有可用的 AI Provider，请先在「设置 → AI」中配置 API Key。"
            return

        tools = get_tool_definitions()
        current_messages = list(self.messages)

        # 4.3 F3-2: 处理待确认工具的用户回复（CONFIRM 流程闭环）
        if self.pending_confirmation:
            last_user = ""
            if self.messages and self.messages[-1]["role"] == "user":
                last_user = str(self.messages[-1]["content"]).strip().lower()
            if last_user in ("确认", "是", "继续", "好的", "确定", "ok", "yes", "confirm", "y"):
                pending = self.pending_confirmation
                self.pending_confirmation = None
                tool_name, tool_args = pending["name"], pending["args"]
                yield f"\n\n> ✅ 已确认，正在执行工具: `{tool_name}`...\n\n"
                tool_call_id = f"call_{uuid.uuid4().hex[:12]}"
                result = await execute_tool(tool_name, tool_args)
                tool_result_json = json.dumps(result, ensure_ascii=False)
                # 工具轮上下文写入持久消息，供后续 LLM 轮次与用户下一条消息使用
                assistant_msg = {
                    "role": "assistant",
                    "content": None,
                    "tool_calls": [{
                        "id": tool_call_id,
                        "type": "function",
                        "function": {"name": tool_name, "arguments": json.dumps(tool_args, ensure_ascii=False)},
                    }],
                }
                self.add_message("assistant", "", {"tool_calls": assistant_msg["tool_calls"]})
                self.add_message("tool", tool_result_json, {"tool_call_id": tool_call_id})
                current_messages = list(self.messages)
                yield f"> 工具执行结果:\n```json\n{tool_result_json}\n```\n\n"
            elif last_user in ("取消", "cancel", "no", "n", "不"):
                self.pending_confirmation = None
                yield "\n\n> 已取消该操作。\n\n"
                return

        for _round in range(max_tool_rounds):
            # 调用 LLM，实时流式输出
            full_content = ""
            try:
                stream = self.provider.chat_stream(
                    messages=current_messages,
                    system_prompt=self.system_prompt,
                )

                async for chunk in stream:
                    full_content += chunk
                    yield chunk  # 实时流式输出给前端
                    # T6-5: 流式早停——检测到完整 tool call 立即终止生成并执行
                    # （不等 LLM 完整输出，显著降低工具执行前延迟 TTA）
                    if _has_complete_tool_call(full_content):
                        try:
                            await stream.aclose()
                        except Exception:
                            pass
                        break

            except Exception as e:
                logger.error(f"Agent stream error: {e}")
                yield f"\n\n> 错误: {_extract_error_message(e)}"
                return

            # 检测是否有 tool call
            tool_call = _parse_tool_call(full_content)
            if not tool_call:
                reason = _get_reasoning(self.provider)
                self.add_message("assistant", full_content,
                                 {"reasoning_content": reason} if reason else None)
                return

            cleaned_content = _strip_tool_call(full_content)

            tool_name = tool_call["name"]
            tool_args = tool_call["arguments"]

            # === Agent v2: 校验工具调用 ===
            available_tools = {t["function"]["name"] for t in tools}
            validation = validate_tool_call(tool_name, tool_args, available_tools, self.current_project)

            if validation.has_corrections:
                yield f"\n\n{validation.correction_message}\n\n"

            tool_name = validation.name
            tool_args = validation.args

            # === Agent v2: 权限分级检查 ===
            if validation.permission == ToolPermission.CONFIRM and self.autonomy_mode != "full_auto":
                # 4.3 F3-2: 记录待确认工具，等待用户下一条回复确认/取消
                self.pending_confirmation = {"name": tool_name, "args": tool_args}
                # 4.3 F3-2: 结构化确认标记，独立一行 `---CONFIRM:<tool>---`，
                # 前端据此渲染「确认/取消」按钮卡片（渲染时按行剥离，不进显示区）。
                # 保留原确认文本，旧版前端/无标记场景仍可手动输入"确认"/"取消"。
                yield f"\n---CONFIRM:{tool_name}---\n\n> ⚠️ 操作 `{tool_name}` 需要确认。请回复 '确认' 继续，或 '取消' 中止。\n\n"
                return

            tool_call_id = f"call_{uuid.uuid4().hex[:12]}"

            yield f"\n\n> 🔧 正在调用工具: `{tool_name}`...\n\n"

            # === Agent v2: 执行工具 + 错误恢复 ===
            retry_count = 0
            max_retries = 2
            result = None
            while retry_count <= max_retries:
                try:
                    result = await execute_tool(tool_name, tool_args)
                    break
                except Exception as e:
                    error_msg = _extract_error_message(e)
                    logger.error(f"Tool execution error: {e}")

                    if retry_count < max_retries:
                        recovery = analyze_error(tool_name, tool_args, error_msg, available_tools)
                        if recovery.action == "retry":
                            yield f"\n> {recovery.message}\n\n"
                            if recovery.modified_tool:
                                tool_name = recovery.modified_tool
                            if recovery.modified_args:
                                tool_args = recovery.modified_args
                            retry_count += 1
                            continue
                        else:
                            yield f"\n> {recovery.message}\n\n"
                            return
                    else:
                        yield f"\n> 工具执行失败（已重试 {max_retries} 次）: {error_msg}\n\n"
                        return

            if result is None:
                yield "\n> 工具执行失败，未获取到结果。\n\n"
                return

            if not result.get("success", False):
                error_msg = str(result.get("error", "未知错误"))
                recovery = analyze_error(tool_name, tool_args, error_msg, available_tools)
                yield f"\n> {recovery.message}\n\n"
                if recovery.action == "retry" and retry_count < max_retries:
                    retry_count += 1
                    continue
                return

            tool_result = result.get("result")

            # === Agent v2: 更新上下文和记忆 ===
            if self.current_project:
                ctx = get_project_context(self.session_id)
                ctx.record_operation(f"调用工具: {tool_name}")

            memory = get_memory_engine()
            memory.record_operation(self.current_project, f"调用 {tool_name}")

            # 将 tool 结果加入上下文（OpenAI 标准格式）
            tool_result_json = json.dumps(tool_result, ensure_ascii=False)
            reason = _get_reasoning(self.provider)
            assistant_msg = {
                "role": "assistant",
                "content": cleaned_content if cleaned_content else None,
                "tool_calls": [{
                    "id": tool_call_id,
                    "type": "function",
                    "function": {
                        "name": tool_name,
                        "arguments": json.dumps(tool_args, ensure_ascii=False),
                    }
                }]
            }
            if reason:
                assistant_msg["reasoning_content"] = reason
            current_messages.append(assistant_msg)
            current_messages.append({
                "role": "tool",
                "tool_call_id": tool_call_id,
                "content": tool_result_json,
            })

            yield f"> 工具执行结果:\n```json\n{tool_result_json}\n```\n\n"

        yield "\n\n> 已达到最大工具调用轮次，任务可能未完成。"

    async def run(self, max_tool_rounds: int = 5) -> str:
        """非流式运行 Agent"""
        result_parts = []
        async for chunk in self.run_stream(max_tool_rounds=max_tool_rounds):
            result_parts.append(chunk)
        return "".join(result_parts)


def _compress_history(messages: list[dict], max_chars: int = 24000, keep_recent: int = 10) -> list[dict]:
    """T6-7: 上下文超阈值时压缩历史（保留最近消息，早期历史折叠为摘要占位）

    确定性截断压缩（不引入额外 LLM 摘要调用，避免增加延迟）：
    估算消息总字符数，超过 max_chars 且消息数超过 keep_recent 时，
    将最早的消息折叠为一条带标记的占位消息，保留最近 keep_recent 条。
    """
    total = sum(len(str(m.get("content", "")) or "") for m in messages)
    if total <= max_chars or len(messages) <= keep_recent:
        return messages
    dropped = messages[:-keep_recent]
    kept = messages[-keep_recent:]
    dropped_chars = sum(len(str(m.get("content", "")) or "") for m in dropped)
    summary = {
        "role": "user",
        "content": (
            f"（历史对话已压缩：省略了此前 {len(dropped)} 轮约 {dropped_chars} 字符的内容，"
            "任务目标保持不变，请基于最近对话继续）"
        ),
    }
    return [summary] + kept


def _has_complete_tool_call(content: str) -> bool:
    """T6-5: 检测内容中是否已出现「完整闭合」的 tool call（用于流式早停）

    仅认可完整闭合，避免流中途误触发：
    - ```tool_call JSON 代码块（``` 闭合）
    - 独立 JSON 对象（name + arguments 且 } 闭合）
    - XML <invoke name="...">...</invoke>（</invoke> 闭合）
    与 _parse_tool_call 的解析规则保持一致（早停后必能解析出同一 tool call）。
    """
    if re.search(r"```tool_call\s*\n.*?\n```", content, re.DOTALL):
        return True
    if re.search(r'\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[^}]*\}\s*\}', content):
        return True
    if re.search(r'<invoke\s+name="[^"]+"[^>]*>.*?</invoke>', content, re.DOTALL):
        return True
    return False


def _parse_tool_call(content: str) -> Optional[dict]:
    """从 LLM 响应中解析 tool call，返回 {name, arguments} 或 None"""

    # 方式1: 匹配 ```tool_call ... ``` 代码块
    pattern = r"```tool_call\s*\n(.*?)\n```"
    match = re.search(pattern, content, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1))
        except json.JSONDecodeError:
            pass

    # 方式2: 匹配独立的 JSON 对象（包含 name 和 arguments，支持空参数 {}）
    pattern2 = r'\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[^}]*\}\s*\}'
    match2 = re.search(pattern2, content)
    if match2:
        try:
            return json.loads(match2.group(0))
        except json.JSONDecodeError:
            pass

    # 方式3: 匹配 XML 格式 — 优先从 <tool_calls> 中提取 <invoke>
    invoke_pattern = r"<invoke\s+name=\"([^\"]+)\">(.*?)</invoke>"
    tc_match = re.search(r"<tool_calls>(.*?)</tool_calls>", content, re.DOTALL)
    search_content = tc_match.group(1) if tc_match else content
    match3 = re.search(invoke_pattern, search_content, re.DOTALL)
    if match3:
        tool_name = match3.group(1)
        params_str = match3.group(2)
        args = {}
        for pm in re.finditer(r"<parameter\s+name=\"([^\"]+)\"[^>]*>(.*?)</parameter>", params_str):
            value = pm.group(2).strip()
            if value.lower() == 'true':
                value = True
            elif value.lower() == 'false':
                value = False
            args[pm.group(1)] = value
        return {"name": tool_name, "arguments": args}

    # 兜底: 处理不完整 XML（流截断时 invoke 标签未闭合，但仍能提取参数）
    m = re.search(r'<invoke\s+name="([^"]+)"[^>]*>', content)
    if m:
        tool_name = m.group(1)
        tail = content[m.start():]
        args = {}
        for pm in re.finditer(r'<parameter\s+name="([^"]+)"[^>]*>(.*?)(?:</parameter>|$)', tail, re.DOTALL):
            key = pm.group(1)
            value = pm.group(2).strip()
            if value.lower() == 'true':
                value = True
            elif value.lower() == 'false':
                value = False
            args[key] = value
        if args:
            return {"name": tool_name, "arguments": args}

    return None


def _strip_tool_call(content: str) -> str:
    """从内容中移除 tool call JSON/XML，返回清理后的文本"""
    # 移除 ```tool_call ... ``` 代码块
    cleaned = re.sub(r"```tool_call\s*\n.*?\n```\s*", "", content, flags=re.DOTALL)
    # 移除独立的 JSON 对象（包含 name 和 arguments）
    cleaned = re.sub(
        r'\n?\s*\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[^}]+\}\s*\}\s*\n?',
        "",
        cleaned,
    )
    # 移除 <tool_calls> XML 格式
    cleaned = re.sub(r"<tool_calls>.*?</tool_calls>\s*", "", cleaned, flags=re.DOTALL)
    return cleaned.strip()


def _extract_error_message(e: Exception) -> str:
    """从异常中提取用户友好的错误信息"""
    msg = str(e)

    # 尝试解析 OpenAI API 错误
    try:
        if "Error code:" in msg:
            parts = msg.split(" - ", 1)
            if len(parts) > 1:
                detail = parts[1]
                try:
                    data = json.loads(detail.replace("'", '"'))
                    if "error" in data and "message" in data["error"]:
                        return data["error"]["message"]
                except (json.JSONDecodeError, KeyError):
                    pass
                return detail[:200]
    except Exception:
        pass

    return msg[:300]


def _get_reasoning(provider) -> str:
    """获取 Provider 的 reasoning_content（DeepSeek thinking mode）"""
    reason = getattr(provider, 'last_reasoning_content', '')
    return reason.strip() if reason else ''


# 全局会话缓存
_sessions: dict[str, AgentSession] = {}


def get_or_create_session(session_id: str) -> AgentSession:
    """获取或创建 Agent 会话"""
    if session_id not in _sessions:
        session = AgentSession()
        session.set_provider()
        session.session_id = session_id
        _sessions[session_id] = session
    return _sessions[session_id]


def clear_session(session_id: str):
    """清除会话"""
    _sessions.pop(session_id, None)
    clear_project_context(session_id)
