"""AutoLink AI Hub 工具层（v3.1.1-T5-1 骨架 / T5-2 白名单，移植 MC ai_hub/agent/tools.py，autolink 化）

关键差异（架构决策②）：MC 工具用 subprocess 调自身后端；AutoLink 工具直接经
`cli.execute(action, params)` 同进程调用 —— UI / CLI / AI 三入口行为一致，且每次
调用自动写 cli-audit.jsonl（R5.7 AI 留轨迹）。
"""
import json
import logging
from typing import Any, Awaitable, Callable, Optional

from autolink_hub.agent.schemas import get_tool_permission

logger = logging.getLogger(__name__)

# ============================================================
# 工具注册表
# ============================================================

_tools: dict[str, dict] = {}


def register_tool(name: str, description: str, parameters: dict,
                  handler: Callable[[dict], Any], permission: Optional[str] = None) -> None:
    """注册工具：{name, description, parameters(JSON-Schema), handler, permission}"""
    _tools[name] = {
        "name": name,
        "description": description,
        "parameters": parameters,
        "handler": handler,
        "permission": permission or get_tool_permission(name).value,
    }


def get_tool_definitions() -> list[dict]:
    """输出 JSON-Schema 风格工具定义（注入 system prompt 供 LLM 参考）"""
    return [{"type": "function", "function": {
        "name": t["name"],
        "description": t["description"],
        "parameters": t["parameters"],
        "permission": t["permission"],
    }} for t in _tools.values()]


async def execute_tool(name: str, arguments: dict) -> dict:
    """执行工具：查表 → 调 handler → 统一包 {success, result/error}"""
    tool = _tools.get(name)
    if tool is None:
        return {"success": False, "error": f"未知工具: {name}"}
    try:
        result = tool["handler"](arguments)
        if hasattr(result, "__await__") or hasattr(result, "__aiter__"):
            result = await result
        return {"success": True, "result": result}
    except Exception as e:
        logger.error(f"Tool '{name}' execution error: {e}")
        return {"success": False, "error": str(e)}


# ============================================================
# AutoLink 白名单工具（直调 cli.execute —— UI/CLI/AI 同一执行路径 + 自动审计）
# ============================================================

def _make_cli_handler(action: str) -> Callable[[dict], Any]:
    """生成直调 cli.execute 的工具 handler（同一进程，自动写审计日志）"""
    def handler(arguments: dict) -> Any:
        from cli import execute as cli_execute
        params = {k: v for k, v in arguments.items() if v is not None}
        return cli_execute(action, params, argv=[f"ai:{action}"])
    return handler


def _str_param(name: str, description: str, required: bool = False) -> dict:
    return {"type": "string", "description": description}


def _schema(properties: dict, required: list[str]) -> dict:
    return {"type": "object", "properties": properties, "required": required}


def init_tools() -> None:
    """注册 AutoLink 白名单工具（T5-2 白名单：backend 现有 action 域）"""
    if _tools:
        return

    # ---- 设计域 ----
    register_tool(
        "generate_design", "一键网络设计（自动选型 + 拓扑生成），与 GUI 设计结果一致",
        _schema({"configFile": _str_param("configFile", "project_config.json 或 network_config.ini 路径")},
                required=["configFile"]),
        _make_cli_handler("design"),
    )
    register_tool(
        "validate_design", "校验设计配置，返回 {valid, errors, validationIssues}；validationIssues 每条含 rule_id/severity/message/recommendation（修复建议），可直接用于向用户解释问题并给出修复方案",
        _schema({"configFile": _str_param("configFile", "project_config.json 或 network_config.ini 路径")},
                required=["configFile"]),
        _make_cli_handler("validate"),
    )
    register_tool(
        "estimate", "规模估算（PUE/收敛比等参数）",
        _schema({"configFile": _str_param("configFile", "project_config.json 或 network_config.ini 路径")},
                required=["configFile"]),
        _make_cli_handler("estimate"),
    )
    register_tool(
        "report", "生成设计报告数据",
        _schema({"configFile": _str_param("configFile", "project_config.json 或 network_config.ini 路径")},
                required=["configFile"]),
        _make_cli_handler("report"),
    )

    # ---- 导出域 ----
    register_tool(
        "export_outputs", "导出交付物（connections/deviceList/cablingGuide/bom/reportData/pdfReport）",
        _schema({
            "configFile": _str_param("configFile", "project_config.json 或 network_config.ini 路径", True),
            "outputDir": _str_param("outputDir", "输出目录（默认 output）"),
            "outputTypes": _str_param("outputTypes", "逗号分隔的输出类型"),
        }, required=["configFile"]),
        _make_cli_handler("export"),
    )

    # ---- 机房域 ----
    register_tool(
        "room_create", "创建机房矩阵",
        _schema({
            "rows": _str_param("rows", "行命名，如 ['A','B','C']"),
            "cols": _str_param("cols", "列编号，如 [1,2,3]"),
            "name": _str_param("name", "机房名称（默认 机房）"),
        }, required=["rows", "cols"]),
        _make_cli_handler("room:create"),
    )
    register_tool(
        "room_validate", "校验机房布局（占位/类型/U位/功率）",
        _schema({"layout": _str_param("layout", "room_layout.json 路径")}, required=["layout"]),
        _make_cli_handler("room:validate"),
    )

    # ---- 配置域 ----
    register_tool(
        "list_config_schema", "列出统一配置 schema 与场景预设清单",
        _schema({}, []),
        _make_cli_handler("config:list-schema"),
    )
    register_tool(
        "apply_config_preset", "应用场景预设（ib-allflash/roce-general/l20-inference/uec-datacenter）",
        _schema({
            "presetId": _str_param("presetId", "预设 id", True),
            "config": _str_param("config", "当前设计配置 JSON 文件路径（缺省 = {}）"),
        }, required=["presetId"]),
        _make_cli_handler("config:apply-preset"),
    )
    register_tool(
        "config_export", "导出配置包裹（appSettings + projectConfig）",
        _schema({
            "appSettings": _str_param("appSettings", "应用设置 JSON 文件路径"),
            "projectConfig": _str_param("projectConfig", "项目配置 JSON 文件路径"),
        }, []),
        _make_cli_handler("config:export"),
    )
    register_tool(
        "config_import", "导入配置包裹（autolink-config 格式）",
        _schema({"payload": _str_param("payload", "导出的配置包裹 JSON 文件路径", True)}, required=["payload"]),
        _make_cli_handler("config:import"),
    )

    # ---- 项目配置域 ----
    register_tool(
        "project_config_migrate", "INI → JSON 项目配置迁移",
        _schema({"projectDir": _str_param("projectDir", "项目目录绝对路径")}, required=["projectDir"]),
        _make_cli_handler("migrate"),
    )
    register_tool(
        "project_config_to_ini", "JSON 项目配置反向序列化为 network_config.ini",
        _schema({"config": _str_param("config", "project_config.json 路径")}, required=["config"]),
        _make_cli_handler("project_config_to_ini"),
    )

    logger.info(f"AutoLink AI Hub: registered {len(_tools)} tools")
