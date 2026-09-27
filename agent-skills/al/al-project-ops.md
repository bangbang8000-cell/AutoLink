---
name: "al-project-ops"
description: "AL 规划域的项目与模板日常操作：查项目、读配置、改参数、建/删项目、导入导出、模板 CRUD 与推荐、INI↔JSON 配置迁移。当用户说「有哪些项目」「这个项目什么配置」「帮我改一下这个项目的 XX」「存成模板」「导入/导出这个项目包」时使用。含同名双胞胎工具的分流判据。"
---

# AL 项目与模板操作

## ⚠️ 先看这张「双胞胎工具」分流表

AL 里有多组**功能重叠但命名不同**的工具，混用会拿错结果或改错文件：

| 你要做的事 | 用这个 | 别用这个 |
|---|---|---|
| 列项目 | `project_list` 或 `list_projects` | — （两者等价，`list_projects` 是跨端统一名） |
| 看项目详情 | `project_info` | `get_project_info`（**AL 未注册，是权限表死条目**） |
| 列项目文件 | `project_list_files` | `list_project_files`（**同上，未注册**） |
| 看模板详情 | `template_view` 或 `preview_template` | `get_template`（未注册） |
| 列模板 | `template_list` | `list_templates`（**同上，未注册**） |
| 建项目 | `create_project`（无模板）／`create_from_template`（带模板） | `project_create`（旧别名，行为同 `create_project`） |
| 删项目 | `delete_project`（🔴 confirm） | `project_delete`（🔴 confirm，旧别名） |

> **规律**：`<名词>_<动词>` 是旧命名，`<动词>_<名词>` 是跨端统一新命名。**新写 skill 一律用新命名**。
> `get_project_info` / `list_project_files` / `list_templates` 在 AL 权限表里躺着但**工具没注册**，调用会失败 —— 这是已知的移植遗留（见 `工具面清单.md` §3.2）。

## 一、查询（🟢 全部 auto，放心调）

```
project_list                              → 项目摘要（名称/描述/时间/是否含配置）
project_info   {"name": "..."}            → 完整 ProjectConfig + 宽松校验摘要
project_list_files {"projectName": "..."} → 项目目录下所有文件（路径 + 大小）
project_read_file {"projectName":"...", "filePath":"project_config.json"}
                                          → 项目内文本文件内容（防目录穿越）
template_list                             → 模板清单 + 规模摘要
template_view  {"name": "..."}            → 模板完整 ProjectConfig
```

**典型顺序**：「这个项目什么配置」→ `project_info`；
想知道目录里有什么 → `project_list_files`；
要读某个非配置文件 → `project_read_file`。

## 二、模板推荐（🟢 auto）

```
template_recommend {"protocol": "IB", "gpuModel": "H200", "scale": 1250}
```

按 参数网协议 / GPU 型号 / 规模（**GPU 服务器台数**）打分排序。

**判据**：
- 用户只说「用哪个模板」→ 直接 `template_recommend`
- 用户要「看全部」→ `template_list`
- 用户已报出模板名 → 跳过推荐，直接 `preview_template` 确认内容

## 三、项目改动（🟡 notify —— 改完必须告诉用户改了什么）

### 改参数（推荐路径）

```
project_info      {"name": "万卡-H200-QM9700-三层-IB"}       ← 先读当前配置
update_project    {"projectName": "万卡-H200-QM9700-三层-IB",
                   "config": {"topology": {"num_gpu_servers": 1024}}}
```

`update_project` 做的是 **overlay 深度合并**，只写你给的那几个键，其余不动。
→ **先读再合并**是硬要求：不读就写会把用户已有配置改瞎。

### 直接写文件（谨慎）

```
project_write_file {"projectName":"...", "filePath":"project_config.json", "content":"<全文>"}
```

⚠️ **覆盖语义**，不是合并。只在需要写非配置文件（如补一份设计说明 `.md`）时用。
写 `project_config.json` 请走 `update_project`。

### 新建

```
create_project       {"projectName": "...", "description": "..."}                  # 默认配置
create_from_template {"projectName": "...", "templateName": "...", "description": "..."}
```

⚠️ `create_project` **不吃 `templateName`** —— 要带模板必须用 `create_from_template`。

