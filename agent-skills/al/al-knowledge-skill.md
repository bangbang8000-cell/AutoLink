---
name: "al-knowledge-skill"
description: "AL 规划域的知识库与技能库操作：检索/写入知识条目、列出/查看/启用禁用技能、写回与优化技能定义。当用户说「知识库里有什么」「把这段经验存起来」「查一下 RoCE 收敛比的规范」「有哪些技能」「改进这个技能」时使用。含「先检索再作答」的注入策略与技能自学习闭环。"
---

# AL 知识库与技能库

## 一、知识库（list / search / add）

```
list_knowledge   {"category": "设计规范", "project": "..."}      🟢 auto
search_knowledge {"query": "RoCE 收敛比", "top_k": 5}            🟢 auto
add_knowledge    {"name": "...", "content": "...", "metadata": {...}}  🟡 notify
```

### 检索策略（**硬要求**）

> 回答**专业设计 / 选型 / 规范类**问题时，**先 `search_knowledge` 再作答**。

不要凭模型知识回答规范问题 —— 知识库里存的是**本产品的口径**，可能与通用知识不同。

`search_knowledge` 返回 Top-K（默认 5）命中：标题 / 内容摘要 / 分类 / 标签。

### 写入

```
add_knowledge {
  "name": "roce-convergence",
  "content": "<markdown 全文>",
  "metadata": {"title":"RoCE 收敛比规范","category":"设计规范","project":"...","tags":["roce","收敛比"]}
}
```

- `name` **唯一**（如 `roce-convergence`）
- 落盘为 `<name>.md` + 伴生 metadata
- 🟡 notify：写完告诉用户存了什么

> 用户说「把这段经验/规范存起来」时用这个，**不要**用 `project_write_file`（那写到项目里，不是知识库）。

## 二、技能库（list / view / 启停 / 写回 / 优化）

```
skill_list        {}                       🟢 auto   → 名称/是否启用/使用次数/最近使用
skill_view        {"name": "..."}          🟢 auto   → 技能内容（markdown）
skill_set_enabled {"name":"...", "enabled": true}  🟡 notify → 影响是否注入 system prompt
skill_update      {"name":"...", "content":"..."}  🟡 notify → 写入/更新技能定义
skill_save        {"name":"...", "content":"..."}  🟡 notify → skill_update 的别名
skill_optimize    {"name":"...", "notes":"..."}    🟡 notify → 追加「自学习改进记录」
```

### 关键语义

| 工具 | 说明 |
|---|---|
| `skill_set_enabled` | **只影响是否注入 system prompt**，不删文件 |
| `skill_update` / `skill_save` | 行为**完全相同**，`skill_save` 是别名 |
| `skill_optimize` | 不覆写正文，**追加**结构化「自学习改进记录」（原因/措施/详情）+ 刷新元数据 |

### 自学习闭环

```
任务完成 → skill_optimize {"name":"design-and-validate","notes":"本次发现 X 参数需先读再写"}
         → 技能定义追加一条改进记录
         → 下次该技能被用时带上这条经验
```

> ⚠️ AL 的引擎用**单一状态文件**（`_state_dir()`）+ `append_learning_record`。
> 与 MC 的 per-skill `.meta.json` + `maybe_self_improve` **机制不同** —— 跨端迁移技能时要注意。

## 三、⚠️ 「hub 内置技能」≠「外部 Agent 技能」（**别混淆**）

AL 里有两层完全不同的「技能」：

| 层 | 位置 | 格式 | 谁用 |
|---|---|---|---|
| **hub 内置技能** | `autolink_hub/skills/skills/*.md` | 无 frontmatter 的纯 md | 注入 hub 自己的 system prompt，供产品内 AI 助手用 |
| **外部 Agent 技能** | `agent-skills/al/*.md`（本目录） | **YAML frontmatter**（`name`+`description`）+ md | 旁挂 Agent（Claude Code / Codex / Hermes / DeepSeek Harness）读 |

- hub 内置技能**通过 `skill_update` 工具**读写
- 外部 Agent 技能**是文件**，Agent 自己加载

→ 用户说「改一下某技能」时要**先问清是哪一层**。

### hub 内置技能当前 7 个

`create-from-template` / `design-and-validate` / `device-selection` / `export-outputs` / `parse-examples` / `requirements-generation` / `room-layout`

## 四、审计与反馈

```
audit_query    {"agent": "...", "tool": "...", "result": "ok", "limit": 20}   🟢 auto
agent_feedback {"tool": "...", "result": "error", "notes": "..."}             🟢 auto
```

- `audit_query`：查 Agent Connect 操作审计（脱敏入参摘要 / 耗时 / 模式）。`result` 可取 `ok` / `error` / `idempotent`
- `agent_feedback`：**交互失败时上报**，会沉淀到知识库 `agent-feedback` 类目并返回优化建议

> ⚠️ **`agent_feedback` 的权限档在权限表里缺失，兜底为 confirm**（见 `工具面清单.md` §3.2）。
> 若被要求确认，属已知登记缺陷，正常放行即可。

→ **工具调用失败时主动 `agent_feedback`**，这是产品自我改进的入口。

## 五、常见坑

| 坑 | 正解 |
|---|---|
| 规范类问题凭模型知识答 | 先 `search_knowledge` |
| 用 `project_write_file` 存知识 | 用 `add_knowledge`（进知识库） |
| 以为 `skill_set_enabled` 会删技能 | 只控制是否注入 prompt |
| 分不清 hub 技能与 Agent 技能 | 先问用户是哪一层 |
| `skill_optimize` 想覆写正文 | 它只**追加**改进记录 |
| 工具报错就重试 | 先 `agent_feedback` 上报 |

## 下一步

- 全流程入口 → `al-design-flow`
- 接入与自检 → `al-connect`
