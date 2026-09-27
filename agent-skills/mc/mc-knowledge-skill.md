---
name: "mc-knowledge-skill"
description: "MC 渲染域的知识库与技能库操作：检索/写入领域事实、列出/查看技能、启用禁用、更新技能、技能自学习修订。当用户说「知识库有什么」「把这条规范存起来」「查一下华为 VLAN 配置规范」「有哪些技能」「改进这个技能」时使用。含「知识是事实、技能是操作指引」的分工与 MC 独有的自学习阈值机制。"
---

# MC 知识库与技能库

## 一、⚠️ 核心分工：「知识」vs「技能」

| | 知识（Knowledge） | 技能（Skill） |
|---|---|---|
| **是什么** | **事实** —— 领域知识、规范、厂商语法 | **操作指引** —— 步骤、流程、「怎么做事」 |
| 例 | 「华为 VLAN 配置是 `vlan batch 10 20`」 | 「渲染前先跑 dry_run」 |
| 存哪 | 知识库 | 技能库 |
| 何时用 | 回答事实性问题 | 执行任务时 |

**判据**（回答「该存哪个」）：

> 这句话**是陈述一个事实**，还是**指导一个动作**？
> 事实 → `add_knowledge`；动作 → `update_skill`。

## 二、知识库

```
list_knowledge   {"category": "...", "project": "..."}       🟢 auto
search_knowledge {"query": "华为 VLAN 配置", "topK": 5}       🟢 auto
add_knowledge    {"title": "...", "content": "...", "category": "...", "tags": [...]}  🟡 notify
```

- `list_knowledge` 返回：标题 / 分类 / 标签 / 关联项目
- `search_knowledge` 返回 Top-K（**含内容全文**）
- **写入后按相关度自动注入后续对话上下文**

### 检索策略

> 回答**领域事实**问题（厂商语法、规范、参数含义）时**先 `search_knowledge`**。

MC 的知识库存的是**本项目积累的口径**，可能与通用知识不同。

### 参数名注意

`search_knowledge` 的条数参数是 **`topK`**（驼峰），别名支持 `top_k` / `tag` / `keyword`。
`add_knowledge` 的标签参数是 **`tags`**（数组），别名支持 `tag` / `tag_list`。

## 三、技能库

```
list_skills    {}                              🟢 auto
get_skill      {"skillName": "..."}            🟢 auto
enable_skill   {"skillName": "..."}            🟡 notify
disable_skill  {"skillName": "..."}            🟡 notify
update_skill   {"skillName": "...", "content": "..."}   🟡 notify
skill_optimize {"skillName": "..."}            🟡 notify
```

| 工具 | 语义 |
|---|---|
| `list_skills` | 名称 / 启用状态 / **使用统计** |
| `get_skill` | 单个技能**含内容全文** |
| `enable_skill` | 恢复进入 AI 上下文 |
| `disable_skill` | 不再进入 AI 上下文，**保留文件不删除** |
| `update_skill` | 创建或覆盖技能内容，**立即进入 AI 上下文** |
| `skill_optimize` | **触发自学习修订** |

> ⚠️ 参数名是 **`skillName`**（不是 `name`）。别名 `skill` / `skill_name` 可自动纠正。

## 四、⚠️ MC 的自学习机制（**与 AL 不同**）

```
skill_optimize {"skillName": "..."}
```

**触发条件**：**达阈值**（**失败次数 / 失败率**）时，才向技能 Markdown **尾部追加**结构化改进记录 + **递增修订版本**。

| | MC | AL |
|---|---|---|
| 触发 | **达失败阈值自动触发** | 主动调用即追加 |
| 存储 | **per-skill `.meta.json`** | **单一状态文件** `_state_dir()` |
| 动作 | `maybe_self_improve` | `append_learning_record` |
| 版本号 | **有修订版本计数** | 无 |

→ 用户问「技能怎么自学习」时按 MC 的机制答（**阈值驱动 + 修订版本**），别说成 AL 的。
→ **跨端迁移技能时，两套机制不互通**（5.0.3-503-b 双端各自实现）。

「反复失败 / 质量下降」→ 用 `skill_optimize`。

## 五、⚠️ 三层「技能」别混淆

| 层 | 位置 | 谁用 |
|---|---|---|
| **MC hub 内置技能** | `ai_hub/skills/skills/*.md` | 注入 hub 自己的 system prompt（产品内 AI 助手） |
| **MC hub 技能元数据** | `ai_hub/skills/skills/*.meta.json` | 自学习修订计数 |
| **外部 Agent 技能** | `agent-skills/mc/*.md`（本目录） | 旁挂 Agent 自己加载 |

### MC hub 内置技能清单

`analyze-and-optimize` / `create-from-template` / `enhance-template` / `generate-labels` / `render-and-validate` / `reverse-engineer` / `update-excel-data`

（另有 `create_project_intelligent.meta.json` / `delete_project.meta.json` / `list_projects.meta.json` —— 这三个是**工具级技能**，只有元数据）

→ 用户说「改一下某技能」→ **先问是哪一层**。

## 六、审计与反馈

```
audit_query    {"agent": "...", "tool": "...", "result": "ok", "limit": 20}   🟢 auto（权限表缺失→confirm）
agent_feedback {"tool": "...", "result": "error", "notes": "..."}            🟢 auto（权限表缺失→confirm）
```

- `audit_query`：按 `agent` / `tool` / `result`（`ok` / `error` / `idempotent`）过滤，返回脱敏入参摘要 / 耗时 / 模式
- `agent_feedback`：交互失败时上报 → 沉淀到知识库 `agent-feedback` 类目 → 返回针对该工具的优化建议

> ⚠️ **MC 的 `audit_query` / `agent_feedback` 权限表未登记，兜底为 confirm**（与 AL 同源缺陷）。
> → 若被要求确认，属**已知登记缺陷**，正常放行。

→ **工具调用失败时主动 `agent_feedback`**，这是产品自我改进的入口。

## 七、常见坑

| 坑 | 正解 |
|---|---|
| 把操作步骤存成知识 | 步骤应存技能（`update_skill`） |
| 把事实存成技能 | 事实应存知识（`add_knowledge`） |
| 参数写 `name` | 技能用 `skillName` |
| 以为 `disable_skill` 会删技能 | 只控制是否进上下文 |
| 用 AL 的机制描述 MC 自学习 | MC 是**阈值驱动 + 修订版本** |
| 分不清三层技能 | 先问用户是哪一层 |
| 工具报错就重试 | 先 `agent_feedback` 上报 |

## 下一步

- 渲染流程 → `mc-render-flow`
- 接入 → `mc-connect`
- 跨端机制差异 → `cross-hub-guide`
