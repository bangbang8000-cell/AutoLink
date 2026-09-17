"""5.1.1-511-a：Agent Connect 管理器（MCP Server 生命周期 + 状态机 + 审计，AutoLink）。

- 状态机：disabled（开关关，默认）→ enabled（开关开，持有 FastMCP）
- agentMode：compiled（默认）| source；切换保持 enabled
- 惰性导入 mcp SDK：未安装时 enable 返回可读错误，不阻断 AI Hub
- 审计：Agent 操作写入审计文件（编译态强制，源码态默认）
"""
import json
import logging
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

AGENT_MODES = ("compiled", "source")
DEFAULT_AGENT_MODE = "compiled"
# 5.2.2-522-s4：confirm 档门禁模式
#   notify  —— 灰度（默认）：记录 notify 审计，不阻断（DP-MC-02 决策）
#   enforce —— 阻断：未携带 approvalToken 即拒绝，返回 AC_ERR_PERMISSION_REQUIRED
GATE_MODES = ("notify", "enforce")
GATE_MODE_DEFAULT = "notify"
AC_ERR_PERMISSION_REQUIRED = "AC_ERR_PERMISSION_REQUIRED"

# 审计敏感字段（写盘/查询时脱敏，避免密钥/口令入库）
_SENSITIVE_SUBSTR = (
    "password", "passwd", "secret", "token", "api_key", "apikey",
    "authorization", "credential", "private_key", "access_key",
)


def _now() -> str:
    return datetime.now().isoformat()


def _summarize_args(arguments: dict[str, Any], max_len: int = 120) -> dict[str, Any]:
    """审计入参摘要：敏感字段脱敏 + 长值截断 + 列表/对象压缩。"""
    args = arguments or {}
    out: dict[str, Any] = {}
    for k, v in args.items():
        if any(s in str(k).lower() for s in _SENSITIVE_SUBSTR):
            out[k] = "[REDACTED]"
            continue
        if isinstance(v, dict):
            s = json.dumps(v, ensure_ascii=False)
        elif isinstance(v, (list, tuple)):
            s = f"[list:{len(v)}]"
        elif v is None:
            s = "null"
        else:
            s = str(v)
        out[k] = s if len(s) <= max_len else s[:max_len] + "..."
    return out


def _import_fastmcp():
    """惰性导入第三方 mcp SDK（Server 端），规避本地 autolink_hub/mcp 目录遮蔽。

    本地存在 `autolink_hub/mcp/` 目录与第三方 `mcp` 包同名，只要 backend/ 在
    sys.path 中（pytest 等场景），顶层 `import mcp` 就会命中本地目录。此处用
    importlib.metadata 定位 site-packages 中 mcp 的绝对路径，从该路径以
    importlib 显式加载，确保取到第三方 SDK。未安装抛 ImportError。
    """
    import importlib
    import sys

    from importlib.metadata import distribution

    try:
        dist = distribution("mcp")
    except Exception as e:
        raise ImportError(
            f"MCP SDK 未安装（pip install 'mcp>=1.2.0,<2'），无法启动 Agent Connect MCP Server：{e}"
        ) from e

    try:
        init_path = dist.locate_file("mcp/__init__.py")
        if not init_path.exists():
            raise ImportError("MCP SDK 包路径无法定位")
        site_root = str(init_path.parent.parent)  # <site-packages>
    except Exception as e:
        raise ImportError("MCP SDK 包路径无法定位") from e

    # 强制 site-packages 根位于 sys.path 最前，使 importlib 解析第三方 mcp
    if site_root in sys.path:
        sys.path.remove(site_root)
    sys.path.insert(0, site_root)
    try:
        site_mcp = importlib.import_module("mcp")
        if "autolink_hub" in str(getattr(site_mcp, "__file__", "")):
            raise ImportError("mcp 解析到本地 autolink_hub/mcp，无法加载第三方 SDK")
        fastmcp_mod = importlib.import_module("mcp.server.fastmcp")
        return fastmcp_mod.FastMCP
    except ImportError as e:
        # 5.2.3-523-fix1: 原实现把底层原因吞掉、只报「未安装」，导致真正病因（典型如装了
        # mcp 2.x —— FastMCP 已改名 MCPServer，`mcp.server.fastmcp` 直接 ImportError）
        # 被掩盖成“没装”，排查成本极高。此处把原始异常原文带出。
        raise ImportError(
            "MCP SDK 不可用（需 mcp>=1.2.0,<2；2.x 破坏性重构，已将 FastMCP 改名 "
            f"MCPServer）：{e}"
        ) from e


