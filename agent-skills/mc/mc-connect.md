---
name: "mc-connect"
description: "连接 MC 渲染域（MagicCommander）MCP Server 并完成首次连通性校验。当用户要求接入 MagicCommander、配置 MC 的 MCP、排查「连不上 MC / 工具列表为空 / 渲染工具找不到」时使用。含 stdio 启动命令（--workspace）、11 个能力域、MC 与 AL 接入参数的差异对照。"
---

# MC 渲染域接入（Agent Connect）

MC = **MagicCommander-Client**，负责「Excel 参数 → Jinja2 模板 → **设备配置渲染**」的**渲染**链路。

## 一、启动方式

```bash
python -m ai_hub.mcp_server.run \
  --mode compiled \
  --workspace <工作区目录>
```

| 参数 | 说明 |
|---|---|
| `--mode` | `compiled`（默认，产品态）／`source`（开发态） |
| `--workspace` | **工作区目录**（编译态资产根）—— 项目 / 模板 / 设备库都读这里 |
| `--audit` | 审计文件路径，默认 `<workspace>/agent-connect-audit.jsonl` |

### ⚠️ 与 AL 的参数差异（**最容易搞错的地方**）

| | AL | MC |
|---|---|---|
| 资产根参数名 | **`--user-data`** | **`--workspace`** |
| 模块路径 | `autolink_hub.mcp_server.run` | `ai_hub.mcp_server.run` |
| 工作目录 | `backend/` | `ai_hub` 包的父目录 |

→ 写成 `--user-data` 给 MC，或 `--workspace` 给 AL，都会**静默用空路径**导致查不到资产。

## 二、MC 的 Claude Desktop 配置样例

```json
{"mcpServers": {"magiccommander": {
  "command": "python",
  "args": ["-m", "ai_hub.mcp_server.run", "--mode", "compiled", "--workspace", "<workspace>"]}}}
```

## 三、两种模式

| | `compiled` | `source` |
|---|---|---|
| 只读 + 受控写入 | ✅ | ✅ |
| `run_cli`（白名单 CLI 透传） | ❌ | ✅ |
| `read_file` / `list_dir` / `read_source` | ❌ | ✅ |
| 破坏性工具（`*_delete` 等） | ❌ 屏蔽 | ❌ 仍屏蔽 |

`run_cli` 白名单子命令：`project` / `template` / `render` / `validate` / `diff` / `label` / `analyze` / `file`

**编译态屏蔽规则与 AL 同构**（语义规则化匹配 `^delete_` / `_delete$` / `^remove_` / `^clear_` / `^purge_` / `^drop_`）。

## 四、三级权限（同 AL）

| 档位 | 语义 |
|---|---|
| 🟢 `auto` | 自动执行 |
| 🟡 `notify` | 执行并告知 |
| 🔴 `confirm` | 需用户确认（enforce 模式需 `approvalToken`） |

> ⚠️ MC 注册工具里有 **17 个 confirm 档**（AL 是 7 个），因为**渲染本身是"写文件"操作** —— `render_config` / `render_yaml` / `reverse_engineer_config` 都是 confirm。
> ⚠️ 且 `task_*` / `audit_query` / `agent_feedback` 五+二共 7 个因**权限表未登记**而兜底 confirm（与 AL 同源缺陷，见 `工具面清单.md` §3.2）。

## 五、连通性自检

```
1. list_projects    {}                → 期望 {projects:[...]}（空数组也算通）
2. template_list    {}                → 期望模板清单（MC 的模板中心 = example 目录）
3. list_skills      {}                → 期望技能清单
```

| 现象 | 根因 |
|---|---|
| 工具列表为空 | `--mode compiled` 域被隐藏，或 `--workspace` 不存在 |
| 所有工具返回 confirm | 权限表未登记 → 兜底 CONFIRM |
| `run_cli` 找不到 | compiled 模式 |
| 项目/模板查不到 | `--workspace` 指错（最常见：写成了 AL 的 `--user-data`） |

## 六、能力域（11 域，编译态可见 9）

| 域 | 编译态 | 用途 |
|---|---|---|
| `project` | ✅ | 项目清单/详情/创建/更新/删除/文件 | 
| `template` | ✅ | 模板清单/预览/创建更新删除/推荐/智能创建 |
| `render` | ✅ | **渲染 / 预演 / 差异对比 / 撤销** |
| `validate` | ✅ | 模板语法 / Excel 数据 / 设计与校验 |
| `export` | ✅ | 导出项目包 / 标签 |
| `knowledge` | ✅ | 知识检索与写入 **+ 技能库** |
| `system` | ✅ | 审计 / 反馈 / 文件系统（`read_file`/`search_files` 编译态可用） |
| `task` | ✅ | 异步任务 |
| `device` | ✅ | （域已声明，MC 侧设备库仅 13 台） |
| `cli` | ❌ 仅源码态 | 白名单 CLI 透传 |
| `filesystem` | ❌ 仅源码态 | `list_dir` / `read_source` |

> ⚠️ **注意 MC 的 `read_file` 是 🟢 auto 且编译态可用**（与 AL 的 confirm + 仅源码态**不同**）。

## 七、长耗时工具

`render_config` / `render_yaml` / `generate_labels` / `export_project` / `import_project` 等在 MCP 层自动转异步，返回 `task_id`。

→ 直接调用 + `task_wait`，**不要**再套 `task_submit`。

## 八、MC 侧规模事实

- MC 工具 **53** 个
- MC 设备库仅 **13 台**（**无 H200 / B300 / Q3400 / Spectrum-X**）
- MC 模板中心 = `example/` 目录（概念上对应 AL 的 `template/`）

## 下一步

- 要渲染配置 → `mc-render-flow`
- 要建/改项目 → `mc-project-ops`
- 要写模板 → `mc-template-author`
- 接入指南与跨端 → `cross-hub-guide`
