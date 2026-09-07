"""5.1.1-511-a：Agent Connect 管理器（MCP Server 生命周期 + 状态机 + 审计，AutoLink）。

- 状态机：disabled（开关关，默认）→ enabled（开关开，持有 FastMCP）
- agentMode：compiled（默认）| source；切换保持 enabled
- 惰性导入 mcp SDK：未安装时 enable 返回可读错误，不阻断 AI Hub
- 审计：Agent 操作写入审计文件（编译态强制，源码态默认）
"""
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

logger = logging.getLogger(__name__)

AGENT_MODES = ("compiled", "source")
DEFAULT_AGENT_MODE = "compiled"


def _now() -> str:
    return datetime.now().isoformat()


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
            "MCP SDK 未安装（pip install 'mcp>=1.2.0'），无法启动 Agent Connect MCP Server"
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
        raise ImportError(
            "MCP SDK 未安装（pip install 'mcp>=1.2.0'），无法启动 Agent Connect MCP Server"
        ) from e


class AgentConnectManager:
    """Agent Connect MCP Server 生命周期管理器（单例模式，配合 reset_manager）。"""

    def __init__(self):
        self._status = "disabled"  # disabled | enabled
        self._agent_mode = DEFAULT_AGENT_MODE
        self._mcp: Any = None
        self._audit_path: Optional[Path] = None
        self._tool_count = 0
        self._write_records: dict[str, Any] = {}  # 5.1.3-513-c：L3 幂等记录

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
            registered = self._register_tools(mcp, mode)
            self._mcp = mcp
            self._agent_mode = mode
            self._tool_count = registered
            self._status = "enabled"
            logger.info(f"Agent Connect enabled mode={mode} tools={registered}")
            return True, f"Agent Connect 已开启（mode={mode}，暴露 {registered} 个工具）"
        except Exception as e:  # pragma: no cover
            logger.error(f"Agent Connect enable failed: {e}")
            self._status = "error"
            return False, f"Agent Connect 启动失败: {e}"

    def disable(self) -> None:
        """关闭 Agent Connect：释放 mcp 实例，回到 disabled。"""
        self._mcp = None
        self._tool_count = 0
        self._status = "disabled"
        logger.info("Agent Connect disabled")

    def set_agent_mode(self, agent_mode: Optional[str]) -> str:
        """切换运行模式（compiled/source），保持 enabled。"""
        mode = self._clamp_mode(agent_mode)
        if mode != self._agent_mode:
            self._agent_mode = mode
            if self._status == "enabled" and self._mcp is not None:
                logger.info(f"Agent Connect mode -> {mode}")
        return mode

    @staticmethod
    def _clamp_mode(agent_mode: Optional[str]) -> str:
        if agent_mode in AGENT_MODES:
            return agent_mode
        return DEFAULT_AGENT_MODE

    # -------------------- 工具注册 --------------------

    def _register_tools(self, mcp: Any, mode: str) -> int:
        """将现有 Agent 工具注册表包装为 MCP 工具（按模式过滤）。"""
        from autolink_hub.agent import tools
        from autolink_hub.mcp_server.capabilities import (
            filter_tools_for_mode,
            mcp_permission_meta,
            normalize_mcp_schema,
            tool_name_to_mcp,
        )

        defs = tools.get_tool_definitions()
        selected = filter_tools_for_mode(mode, defs)
        count = 0
        for item in selected:
            name = item["name"]
            mcp_name = tool_name_to_mcp(name)
            schema = normalize_mcp_schema(item.get("parameters") or {})
            perm_meta = mcp_permission_meta(item.get("permission") or "confirm")
            tool_name = name  # 闭包绑定

            @mcp.tool(name=mcp_name, description=f"{item.get('description', '')} [permission:{perm_meta['approval_level']}]")
            async def _handler(arguments: dict | None = None, toolName: str = tool_name) -> dict:
                return await self._execute_wrapped(toolName, arguments or {})

            count += 1
        return count

    async def _execute_wrapped(self, name: str, arguments: dict) -> dict:
        """执行 Agent 工具并记录审计；写入工具过 L2/L3 语义层，失败返回结构化错误。"""
        from autolink_hub.agent.tools import execute_tool
        from autolink_hub.mcp_server.write_gate import (
            check_idempotent,
            idempotency_key,
            is_write_tool,
            validate_result,
        )

        args = arguments or {}
        # L3 幂等：写入工具且同 key 已提交 → 返回"已存在"
        if is_write_tool(name):
            hit = check_idempotent(self._write_records, name, args)
            if hit is not None:
                self.record_audit("external-agent", name, args, "idempotent")
                return hit

        result = await execute_tool(name, args)
        ok = result.get("success")
        payload = result
        if ok and is_write_tool(name):
            # L2 语义校验：写入结果结构完整、无 error 标记
            payload = validate_result(name, result)
            ok = payload.get("success")
            if ok:
                # 记录幂等标记（后续同 key 提交返回"已存在"）
                key = idempotency_key(args)
                if key:
                    self._write_records[f"{name}:{key}"] = True
        self.record_audit("external-agent", name, args, "ok" if ok else "error")
        if ok:
            return {"success": True, "result": payload.get("result")}
        return {"success": False, "error": payload.get("error", "工具执行失败")}

    # -------------------- 审计 --------------------

    def set_audit_path(self, path: Optional[Path]) -> None:
        self._audit_path = Path(path) if path else None

    def record_audit(self, agent: str, tool: str, arguments: dict, result: str) -> None:
        """记录 Agent 操作审计。审计路径未配置时跳过（不阻断执行）。"""
        if self._audit_path is None:
            return
        try:
            self._audit_path.parent.mkdir(parents=True, exist_ok=True)
            entry = {
                "ts": _now(),
                "agent": agent,
                "tool": tool,
                "arguments": arguments,
                "result": result,
            }
            with self._audit_path.open("a", encoding="utf-8") as f:
                f.write(json.dumps(entry, ensure_ascii=False) + "\n")
        except OSError as e:  # pragma: no cover
            logger.warning(f"Agent Connect audit write failed: {e}")

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
