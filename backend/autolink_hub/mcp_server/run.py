"""5.1.6-516-a：Agent Connect MCP Server stdio 启动入口（AutoLink）。

供外部 AI Agent（Claude Desktop / Codex CLI / Trae Work / VS Code 等）通过标准
MCP stdio 协议连接：

    python -m autolink_hub.mcp_server.run --mode compiled --user-data <用户数据目录>

参数：
  --mode      compiled（默认，产品使用态：只读+受控写入）| source（开发态：+CLI/源码）
  --user-data 用户数据目录（项目/模板/设备库/机房规划等资产根）
  --audit     审计文件路径（默认 <user-data>/agent-connect-audit.jsonl）

MCP SDK 未安装时给出可读错误并退出（exit code 2）。
"""
import argparse
import sys
from pathlib import Path


def _bootstrap() -> None:
    """确保 autolink_hub 可导入：stdio 拉起时 cwd 可能为 Agent 工作目录。"""
    here = Path(__file__).resolve().parents[2]
    here_str = str(here)
    if here_str not in sys.path:
        sys.path.insert(0, here_str)


def main() -> int:
    _bootstrap()
    parser = argparse.ArgumentParser(description="Agent Connect MCP Server (stdio)")
    parser.add_argument("--mode", choices=["compiled", "source"], default="compiled")
    parser.add_argument("--user-data", default="", help="用户数据目录（项目/模板/设备库/机房规划等）")
    parser.add_argument("--audit", default="", help="审计文件路径（默认 <user-data>/agent-connect-audit.jsonl）")
    args = parser.parse_args()

    from autolink_hub.agent.tools import init_tools
    from autolink_hub.config import settings
    from autolink_hub.mcp_server.manager import get_agent_connect_manager

    if args.user_data:
        settings.user_data_dir = args.user_data
    init_tools()

    mgr = get_agent_connect_manager()
    audit_path = args.audit or (str(Path(args.user_data) / "agent-connect-audit.jsonl") if args.user_data else "")
    if audit_path:
        mgr.set_audit_path(Path(audit_path))

    ok, msg = mgr.enable(agent_mode=args.mode)
    if not ok:
        print(f"[agent-connect] {msg}", file=sys.stderr)
        return 2
    mcp = mgr.mcp
    if mcp is None:  # pragma: no cover
        print("[agent-connect] 启动失败：未创建 MCP Server", file=sys.stderr)
        return 2
    print(f"[agent-connect] AutoLink Agent Connect 已就绪 mode={mgr.agent_mode} tools={mgr.status_report()['tool_count']}", file=sys.stderr)
    mcp.run()  # 阻塞运行 stdio server
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