### 删除（🔴 confirm）

```
delete_project {"projectName": "..."}
```

**不可恢复。** 调用前必须：
1. 明确告诉用户「项目名 + 不可恢复」
2. 拿到用户明确同意
3. enforce 模式下带 `approvalToken`

> 编译态下破坏性工具被语义规则屏蔽，但**权限档位仍是 confirm** —— 别因为 compiled 模式下没看到 `*_delete` 就以为可以不问用户。

## 四、模板 CRUD（🟡 notify / 删除 🔴）

```
template_create {"templateName":"...", "config": {...}, "description":"...", "overwrite": false}
template_update {"templateName":"...", "config": {...}}
template_delete {"templateName":"...", "overwrite": ...}     ← 🔴 confirm
```

**关键约束**：
- **内置模板只读**：`template_update` / `template_delete` 对内置模板会拒绝。要改内置模板 → 先 `template_create` 存成用户模板再改。
- 删内置模板会被拒，**要向用户解释「这是内置模板不能删」**，而不是报「失败了」。
- `template_create` 的 `config` 从 `project_info` 或 `generate_project` 的结果取。
- 重名默认拒绝，`overwrite: true` 才覆盖。

## 五、导入导出（🟡 notify + 长耗时）

```
export_project  {"projectName": "...", "outputPath": "D:/out/xxx.zip"}
template_export {"name": "...", "outputPath": "D:/out/xxx.zip"}

import_project  {"source": "D:/in/xxx.zip", "projectName": "...", "overwrite": false}
template_import {"source": "D:/in/xxx.zip", "name": "...", "overwrite": false}
```

**行为差异（重要）**：
- **给了 `outputPath`** → 打包成 zip 落盘
- **不给 `outputPath`** → **返回文件清单 + 内容**（不落盘，适合让 Agent 直接读内容）

→ 所以「把项目包内容给我看看」= 不传 `outputPath`，直接拿内容，**不用先导出再解压**。

导入类工具都是长耗时 → 自动异步 → `task_wait`。

## 六、INI ↔ JSON 配置迁移（🟡 notify）

```
project_config_migrate {"projectDir": "<项目目录绝对路径>"}   # INI → JSON
project_config_to_ini  {"config": "<project_config.json 路径>"} # JSON → INI
```

**⚠️ 血训：两条初始化路径不对称是有意设计，不要「修」它。**

AL 的 `port_count − uplinks` 只走 **JSON 路径**，INI 路径不做这个减法。
这是历史口径裁定（5.3.0 D1–D5），**不是缺陷**。
→ 用 `project_config_migrate` 把 INI 转 JSON 后，**数值可能变**，要向用户说明。

## 七、配置 schema 与预设

```
list_config_schema  {}                                    → 统一配置 schema + 预设清单
apply_config_preset {"presetId":"ib-allflash", "config":"<当前配置 JSON 路径>"}
```

可用预设：`ib-allflash` / `roce-general` / `l20-inference` / `uec-datacenter`

→ 回答「有哪些配置项 / 有什么预设」时用 `list_config_schema`（🟢 auto）。
→ 应用预设是 🟡 notify 写操作，**先问用户要哪个预设**。

## 常见坑

| 坑 | 正解 |
|---|---|
| 调 `get_project_info` / `list_project_files` / `list_templates` | 这三个在 AL **未注册**，用 `project_info` / `project_list_files` / `template_list` |
| 用 `create_project` 传 `templateName` | 改用 `create_from_template` |
| 不先读就 `update_project` | overlay 合并虽安全，但用户可能已改过 → 先 `project_info` |
| `project_write_file` 写 `project_config.json` | 用 `update_project`（合并）而非全量覆盖 |
| 改内置模板 | 内置只读 → 先 `template_create` 另存用户模板 |
| 以为 INI/JSON 数值应一致 | **有意不对称**，勿修 |
| 导出时自己先落盘再读内容 | 不传 `outputPath` 直接拿内容 |

## 下一步

- 要设计/重跑设计 → `al-design-flow`
- 要校验并修缺陷 → `al-validate-repair`
- 要导出交付物 → `al-export-delivery`
