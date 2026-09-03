"""AutoLink AI Hub MCP（Model Context Protocol）工具接入（5.0.3-503-c）。

MCP 是协议层而非 Agent 框架：允许作为依赖；工具经 `mcp:<server>:<tool>` 前缀注册进
tools.py 共享注册表，双引擎均透传（不改引擎适配器）。
"""
from autolink_hub.mcp.manager import (
    MCPManager,
    get_mcp_manager,
    reset_mcp_manager,
    mcp_available,
    MCP_TOOL_PREFIX,
)

__all__ = [
    "MCPManager",
    "get_mcp_manager",
    "reset_mcp_manager",
    "mcp_available",
    "MCP_TOOL_PREFIX",
]
