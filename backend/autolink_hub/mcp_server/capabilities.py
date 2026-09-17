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
    "task": {
        "name": "任务",
        "description": "长耗时设计生成/导出任务提交与进度轮询（异步任务层）",
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

# ---------------------------------------------------------------------------
# 5.2.2-522-s2：编译态屏蔽规则（**语义规则化**，取代原枚举名单）
# ---------------------------------------------------------------------------
# 原实现用固定枚举名单（delete_project / delete_template / ...），一旦实际注册名
# 与名单不符（AL 实际注册的是 `project_delete` 与 `template_delete`）屏蔽即**静默
# 失效**，危险工具泄漏到编译态。现改为按命名语义匹配，并配套 `audit_block_rules()`
# 启动期对账（fail-fast）。
_DESTRUCTIVE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^delete_"),
    re.compile(r"_delete$"),
    re.compile(r"^delete$"),
    re.compile(r"^remove_"),
    re.compile(r"_remove$"),
    re.compile(r"^clear_"),
    re.compile(r"_clear$"),
    re.compile(r"^purge_"),
    re.compile(r"_purge$"),
    re.compile(r"^drop_"),
    re.compile(r"_drop$"),
)

_SOURCE_ONLY_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^run_cli$"),
    re.compile(r"^read_file$"),
    re.compile(r"^list_dir$"),
    re.compile(r"^read_source$"),
)

# 显式补充屏蔽名单：语义规则未覆盖、但产品上仍需隐藏的工具（扩展位）
COMPILED_BLOCKED_TOOLS: list[str] = []


def _matches_any(name: str, patterns: tuple[re.Pattern[str], ...]) -> bool:
    return any(p.search(name) for p in patterns)


def is_destructive_tool(tool_name: str) -> bool:
    """破坏性（删除/清空/移除）工具：按命名语义判定。

    注意 ``apply_config_preset`` 不命中（``preset`` 不是 ``reset``，规则为锚定匹配）。
    """
    return _matches_any(tool_name or "", _DESTRUCTIVE_PATTERNS)


def is_source_only_tool(tool_name: str) -> bool:
    """源码态专用工具（CLI 透传 / 源码直读）：编译态不暴露。"""
    name = tool_name or ""
    return name in SOURCE_ONLY_TOOLS or _matches_any(name, _SOURCE_ONLY_PATTERNS)


def is_blocked_in_compiled(tool_name: str) -> bool:
    """编译态强制隐藏：破坏性工具 + 源码态专用工具 + 显式补充名单。"""
    name = tool_name or ""
    if name in COMPILED_BLOCKED_TOOLS:
        return True
    return is_destructive_tool(name) or is_source_only_tool(name)


def audit_block_rules(registered_names: list[str], mode: str = "compiled") -> dict[str, Any]:
    """屏蔽规则启动期自我对账（fail-fast 前置检查）。

    返回 ``destructive`` / ``source_only`` / ``compiled_blocked`` / ``unmatched_rules``。
    """
    names = [n for n in (registered_names or []) if n]
    destructive = sorted(n for n in names if is_destructive_tool(n))
    source_only = sorted(n for n in names if is_source_only_tool(n))
    blocked = sorted(set(destructive) | set(source_only) | {n for n in names if n in COMPILED_BLOCKED_TOOLS})
    matched = {p.pattern for n in names for p in _DESTRUCTIVE_PATTERNS if p.search(n)}
    matched |= {p.pattern for n in names for p in _SOURCE_ONLY_PATTERNS if p.search(n)}
    all_patterns = {p.pattern for p in _DESTRUCTIVE_PATTERNS} | {p.pattern for p in _SOURCE_ONLY_PATTERNS}
    return {
        "mode": mode,
        "registered": len(names),
        "destructive": destructive,
        "source_only": source_only,
        "compiled_blocked": blocked,
        "unmatched_rules": sorted(all_patterns - matched),
    }


