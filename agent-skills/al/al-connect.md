---
name: "al-connect"
description: "连接 AL 规划域（AutoLink）MCP Server 并完成首次连通性校验。当用户要求接入 AutoLink、配置 AL 的 MCP、排查「连不上 AL / 工具列表为空 / 工具调用被拒」时使用。含 stdio 启动命令、compiled/source 模式差异、三级权限语义、编译态屏蔽规则。"
---

# AL 规划域接入（Agent Connect）

AL = **AutoLink-Client**，负责「GPU 规模 → 组网方案 → 机房落位 → 交付物导出」的**规划**链路。
它以 **MCP stdio Server** 形态对旁挂 Agent 暴露能力，无需额外网关。

## 一、启动方式

```bash
python -m autolink_hub.mcp_server.run \
  --mode compiled \
  --user-data <用户数据目录>
```

| 参数 | 说明 |
|---|---|
| `--mode` | `compiled`（默认，产品使用态）／`source`（开发态） |
| `--user-data` | 用户数据目录根 —— 项目 / 模板 / 设备库 / 机房规划等资产都读这里 |
| `--audit` | 审计文件路径，默认 `<user-data>/agent-connect-audit.jsonl` |

> 工作目录必须是 AL 的 `backend/` 目录（`autolink_hub` 包的父目录），否则 `-m` 找不到模块。

## 二、两种模式的差别（**先确认模式再选工具**）

| | `compiled`（产品态） | `source`（开发态） |
|---|---|---|
| 只读 + 受控写入 | ✅ | ✅ |
| `run_cli`（CLI 透传） | ❌ 不暴露 | ✅ |
| `read_file` / `list_dir` / `read_source` | ❌ 不暴露 | ✅ |
| 破坏性工具（`*_delete` 等） | ❌ 屏蔽 | ❌ 仍屏蔽 |
| `cli` / `filesystem` 两个能力域 | ❌ 整域不可见 | ✅ |

**编译态屏蔽是语义规则化的**（`capabilities.py::_DESTRUCTIVE_PATTERNS`），不是枚举名单。命中以下命名即被隐藏：

```
^delete_   _delete$   ^delete$   ^remove_   _remove$
^clear_    _clear$    ^purge_    _purge$    ^drop_   _drop$
```

⚠️ 注意 `apply_config_preset` **不**命中（`preset` ≠ `reset`，规则是锚定匹配）。写 `apply_` 开头的新工具不会被误伤。

## 三、三级权限

| 档位 | 语义 | 外部 Agent 行为 |
|---|---|---|
| 🟢 `auto` | 自动执行 | 直接调，无需询问 |
| 🟡 `notify` | 执行并告知 | 调完向用户说明改了什么 |
| 🔴 `confirm` | 需用户确认 | **必须**先取得用户同意；enforce 模式下需带 `approvalToken` |

MCP 工具元数据里对应 `require_approval` / `approval_level` 字段，**调用前先读这两个字段决定要不要问用户**，不要凭工具名猜。

> `confirm` 档工具在 schema 里会自动补一个 `approvalToken` 参数（`normalize_mcp_schema`）。门禁非 enforce 模式时可省略。

## 四、连通性自检（**首次接入必须做**）

```
1. 调 list_projects          → 期望：返回 {success:true, projects:[...]}（空数组也算通）
2. 调 audit_query {"limit":1} → 期望：返回审计记录（证明写审计链路正常）
3. 调 device_query {"limit":1}→ 期望：返回设备库条目（证明 --user-data 指向正确）
```

**判读**：

| 现象 | 根因 | 处置 |
|---|---|---|
| 工具列表为空 | `--mode compiled` 且域被隐藏，或 `--user-data` 路径不存在 | 检查 user-data 是否真实存在 |
| 所有工具都返回 `confirm` | 权限表未登记该工具，`get_tool_permission` 兜底 CONFIRM | 见 `工具面清单.md` §3.2 —— 已知 14 个工具的登记缺失 |
| `run_cli` / `read_file` 找不到 | 处于 compiled 模式 | 需要这两个工具就切 `--mode source` |
| `ModuleNotFoundError: autolink_hub` | 工作目录不是 `backend/` | 修正工作目录 |

## 五、能力域（13 域，编译态可见 11）

| 域 | 编译态 | 用途 |
|---|---|---|
| `project` | ✅ | 项目清单/详情/创建/更新/删除/文件读写/导入导出 |
| `template` | ✅ | 模板清单/详情/创建更新删除/导入导出/推荐 |
| `device` | ✅ | 设备库查询、按 id 取详情、默认选型规则 |
| `design` | ✅ | 一键设计 / 配置 schema / 预设 / 容量 / ATOP / 优化 / 修复 |
| `export` | ✅ | 导出交付物与报告 |
| `validate` | ✅ | 设计校验 / 规模估算 / 示例文件解析 |
| `room` | ✅ | 机房矩阵创建/校验/智能落位/标记/上架 |
| `knowledge` | ✅ | 知识检索与写入 **+ 技能 list/view/写回/优化** |
| `system` | ✅ | 审计查询 / 交互反馈 |
| `task` | ✅ | 异步任务提交/查询/等待/取消 |
| `render` | ✅ | （域已声明，AL 侧当前无注册工具） |
| `cli` | ❌ 仅源码态 | 白名单 CLI action 透传 |
| `filesystem` | ❌ 仅源码态 | 沙箱读文件/列目录/读源码 |

> 完整 72 个工具的名 / 权限 / 参数 / 说明见 `agent-skills/工具面清单.md`。

## 六、长耗时工具（**不要重复异步**）

以下 13 个工具在 MCP 层**已自动转异步**，调用后直接返回 `task_id`：

```
generate_design      report               export_outputs     export_project
project_export       template_export      room_optimize      atop_recommend
capacity_recommend   project_import       template_import    repair_apply
optimize_apply
```

→ **直接调用**，拿 `task_id` 后用 `task_query` 轮询或 `task_wait` 阻塞等待。
→ ⚠️ **不要**再套一层 `task_submit`，会双重异步。

其余工具是同步的，直接返回结果。

## 七、下一步

- 要做「从需求到项目」全流程 → `al-design-flow`
- 要查/改项目 → `al-project-ops`
- 要选设备 → `al-device-select`
- 要算容量/拓扑 → `al-capacity-topology`
- 要机房落位 → `al-room-layout`
- 要导出交付物 → `al-export-delivery`
- 要校验和修缺陷 → `al-validate-repair`
- 要沉淀知识 → `al-knowledge-skill`
