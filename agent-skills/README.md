# MC-AL Agent Skill 体系

> 给**旁挂大模型 Agent**（Hermes / DeepSeek Harness / Claude Code / Codex / Trae Work / VS Code …）用的技能包。
> 目的：让外部 Agent 用统一的、经过验证的口径调用 **AL 规划域** 与 **MC 渲染域**，完成项目的**创建 / 设计 / 渲染 / 校验 / 评估 / 交付**全流程。

---

## 一、这是什么

`AIDC AutoLink-Client`（AL）与 `MagicCommander-Client`（MC）各自已内置 **MCP stdio Server**（Agent Connect），对旁挂 Agent 暴露工具能力。

但工具层之上缺一层**「怎么用」的知识**：什么场景调什么工具、参数怎么传、哪些坑不能踩、权限档位怎么读、结果怎么向用户解释。

**这个目录就是那层知识。**

```
旁挂 Agent
    ↓ 读取 agent-skills/*.md（本目录）
    ↓ 通过 MCP stdio 连接
┌──────────────┬──────────────┐
│ AL 规划域     │ MC 渲染域     │
│ 72 工具/13 域 │ 53 工具/11 域 │
└──────────────┴──────────────┘
```

---

## 二、目录结构

```
agent-skills/
├── README.md                    ← 本文（接入指南）
├── 工具面清单.md                 ← 事实底座：125 个工具的名/权限/参数/域
├── al/       （12 个）           ← AL 规划域
├── mc/       （10 个）           ← MC 渲染域
└── cross/    （3 个）            ← 跨端协作
```

### AL 规划域（`al/`）

| Skill | 什么时候读 |
|---|---|
| `al-connect` | **接入起点** —— 连不上 / 首次配置 / 模式选择 |
| `al-design-flow` | **主流程** —— 需求 → 设计 → 校验 → 导出 |
| `al-project-ops` | 项目与模板的查/改/建/删/导入导出 |
| `al-device-select` | 设备库查询、默认选型规则、光模块 |
| `al-capacity-topology` | 容量估算、ZCube 拓扑推荐、批量优化 |
| `al-room-layout` | 机房矩阵、机柜落位、功率约束 |
| `al-export-delivery` | 导出交付物（连接表/BOM/PDF/合规包） |
| `al-validate-repair` | 校验问题 + 智能修复闭环 |
| `al-knowledge-skill` | 知识库检索写入、技能库读写 |
| `al-report-explain` | 结果解读与汇报口径 |
| `al-async-tasks` | 异步长任务编排 |
| `al-source-mode` | 源码态 CLI 透传与文件读取 |

### MC 渲染域（`mc/`）

| Skill | 什么时候读 |
|---|---|
| `mc-connect` | **接入起点** —— 启动参数（`--workspace`）、11 域 |
| `mc-render-flow` | **主流程** —— 校验 → 预演 → 渲染 → 对比 → 标签 |
| `mc-project-ops` | 项目操作、Excel/文本读写、文件搜索 |
| `mc-template-author` | Jinja2 模板创作、反推模板、变量对齐 |
| `mc-validate-diff` | 四层校验、差异对比、回退 |
| `mc-knowledge-skill` | 知识/技能库、自学习机制 |
| `mc-export-labels` | 标签生成（Word/Markdown）、导出包、清理 |
| `mc-async-tasks` | 异步渲染任务编排 |
| `mc-source-mode` | 源码态 CLI 透传与沙箱读取 |
| `mc-report-explain` | 结果解读与渲染失败归因 |

### 跨端（`cross/`）

| Skill | 什么时候读 |
|---|---|
| `cross-hub-guide` | **双端挂载总指南** + 同名不同行为完整差异表 |
| `cross-plan-to-render` | **端到端链路** —— AL 规划 → MC 渲染 |
| `cross-troubleshoot` | **故障排查总入口** —— 分层排查树 + 已知缺陷清单 |

---

