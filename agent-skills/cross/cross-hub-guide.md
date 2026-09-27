---
name: "cross-hub-guide"
description: "旁挂 Agent 接入 MC-AL 双 hub 的总指南：同时挂载 AL 规划域与 MC 渲染域两个 MCP Server、选择模式与权限档、以及双端「同名不同行为」的完整差异表。当用户问「怎么同时接两个」「AL 和 MC 有什么区别」「哪个工具该用哪端」「接入配置怎么写」时使用。这是接入的起点文档。"
---

# 双 Hub 接入总指南

## 一、两套程序的分工

```
用户需求
   ↓
┌─────────────────────────┐      ┌─────────────────────────┐
│  AL 规划域               │      │  MC 渲染域               │
│  AutoLink-Client        │      │  MagicCommander-Client  │
│                         │      │                         │
│  GPU 规模 → 组网规划     │ ───→ │  Excel + 模板 → 设备配置 │
│  · 拓扑设计 / 选型       │ plan │  · 配置渲染 / 标签       │
│  · 机房落位              │ table│  · 差异对比 / 撤销       │
│  · 交付物导出（12 段）   │ v1.3 │  · 反推模板              │
│  · 22 条校验规则         │      │  · 模板语法/数据校验     │
└─────────────────────────┘      └─────────────────────────┘
```

**衔接契约**：`plan:table v1.3`

> **一句话判据**：
> - 问「**怎么规划**」（多少台、什么拓扑、怎么摆、合规吗）→ **AL**
> - 问「**怎么渲染**」（出配置、出标签、模板怎么写）→ **MC**

## 二、挂载两个 MCP Server

```json
{
  "mcpServers": {
    "autolink": {
      "command": "python",
      "args": ["-m", "autolink_hub.mcp_server.run",
               "--mode", "compiled",
               "--user-data", "<AL 用户数据目录>"]
    },
    "magiccommander": {
      "command": "python",
      "args": ["-m", "ai_hub.mcp_server.run",
               "--mode", "compiled",
               "--workspace", "<MC 工作区目录>"]
    }
  }
}
```

### ⚠️ 两个必须核对的地方

| | AL | MC |
|---|---|---|
| **模块名** | `autolink_hub.mcp_server.run` | `ai_hub.mcp_server.run` |
| **资产根参数** | **`--user-data`** | **`--workspace`** |

→ 参数名写错会**静默用空路径**，工具列表正常但查不到任何项目。

**工作目录**：AL 要在 `backend/`（`autolink_hub` 的父目录）；MC 要在 `ai_hub` 的父目录。

## 三、模式与权限

两端**同构**三级权限：

| 档位 | AL 数量 | MC 数量 |
|---|---|---|
| 🟢 auto | 33 | 19 |
| 🟡 notify | 32 | 17 |
| 🔴 confirm | 7 | **17** |

> MC 的 confirm 更多，因为**渲染本身就是写文件**。

**模式选择建议**：

| 场景 | 模式 |
|---|---|
| 让 Agent 用产品能力做设计/渲染 | `compiled` |
| 需要 CLI 透传 / 读源码 | `source` |
| 只做查询 | `compiled`（够用） |

## 四、⚠️ 双端「同名不同行为」完整差异表（**最重要的一节**）

### 4.1 工具行为差异

| 工具名 | AL | MC | 影响 |
|---|---|---|---|
| `read_file` | 🔴 confirm，**仅源码态** | 🟢 **auto，两模式都可用** | 别假设「读文件都要确认」 |
| `export_project` | 🟡 notify | 🟢 **auto** | MC 只打包不写项目文件 |
| `create_project` | 🟡 notify，走默认配置 | 🟡 notify，**别名指向 `create_project_intelligent`** | 别用 `create_project` 传模板 |
| `render_config` | 无 | 🔴 confirm | AL 无渲染工具 |
| `validate_design` | 🟢 auto，22 条规则 | 无 | MC 无设计合规校验 |
| `validate_template` | 无 | 🟢 auto | AL 无 Jinja2 校验 |
| `search_knowledge` 条数参数 | `top_k` | **`topK`** | 跨端写错参数名 |