def assert_compiled_selection_safe(selected_names: list[str], registered_names: list[str]) -> list[str]:
    """编译态启动断言：选中集内不得含任何受屏蔽工具。返回泄漏工具名（空=通过）。"""
    audit = audit_block_rules(registered_names, "compiled")
    blocked = set(audit["compiled_blocked"])
    return sorted(n for n in (selected_names or []) if n in blocked)

# 长耗时工具（设计生成/导出/优化/打包）：MCP 层自动提交为异步任务并返回 task_id
LONG_RUNNING_TOOLS: list[str] = [
    "generate_design",
    "report",
    "export_outputs",
    "export_project",
    "project_export",
    "template_export",
    "room_optimize",
    "atop_recommend",
    "capacity_recommend",
    "project_import",
    "template_import",
    "repair_apply",
    "optimize_apply",
]

# 工具名 → 能力域映射（前缀/关键字推断 + 显式表兜底）
# 5.2.2-522-s2：补齐缺失前缀（原表未覆盖 project_delete / template_delete /
# project_list / audit_query / agent_feedback / template_recommend 等）
_TOOL_DOMAIN_HINTS: list[tuple[str, str]] = [
    # 5.2.2-522-s2：前缀规则覆盖不到的工具（精确名兜底；原实现全部落回 system，
    # 使能力域标签、编译态可见性判定与权限档位取值失真）
    ("create_from_template", "template"),
    ("preview_template", "template"),
    ("generate_project", "project"),
    ("list_config_schema", "design"),
    ("apply_config_preset", "design"),
    ("config_export", "design"),
    ("config_import", "design"),
    ("atop_recommend", "design"),
    ("capacity_recommend", "design"),
    ("add_knowledge", "knowledge"),
    ("list_knowledge", "knowledge"),
    ("search_knowledge", "knowledge"),
    ("list_projects", "project"),
    ("get_project", "project"),
    ("create_project", "project"),
    ("update_project", "project"),
    ("import_project", "project"),
    ("delete_project", "project"),
    ("project_", "project"),
    ("template_list", "template"),
    ("list_templates", "template"),
    ("get_template", "template"),
    ("create_template", "template"),
    ("save_template", "template"),
    ("update_template", "template"),
    ("delete_template", "template"),
    ("template_", "template"),
    ("import_template", "template"),
    ("export_template", "template"),
    ("device_query", "device"),
    ("device_", "device"),
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
    ("estimate", "validate"),
    ("parse_file", "validate"),
    ("room", "room"),
    ("rack", "room"),
    ("knowledge", "knowledge"),
    ("skill", "knowledge"),
    ("health", "system"),
    ("status", "system"),
    ("audit_query", "system"),
    ("agent_feedback", "system"),
    ("task_submit", "task"),
    ("task_query", "task"),
    ("task_list", "task"),
    ("task_wait", "task"),
    ("task_cancel", "task"),
    ("run_cli", "cli"),
    ("read_file", "filesystem"),
    ("list_dir", "filesystem"),
    ("read_source", "filesystem"),
]


def domain_for_tool(tool_name: str) -> str:
    """推断工具所属能力域（显式前缀命中优先，缺省 system）。"""
    name = tool_name or ""
    for prefix, domain in _TOOL_DOMAIN_HINTS:
        if name.startswith(prefix):
            return domain
    return "system"


# ---------------------------------------------------------------------------
# 权限映射
# ---------------------------------------------------------------------------
def mcp_permission_meta(permission: str) -> dict[str, Any]:
    """权限档位 → MCP 工具元数据（外部 Agent 可感知的审批要求）。"""
    p = (permission or "confirm").lower()
    if p == "auto":
        return {"require_approval": False, "approval_level": "auto", "description": "自动执行", "gate": "none"}
    if p == "notify":
        return {"require_approval": True, "approval_level": "notify", "description": "执行并通知", "gate": "notify"}
    return {"require_approval": True, "approval_level": "confirm", "description": "需用户确认", "gate": "confirm"}


