"""5.1.1-511-b/511-d：Agent Connect 能力域划分与权限映射（AutoLink）。

编译态（产品使用态）只暴露白名单能力域；源码态（开发态）追加 CLI 透传
与文件系统（读源码）。权限档位沿用 AUTO/NOTIFY/CONFIRM，映射为 MCP
工具元数据中的 approval 标注，供外部 Agent 客户端感知。
"""
import re
from typing import Any, Callable

# ---------------------------------------------------------------------------
# 能力域元数据
# ---------------------------------------------------------------------------
CAPABILITY_DOMAINS: dict[str, dict[str, Any]] = {
    "project": {
        "name": "项目",
        "description": "项目查询/创建/更新/删除（删除类在编译态不暴露）",
        "compiled_visible": True,
        "default_permission": "notify",
    },
    "template": {
        "name": "模板",
        "description": "模板查询/创建/更新/导入导出",
        "compiled_visible": True,
        "default_permission": "notify",
    },
    "device": {
        "name": "设备库",
        "description": "设备库查询/导入导出",
        "compiled_visible": True,
        "default_permission": "notify",
    },
    "design": {
        "name": "设计",
        "description": "网络拓扑设计/生成/优化",
        "compiled_visible": True,
        "default_permission": "notify",
    },
    "render": {
        "name": "渲染",
        "description": "配置渲染/预演/结果对比",
        "compiled_visible": True,
        "default_permission": "confirm",
    },
    "export": {
        "name": "输出",
        "description": "导出连接表/BOM/设备清单/机柜表/PDF 报告/评审包",
        "compiled_visible": True,
        "default_permission": "notify",
    },
    "validate": {
        "name": "校验",
        "description": "设计/机房/拓扑校验与核对",
        "compiled_visible": True,
        "default_permission": "auto",
    },
    "room": {
        "name": "机房",
        "description": "机房矩阵/机柜落位/优化",
        "compiled_visible": True,
        "default_permission": "notify",
    },
    "knowledge": {
        "name": "知识库",
        "description": "知识库查询/写入（源码态可写）",
        "compiled_visible": True,
        "default_permission": "auto",
    },
    "system": {
        "name": "系统",
        "description": "系统状态/健康检查（只读）",
        "compiled_visible": True,
        "default_permission": "auto",
    },
    "cli": {
        "name": "CLI",
        "description": "命令行透传（白名单子命令，仅源码态）",
        "compiled_visible": False,
        "default_permission": "notify",
    },
    "filesystem": {
        "name": "文件系统",
        "description": "读取源码/项目/模板/设备库文件（限沙箱目录，仅源码态）",
        "compiled_visible": False,
        "default_permission": "notify",
    },
}

# 源码态独有工具（编译态不暴露）
SOURCE_ONLY_TOOLS: list[str] = ["run_cli", "read_file", "list_dir", "read_source"]

# 编译态禁止暴露的工具（即使权限档位为 auto 也强制隐藏）
COMPILED_BLOCKED_TOOLS: list[str] = [
    "delete_project",
    "delete_template",
    "remove_device",
    "clear_device_library",
    "delete_skill",
    "run_cli",
    "read_file",
    "list_dir",
    "read_source",
]

# 工具名 → 能力域映射（前缀/关键字推断 + 显式表兜底）
_TOOL_DOMAIN_HINTS: list[tuple[str, str]] = [
    ("list_projects", "project"),
    ("get_project", "project"),
    ("create_project", "project"),
    ("update_project", "project"),
    ("import_project", "project"),
    ("delete_project", "project"),
    ("template_list", "template"),
    ("list_templates", "template"),
    ("get_template", "template"),
    ("create_template", "template"),
    ("save_template", "template"),
    ("update_template", "template"),
    ("delete_template", "template"),
    ("import_template", "template"),
    ("export_template", "template"),
    ("device_query", "device"),
    ("list_devices", "device"),
    ("get_device_library", "device"),
    ("import_device_library", "device"),
    ("export_device_library", "device"),
    ("generate_design", "design"),
    ("design", "design"),
    ("optimize", "design"),
    ("repair", "design"),
    ("render", "render"),
    ("dry_run", "render"),
    ("diff", "render"),
    ("export", "export"),
    ("report", "export"),
    ("bom", "export"),
    ("review", "export"),
    ("validate", "validate"),
    ("check", "validate"),
    ("analyze", "validate"),
    ("verify", "validate"),
    ("room", "room"),
    ("rack", "room"),
    ("knowledge", "knowledge"),
    ("skill", "knowledge"),
    ("health", "system"),
    ("status", "system"),
    ("run_cli", "cli"),
    ("read_file", "filesystem"),
    ("list_dir", "filesystem"),
    ("read_source", "filesystem"),
]


def domain_for_tool(tool_name: str) -> str:
    """推断工具所属能力域（显式前缀命中优先，缺省 system）。"""
    for prefix, domain in _TOOL_DOMAIN_HINTS:
        if tool_name.startswith(prefix):
            return domain
    return "system"


# ---------------------------------------------------------------------------
# 权限映射
# ---------------------------------------------------------------------------
def mcp_permission_meta(permission: str) -> dict[str, Any]:
    """权限档位 → MCP 工具元数据（外部 Agent 可感知的审批要求）。"""
    p = (permission or "confirm").lower()
    if p == "auto":
        return {"require_approval": False, "approval_level": "auto", "description": "自动执行"}
    if p == "notify":
        return {"require_approval": True, "approval_level": "notify", "description": "执行并通知"}
    return {"require_approval": True, "approval_level": "confirm", "description": "需用户确认"}


# ---------------------------------------------------------------------------
# 工具过滤
# ---------------------------------------------------------------------------
def filter_tools_for_mode(
    agent_mode: str,
    tool_definitions: list[dict[str, Any]] | None = None,
    tool_permission_getter: Callable[[str], str] | None = None,
) -> list[dict[str, Any]]:
    """按运行模式过滤工具定义。"""
    mode = agent_mode if agent_mode == "source" else "compiled"
    tools = tool_definitions or []
    out: list[dict[str, Any]] = []
    for t in tools:
        fn = t.get("function") or t
        name = fn.get("name") or t.get("name") or ""
        if not name:
            continue
        if name.startswith("mcp:"):
            continue  # 外部 MCP Client 工具不透传为 MCP Server 工具
        if mode == "compiled" and name in COMPILED_BLOCKED_TOOLS:
            continue
        domain = domain_for_tool(name)
        if mode == "compiled" and not CAPABILITY_DOMAINS[domain]["compiled_visible"]:
            continue
        if tool_permission_getter:
            perm = tool_permission_getter(name)
        else:
            perm = CAPABILITY_DOMAINS[domain]["default_permission"]
        out.append({"name": name, "description": fn.get("description", ""), "parameters": fn.get("parameters") or {}, "permission": perm})
    return out


def tool_name_to_mcp(name: str) -> str:
    """工具名 → MCP 工具名（合法标识符，替换非法字符）。"""
    return re.sub(r"[^A-Za-z0-9_-]", "_", name)


def normalize_mcp_schema(parameters: dict[str, Any]) -> dict[str, Any]:
    """工具参数 JSON Schema 归一为 MCP inputSchema（保证 type/properties/required 齐备）。"""
    if not isinstance(parameters, dict):
        return {"type": "object", "properties": {}, "required": []}
    return {
        "type": parameters.get("type") or "object",
        "properties": parameters.get("properties") or {},
        "required": parameters.get("required") or [],
    }
