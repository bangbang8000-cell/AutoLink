"""AutoLink AI Hub MCP 管理器（5.0.3-503-c：MCP 工具接入）

- 配置管理：MCP server 配置持久化到 $AUTOLINK_USER_DATA/mcp_servers.json
- 子进程生命周期：stdio 子进程（mcp SDK stdio_client），连接按需建立/关闭
- 工具发现：连接 server → list_tools → 动态注册 `mcp:<server>:<tool>` 到 tools.py 共享注册表
- 执行分发：execute_tool 查表 → 本管理器 call_tool → 转发到对应 MCP server
- 双引擎共享：工具注册进 tools.py 共享注册表，双引擎均透传（不改引擎适配器）

依赖 `mcp`（requirements.txt 已声明）：仅在运行时惰性导入；未安装时优雅降级
（list/sync 返回「MCP SDK 未安装」提示，不阻断其余 AI Hub 功能）。
"""
import asyncio
import json
import logging
import os
import re
import threading
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# MCP 工具前缀：mcp:<server>:<tool>
MCP_TOOL_PREFIX = "mcp:"

CONFIG_FILENAME = "mcp_servers.json"
SERVER_NAME_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
DEFAULT_TIMEOUT = 60.0


def mcp_available() -> bool:
    """mcp Python SDK 是否可用（惰性探测，不真实导入业务逻辑）"""
    try:
        import mcp  # noqa: F401
        return True
    except ImportError:
        return False


def _state_dir() -> Path:
    """MCP 配置目录：$AUTOLINK_USER_DATA > settings.user_data_dir > ~/.autolink"""
    ud = os.environ.get("AUTOLINK_USER_DATA", "")
    if ud:
        return Path(ud)
    try:
        from autolink_hub.config import settings
        if settings.user_data_dir:
            return Path(settings.user_data_dir)
    except Exception:
        pass
    return Path.home() / ".autolink"


