"""AutoLink AI Hub 工具 Schema（v3.1.1-T5-1.4，移植 MC ai_hub/agent/schemas.py，autolink 化）

权限分级 + 工具名别名 + 参数别名（工具名与 T5-2 白名单一致）
"""
from enum import Enum


class ToolPermission(Enum):
    AUTO = "auto"       # 🟢 自动执行
    NOTIFY = "notify"   # 🟡 自动 + 通知
    CONFIRM = "confirm" # 🔴 需确认


# 权限分级表（AutoLink 白名单；未注册工具默认 CONFIRM）
TOOL_PERMISSIONS: dict[str, ToolPermission] = {
    # 只读查询（AUTO）
    "list_projects": ToolPermission.AUTO,
    "list_templates": ToolPermission.AUTO,
    "get_project_info": ToolPermission.AUTO,
    "list_project_files": ToolPermission.AUTO,
    "validate_design": ToolPermission.AUTO,
    "estimate": ToolPermission.AUTO,
    "report": ToolPermission.AUTO,
    "room_validate": ToolPermission.AUTO,
    "list_config_schema": ToolPermission.AUTO,
    # 写操作（NOTIFY）
    "generate_design": ToolPermission.NOTIFY,
    "create_project": ToolPermission.NOTIFY,
    "export_outputs": ToolPermission.NOTIFY,
    "room_create": ToolPermission.NOTIFY,
    "apply_config_preset": ToolPermission.NOTIFY,
    "config_export": ToolPermission.NOTIFY,
    "config_import": ToolPermission.NOTIFY,
    "project_config_migrate": ToolPermission.NOTIFY,
    "project_config_to_ini": ToolPermission.NOTIFY,
    # 高风险（CONFIRM）
    "delete_project": ToolPermission.CONFIRM,
}

TOOL_NAME_ALIASES: dict[str, str] = {
    "design": "generate_design",
    "generate": "generate_design",
    "gen_design": "generate_design",
    "validate": "validate_design",
    "validate_config": "validate_design",
    "check_design": "validate_design",
    "estimate": "estimate",
    "export": "export_outputs",
    "export_output": "export_outputs",
    "report": "report",
    "room_create_matrix": "room_create",
    "room_validate_layout": "room_validate",
    "list_config": "list_config_schema",
    "config_schema": "list_config_schema",
    "apply_preset": "apply_config_preset",
    "preset": "apply_config_preset",
    "import_config": "config_import",
    "export_config": "config_export",
    "list_projects": "list_projects",
    "list_templates": "list_templates",
}

PARAM_ALIASES: dict[str, str] = {
    "project": "projectName",
    "name": "projectName",
    "project_name": "projectName",
    "template": "templateName",
    "template_name": "templateName",
    "config": "configFile",
    "config_file": "configFile",
    "config_path": "configFile",
    "preset": "presetId",
    "preset_id": "presetId",
    "layout": "layout",
    "output_dir": "outputDir",
    "output_types": "outputTypes",
    "rows": "rows",
    "cols": "cols",
    "description": "description",
}


def get_tool_permission(tool_name: str) -> ToolPermission:
    return TOOL_PERMISSIONS.get(tool_name, ToolPermission.CONFIRM)


def resolve_tool_name(name: str) -> tuple[str, str | None]:
    name_lower = name.lower().strip()
    if name_lower in TOOL_NAME_ALIASES:
        resolved = TOOL_NAME_ALIASES[name_lower]
        return resolved, f"工具 '{name}' 已自动修正为 '{resolved}'"
    return name, None


def normalize_params(args: dict) -> dict:
    normalized = dict(args)
    for wrong, correct in PARAM_ALIASES.items():
        if wrong in normalized and correct not in normalized:
            normalized[correct] = normalized.pop(wrong)
    return normalized
