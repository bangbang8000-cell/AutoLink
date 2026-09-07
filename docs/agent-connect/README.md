# Agent Connect 接入样板（5.1.6-516-a）

AutoLink 5.1 系列将自身封装为标准 MCP Server（Agent Connect）。本目录提供主流
AI Agent / 编程智能体的「配置即用」接入样板。启动命令统一为：

```bash
python -m autolink_hub.mcp_server.run --mode compiled --user-data <用户数据目录>
```

- `--mode compiled`（默认）：产品使用态 —— 只读 + 受控写入，不修改软件本体
- `--mode source`：开发态 —— 追加 CLI 透传与源码直读（`npm run dev:all` 场景）

> 先决条件：已安装 MCP SDK（`pip install "mcp>=1.2.0"`），且已在应用设置中开启 Agent Connect。
> 配置中用到的 `<REPO_ROOT>` 请替换为本仓库（AIDC AutoLink-Client）的绝对路径。

## 3 步接入（516-b）

1. **开启**：应用「设置 → AI → Agent Connect」打开开关（可选用 `--mode source` 体验完整能力）
2. **复制配置**：按下方你的 Agent 客户端粘贴对应配置
3. **自检**：调用 `ac_selfcheck` / 查看「设置 → Agent Connect → 自检」，绿灯即接入成功

## 开发态（源码运行，517-e）

以 `npm run dev:all` 源码运行时，追加 `--mode source` 即可解锁无限制通道：

- `run_cli`：白名单 CLI action 透传（design/validate/export/report/room/config/project/template/capacity/atop/optimize/repair/file/device 等域）
- `read_file(path)` / `list_dir(path)` / `read_source(path)`：沙箱内文件系统（用户数据目录 + 仓库根），越权拒绝
- 该模式下写入工具权限放宽为 NOTIFY 为主，但业务数据校验（L2/L3）不豁免

## Claude Desktop

`claude_desktop_config.json`（macOS: `~/Library/Application Support/Claude/`；Windows: `%APPDATA%\Claude\`）

```json
{
  "mcpServers": {
    "autolink": {
      "command": "python",
      "args": ["-m", "autolink_hub.mcp_server.run", "--mode", "compiled", "--user-data", "<用户数据目录>"],
      "cwd": "<REPO_ROOT>"
    }
  }
}
```

## Codex CLI

`.codex/config.toml`（项目根目录）

```toml
[mcp_servers.autolink]
command = "python"
args = ["-m", "autolink_hub.mcp_server.run", "--mode", "compiled", "--user-data", "<用户数据目录>"]
cwd = "<REPO_ROOT>"
```

## Trae Work / VS Code

`.mcp.json`（工作区根目录，Trae/VS Code 共用）

```json
{
  "servers": {
    "autolink": {
      "type": "stdio",
      "command": "python",
      "args": ["-m", "autolink_hub.mcp_server.run", "--mode", "compiled", "--user-data", "<用户数据目录>"],
      "cwd": "<REPO_ROOT>"
    }
  }
}
```

## 排错（516-b/X-516）

| 现象 | 检查项 | 修复 |
| --- | --- | --- |
| 连接失败「MCP SDK 未安装」 | `pip show mcp` | `pip install "mcp>=1.2.0"` 后重启 |
| 工具列表为空 | 设置开关 | 开启 Agent Connect 后再连接 |
| 权限提示频繁 | `--mode` | 编译态写入需确认属预期；开发场景切 `--mode source` |
| 审计缺失 | 审计开关 | 设置中开启审计；`--audit <path>` 指定路径 |

## 验证工具（Agent 会话内可调用）

- `ac_generate_design`（返回 task_id）→ `task_query` 轮询 —— 一键网络设计
- `ac_list_projects` / `ac_project_info` —— 查询项目
- `ac_template_list` / `ac_preview_template` —— 查询模板
- `task_submit` / `task_wait` / `task_cancel` —— 异步任务
- `audit_query` —— 查询本人操作审计（脱敏摘要）