## 三、快速接入

### 3.1 挂载两个 MCP Server

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

> ⚠️ **最容易错的一处**：AL 用 `--user-data`，MC 用 `--workspace`。
> 写错会**静默用空路径** —— 工具列表正常，但查不到任何项目。

### 3.2 首次连通性自检

```
AL： list_projects → audit_query → device_query
MC： list_projects → template_list → list_skills
```

三个都返回（**空数组也算通**）即接入成功。

### 3.3 权限档位怎么读

| 档位 | 行为 |
|---|---|
| 🟢 `auto` | 直接调 |
| 🟡 `notify` | 调完告知用户改了什么 |
| 🔴 `confirm` | **先取得用户同意**；enforce 模式需 `approvalToken` |

**调用前先读工具元数据的 `require_approval` / `approval_level` 字段**，不要凭工具名猜。

---

## 四、三条硬规则（**所有 skill 共同遵守**）

### 规则 1：功能域判据

| 问「**怎么规划**」 | 问「**怎么渲染**」 |
|---|---|
| 多少台 / 什么拓扑 / 怎么摆 / 合规吗 | 出配置 / 出标签 / 模板怎么写 |
| → **AL** | → **MC** |

### 规则 2：跨端参数名不通用

| 用途 | AL | MC |
|---|---|---|
| 资产根 | `--user-data` | `--workspace` |
| 导入源 | `source` | `zipPath` |
| 导出目标 | `outputPath` | `targetDir` |
| 技能名 | `name` | `skillName` |
| 知识条数 | `top_k` | `topK` |

→ **不要假设参数名跨端一致。**

### 规则 3：长耗时工具不要重复异步

两端都有 `LONG_RUNNING_TOOLS` 清单，这些工具**在 MCP 层已自动异步**。
调用后直接拿 `task_id` → `task_wait` / `task_query` 取结果。
**不要再套 `task_submit`**（双重异步，拿不到真实结果）。

---

## 五、⚠️ 需要先知道的已知问题

这些是**已核实的事实**，遇到时不要当新缺陷排查（详见 `工具面清单.md` §3 与 `cross-troubleshoot` §3）：

### 5.1 权限登记缺失（**双端同源**）

`get_tool_permission()` 兜底值是 **CONFIRM**，未登记的工具会被当高危：

| 端 | 未登记数 | 典型 |
|---|---|---|
| AL | 14 | `list_knowledge` / `search_knowledge` / `task_*`×5 / `add_knowledge` / `audit_query` / `agent_feedback` / `project_export` / `project_import` / `template_export` / `template_import` |
| MC | 10 | `task_*`×5 / `audit_query` / `agent_feedback` / `run_cli` / `list_dir` / `read_source` |

**症状**：只读工具却要求确认。

### 5.2 AL 权限表死条目 3 个

`get_project_info` / `list_project_files` / `list_templates` —— 权限表有，**工具未注册**。
→ AL 侧请用 `project_info` / `project_list_files` / `template_list`。

### 5.3 算法口径缺陷

| 缺陷 | 表现 |
|---|---|
| 二层判据 | `k²/(2p)` 被写成 `k/(2p)` → 台数**差一半** → 256/1024/1250 台被误判三层 |
| **P-5** | QM9700 的 breakout 把**参数网也降到 200G** |
| **P-6** | `storage_ports_per_server` 单值 → 建链/层级/容量三处不同源 |
| **P-7** | 拓扑边不带 breakout → 图与连接表口径不一致 |

### 5.4 数据缺口

| 缺口 | 影响 |
|---|---|
| MC 设备库仅 **13 台** | 无 H200 / B300 / Q3400 / Spectrum-X |
| `switches/storage/` 5 台全以太 | **无 IB 存储交换机**（双端都有） |
| B300 档案自相矛盾 | 描述 2×400G vs 字段 8×800G → 以**字段**为准 |
| Q3400 描述 | 写 NDR，应为 **XDR** |