class MCPManager:
    """MCP server 配置 + 子进程生命周期 + 工具注册管理"""

    def __init__(self, state_dir: Optional[str] = None):
        self._state_dir = Path(state_dir) if state_dir else _state_dir()
        self._servers: dict[str, dict] = {}
        self._loaded = False
        self._lock = threading.Lock()

    # ---- 配置持久化 ----

    def config_path(self) -> Path:
        return self._state_dir / CONFIG_FILENAME

    def load(self) -> None:
        if self._loaded:
            return
        self._loaded = True
        path = self.config_path()
        if not path.exists():
            return
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            servers = data.get("servers", []) if isinstance(data, dict) else []
            self._servers = {
                s["name"]: s for s in servers
                if isinstance(s, dict) and s.get("name")
            }
        except Exception as e:
            logger.warning(f"Failed to load mcp config {path}: {e}")

    def _save(self) -> None:
        try:
            path = self.config_path()
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(
                json.dumps({"servers": list(self._servers.values())}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as e:
            logger.warning(f"Failed to save mcp config: {e}")

    # ---- server 配置 CRUD ----

    def list_servers(self) -> list[dict]:
        """server 清单（含已发现工具列表与连接状态）"""
        self.load()
        result = []
        for name, cfg in self._servers.items():
            result.append({
                "name": name,
                "command": cfg.get("command", ""),
                "args": list(cfg.get("args") or []),
                "enabled": bool(cfg.get("enabled", True)),
                "permission": cfg.get("permission", "confirm"),
                "status": "configured",
                "tools": list(cfg.get("_tools") or []),
                "error": cfg.get("_error", ""),
            })
        return result

    async def add_server(self, name: str, command: str, args: Optional[list] = None,
                         env: Optional[dict] = None, enabled: bool = True,
                         permission: str = "confirm") -> dict:
        """新增/更新 MCP server 配置（持久化 + 重新同步该 server 工具）"""
        self.load()
        name = (name or "").strip()
        command = (command or "").strip()
        if not name:
            return {"ok": False, "error": "MCP server 名不能为空"}
        if not SERVER_NAME_RE.match(name):
            return {"ok": False, "error": "MCP server 名仅允许字母/数字/-/_（≤64）"}
        if not command:
            return {"ok": False, "error": "MCP server 启动命令不能为空"}
        if permission not in ("auto", "notify", "confirm"):
            permission = "confirm"
        self._servers[name] = {
            "name": name,
            "command": command,
            "args": list(args or []),
            "env": dict(env or {}),
            "enabled": bool(enabled),
            "permission": permission,
        }
        self._save()
        sync = await self.sync_server(name)
        return {"ok": True, "server": name, "sync": sync}

    def remove_server(self, name: str) -> dict:
        """删除 MCP server 配置（取消注册其工具 + 持久化）"""
        self.load()
        cfg = self._servers.get(name)
        if cfg is None:
            return {"ok": False, "error": f"MCP server 不存在: {name}"}
        # 先取已注册工具名，再删配置（避免删除后丢失 _tools 索引）
        tool_names = [f"{MCP_TOOL_PREFIX}{name}:{t}" for t in (cfg.get("_tools") or [])]
        del self._servers[name]
        self._save()
        from autolink_hub.agent.tools import unregister_tool
        for tool in tool_names:
            unregister_tool(tool)
        return {"ok": True, "server": name, "unregistered": len(tool_names)}

    def set_enabled(self, name: str, enabled: bool) -> dict:
        self.load()
        if name not in self._servers:
            return {"ok": False, "error": f"MCP server 不存在: {name}"}
        self._servers[name]["enabled"] = bool(enabled)
        self._save()
        return {"ok": True, "server": name, "enabled": bool(enabled)}

    # ---- 工具发现 / 注册 ----

    def _server_tool_names(self, server: str) -> list[str]:
        """该 server 已注册的全部 mcp 工具名"""
        names = []
        for tname in list(self._servers.get(server, {}).get("_tools") or []):
            names.append(f"{MCP_TOOL_PREFIX}{server}:{tname}")
        return names

    async def _discover_tools(self, cfg: dict) -> list[dict]:
        """连接 MCP server 并列出工具（{name, description, inputSchema}）"""
        if not mcp_available():
            raise RuntimeError("MCP Python SDK 未安装（pip install mcp）")
        from mcp import ClientSession, StdioServerParameters  # noqa: E402
        from mcp.client.stdio import stdio_client  # noqa: E402

        params = StdioServerParameters(
            command=cfg["command"],
            args=list(cfg.get("args") or []),
            env=dict(cfg.get("env") or {}) or None,
        )
        tools: list[dict] = []
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                listed = await session.list_tools()
                for t in getattr(listed, "tools", []) or []:
                    tools.append({
                        "name": t.name,
                        "description": t.description or "",
                        "inputSchema": getattr(t, "inputSchema", None) or {},
                    })
        return tools

    async def sync_server(self, name: str) -> dict:
        """同步单个 server：发现工具 → 注册 mcp:<server>:<tool>"""
        self.load()
        cfg = self._servers.get(name)
        if cfg is None:
            return {"ok": False, "error": f"MCP server 不存在: {name}"}
        if not cfg.get("enabled"):
            return {"ok": False, "error": f"MCP server 未启用: {name}"}

        try:
            tools = await self._discover_tools(cfg)
        except Exception as e:  # noqa: BLE001
            cfg["_error"] = str(e)
            cfg["_tools"] = []
            self._save()
            return {"ok": False, "error": str(e)}

        # 注册到 tools.py 共享注册表（双引擎透传）
        from autolink_hub.agent.tools import register_tool
        registered = []
        for t in tools:
            tool_full = f"{MCP_TOOL_PREFIX}{name}:{t['name']}"
            register_tool(
                tool_full,
                f"[MCP:{name}] {t['description'] or t['name']}",
                _normalize_schema(t.get("inputSchema") or {}),
                self._make_handler(name, t["name"]),
                permission=cfg.get("permission", "confirm"),
            )
            registered.append(t["name"])
        cfg["_tools"] = registered
        cfg["_error"] = ""
        self._save()
        return {"ok": True, "server": name, "tools": registered}

    async def sync_all(self) -> dict:
        """同步全部启用 server（供 mcp reload 调用）"""
        self.load()
        results = {}
        for name, cfg in self._servers.items():
            if not cfg.get("enabled"):
                continue
            results[name] = await self.sync_server(name)
        return {"ok": True, "results": results}

    def sync_all_blocking(self) -> dict:
        """同步全部（同步上下文用：hub 初始化；自建事件循环并关闭）"""
        async def _run():
            return await self.sync_all()

        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        if loop is not None:
            # 已在事件循环内（如测试/异步启动），直接驱动
            async def _inline():
                return await self.sync_all()
            return asyncio.run_coroutine_threadsafe(_inline(), loop).result()
        new_loop = asyncio.new_event_loop()
        try:
            return new_loop.run_until_complete(_run())
        finally:
            new_loop.close()

    def _make_handler(self, server: str, tool: str):
        """生成 MCP 工具 handler（异步，转发到 call_tool；失败抛异常由 execute_tool 包装）"""
        async def handler(arguments: dict):
            result = await self.call_tool(server, tool, arguments)
            if isinstance(result, dict) and result.get("success") is False:
                raise RuntimeError(result.get("error", "MCP 调用失败"))
            return result.get("result")
        return handler

    # ---- 执行分发 ----

    async def call_tool(self, server: str, tool: str, arguments: dict,
                        timeout: float = DEFAULT_TIMEOUT) -> dict:
        """调用 MCP server 工具：连接 → call_tool → 关闭，返回 {success, result/error}"""
        self.load()
        cfg = self._servers.get(server)
        if cfg is None:
            return {"success": False, "error": f"MCP server 不存在: {server}"}
        if not cfg.get("enabled"):
            return {"success": False, "error": f"MCP server 未启用: {server}"}
        try:
            result = await self._call_tool_impl(cfg, tool, arguments, timeout)
            return {"success": True, "result": result}
        except Exception as e:  # noqa: BLE001
            logger.error(f"MCP call error [{server}:{tool}]: {e}")
            return {"success": False, "error": str(e)}

    async def _call_tool_impl(self, cfg: dict, tool: str, arguments: dict,
                              timeout: float) -> dict:
        if not mcp_available():
            raise RuntimeError("MCP Python SDK 未安装（pip install mcp）")
        from mcp import ClientSession, StdioServerParameters  # noqa: E402
        from mcp.client.stdio import stdio_client  # noqa: E402

        params = StdioServerParameters(
            command=cfg["command"],
            args=list(cfg.get("args") or []),
            env=dict(cfg.get("env") or {}) or None,
        )
        async with stdio_client(params) as (read, write):
            async with ClientSession(read, write) as session:
                await session.initialize()
                resp = await asyncio.wait_for(
                    session.call_tool(tool, arguments), timeout=timeout,
                )
        # 归一化 MCP 响应（结构化内容 → 可序列化对象）
        content = getattr(resp, "content", None) or []
        parts = []
        for c in content:
            ctype = getattr(c, "type", "")
            ctext = getattr(c, "text", "")
            if ctype == "text" and ctext:
                parts.append(ctext)
        if len(parts) == 1 and parts[0]:
            return {"content": parts[0]}
        return {"content": parts}


def _normalize_schema(input_schema: dict) -> dict:
    """归一化 MCP inputSchema → JSON-Schema（{type, properties, required}）"""
    if not isinstance(input_schema, dict):
        return {"type": "object", "properties": {}, "required": []}
    return {
        "type": input_schema.get("type", "object"),
        "properties": input_schema.get("properties", {}) or {},
        "required": input_schema.get("required", []) or [],
    }


_manager: Optional[MCPManager] = None


def get_mcp_manager() -> MCPManager:
    global _manager
    if _manager is None:
        _manager = MCPManager()
    return _manager


def reset_mcp_manager() -> None:
    """测试隔离：重置单例"""
    global _manager
    _manager = None