### 4.2 参数名差异（**写跨端 skill 必须查这张表**）

| 用途 | AL | MC |
|---|---|---|
| 导入源 | **`source`** | **`zipPath`** |
| 导出目标 | **`outputPath`** | **`targetDir`** |
| 资产根（启动） | **`--user-data`** | **`--workspace`** |
| 项目名 | `projectName` | `projectName` ✅ |
| 模板名 | `templateName` | `templateName` ✅ |
| 技能名 | `name` | **`skillName`** |
| 知识条数 | `top_k` | **`topK`** |

### 4.3 别名路由差异

| 外部 Agent 写的 | AL 路由到 | MC 路由到 |
|---|---|---|
| `create_project` | `project_create` | **`create_project_intelligent`** |

→ **同一句话在两端路由到不同实现**（AL 走默认配置、MC 走智能创建）。

### 4.4 技能自学习机制差异

| | AL | MC |
|---|---|---|
| 触发 | 主动调用即追加 | **达失败阈值自动触发** |
| 存储 | 单一状态文件 `_state_dir()` | **per-skill `.meta.json`** |
| 接口 | `append_learning_record` | `maybe_self_improve` |
| 版本号 | 无 | **有修订版本计数** |

> **两套机制不互通**，跨端迁移技能时注意。

### 4.5 长耗时工具清单差异

**共同**（双端都自动异步）：`export_project` / `import_project`

**AL 独有**（13 个）：`generate_design` / `report` / `export_outputs` / `project_export` / `template_export` / `room_optimize` / `atop_recommend` / `capacity_recommend` / `template_import` / `repair_apply` / `optimize_apply`

**MC 独有**：`render_config` / `render_yaml` / `generate_labels` / `generate_label_md` / `reverse_engineer_config` / `create_project_intelligent`

→ 判据：**别猜，看 `LONG_RUNNING_TOOLS` 清单**；写 skill 时两头都列上。

## 五、⚠️ 双端共同的已知缺陷（会同时踩）

| 缺陷 | 表现 | 影响 |
|---|---|---|
| **权限表登记缺失** | AL 14 个 / MC 10 个工具未登记 → 兜底 **confirm** | 只读工具被当高危 |
| **AL 权限表死条目** | `get_project_info` / `list_project_files` / `list_templates` | 调用失败 |
| **任务工具双端均未登记** | `task_*` × 5 | 双端兜底 confirm |
| **audit_query / agent_feedback 未登记** | 双端 | 兜底 confirm |

→ 遇到「明明只读却要确认」→ **先查这张表**，不要当成新缺陷报。

## 六、跨端典型链路

```
① AL：需求 → 设计 → 校验 → 导出（plan:table v1.3）
② 交给 MC：Excel 参数 + Jinja2 模板 → 渲染 → 标签 → 交付包
```

细节见 `cross-plan-to-render`。

## 七、双端规模对照（回答数量问题时用）

| 项 | AL | MC |
|---|---|---|
| 工具数 | **72** | **53** |
| 能力域 | **13**（可见 11） | **11**（可见 9） |
| 设备库 | **127** 台 | **13** 台 |
| 模板 | **23** 套 | `example/` 目录 |
| 校验规则 | **22** 条（V001–V022） | 无 |
| CLI action | **64** | 8 个子命令 |
| hub 内置技能 | 7 个 | 7 个（+3 元数据） |
| confirm 工具 | **7** | **17** |

## 八、常用 skill 索引

**AL 侧**：`al-connect` / `al-design-flow` / `al-project-ops` / `al-device-select` / `al-capacity-topology` / `al-room-layout` / `al-export-delivery` / `al-validate-repair` / `al-knowledge-skill` / `al-report-explain` / `al-async-tasks` / `al-source-mode`

**MC 侧**：`mc-connect` / `mc-render-flow` / `mc-project-ops` / `mc-template-author` / `mc-validate-diff` / `mc-knowledge-skill` / `mc-export-labels` / `mc-async-tasks` / `mc-source-mode` / `mc-report-explain`

**跨端**：`cross-hub-guide`（本文）/ `cross-plan-to-render` / `cross-troubleshoot`