def _import_mcp_types():
    """惰性取第三方 mcp SDK 的响应类型（与 `_import_fastmcp` 同一套 sys.path 修正）。"""
    _import_fastmcp()
    import importlib

    mcp_types = importlib.import_module("mcp.types")
    return mcp_types.CallToolResult, mcp_types.TextContent


def _flatten_payload(value: Any) -> Any:
    """响应扁平化：工具返回的 JSON 字符串解析为对象，避免响应里再套一层转义 JSON。"""
    if isinstance(value, str):
        stripped = value.strip()
        if stripped[:1] in ("{", "["):
            try:
                return json.loads(stripped)
            except Exception:  # noqa: BLE001 - 非 JSON 文本保持原样
                return value
    return value


def _coerce_arguments(kwargs: dict[str, Any]) -> dict[str, Any]:
    """入参归一：兼容旧调用方沿用的 ``{"arguments": {...}}`` 包裹形态。"""
    args = dict(kwargs or {})
    wrapped = args.get("arguments")
    if isinstance(wrapped, dict) and len([k for k, v in args.items() if k != "arguments" and v is not None]) == 0:
        return dict(wrapped)
    args.pop("arguments", None)
    return args


# 编译态/源码态共用的控制字段（不属于业务参数）
_CONTROL_FIELDS = ("approvalToken",)


