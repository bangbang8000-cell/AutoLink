"""AutoLink AI Hub 错误恢复策略（v3.1.1-T5-1.4，移植 MC ai_hub/agent/recovery.py，autolink 化）"""
import logging

logger = logging.getLogger(__name__)


class RecoveryAction:
    def __init__(self, action: str, message: str, modified_args: dict | None = None,
                 modified_tool: str | None = None):
        self.action = action      # "retry" | "ask_user" | "abort"
        self.message = message
        self.modified_args = modified_args
        self.modified_tool = modified_tool


def analyze_error(tool_name: str, arguments: dict, error: str,
                  available_tools: set[str]) -> RecoveryAction:
    error_lower = error.lower()

    if "未知 action" in error or "未知工具" in error or "unknown tool" in error_lower:
        from autolink_hub.agent.schemas import resolve_tool_name
        new_name, msg = resolve_tool_name(tool_name)
        if new_name != tool_name:
            return RecoveryAction(action="retry", message=msg or f"修正为 '{new_name}'",
                                  modified_tool=new_name)
        return RecoveryAction(action="ask_user",
            message=f"工具 '{tool_name}' 不存在。可用: {', '.join(sorted(available_tools)[:10])}...")

    if "配置文件" in error and "不存在" in error:
        return RecoveryAction(action="ask_user",
            message="配置文件不存在。请确认项目已创建或已生成 project_config.json。")

    if "预设" in error and "不存在" in error:
        return RecoveryAction(action="ask_user",
            message="场景预设不存在。可先查看 list_config_schema 获取可用预设清单。")

    if any(kw in error_lower for kw in ["timeout", "connection", "network"]):
        return RecoveryAction(action="retry", message="AI 服务暂时不可用，正在重试...")

    return RecoveryAction(action="ask_user", message=f"操作失败: {error[:300]}")