# ---------------------------------------------------------------------------
# 5.2.2-522-s4：MCP ToolAnnotations（外部 Agent 可感知的只读/破坏性提示）
# ---------------------------------------------------------------------------
_READONLY_PREFIXES: tuple[str, ...] = (
    "list_", "get_", "query_", "search_", "read_", "check_", "validate_",
    "verify_", "audit_", "analyze_", "diff_", "preview_", "recommend_", "inspect_",
    "estimate", "parse_file",
)
_READONLY_EXACT: frozenset[str] = frozenset({
    "dry_run", "health", "status", "template_list",
    "task_list", "task_query", "task_wait",
})


def is_readonly_tool(tool_name: str) -> bool:
    """只读工具判定（无副作用，可安全重放）。"""
    name = tool_name or ""
    if is_destructive_tool(name):
        return False
    if name in _READONLY_EXACT:
        return True
    return any(name.startswith(p) for p in _READONLY_PREFIXES)


def tool_annotations(permission: str, tool_name: str = "") -> dict[str, Any]:
    """工具语义 → MCP ``ToolAnnotations``（dict 形式，由注册层转为 SDK 模型）。"""
    readonly = is_readonly_tool(tool_name) if tool_name else False
    destructive = is_destructive_tool(tool_name) if tool_name else False
    meta = mcp_permission_meta(permission)
    return {
        "readOnlyHint": bool(readonly),
        "destructiveHint": bool(destructive),
        "idempotentHint": bool(readonly),
        "openWorldHint": False,
        "title": meta["description"],
    }


# ---------------------------------------------------------------------------
# 工具过滤
# ---------------------------------------------------------------------------
def filter_tools_for_mode(
    agent_mode: str,
    tool_definitions: list[dict[str, Any]] | None = None,
    tool_permission_getter: Callable[[str], str] | None = None,
) -> list[dict[str, Any]]:
    """按运行模式过滤工具定义。

    5.2.2-522-s2：屏蔽改用**语义规则**（``is_blocked_in_compiled``）。
    5.2.2-522-s4：权限档位优先取**注册表真实 permission**（原实现回落到能力域默认值，
    导致 ``project_delete`` 等被误判为 system/auto）。
    """
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
        if mode == "compiled" and is_blocked_in_compiled(name):
            continue
        domain = domain_for_tool(name)
        if mode == "compiled" and not CAPABILITY_DOMAINS[domain]["compiled_visible"]:
            continue
        declared = fn.get("permission") or t.get("permission")
        if tool_permission_getter:
            perm = tool_permission_getter(name)
        elif declared:
            perm = declared
        else:
            perm = CAPABILITY_DOMAINS[domain]["default_permission"]
        out.append({"name": name, "description": fn.get("description", ""), "parameters": fn.get("parameters") or {}, "permission": perm})
    return out


def tool_name_to_mcp(name: str) -> str:
    """工具名 → MCP 工具名（合法标识符，替换非法字符）。"""
    return re.sub(r"[^A-Za-z0-9_-]", "_", name)


# 确认凭据字段名（confirm 档工具在 enforce 模式下必须显式携带）
CONFIRM_APPROVAL_FIELD = "approvalToken"


def normalize_mcp_schema(parameters: dict[str, Any], permission: str = "") -> dict[str, Any]:
    """工具参数 JSON Schema 归一为 MCP inputSchema（5.2.2-522-a1 起**保真透传**）。

    原实现只保留 type/properties/required，把参数 ``description`` / ``enum`` 等可读信息
    整体丢弃，外部 Agent 拿到的是"空壳 schema"。
    """
    if not isinstance(parameters, dict):
        parameters = {}
    props = parameters.get("properties")
    props = dict(props) if isinstance(props, dict) else {}
    required = parameters.get("required")
    required = list(required) if isinstance(required, list) else []
    if (permission or "").lower() == "confirm" and CONFIRM_APPROVAL_FIELD not in props:
        props[CONFIRM_APPROVAL_FIELD] = {
            "type": "string",
            "description": "确认凭据（仅在 Agent Connect 门禁为 enforce 模式时必填，由用户在界面确认后下发）",
        }
    schema: dict[str, Any] = {
        "type": parameters.get("type") or "object",
        "properties": props,
        "required": required,
    }
    if parameters.get("description"):
        schema["description"] = parameters["description"]
    return schema
