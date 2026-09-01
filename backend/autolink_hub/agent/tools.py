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


# ============================================================
# 4.3 F3-4/F3-3: 自定义工具 handler（不走 cli.execute 的直连后端函数）
# ============================================================

def _deep_merge(base: dict, overlay: dict) -> dict:
    """递归深合并：overlay 中的 dict 键递归合并，其余直接覆盖"""
    result = dict(base)
    for k, v in overlay.items():
        if isinstance(v, dict) and isinstance(result.get(k), dict):
            result[k] = _deep_merge(result[k], v)
        else:
            result[k] = v
    return result


def _update_project_handler(arguments: dict) -> dict:
    """update_project：读当前 project_config.json → 深合并 overlay → 写回 → 宽松校验摘要。

    全部复用 manage 既有函数（project_read_file/project_write_file/project_info），
    无需新增 engine action。
    """
    from manage import project_info, project_read_file, project_write_file

    name = arguments.get("projectName") or ""
    overlay = arguments.get("config") or {}
    if not name:
        return {"success": False, "error": "项目名不能为空"}
    if not isinstance(overlay, dict) or not overlay:
        return {"success": False, "error": "config 必须是非空 ProjectConfig JSON 对象"}

    # 读当前配置
    read = project_read_file(name, "project_config.json")
    if not read.get("success"):
        return {"success": False, "error": read.get("error", f"项目不存在: {name}")}
    try:
        import json
        current = json.loads(read.get("content") or "{}")
        if not isinstance(current, dict):
            return {"success": False, "error": "项目 project_config.json 格式异常（非 JSON 对象）"}
    except Exception as e:
        return {"success": False, "error": f"项目配置解析失败: {e}"}

    merged = _deep_merge(current, overlay)
    # 保持项目名一致
    merged.setdefault("meta", {})["name"] = name

    import json as _json
    write = project_write_file(name, "project_config.json", _json.dumps(merged, ensure_ascii=False, indent=2))
    if not write.get("success"):
        return {"success": False, "error": write.get("error", "写入失败")}

    info = project_info(name)
    return {
        "success": True,
        "project": name,
        "updated": True,
        "config": merged,
        "validation": info.get("validation"),
    }


def _skill_list_handler(arguments: dict) -> dict:
    from autolink_hub.skills.engine import get_skills_engine
    skills = get_skills_engine().list_skills()
    return {"success": True, "skills": skills, "total": len(skills)}


def _skill_view_handler(arguments: dict) -> dict:
    from autolink_hub.skills.engine import get_skills_engine
    skill = get_skills_engine().get_skill(arguments.get("name") or "")
    if skill is None:
        return {"success": False, "error": f"技能不存在: {arguments.get('name') or ''}"}
    return {
        "success": True,
        "skill": {
            "name": skill.name,
            "enabled": skill.enabled,
            "use_count": skill.use_count,
            "last_used": skill.last_used,
            "content": skill.content,
        },
    }