### 5.5 有意设计（**不要「修」**）

| 现象 | 真相 |
|---|---|
| INI 与 JSON 数不同 | 有意不对称（5.3.0 裁定） |
| 8 卡服务器只算 1 柜 | 正确（默认 1 柜 1 台） |
| `apply_config_preset` 未被编译态屏蔽 | 锚定匹配，`preset` ≠ `reset` |
| MC `read_file` 编译态可用 | MC 的设计（AL 不可用） |

---

## 六、事实底座

所有 skill 中引用的工具名、参数名、权限档，以 **`工具面清单.md`** 为准。

该清单为 **AST 解析 + 权限表合并**生成，**零手工录入**，含：

- AL 72 工具 / MC 53 工具，逐个列出 权限 / 必填参数 / 说明
- 按 13 / 11 个能力域分组
- **权限表与注册表的对账结论**（§3.2 缺陷明细）
- 双端同名工具清单与差异（§3.3）
- 长耗时工具清单（§3.5）

**修改工具后请重新生成该清单**（见 §八）。

---

## 七、双端规模对照（回答数量问题用）

| 项 | AL | MC |
|---|---|---|
| 工具数 | **72** | **53** |
| 能力域 | **13**（编译态可见 11） | **11**（可见 9） |
| 设备库 | **127** 台（92 硬件 + 35 光模块） | **13** 台 |
| 模板 | **23** 套 | `example/` 目录 |
| 校验规则 | **22** 条（V001–V022） | 无 |
| CLI action | **64** | 8 个子命令 |
| hub 内置技能 | 7 个 | 7 个（+3 元数据） |
| confirm 档工具 | **7** | **17** |
| `reportData` | **12** 段 | — |
| golden 基线 | **28** 个 JSON | — |

---

## 八、维护

### 什么时候需要更新

| 变更 | 要做什么 |
|---|---|
| 新增 / 删除 / 改名工具 | 重新生成 `工具面清单.md`，更新相关 skill |
| 改动权限档 | 同上 |
| 修复 §五 中的已知缺陷 | 更新 `工具面清单.md` §3.2 与 `cross-troubleshoot` §3 |
| 版本发版 | 检查 §七 规模数字是否变化 |

### 校验脚本

```
python scripts/check_skill_refs.py
```

校验 skill 文档中引用的工具名**确实存在于工具面清单**（防止文档超前于代码）。
详见仓库 `scripts/` 目录。

### 工具面清单的生成方式

清单由 AST 解析 `agent/tools.py` 的 `register_tool(...)` 调用 + 合并 `agent/schemas.py` 的 `TOOL_PERMISSIONS` 得出。
工具变更后应**重新生成**而非手工编辑。

---

## 九、给旁挂 Agent 的加载建议

**按需加载，不要全读**：

```
刚接入          → cross-hub-guide  +  al-connect / mc-connect
做设计          → al-design-flow
做渲染          → mc-render-flow
端到端          → cross-plan-to-render
出问题          → cross-troubleshoot
查事实          → 工具面清单.md
```

**最小可用集**（只读查询场景）：
`cross-hub-guide` + `工具面清单.md`

**完整集**（全流程交付场景）：
全部 25 份

---

## 十、Skill 格式

每份 skill 遵循标准 frontmatter 格式：

```markdown
---
name: "skill-name"
description: "一句话说明这个 skill 做什么、什么时候用。要写得能让人（和 Agent）仅凭 description 就判断该不该读它。"
---

# 正文
```

**写作约定**：

- 工具名一律**写规范名**且用反引号（不依赖 `TOOL_NAME_ALIASES` 别名纠正 —— 别名表两端不一致）
- 已知缺陷用 ⚠️ 标出，并同时给出**影响面**与**处置办法**
- 每个 skill 结尾必须有「常见坑」表与「下一步」链接
- 涉及数字的事实须与 `工具面清单.md` / 本文 §七 一致