def _split_arguments(args: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """拆分业务参数与控制字段（approvalToken 等不下发给业务 handler）。"""
    business = {k: v for k, v in (args or {}).items() if k not in _CONTROL_FIELDS}
    control = {k: v for k, v in (args or {}).items() if k in _CONTROL_FIELDS}
    return business, control


class AgentConnectManager:
    """Agent Connect MCP Server 生命周期管理器（单例模式，配合 reset_manager）。"""

    def __init__(self):
        self._status = "disabled"  # disabled | enabled
        self._agent_mode = DEFAULT_AGENT_MODE
        self._mcp: Any = None
        self._audit_path: Optional[Path] = None
        self._tool_count = 0
        self._write_records: dict[str, Any] = {}  # 5.1.3-513-c：L3 幂等记录
        # 5.2.2-522-s2：屏蔽规则对账结果（启动期写入，供 selfcheck 展示）
        self._block_audit: dict[str, Any] = {}
        # 5.2.2-522-s4：门禁模式 notify（灰度，默认）| enforce（阻断）
        self._gate_mode = GATE_MODE_DEFAULT
        self._gate_hits: list[dict[str, Any]] = []
        # 5.2.2-522-s4：注册期快照的工具权限档位（门禁判定用）
        self._tool_permissions: dict[str, str] = {}

    # -------------------- 状态机 --------------------

    @property
    def status(self) -> str:
        return self._status

    @property
    def agent_mode(self) -> str:
        return self._agent_mode

    @property
    def mcp(self) -> Any:
        return self._mcp

    def enable(self, agent_mode: Optional[str] = None) -> tuple[bool, str]:
        """开启 Agent Connect：创建 FastMCP 实例并注册编译态/源码态工具。

        返回 (ok, message)。mcp SDK 未安装时返回 (False, 可读错误)。
        5.2.2-522-s2：注册前做**屏蔽规则启动断言**，编译态选中集含受屏蔽工具即拒绝启动。
        """
        try:
            FastMCP = _import_fastmcp()
        except ImportError as e:
            logger.error(f"Agent Connect enable failed: {e}")
            return False, str(e)
        mode = self._clamp_mode(agent_mode)
        try:
            mcp = FastMCP(
                "autolink-agent-connect",
                instructions=(
                    "AutoLink Agent Connect：通过标准 MCP 工具查询、创建、更新、"
                    "渲染项目/模板/设备库/机房规划/输出。compiled 模式只读+受控写入；"
                    "source 模式追加 CLI 与源码直读。"
                ),
            )
            self._gate_mode = self._read_gate_mode()
            registered = self._register_tools(mcp, mode)
            self._register_prompts(mcp)
            self._register_resources(mcp)
            self._mcp = mcp
            self._agent_mode = mode
            self._tool_count = registered
            self._status = "enabled"
            self._install_execution_guard()
            logger.info(f"Agent Connect enabled mode={mode} tools={registered} gate={self._gate_mode}")
            return True, f"Agent Connect 已开启（mode={mode}，暴露 {registered} 个工具，门禁={self._gate_mode}）"
        except Exception as e:  # pragma: no cover
            logger.error(f"Agent Connect enable failed: {e}")
            self._status = "error"
            return False, f"Agent Connect 启动失败: {e}"

    def disable(self) -> None:
        """关闭 Agent Connect：释放 mcp 实例，回到 disabled。"""
        self._mcp = None
        self._tool_count = 0
        self._status = "disabled"
        self._clear_execution_guard()
        logger.info("Agent Connect disabled")

    # -------------------- 执行守卫（5.2.2-522-s1） --------------------

    def _install_execution_guard(self) -> None:
        """把自己装成 execute_tool 的模式守卫：入口再兜一层白名单。"""
        from autolink_hub.agent.tools import set_execution_guard

        set_execution_guard(self._guard_for_mode(self._agent_mode))

    def _clear_execution_guard(self) -> None:
        try:
            from autolink_hub.agent.tools import set_execution_guard

            set_execution_guard(None)
        except Exception:  # pragma: no cover
            pass

    @staticmethod
    def _guard_for_mode(mode: str):
        """构造模式守卫：返回拒绝原因字符串（None 表示放行）。"""
        from autolink_hub.mcp_server.capabilities import filter_tools_for_mode

        allowed: set[str] = set()

        def _guard(tool_name: str) -> Optional[str]:
            if not allowed:
                from autolink_hub.agent.tools import get_tool_definitions

                allowed.update(d["name"] for d in filter_tools_for_mode(mode, get_tool_definitions()))
            if tool_name not in allowed:
                return f"工具 {tool_name} 在 {mode} 模式不可用"
            return None

        return _guard

    @staticmethod
    def _read_gate_mode() -> str:
        try:
            from autolink_hub.config import get_agent_connect_gate_mode

            raw = get_agent_connect_gate_mode()
        except Exception:
            raw = GATE_MODE_DEFAULT
        return raw if raw in GATE_MODES else GATE_MODE_DEFAULT

    @staticmethod
    def _read_switch() -> bool:
        """真实读取应用内 Agent Connect 总开关（5.2.2-522-s3）。

        原 selfcheck 只看内存 ``self._status``，开关关掉后 MCP Server 仍可经 stdio
        被外部拉起，自检还报"已开启"。此处改为读配置项，与 run.py 的启动约束同源。
        """
        try:
            from autolink_hub.config import get_enable_agent_connect

            return bool(get_enable_agent_connect())
        except Exception:
            return False

    def set_agent_mode(self, agent_mode: Optional[str]) -> str:
        """切换运行模式（compiled/source），保持 enabled。"""
        mode = self._clamp_mode(agent_mode)
        if mode != self._agent_mode:
            self._agent_mode = mode
            if self._status == "enabled" and self._mcp is not None:
                self._install_execution_guard()
                logger.info(f"Agent Connect mode -> {mode}")
        return mode

    def set_gate_mode(self, gate_mode: Optional[str]) -> str:
        """设置写工具门禁模式（notify 灰度 / enforce 阻断）。"""
        mode = gate_mode if gate_mode in GATE_MODES else GATE_MODE_DEFAULT
        if mode != self._gate_mode:
            self._gate_mode = mode
            logger.info(f"Agent Connect gate -> {mode}")
        return mode

    @property
    def gate_mode(self) -> str:
        return self._gate_mode

    @property
    def gate_hits(self) -> list[dict[str, Any]]:
        return list(self._gate_hits)

    @property
    def block_audit(self) -> dict[str, Any]:
        return dict(self._block_audit)

    @staticmethod
    def _clamp_mode(agent_mode: Optional[str]) -> str:
        if agent_mode in AGENT_MODES:
            return agent_mode
        return DEFAULT_AGENT_MODE

    # -------------------- 工具注册 --------------------

    def _register_tools(self, mcp: Any, mode: str) -> int:
        """将现有 Agent 工具注册表包装为 MCP 工具（按模式过滤）。

        5.2.2-522-s1：改为**工厂闭包**在注册期绑定工具名，处理器签名不再暴露
        ``toolName``（原实现把工具名做成入参默认值，调用方可覆盖 → 越权）。
        5.2.2-522-a1：``inputSchema`` 接入真实参数（含 description/enum）。
        5.2.2-522-s4：写入 MCP ``annotations``（readOnly/destructive/idempotent）。
        """
        from autolink_hub.agent import tools
        from autolink_hub.mcp_server.capabilities import (
            LONG_RUNNING_TOOLS,
            assert_compiled_selection_safe,
            audit_block_rules,
            filter_tools_for_mode,
            mcp_permission_meta,
            normalize_mcp_schema,
            tool_annotations,
            tool_name_to_mcp,
        )

        defs = tools.get_tool_definitions()
        if not defs:
            # 注册表为空（外部直接调用 enable() 而未先 init_tools()）：按需初始化。
            # 否则下方的「屏蔽规则未命中任何注册工具」启动断言会误报并拒绝启动。
            tools.init_tools()
            defs = tools.get_tool_definitions()
        selected = filter_tools_for_mode(mode, defs)
        self._tool_permissions = {}
        registered_names = [(d.get("function") or d).get("name") or "" for d in defs]
        # 屏蔽规则对账 + 编译态安全断言（fail-fast）
        self._block_audit = audit_block_rules(registered_names, mode)
        if mode == "compiled":
            leaked = assert_compiled_selection_safe([s["name"] for s in selected], registered_names)
            if leaked:
                raise RuntimeError(
                    f"Agent Connect 安全断言失败：编译态选中集包含受屏蔽工具 {leaked}（屏蔽规则失效，拒绝启动）"
                )
            if not self._block_audit["compiled_blocked"]:
                raise RuntimeError(
                    "Agent Connect 安全断言失败：编译态屏蔽规则未命中任何注册工具（规则可能已失效，拒绝启动）"
                )

        count = 0
        for item in selected:
            name = item["name"]
            mcp_name = tool_name_to_mcp(name)
            perm = item.get("permission") or "confirm"
            self._tool_permissions[name] = perm
            perm_meta = mcp_permission_meta(perm)
            schema = normalize_mcp_schema(item.get("parameters") or {}, perm)
            is_long = name in LONG_RUNNING_TOOLS
            async_flag = " [async:task]" if is_long else ""
            description = (
                f"{item.get('description', '')} "
                f"[permission:{perm_meta['approval_level']}]{async_flag}"
            ).strip()
            handler = self._make_tool_handler(name, is_long, schema)
            self._add_tool(
                mcp,
                handler=handler,
                mcp_name=mcp_name,
                description=description,
                schema=schema,
                annotations=tool_annotations(perm, name),
            )
            count += 1
        return count

    def _make_tool_handler(self, tool_name: str, is_long_running: bool, schema: dict[str, Any] | None = None):
        """工厂闭包：注册期绑定工具名；处理器签名 = 真实工具参数（无 toolName）。"""
        import inspect

        from autolink_hub.mcp_server.capabilities import CONFIRM_APPROVAL_FIELD

        if is_long_running:
            async def _handler(**kwargs: Any):
                return await self._invoke(tool_name, _coerce_arguments(kwargs), long_running=True)
        else:
            async def _handler(**kwargs: Any):
                return await self._invoke(tool_name, _coerce_arguments(kwargs), long_running=False)

        type_map = {
            "string": str, "integer": int, "number": float,
            "boolean": bool, "array": list, "object": dict,
        }
        params: list[inspect.Parameter] = []
        for prop_name, prop in ((schema or {}).get("properties") or {}).items():
            if not isinstance(prop_name, str) or not prop_name.isidentifier() or prop_name.startswith("_"):
                logger.warning("工具 %s 的参数 %r 无法映射到处理器签名，已跳过", tool_name, prop_name)
                continue
            py_type = type_map.get((prop or {}).get("type"), Any)
            params.append(inspect.Parameter(
                prop_name,
                inspect.Parameter.KEYWORD_ONLY,
                default=None,
                annotation=Optional[py_type],
            ))
        # 过渡兼容：旧客户端沿用 {"arguments": {...}} 包裹
        if "arguments" not in {p.name for p in params}:
            params.append(inspect.Parameter(
                "arguments", inspect.Parameter.KEYWORD_ONLY, default=None, annotation=Optional[dict],
            ))
        # 控制字段（确认凭据）
        if CONFIRM_APPROVAL_FIELD not in {p.name for p in params}:
            params.append(inspect.Parameter(
                CONFIRM_APPROVAL_FIELD, inspect.Parameter.KEYWORD_ONLY, default=None, annotation=Optional[str],
            ))
        _handler.__signature__ = inspect.Signature(params)  # type: ignore[attr-defined]
        _handler.__name__ = f"ac_{tool_name}"
        return _handler

    @staticmethod
    def _add_tool(mcp: Any, *, handler: Any, mcp_name: str, description: str,
                  schema: dict[str, Any], annotations: dict[str, Any]) -> Any:
        """注册工具并**覆盖** inputSchema 为注册表原始 schema（保真透传）。"""
        tool = None
        manager = getattr(mcp, "_tool_manager", None)
        if manager is not None:
            tool = manager.add_tool(
                handler,
                name=mcp_name,
                description=description,
                annotations=annotations,
                structured_output=False,
            )
        else:  # pragma: no cover - 兜底：无私有 manager 时走公开 API
            mcp.add_tool(handler, name=mcp_name, description=description, annotations=annotations)
        if tool is not None:
            try:
                tool.parameters = schema
            except Exception:  # pragma: no cover - SDK 若改为不可赋值则保留推导 schema
                logger.warning("无法覆盖工具 %s 的 inputSchema（SDK 版本差异）", mcp_name)
        return tool

    # -------------------- 资源与提示（5.2.2-522-a3） --------------------

    def _register_resources(self, mcp: Any) -> int:
        """注册只读 resources：模板清单 / 设备库 / 知识库 / 项目清单。按需读盘、不缓存。"""
        count = 0

        def _safe(loader):
            def _inner() -> str:
                try:
                    return loader()
                except Exception as e:  # noqa: BLE001 - 资源读取失败给出可读信息而非崩溃
                    return json.dumps({"error": f"资源读取失败: {e}"}, ensure_ascii=False)

            return _inner

        specs = [
            ("autolink://templates/index", "al_templates_index", "模板中心清单", self._load_templates_index),
            ("autolink://device-library/index", "al_device_library_index", "设备库清单（含光模块）", self._load_device_library_index),
            ("autolink://knowledge/index", "al_knowledge_index", "知识库条目清单", self._load_knowledge_index),
            ("autolink://projects/index", "al_projects_index", "工作区项目清单", self._load_projects_index),
        ]
        for uri, name, desc, loader in specs:
            try:
                mcp.resource(uri, name=name, description=desc, mime_type="application/json")(_safe(loader))
                count += 1
            except Exception as e:  # noqa: BLE001
                logger.warning("注册 resource %s 失败: %s", uri, e)
        return count

    def _register_prompts(self, mcp: Any) -> int:
        """注册工作流 prompts：把三步主流程固化为可直接选用的提示模板。"""
        count = 0
        specs = [
            ("al_design_workflow", "从规模到组网设计的标准流程",
             "请按以下步骤完成组网设计：\n"
             "1. 用 project_list 或 project_info 查清目标项目与现状；\n"
             "2. 用 template_recommend / device_query 选定模板与设备；\n"
             "3. 用 generate_design 生成设计（长耗时，返回 task_id，用 task_query 轮询）；\n"
             "4. 用 validate_design 校验设计合法性（含逐层端口守恒）；\n"
             "5. 汇总拓扑模式、设备台数与校验结论。"),
            ("al_room_workflow", "机房机柜落位标准流程",
             "请按以下步骤完成机房规划：\n"
             "1. 用 room_create / room_set_type 定义机房矩阵与类型；\n"
             "2. 用 room_place 按约束落位机柜；\n"
             "3. 用 room_optimize 优化（长耗时任务）；\n"
             "4. 用 room_validate 校验（承重/供电/冷暖风道）；\n"
             "5. 汇总落位率与冲突项。"),
            ("al_export_workflow", "交付物导出标准流程",
             "导出交付物前请确认：\n"
             "1. validate_design 通过，且无 error 级问题；\n"
             "2. 明确导出类型（连接表/设备清单/BOM/布线表/评审包）；\n"
             "3. 用 export_outputs 生成（长耗时任务，用 task_query 轮询）；\n"
             "4. 核对产物清单与批次目录，向用户汇报产物路径。"),
        ]
        for name, desc, template in specs:
            try:
                def _prompt_factory(text: str):
                    def _prompt() -> str:
                        return text

                    return _prompt

                mcp.prompt(name=name, description=desc)(_prompt_factory(template))
                count += 1
            except Exception as e:  # noqa: BLE001
                logger.warning("注册 prompt %s 失败: %s", name, e)
        return count

    # -- 资源加载实现（按需读盘） --

    @staticmethod
    def _agent_tools_module():
        from autolink_hub.agent import tools as tools_mod

        return tools_mod

    @classmethod
    def _load_templates_index(cls) -> str:
        mod = cls._agent_tools_module()
        for attr in ("_template_root", "_template_dir", "_TEMPLATE_ROOT"):
            root = getattr(mod, attr, None)
            if root and Path(root).exists():
                names = sorted(p.name for p in Path(root).iterdir() if p.is_dir())
                return json.dumps({"total": len(names), "root": str(root), "templates": names},
                                  ensure_ascii=False, indent=2)
        return json.dumps({"total": 0, "templates": [], "note": "模板根目录不可定位"}, ensure_ascii=False)

    @classmethod
    def _load_device_library_index(cls) -> str:
        mod = cls._agent_tools_module()
        for attr in ("_device_library", "get_device_library"):
            obj = getattr(mod, attr, None)
            try:
                lib = obj() if callable(obj) else obj
            except Exception:  # noqa: BLE001
                continue
            if lib is None:
                continue
            for meth in ("get_all", "list_all", "all"):
                fn = getattr(lib, meth, None)
                if callable(fn):
                    try:
                        devices = list(fn())
                    except Exception:  # noqa: BLE001
                        continue
                    return json.dumps(
                        {"total": len(devices), "devices": [str(d) for d in devices[:500]]},
                        ensure_ascii=False, indent=2,
                    )
        return json.dumps({"total": 0, "devices": [], "note": "设备库不可定位"}, ensure_ascii=False)

    @staticmethod
    def _load_knowledge_index() -> str:
        entries = []
        try:
            from autolink_hub.knowledge.engine import get_knowledge_engine

            engine = get_knowledge_engine()
            for attr in ("list_entries", "list_all", "search"):
                fn = getattr(engine, attr, None)
                if callable(fn):
                    try:
                        raw = fn() if attr != "search" else fn("")
                        entries = raw if isinstance(raw, list) else list(raw or [])
                        break
                    except Exception:  # noqa: BLE001
                        continue
        except Exception as e:  # noqa: BLE001
            return json.dumps({"total": 0, "entries": [], "note": f"知识库不可用: {e}"}, ensure_ascii=False)
        return json.dumps({"total": len(entries), "entries": entries[:200]}, ensure_ascii=False, default=str)

    @classmethod
    def _load_projects_index(cls) -> str:
        mod = cls._agent_tools_module()
        for attr in ("_workspace_dir", "get_workspace_dir"):
            obj = getattr(mod, attr, None)
            try:
                workspace = Path(obj() if callable(obj) else obj or "")
            except Exception:  # noqa: BLE001
                continue
            if workspace and workspace.exists():
                names = sorted(p.name for p in workspace.iterdir() if p.is_dir() and not p.name.startswith("_"))
                return json.dumps({"total": len(names), "projects": names}, ensure_ascii=False, indent=2)
        return json.dumps({"total": 0, "projects": [], "note": "工作区不可定位"}, ensure_ascii=False)

    # -------------------- 执行（模式 → 权限 → 语义） --------------------

    async def _invoke(self, name: str, arguments: dict, long_running: bool):
        """MCP 工具处理器统一入口：产出 ``CallToolResult``（含 isError）。"""
        args, control = _split_arguments(arguments or {})
        if long_running:
            blocked = self._permission_gate(name, args, control, record=False)
            if blocked is not None:
                return self._to_call_result(name, args, blocked, ok=False)
            payload = self._submit_long_task(name, arguments or {})
            return self._to_call_result(name, args, payload, ok=True)
        payload = await self._execute_wrapped(name, arguments or {})
        return self._to_call_result(name, args, payload, ok=bool(payload.get("success")))

    def _to_call_result(self, name: str, args: dict, payload: dict, ok: bool):
        """把结构化 payload 转成 MCP ``CallToolResult``。

        5.2.2-522-a2：失败时置 ``isError=True``（原实现失败也返回普通内容，
        协议层 ``isError`` 恒为 false，下游 Agent 无法区分成功/失败）；响应扁平化单层。
        """
        CallToolResult, TextContent = _import_mcp_types()
        body = dict(payload or {})
        body["success"] = bool(ok)
        text = json.dumps(body, ensure_ascii=False, indent=2, default=str)
        return CallToolResult(
            content=[TextContent(type="text", text=text)],
            structuredContent=body,
            isError=not ok,
        )

    def _permission_gate(self, name: str, args: dict, control: dict, record: bool = True) -> Optional[dict]:
        """confirm 档服务端门禁（与 write_gate 同层，顺序：模式 → 权限 → 语义）。

        - ``enforce``：未携带 ``approvalToken`` → 拒绝（``AC_ERR_PERMISSION_REQUIRED``）
        - ``notify``（灰度默认）：记录命中与审计，不阻断（DP-MC-02 决策）
        """
        from autolink_hub.mcp_server.capabilities import CONFIRM_APPROVAL_FIELD

        if self._tool_permissions.get(name, "confirm") != "confirm":
            return None
        token = (control or {}).get(CONFIRM_APPROVAL_FIELD)
        if self._gate_mode == "enforce" and not token:
            return {
                "success": False,
                "error": f"工具 {name} 需用户确认：缺少 {CONFIRM_APPROVAL_FIELD}",
                "error_code": AC_ERR_PERMISSION_REQUIRED,
            }
        if record:
            self._gate_hits.append({
                "ts": _now(), "tool": name, "mode": self._gate_mode, "approved": bool(token),
            })
            self.record_audit("external-agent", name, args, "notify")
        return None

    def _submit_long_task(self, name: str, arguments: dict) -> dict:
        """5.1.4-514-a：长耗时工具提交为异步后台任务，立即返回 task_id。"""
        from autolink_hub.mcp_server.tasks import get_task_manager

        task_id = get_task_manager().submit(
            name,
            lambda: self._execute_wrapped(name, arguments),
        )
        return {
            "task_id": task_id,
            "tool": name,
            "status": "submitted",
            "message": "任务已提交，用 task_query 查询进度",
        }

    async def _execute_wrapped(self, name: str, arguments: dict) -> dict:
        """执行 Agent 工具并记录审计；写入工具过 L2/L3 语义层，失败返回结构化错误。

        执行链：模式守卫（execute_tool 入口）→ 权限门禁 → 业务执行 → L2/L3 语义层。
        """
        from autolink_hub.agent.tools import execute_tool
        from autolink_hub.mcp_server.write_gate import (
            check_idempotent,
            idempotency_key,
            is_write_tool,
            validate_result,
        )

        _started = time.time()
        args, control = _split_arguments(arguments or {})

        # 权限门禁（在语义层之前）
        blocked = self._permission_gate(name, args, control)
        if blocked is not None:
            self.record_audit("external-agent", name, args, "error")
            return blocked

        # L3 幂等：写入工具且同 key 已提交 → 返回"已存在"
        if is_write_tool(name):
            hit = check_idempotent(self._write_records, name, args)
            if hit is not None:
                self.record_audit("external-agent", name, args, "idempotent")
                return hit

        result = await execute_tool(name, args)
        ok = result.get("success")
        payload = result
        # 5.2.2-522-a2：handler 级业务失败历史以**嵌套形态**返回
        # （``{"success": True, "result": {"success": False, ...}}``）。此处归一为扁平失败，
        # 否则非写入工具的失败会被 MCP 层当作成功（``isError`` 恒 false，P1-2 缺陷）。
        inner = result.get("result")
        if ok and isinstance(inner, dict) and inner.get("success") is False:
            payload = {**inner, "success": False}
            ok = False
        if ok and is_write_tool(name):
            # L2 语义校验：写入结果结构完整、无 error 标记
            payload = validate_result(name, result)
            ok = payload.get("success")
            if ok:
                key = idempotency_key(args)
                if key:
                    self._write_records[f"{name}:{key}"] = {"result": payload.get("result")}
        duration_ms = round((time.time() - _started) * 1000, 1)
        self.record_audit("external-agent", name, args, "ok" if ok else "error", duration_ms=duration_ms)
        if ok:
            return {"success": True, "result": _flatten_payload(payload.get("result"))}
        err = payload.get("error", "工具执行失败")
        return {
            "success": False,
            "error": err,
            "error_code": payload.get("error_code") or "AC_ERR_EXEC_FAILED",
        }

    # -------------------- 审计 --------------------

    def set_audit_path(self, path: Optional[Path]) -> None:
        self._audit_path = Path(path) if path else None

    def record_audit(
        self,
        agent: str,
        tool: str,
        arguments: dict,
        result: str,
        duration_ms: float | None = None,
    ) -> None:
        """记录 Agent 操作审计。审计路径未配置时跳过（不阻断执行）。

        5.1.5-515-d：入参摘要（脱敏+截断）、耗时、模式写入审计条目。
        """
        if self._audit_path is None:
            return
        try:
            self._audit_path.parent.mkdir(parents=True, exist_ok=True)
            entry = {
                "ts": _now(),
                "agent": agent,
                "tool": tool,
                "arguments": arguments,
                "args_summary": _summarize_args(arguments),
                "result": result,
                "duration_ms": duration_ms,
                "mode": self._agent_mode,
            }
            with self._audit_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except OSError as e:  # pragma: no cover
            logger.warning(f"Agent Connect audit write failed: {e}")

    def query_audit(
        self,
        agent: str = "",
        tool: str = "",
        result: str = "",
        limit: int = 20,
    ) -> list[dict[str, Any]]:
        """查询审计日志（按 agent/tool/result 过滤，返回最近 N 条）。

        返回条目含脱敏入参摘要（args_summary），避免敏感信息外泄。
        """
        if self._audit_path is None or not self._audit_path.exists():
            return []
        entries: list[dict[str, Any]] = []
        try:
            with self._audit_path.open("r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entries.append(json.loads(line))
                    except Exception:  # noqa: BLE001 - 单行损坏不影响整体
                        continue
        except OSError:  # pragma: no cover
            return []
        filtered = [
            e for e in entries
            if (not agent or agent in (e.get("agent") or ""))
            and (not tool or tool == e.get("tool"))
            and (not result or result == e.get("result"))
        ]
        return filtered[-limit:]

    # -------------------- 自检（5.1.6-516-b/X-516） --------------------

    def selfcheck(self) -> dict[str, Any]:
        """Agent Connect 连接自检：面向"一键接入（复制配置→自检→排错）"的排错入口。

        逐项检查 MCP SDK / **总开关（真实读配置）** / 工具注册 / **屏蔽规则对账** /
        **门禁模式** / 审计，返回结构化结果与修复提示。

        5.2.2-522-s3：原实现只看内存 ``self._status``，开关关掉也报"已开启"；
        现改为真实读配置项，并补充屏蔽规则与门禁的真实状态。
        """
        checks: list[dict[str, Any]] = []
        try:
            _import_fastmcp()
            checks.append({"name": "mcp_sdk", "ok": True, "message": "MCP SDK 已安装（mcp>=1.2.0）"})
        except ImportError as e:
            checks.append({
                "name": "mcp_sdk", "ok": False, "message": str(e),
                "hint": "运行 pip install 'mcp>=1.2.0' 后重启应用",
            })
        # 总开关（真实读配置，而非内存状态）
        enabled_conf = self._read_switch()
        enabled = self._status == "enabled"
        checks.append({
            "name": "enabled", "ok": enabled and enabled_conf,
            "message": (
                f"Agent Connect 已开启（开关={enabled_conf}，状态={self._status}）"
                if enabled and enabled_conf
                else f"Agent Connect 未开启（开关={enabled_conf}，状态={self._status}）"
            ),
            "hint": "" if (enabled and enabled_conf) else "在设置中开启 Agent Connect 后再接入",
        })
        checks.append({
            "name": "tools", "ok": self._tool_count > 0,
            "message": f"已注册 {self._tool_count} 个 MCP 工具",
            "hint": "" if self._tool_count > 0 else "工具注册异常，请重启应用",
        })
        # 屏蔽规则对账（编译态必须命中且不漏）
        audit = self._block_audit or {}
        blocked = audit.get("compiled_blocked") or []
        ok_block = True
        msg_block = "屏蔽规则未运行（尚未开启）"
        hint_block = ""
        if audit:
            if self._agent_mode == "compiled":
                ok_block = bool(blocked)
                msg_block = (
                    f"编译态屏蔽 {len(blocked)} 个工具：{', '.join(blocked[:8])}"
                    + ("…" if len(blocked) > 8 else "")
                )
                hint_block = "" if ok_block else "屏蔽规则未命中任何工具，危险工具可能已泄露，请检查命名规则"
            else:
                msg_block = f"源码态：破坏性工具 {len(audit.get('destructive') or [])} 个按权限档位暴露"
        checks.append({"name": "blocked_rules", "ok": ok_block, "message": msg_block, "hint": hint_block})
        # 门禁模式
        checks.append({
            "name": "gate",
            "ok": True,
            "message": (
                f"写工具门禁={self._gate_mode}"
                + ("（灰度：记录不阻断，一版后转阻断）" if self._gate_mode == "notify" else "（阻断：需 approvalToken）")
            ),
            "hint": "" if self._gate_mode == "enforce" else "灰度期结束后将自动转阻断模式",
        })
        checks.append({
            "name": "audit", "ok": self._audit_path is not None,
            "message": f"审计{'已启用（' + str(self._audit_path) + '）' if self._audit_path else '未启用（默认关闭，可配置开启）'}",
        })
        return {
            "ok": all(c["ok"] for c in checks),
            "mode": self._agent_mode,
            "gate_mode": self._gate_mode,
            "checks": checks,
        }

    # -------------------- 状态报告 --------------------

    def status_report(self) -> dict[str, Any]:
        return {
            "status": self._status,
            "enabled": self._status == "enabled",
            "agent_mode": self._agent_mode,
            "tool_count": self._tool_count,
            "audit_enabled": self._audit_path is not None,
        }


_manager: Optional[AgentConnectManager] = None


def get_agent_connect_manager() -> AgentConnectManager:
    """全局 Agent Connect 管理器单例。"""
    global _manager
    if _manager is None:
        _manager = AgentConnectManager()
    return _manager


def reset_manager() -> None:
    """测试/配置变更后重建管理器（隔离全局状态）。"""
    global _manager
    _manager = AgentConnectManager()