def _skill_set_enabled_handler(arguments: dict) -> dict:
    from autolink_hub.skills.engine import get_skills_engine
    name = arguments.get("name") or ""
    enabled = arguments.get("enabled")
    if enabled in (True, "true", "True", "1", 1):
        enabled = True
    elif enabled in (False, "false", "False", "0", 0, None):
        enabled = False
    else:
        return {"success": False, "error": f"enabled 必须是布尔值，收到: {enabled!r}"}
    ok = get_skills_engine().set_enabled(name, enabled)
    if not ok:
        return {"success": False, "error": f"技能不存在: {name}"}
    return {"success": True, "skill": name, "enabled": enabled}


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
    # V3.1.4-T8-3: 机房智能落位工具族
    register_tool(
        "room_optimize", "机房智能落位：约束满足 + 多目标优化（功率均衡/散热分区/网络就近/布线最短），按 counts（类型→数量）或 cabinets（机柜列表）生成落位方案。返回 {success, placements[{position,type,cabinetId,powerWatts}], scores, issues, stats}；方案仅计算不落盘，需用户确认后由前端应用（NOTIFY）",
        _schema({
            "project": _str_param("project", "项目名（读取该项目机房矩阵）", True),
            "counts": _str_param("counts", "类型→数量 JSON 对象，如 {gpu:120, network:60, storage:45}"),
            "cabinets": _str_param("cabinets", "机柜列表 JSON [{id, type, power_watts}]（优先于 counts）"),
            "objectives": _str_param("objectives", "目标权重 {power_balance, thermal_zones, network_locality, shortest_cable}"),
            "constraints": _str_param("constraints", "上架约束 {powerLimitPerRack, typeDeviceMap}"),
            "time_budget_s": _str_param("time_budget_s", "时间预算秒（默认 5）"),
            "reset_existing": _str_param("reset_existing", "是否清空已落位重排（默认保留手动放置）"),
        }, required=["project"]),
        _make_cli_handler("room:optimize"),
    )
    register_tool(
        "room_set_type", "标记机房矩阵位置机柜类型（gpu/network/storage/compute/combined/empty），如把 D/E/F 列标为网络柜区；写操作，落盘到项目矩阵（NOTIFY）",
        _schema({
            "project": _str_param("project", "项目名", True),
            "position": _str_param("position", "位置，如 A1", True),
            "type": _str_param("type", "类型：gpu/network/storage/compute/combined/empty", True),
        }, required=["project", "position", "type"]),
        _make_cli_handler("room:set-type"),
    )
    register_tool(
        "room_place", "上架/移除机柜到机房矩阵位置（cabinet_id=0 表示移除）；复用 RoomConstraints 校验（占位/类型域/单柜功率）；写操作，落盘到项目矩阵（NOTIFY）",
        _schema({
            "project": _str_param("project", "项目名", True),
            "position": _str_param("position", "位置，如 A1", True),
            "cabinet_id": _str_param("cabinet_id", "机柜 id（0 表示移除）", True),
            "cabinet_type": _str_param("cabinet_type", "机柜类型（提供时做类型域校验）"),
            "power_watts": _str_param("power_watts", "机柜功率 W（提供时做上限校验）"),
            "constraints": _str_param("constraints", "上架约束 {powerLimitPerRack, typeDeviceMap}"),
        }, required=["project", "position", "cabinet_id"]),
        _make_cli_handler("room:place"),
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

    # ---- 管理域（只读查询，V3.1.3-T7-1）----
    register_tool(
        "device_query", "设备库查询：按分类（如 switches/gpu_servers，支持前缀）、厂商/型号关键词过滤，返回设备摘要",
        _schema({
            "category": _str_param("category", "设备分类 id/前缀/厂商/型号，如 switches、gpu_servers"),
            "query": _str_param("query", "关键词（匹配厂商/型号/描述）"),
            "limit": _str_param("limit", "返回条数上限（默认 50）"),
        }, []),
        _make_cli_handler("device:list"),
    )
    register_tool(
        "device_defaults", "共享设备选型规则（与向导一致）：按协议（IB/RoCE/UEC）+ GPU 世代（gb300/nvl72/b200/b300 → 800G，其余 400G）返回参数网/存储网/业务网/带外网默认交换机（refKey → 设备库 id）。回答\"默认用什么交换机/设备\"时优先调用本工具",
        _schema({
            "protocol": _str_param("protocol", "参数网协议：IB/RoCE/UEC（默认 IB）"),
            "gpu_library_id": _str_param("gpu_library_id", "GPU 设备库 id（可选，决定 IB 交换机世代）"),
        }, []),
        _make_cli_handler("device:defaults"),
    )
    register_tool(
        "template_list", "模板清单（内置 + 用户），含规模摘要（GPU 服务器数/存储数/协议/机架类型）",
        _schema({}, []),
        _make_cli_handler("template:list"),
    )
    register_tool(
        "template_view", "模板详情：按名称查看完整 ProjectConfig",
        _schema({"name": _str_param("name", "模板名称", True)}, required=["name"]),
        _make_cli_handler("template:view"),
    )
    register_tool(
        "project_list", "项目清单：扫描工作区，返回项目摘要（名称/描述/时间/是否含配置）",
        _schema({}, []),
        _make_cli_handler("project:list"),
    )
    register_tool(
        "project_info", "项目详情：完整 ProjectConfig + 宽松校验摘要",
        _schema({"name": _str_param("name", "项目名称", True)}, required=["name"]),
        _make_cli_handler("project:info"),
    )

    # ---- 需求生成（V3.1.3-T7-2/T7-5，轨道 B）----
    register_tool(
        "generate_project", "需求生成（轨道 B）：将 LLM 从用户需求抽取的 ProjectConfig 规范化（migrate_config + 默认值补全缺失键 + 宽松校验 + 置信度标注），返回可预览的完整 config（只生成预览、不落盘）。返回含 annotations{confidence, missingFields} 置信度/缺失字段标注，缺失字段为默认推导值需向用户说明",
        _schema({
            "name": _str_param("name", "项目名（可选，缺省取 config.meta.name）"),
            "config": _str_param("config", "LLM 从需求抽取的 ProjectConfig JSON 对象：topology(规模/协议/速率)、networks(开关)、rack_config(机柜约束)、meta.name"),
        }, required=["config"]),
        _make_cli_handler("project:generate"),
    )

    # ---- 示例文件解析（V3.1.3-T7-3）----
    register_tool(
        "parse_file", "解析用户上传的示例文件（Excel/JSON/CSV/文本）为结构化数据（表格行/JSON/文本摘录），供需求生成与模板参考；返回 result.parsed 结构",
        _schema({
            "path": _str_param("path", "文件绝对路径（来自用户附件）", True),
            "type": _str_param("type", "文件类型：excel/json/csv/text（缺省按扩展名识别）"),
        }, required=["path"]),
        _make_cli_handler("file:parse"),
    )

    # ---- 容量规划（V3.1.3-T7-4/T7-5）----
    register_tool(
        "capacity_recommend", "容量规划推荐：训练模型 + GPU 规模 → Scale-Up/Scale-Out 协议与速率/收敛比/层数/通信开销估算（回答\"某模型 N 卡怎么配网络\"）。V3.2.0 起返回 FP8 分块精度通信（exact，含与解析法误差对照）、Pipeline 分段显存（pipeline）与 TCO 成本估算（cost：硬件/电力/空间分项）。返回结果为预估值（estimated=true，误差 ±15-20%），需向用户说明",
        _schema({
            "model": _str_param("model", "模型档案 id（如 deepseek-v3/llama3-70b/qwen2.5-72b）或模型名", True),
            "num_gpus": _str_param("num_gpus", "目标 GPU 数量", True),
            "budget": _str_param("budget", "预算档位：economy/standard/premium（默认 standard）"),
            "precision": _str_param("precision", "训练精度覆盖：fp8/fp16/bf16"),
            "context_length": _str_param("context_length", "上下文长度覆盖（token）"),
            "tp": _str_param("tp", "张量并行度（默认 8）"),
            "dp": _str_param("dp", "数据并行度（默认 1）"),
            "pp": _str_param("pp", "流水线并行 stage 数（默认 1，>1 启用 Pipeline 建模）"),
            "cost_params": _str_param("cost_params", "成本单价覆盖 JSON（如 {\"gpu_watts\": 1000, \"electricity_per_kwh\": 0.6}）"),
        }, required=["model", "num_gpus"]),
        _make_cli_handler("capacity:recommend"),
    )

    # ---- ATOP 自动拓扑优化（V3.2.0-T9-2）----
    register_tool(
        "atop_recommend", "ATOP 式自动拓扑优化（模型通信特征 → ZCube 2D/3D cube 拓扑推荐）：输入模型（如 deepseek-v3，MoE→All-to-All 主导）与 GPU 规模，输出通信特征（communication_pattern/comm_ratio/traffic_breakdown）、cube 维度（2D/3D）、可渲染拓扑（topology.nodes/edges，含 zcube_group/plane_id 分组着色元数据）、拓扑校验结果（validation，V020 结构规则无 error）与推荐理由（rationale）。回答\"某模型 N 卡怎么组网/用什么拓扑\"时优先调用本工具；返回拓扑可直接用于前端渲染（AUTO 只读计算）",
        _schema({
            "num_gpus": _str_param("num_gpus", "目标 GPU 数量", True),
            "model": _str_param("model", "模型档案 id（如 deepseek-v3/llama3-70b/qwen2.5-72b）或模型名"),
            "model_type": _str_param("model_type", "模型类型：dense/moe/multimodal（覆盖）"),
            "num_experts": _str_param("num_experts", "MoE 专家数（>0 判定 alltoall 主导）"),
            "precision": _str_param("precision", "训练精度：fp8/fp16/bf16"),
            "tp": _str_param("tp", "张量并行度（默认 8）"),
            "dp": _str_param("dp", "数据并行度（默认 1）"),
            "pp": _str_param("pp", "流水线并行 stage 数（>1 引入 P2P 分量）"),
            "communication_pattern": _str_param("communication_pattern", "通信模式覆盖：allreduce/alltoall/p2p"),
            "comm_ratio": _str_param("comm_ratio", "通信占比覆盖（0~1）"),
            "traffic": _str_param("traffic", "流量占比覆盖 JSON（如 {\"alltoall\":0.7,\"allreduce\":0.3}）"),
            "switch_ports": _str_param("switch_ports", "Leaf 端口数（0=按规模自动档位）"),
        }, required=["num_gpus"]),
        _make_cli_handler("atop:recommend"),
    )

    # ---- 批量优化（V3.2.0-T9-3，轨道 B：建议批量产出 + 应用）----
    register_tool(
        "optimize_suggest", "批量优化建议：读取项目配置（configFile）→ 按规则批量产出收敛比/成本/散热建议（每条含 category/title/description/patch/impact，patch={section:{key:value}}）。回答\"怎么优化这个项目/有哪些改进点\"时优先调用；只读计算（AUTO）",
        _schema({
            "configFile": _str_param("configFile", "project_config.json 或 network_config.ini 路径", True),
        }, required=["configFile"]),
        _make_cli_handler("optimize:suggest"),
    )
    register_tool(
        "optimize_apply", "批量应用优化建议：把选中的建议（含 patch）合并写入 project_config.json（宽松校验 + 落盘）。调用前应先用 optimize_suggest 获取建议列表供用户选择；写操作（NOTIFY）",
        _schema({
            "configFile": _str_param("configFile", "项目配置路径", True),
            "suggestions": _str_param("suggestions", "选中的建议 JSON 数组（[{category,title,patch}]）", True),
        }, required=["configFile", "suggestions"]),
        _make_cli_handler("optimize:apply"),
    )

    # ---- 智能修复（V3.2.0-T9-4：校验错误 → 修复 → 复核闭环）----
    register_tool(
        "repair_plan", "智能修复方案：读取项目配置（configFile）→ 运行完整校验 → 为可自动修复的 error 级问题生成修复 patch（{section:{key:value}}，rule_id 级：V002 机柜功率/V007 Rail/V010 收敛比/V016 网卡容量/V018 Scale-Up 域/V019 供电/V020 ZCube）。回答\"这个配置有什么错误/怎么修复\"时优先调用；只读计算（AUTO）",
        _schema({
            "configFile": _str_param("configFile", "project_config.json 或 network_config.ini 路径", True),
        }, required=["configFile"]),
        _make_cli_handler("repair:plan"),
    )
    register_tool(
        "repair_apply", "一键应用智能修复：把选中的修复项（含 patch）合并写入 project_config.json → 宽松校验 → 写回 → 复核（重新校验返回剩余错误）。调用前应先用 repair_plan 获取修复方案供用户选择；写操作（NOTIFY）",
        _schema({
            "configFile": _str_param("configFile", "项目配置路径", True),
            "fixes": _str_param("fixes", "选中的修复项 JSON 数组（[{rule_id,patch}]）", True),
        }, required=["configFile", "fixes"]),
        _make_cli_handler("repair:apply"),
    )

    # ---- 项目/模板操作（M6：AI 对话内实现项目/模板 CRUD + 基于模板创建 + 文件读写 + 模板推荐）----
    register_tool(
        "template_create", "保存用户模板：把 ProjectConfig JSON 保存为可复用模板（template.json + project_config.json）。写操作（NOTIFY）",
        _schema({
            "templateName": _str_param("templateName", "新模板名", True),
            "config": _str_param("config", "模板 ProjectConfig JSON 对象（从 project_info 或 generate_project 结果取）", True),
            "description": _str_param("description", "模板描述"),
            "scenario": _str_param("scenario", "适用场景"),
            "overwrite": _str_param("overwrite", "同名覆盖（默认 false）"),
        }, required=["templateName", "config"]),
        _make_cli_handler("template:create"),
    )
    register_tool(
        "template_update", "更新用户模板的 ProjectConfig（内置模板只读不可改）。写操作（NOTIFY）",
        _schema({
            "templateName": _str_param("templateName", "用户模板名", True),
            "config": _str_param("config", "新 ProjectConfig JSON 对象", True),
        }, required=["templateName", "config"]),
        _make_cli_handler("template:update"),
    )
    register_tool(
        "template_delete", "删除用户模板（内置模板只读不可删，需向用户说明）。写操作（NOTIFY）",
        _schema({
            "templateName": _str_param("templateName", "用户模板名", True),
        }, required=["templateName"]),
        _make_cli_handler("template:delete"),
    )
    register_tool(
        "template_recommend", "模板推荐：按参数网协议（IB/RoCE/UEC）/GPU 型号/规模（GPU 服务器数）对模板清单打分排序。回答\"用什么模板/从哪个模板开始\"时优先调用（只读 AUTO）",
        _schema({
            "protocol": _str_param("protocol", "参数网协议：IB/RoCE/UEC"),
            "gpuModel": _str_param("gpuModel", "GPU 型号关键词（如 H100/B300）"),
            "scale": _str_param("scale", "规模（GPU 服务器数量）"),
        }, required=[]),
        _make_cli_handler("template:recommend"),
    )
    register_tool(
        "project_create", "基于模板（或默认配置）创建工作区项目，并自动转 AIDC 项目（mint projectId + plan.json）。回答\"帮我建一个 XX 项目\"时优先调用。写操作（NOTIFY）",
        _schema({
            "projectName": _str_param("projectName", "新项目名", True),
            "description": _str_param("description", "项目描述"),
            "templateName": _str_param("templateName", "基于的模板名（可先用 template_recommend 选择）"),
        }, required=["projectName"]),
        _make_cli_handler("project:create"),
    )
    register_tool(
        "project_delete", "删除工作区项目（不可恢复，需用户明确确认后调用）。写操作（NOTIFY）",
        _schema({
            "projectName": _str_param("projectName", "项目名", True),
        }, required=["projectName"]),
        _make_cli_handler("project:delete"),
    )
    register_tool(
        "project_list_files", "列出项目目录下所有文件（路径 + 大小）。回答\"项目里有哪些文件/结构\"时调用（只读 AUTO）",
        _schema({
            "projectName": _str_param("projectName", "项目名", True),
        }, required=["projectName"]),
        _make_cli_handler("project:list-files"),
    )
    register_tool(
        "project_read_file", "读取项目内文本文件内容（如 project_config.json/plan.json/README 等，防目录穿越）。回答\"XX 文件内容/当前配置\"时调用（只读 AUTO）",
        _schema({
            "projectName": _str_param("projectName", "项目名", True),
            "filePath": _str_param("filePath", "项目内相对路径", True),
        }, required=["projectName", "filePath"]),
        _make_cli_handler("project:read-file"),
    )
    register_tool(
        "project_write_file", "写入项目内文本文件（覆盖已存在文件，防目录穿越）。用于修改项目配置/补充设计文档。写操作（NOTIFY）",
        _schema({
            "projectName": _str_param("projectName", "项目名", True),
            "filePath": _str_param("filePath", "项目内相对路径", True),
            "content": _str_param("content", "文件内容", True),
        }, required=["projectName", "filePath", "content"]),
        _make_cli_handler("project:write-file"),
    )

    # ---- 模板/项目导入导出（AI-4，M6c 补齐：AI 对话内导入导出）----
    register_tool(
        "template_export", "导出模板：把指定模板目录打包为 zip 到指定输出路径（outputPath），或返回模板文件清单+内容（缺省）。回答\"导出/备份这个模板\"时调用。写操作（NOTIFY）",
        _schema({
            "name": _str_param("name", "模板名（内置或用户模板）", True),
            "outputPath": _str_param("outputPath", "zip 输出路径（缺省返回文件清单+内容）"),
        }, required=["name"]),
        _make_cli_handler("template:export"),
        permission="notify",
    )
    register_tool(
        "template_import", "导入模板：从 zip 或目录把模板导入到用户模板中心，校验 template.json 结构；重名默认拒绝（overwrite=true 覆盖）。回答\"导入这个模板包\"时调用（source 为 zip/目录路径）。写操作（NOTIFY）",
        _schema({
            "source": _str_param("source", "模板 zip 或目录路径（来自用户附件或本地路径）", True),
            "name": _str_param("name", "导入后的模板名（缺省取 template.json 的 name/id）"),
            "overwrite": _str_param("overwrite", "同名覆盖（默认 false）"),
        }, required=["source"]),
        _make_cli_handler("template:import"),
        permission="notify",
    )
    register_tool(
        "project_export", "导出项目：把当前项目打包为交付包 zip（含 plan.json/project_config.json 等）到指定输出路径（outputPath），或返回项目文件清单+内容（缺省）。回答\"导出/备份这个项目\"时调用。写操作（NOTIFY）",
        _schema({
            "name": _str_param("name", "项目名", True),
            "outputPath": _str_param("outputPath", "zip 输出路径（缺省返回文件清单+内容）"),
        }, required=["name"]),
        _make_cli_handler("project:export"),
        permission="notify",
    )
    register_tool(
        "project_import", "导入项目：从 zip 把项目导入到工作区，校验 project.json；重名默认拒绝（overwrite=true 覆盖）。回答\"导入这个项目包\"时调用（source 为 zip 路径，来自用户附件）。写操作（NOTIFY）",
        _schema({
            "source": _str_param("source", "项目 zip 路径（来自用户附件或本地路径）", True),
            "projectName": _str_param("projectName", "导入后的项目名（缺省取 project.json 的 name）"),
            "overwrite": _str_param("overwrite", "同名覆盖（默认 false）"),
        }, required=["source"]),
        _make_cli_handler("project:import"),
        permission="notify",
    )

    # ---- 4.3 F3-4：项目/模板操作工具（双端统一命名：list/create/update/delete/导入导出/基于模板创建/预览）----
    register_tool(
        "list_projects", "项目清单：扫描工作区，返回项目摘要（名称/描述/时间/是否含配置）。回答\"有哪些项目\"时调用（只读 AUTO）",
        _schema({}, []),
        _make_cli_handler("project:list"),
        permission="auto",
    )
    register_tool(
        "create_project", "新建项目：用默认配置创建工作区项目并转 AIDC（mint projectId + plan.json）。回答\"帮我建一个 XX 项目\"（未指定模板）时调用。写操作（NOTIFY）",
        _schema({
            "projectName": _str_param("projectName", "新项目名", True),
            "description": _str_param("description", "项目描述"),
        }, required=["projectName"]),
        _make_cli_handler("project:create"),
        permission="notify",
    )
    register_tool(
        "update_project", "更新项目配置：把 overlay 配置（ProjectConfig JSON 对象）深度合并写入项目的 project_config.json 并重新校验（宽松校验摘要）。回答\"帮我改一下 XX 项目的参数\"时调用（先 project_info 读当前配置再合并）。写操作（NOTIFY）",
        _schema({
            "projectName": _str_param("projectName", "项目名", True),
            "config": _str_param("config", "要合并的 ProjectConfig JSON 对象（如 {topology:{num_gpu_servers:128}}）", True),
        }, required=["projectName", "config"]),
        _update_project_handler,
        permission="notify",
    )
    register_tool(
        "delete_project", "删除工作区项目（不可恢复，需用户明确确认后调用）。写操作（CONFIRM）",
        _schema({
            "projectName": _str_param("projectName", "项目名", True),
        }, required=["projectName"]),
        _make_cli_handler("project:delete"),
        permission="confirm",
    )
    register_tool(
        "import_project", "导入项目：从 zip 把项目导入到工作区，校验 project.json；重名默认拒绝（overwrite=true 覆盖）。写操作（NOTIFY）",
        _schema({
            "source": _str_param("source", "项目 zip 路径（来自用户附件或本地路径）", True),
            "projectName": _str_param("projectName", "导入后的项目名（缺省取 project.json 的 name）"),
            "overwrite": _str_param("overwrite", "同名覆盖（默认 false）"),
        }, required=["source"]),
        _make_cli_handler("project:import"),
        permission="notify",
    )
    register_tool(
        "export_project", "导出项目：把指定项目打包为交付包 zip（含 plan.json/project_config.json 等）到指定输出路径（outputPath），或返回项目文件清单+内容（缺省）。写操作（NOTIFY）",
        _schema({
            "projectName": _str_param("projectName", "项目名", True),
            "outputPath": _str_param("outputPath", "zip 输出路径（缺省返回文件清单+内容）"),
        }, required=["projectName"]),
        _make_cli_handler("project:export"),
        permission="notify",
    )
    register_tool(
        "create_from_template", "基于模板创建工作区项目：先用 template_recommend 或 template_list 选模板，再调用本工具（templateName 必填）。写操作（NOTIFY）",
        _schema({
            "projectName": _str_param("projectName", "新项目名", True),
            "templateName": _str_param("templateName", "基于的模板名", True),
            "description": _str_param("description", "项目描述"),
        }, required=["projectName", "templateName"]),
        _make_cli_handler("project:create"),
        permission="notify",
    )
    register_tool(
        "preview_template", "模板预览/详情：按名称查看完整 ProjectConfig（规模/协议/机柜约束）。回答\"这个模板怎么样/配置是什么\"时调用（只读 AUTO）",
        _schema({
            "name": _str_param("name", "模板名称", True),
        }, required=["name"]),
        _make_cli_handler("template:view"),
        permission="auto",
    )

    # ---- 4.3 F3-3：技能库工具（list/详情/启用禁用，AI 可调用）----
    register_tool(
        "skill_list", "技能清单：列出全部技能（名称/是否启用/使用次数/最近使用）。回答\"有哪些技能\"时调用（只读 AUTO）",
        _schema({}, []),
        _skill_list_handler,
        permission="auto",
    )
    register_tool(
        "skill_view", "技能详情：查看单个技能内容（markdown）。回答\"XX 技能讲什么\"时调用（只读 AUTO）",
        _schema({
            "name": _str_param("name", "技能名", True),
        }, required=["name"]),
        _skill_view_handler,
        permission="auto",
    )
    register_tool(
        "skill_set_enabled", "启用/禁用技能：enabled=true 启用、false 禁用（影响其是否注入 system prompt）。写操作（NOTIFY）",
        _schema({
            "name": _str_param("name", "技能名", True),
            "enabled": _str_param("enabled", "是否启用（true/false）", True),
        }, required=["name", "enabled"]),
        _skill_set_enabled_handler,
        permission="notify",
    )

    logger.info(f"AutoLink AI Hub: registered {len(_tools)} tools")
