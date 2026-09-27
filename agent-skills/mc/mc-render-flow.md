---
name: "mc-render-flow"
description: "MC 渲染域主流程：把 Excel 参数 + Jinja2 模板渲染成设备配置。当用户说「渲染配置」「生成设备配置」「预演一下」「渲染结果和上次有什么不同」「撤销渲染」时使用。含 dry_run→render_config 的顺序、渲染是 confirm 档的确认点、diff_compare 与 undo_render 的用法、以及渲染失败的三类根因排查。"
---

# MC 主流程：Excel + 模板 → 设备配置

## 主干链路

```
① 确认项目结构          get_project_info / list_project_files
② 校验输入              validate_template（模板语法）+ validate_excel（参数表）
                        + analyze_project（交叉引用）
③ 预演                  dry_run          ← 🟢 auto，不写文件
④ 向用户确认            ⚠️ 必经确认点（渲染写文件）
⑤ 渲染                  render_config    ← 🔴 confirm（或 render_yaml）
⑥ 对比                  diff_compare     ← 🟢 auto
⑦ 出标签 / 导出         generate_labels / export_project
```

## ① 确认项目结构

```
list_projects    {}                                → 全部项目
get_project_info {"projectName": "..."}            → 目录结构 / 文件列表 / 各子目录是否存在
list_project_files {"projectName": "..."}          → 目录树
```

典型项目结构：

```
<workspace>/<项目名>/
  templates/      *.j2      Jinja2 模板
  excel/          *.xlsx    参数表
  output/                   渲染产物
  template.meta.json        项目元数据
```

## ② 校验输入（**渲染前必做**）

```
validate_template {"projectName": "...", "templatePath": "templates/ASW.j2"}   🟢 auto
validate_excel    {"projectName": "...", "excelName": "params.xlsx"}           🟢 auto
analyze_project   {"projectName": "..."}                                        🟢 auto
```

| 工具 | 查什么 |
|---|---|
| `validate_template` | **Jinja2 语法**是否正确 |
| `validate_excel` | **Excel 参数**格式与取值 |
| `analyze_project` | 模板复杂度 / 变量使用 / Excel 数据质量 / **模板与参数表交叉引用** |

> ⚠️ `analyze_project` 是最有价值的那个 —— 它能发现「模板里引用了 Excel 里不存在的变量」这类**交叉引用**缺陷，单跑前两个查不出来。

## ③ 预演（🟢 auto，**不写文件**）

```
dry_run {"projectName": "...", "templatePath": "templates/ASW.j2"}
```

返回渲染后的文本**预览**。

→ **任何渲染前都应先 `dry_run`**：成本低、无副作用，能提前暴露变量缺失 / 语法问题。

```
preview_template {"projectName": "...", "templatePath": "templates/ASW.j2"}   🟢 auto
```

`preview_template` 也是预览渲染结果不写文件，用于**看某个模板长什么样**（不需要完整 dry_run 上下文时用）。

## ④ 确认点（**不可跳过**）

`render_config` 是 🔴 **confirm** 档。调用前必须：

1. 把 `dry_run` 的结果摘要给用户看
2. 说明将写入哪些文件、写到哪
3. 拿到用户明确同意
4. enforce 模式带 `approvalToken`

> 渲染会**覆盖** `output/` 下已有文件。用户可能正在用旧版本 → **必须问**。

## ⑤ 渲染

```
render_config {"projectName": "...", "templatePath": "templates/ASW.j2"}   🔴 confirm
render_yaml   {"projectName": "..."}                                        🔴 confirm
```

- `render_config` → 生成**设备配置文件**
- `render_yaml` → 渲染项目的 **YAML** 文件（不同产物）

两者都是长耗时 → MCP 层自动异步 → `task_wait`。

