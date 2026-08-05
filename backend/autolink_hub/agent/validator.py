"""AutoLink AI Hub 工具校验器（v3.1.1-T5-1.4，移植 MC ai_hub/agent/validator.py）

工具名模糊匹配 + 参数别名归一 + 权限检查
"""
import logging

from autolink_hub.agent.schemas import (
    ToolPermission, get_tool_permission, resolve_tool_name, normalize_params, PARAM_ALIASES,
)

logger = logging.getLogger(__name__)


class ToolValidationResult:
    def __init__(self, name: str, args: dict, permission: ToolPermission,
                 corrections: list[str] | None = None):
        self.name = name
        self.args = args
        self.permission = permission
        self.corrections = corrections or []

    @property
    def has_corrections(self) -> bool:
        return len(self.corrections) > 0

    @property
    def correction_message(self) -> str:
        if not self.corrections:
            return ""
        return "\n".join(f"> 🔧 {c}" for c in self.corrections)


def validate_tool_call(tool_name: str, arguments: dict,
                       available_tools: set[str] | None = None,
                       current_project: str | None = None) -> ToolValidationResult:
    corrections: list[str] = []

    resolved_name = tool_name
    if available_tools and tool_name not in available_tools:
        new_name, msg = resolve_tool_name(tool_name)
        if new_name != tool_name:
            resolved_name = new_name
            if msg:
                corrections.append(msg)

    normalized_args = normalize_params(arguments)
    for wrong, correct in PARAM_ALIASES.items():
        if wrong in arguments and correct in normalized_args and wrong in arguments:
            corrections.append(f"参数 {wrong} → {correct}")

    permission = get_tool_permission(resolved_name)
    return ToolValidationResult(name=resolved_name, args=normalized_args,
                                 permission=permission, corrections=corrections)
