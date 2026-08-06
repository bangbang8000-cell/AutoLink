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
    # 管理域只读查询（V3.1.3-T7-1，AUTO）
    "device_query": ToolPermission.AUTO,
    # 共享选型规则（V3.1.3-T7-6，AUTO：只读映射查询）
    "device_defaults": ToolPermission.AUTO,
    "template_list": ToolPermission.AUTO,
    "template_view": ToolPermission.AUTO,
    "project_list": ToolPermission.AUTO,
    "project_info": ToolPermission.AUTO,
    # 需求生成（V3.1.3-T7-2，NOTIFY：生成预览 + 前端确认后落盘）
    "generate_project": ToolPermission.NOTIFY,
    # 示例文件解析（V3.1.3-T7-3，AUTO：只读解析）
    "parse_file": ToolPermission.AUTO,
    # 容量规划推荐（V3.1.3-T7-4，AUTO：纯计算只读）
    "capacity_recommend": ToolPermission.AUTO,
    # ATOP 自动拓扑优化（V3.2.0-T9-2，AUTO：只读计算，返回可渲染拓扑）
    "atop_recommend": ToolPermission.AUTO,
    # 批量优化（V3.2.0-T9-3，AUTO：建议只读计算 / NOTIFY：应用写操作）
    "optimize_suggest": ToolPermission.AUTO,
    "optimize_apply": ToolPermission.NOTIFY,
    # 智能修复（V3.2.0-T9-4，AUTO：修复方案只读计算 / NOTIFY：应用修复并复核）
    "repair_plan": ToolPermission.AUTO,
    "repair_apply": ToolPermission.NOTIFY,
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
    # 机房智能落位（V3.1.4-T8-3，NOTIFY：返回方案需前端确认应用 / 写操作）
    "room_optimize": ToolPermission.NOTIFY,
    "room_set_type": ToolPermission.NOTIFY,
    "room_place": ToolPermission.NOTIFY,
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
    # 机房智能落位（V3.1.4-T8-3）
    "optimize_room": "room_optimize",
    "room_opt": "room_optimize",
    "room_layout_optimize": "room_optimize",
    "set_room_type": "room_set_type",
    "mark_room_type": "room_set_type",
    "room_mark_type": "room_set_type",
    "place_cabinet": "room_place",
    "room_place_cabinet": "room_place",
    "mount_cabinet": "room_place",
    "list_config": "list_config_schema",
    "config_schema": "list_config_schema",
    "apply_preset": "apply_config_preset",
    "preset": "apply_config_preset",
    "import_config": "config_import",
    "export_config": "config_export",
    "list_projects": "list_projects",
    "list_templates": "list_templates",
    # ATOP 自动拓扑优化（V3.2.0-T9-2）
    "atop": "atop_recommend",
    "atop_recommend": "atop_recommend",
    "recommend_topology": "atop_recommend",
    "topology_recommend": "atop_recommend",
    # 批量优化（V3.2.0-T9-3）
    "batch_optimize": "optimize_suggest",
    "suggest_optimizations": "optimize_suggest",
    "optimize_suggestions": "optimize_suggest",
    "apply_optimizations": "optimize_apply",
    "apply_suggestions": "optimize_apply",
    # 智能修复（V3.2.0-T9-4）
    "repair": "repair_plan",
    "auto_fix": "repair_plan",
    "repair_plan": "repair_plan",
    "fix_design": "repair_plan",
    "apply_repairs": "repair_apply",
    "apply_fix": "repair_apply",
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