> ⚠️ **`render_config` 别名**：外部 Agent 写 `render` 会被 `TOOL_NAME_ALIASES` 自动纠正为 `render_config`。
> ⚠️ **MC 的 `create_project` 别名指向 `create_project_intelligent`** —— 与 AL 指向 `project_create` **不同**（见 `工具面清单.md` §3.3）。

## ⑥ 对比与撤销

```
diff_compare {"projectName": "..."}                        🟢 auto
undo_render  {"projectName": "..."}                        🟡 notify
```

- `diff_compare`：**渲染结果 vs 已有输出**的差异。用户问「和上次比改了什么」时用。
- `undo_render`：**撤销最近一次渲染**，从备份恢复输出文件。

> `undo_render` **只撤一次**（最近一次），不做多级回滚。要回到更早版本需另有备份。
> `undo_render` 是 🟡 notify —— 撤销后**必须告诉用户恢复到什么状态**。

## ⑦ 标签与导出

```
generate_labels    {"projectName": "..."}     🟡 notify → Word 格式标签
generate_label_md  {"projectName": "..."}     🟡 notify → Markdown 标签（程序内可直接看）
export_project     {"projectName": "...", "targetDir": "..."}   🟢 auto
```

- 要 Word → `generate_labels`；要**在程序里直接看** → `generate_label_md`
- `export_project` 默认导到 `workspace/_exports/<项目名>.zip`，🟢 auto（**不写项目文件，只打包**）

## 八、⚠️ 渲染失败的三类根因

| 症状 | 根因 | 排查 |
|---|---|---|
| `UndefinedError: 'xxx' is undefined` | **模板引用的变量 Excel 里没有** | `analyze_project` 查交叉引用 |
| 渲染出来是空 / 缺行 | **Excel 表头与模板变量名不一致** | `read_excel` 看表头逐字比对 |
| 语法错误 | Jinja2 模板本身写错 | `validate_template` |
| 渲染成功但内容错 | **分光/速率等口径问题** | 见下节 |

**排查顺序**：`validate_template` → `validate_excel` → `analyze_project` → `read_excel` 看原始表头。

## 九、⚠️ 分光（1分2）在 MC 的既有基准

MC **已有可复用基准**：

- 现模板即「**Leaf 400G 1分2 → 200G 下联 GPU**」
- `roce_templates.py` / `verify_baseline.py` 子口基准：`TwoHundredGigE1/0/1:1` / `:2`

→ 用户问「MC 怎么表达分光」→ **是子接口命名**（`X:1` / `X:2`），不是新建链路。
→ 扩新命令族（如 X400）应**在此基线上扩**，不要另起一套。

## 十、⚠️ MC 无华为/思科之外的缺失

- MC 设备库仅 **13 台**，**无 H200 / B300 / Q3400 / Spectrum-X**
- `project_single.py:423` **无条件产出全部角色 j2**（不能按需只出部分角色）
- `switches/storage/` 5 台全以太，**无 IB 存储交换机**

→ 用户要 H200/B300 相关渲染 → 先确认设备档案是否存在，不存在要如实说「MC 设备库没有，需要先补档案」。

## 常见坑

| 坑 | 正解 |
|---|---|
| 跳过 `dry_run` 直接渲染 | 先预演，成本低无副作用 |
| 不确认就 `render_config` | 它是 confirm 档，且覆盖 output/ |
| 渲染失败只看 `validate_template` | 补 `analyze_project` 查交叉引用 |
| 用 `undo_render` 做多级回滚 | 只撤最近一次 |
| 以为 `preview_template` 会写文件 | 不写；写文件是 `render_config` |
| 用 `create_project` 当「智能创建」 | MC 里 `create_project` 别名指向 `create_project_intelligent`，但**它只从 example 复制**；模板中心创建用 `create_project_intelligent` |
| 给长耗时渲染套 `task_submit` | 已自动异步，会双重异步 |

## 下一步

- 要建/改项目 → `mc-project-ops`
- 要写模板 → `mc-template-author`
- 要跨端接 AL 输出 → `cross-plan-to-render`
