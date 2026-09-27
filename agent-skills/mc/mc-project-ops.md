---
name: "mc-project-ops"
description: "MC 渲染域的项目操作：查项目、看结构、改元数据、建/删项目、导入导出、Excel 与文本文件读写、文件搜索。当用户说「有哪些项目」「这个项目结构」「建个项目」「改项目描述」「读一下这个 Excel」「导出差分包」时使用。含 create_project 与 create_project_intelligent 的关键分流。"
---

# MC 项目操作

## 一、⚠️ 建项目：两个工具，**先看这张表**

| 你要做 | 用这个 | 说明 |
|---|---|---|
| **从模板中心（example 目录）建项目** | `create_from_template` | 指定 `projectName` + `templateName` |
| **智能创建（按设备类型+厂商生成模板和 Excel）** | `create_project_intelligent` | 按 `deviceType`（switch/router/firewall）+ `vendor`（huawei/cisco/h3c）**自动生成** j2 模板与参数表 |
| 从 example 目录复制模板项目 | `create_project` | ⚠️ **别名指向 `create_project_intelligent`** |

**关键**：
- `create_project` 的官方描述写「**仅用于从 example 目录复制模板项目**。从模板中心创建项目请使用 `create_project_intelligent`」
- 但 `TOOL_NAME_ALIASES` 里 `create_project → create_project_intelligent` —— **名字和行为不一致**
- → **外部 Agent 一律显式用 `create_from_template` 或 `create_project_intelligent`，不要用 `create_project`**

### 创建示例

```
create_from_template {"projectName": "新项目", "templateName": "模板名"}

create_project_intelligent {
  "projectName": "新项目",
  "deviceType": "switch",       # switch / router / firewall
  "vendor": "huawei"            # huawei / cisco / h3c
}
```

两者都 🟡 **notify**。

> ⚠️ `create_project_intelligent` 生成的模板**是骨架**，需要 `update_template` 微调后才能渲染。

## 二、查询（🟢 auto）

```
list_projects      {}                                   → 全部项目及结构
get_project_info   {"projectName": "..."}               → 目录结构 / 文件列表 / 子目录是否存在
list_project_files {"projectName": "..."}               → 目录树（含子目录）
analyze_project    {"projectName": "..."}               → 模板复杂度 / 变量使用 / 数据质量 / 交叉引用 + 优化建议
```

`analyze_project` 是**质量体检**工具 —— 用户问「这个项目质量怎么样 / 有什么问题」时用它。

## 三、文件读写

### Excel

```
read_excel  {"projectName": "...", "excelName": "params.xlsx", "sheetName": "Sheet1"}   🟢 auto
write_excel {"projectName": "...", "excelName": "params.xlsx", ...}                     🟡 notify
```

`read_excel` 返回**表头 + 数据行**。

→ 排查渲染失败时，**用 `read_excel` 逐字比对表头与模板变量名**（MC 渲染最常见的坑）。

### 文本文件

```
write_text_file {"projectName": "...", "filePath": "templates/new.j2", "content": "..."}  🟡 notify
read_file       {"projectName": "...", "filePath": "templates/new.j2"}                     🟢 auto
```

`write_text_file` 是**创建或覆盖**（不是合并）。
`read_file` 两种模式（与 AL 不同，MC 的 `read_file` 是 🟢 auto）：

| 调用 | 可用性 | 说明 |
|---|---|---|
| `projectName` + `filePath` | 两模式 | 项目内相对路径 |
| `path` | 仅源码态 | 沙箱内任意路径 |

### 搜索

```
search_files {"projectName": "...", "query": "xxx"}    🟢 auto
```

按**名称或内容**搜索项目文件。用户说「哪个文件里有 XX」时用。

## 四、改元数据

```
update_project {"projectName": "...", "description": "新描述"}
update_project {"projectName": "...", "meta": {"deviceType": "switch", "tags": ["机房A"]}}
```

改的是 **`template.meta.json`**：
- 给 `description` → 更新项目描述
- 给 `meta` → **合并**额外元数据字段

🟡 notify。⚠️ 改的是**元数据**，不是模板内容 —— 改模板用 `update_template`。

## 五、导入导出

```
export_project {"projectName": "...", "targetDir": "D:/out"}     🟢 auto
import_project {"zipPath": "D:/in/xxx.zip", "projectName": "..."} 🟡 notify
```

- `export_project` 默认导到 **`workspace/_exports/<项目名>.zip`**，可用 `targetDir` 指定
- `export_project` 是 🟢 **auto**（只打包不写项目文件）
- `import_project` 解压到 `workspace/<项目名>`，**内置 zip-slip 路径穿越防护**

> MC 的导入参数名是 **`zipPath`**（AL 是 `source`）—— 跨端写 skill 时注意。

## 六、删除（🔴 全 confirm）

```
delete_project {"projectName": "..."}
delete_files   {"projectName": "...", "fileType": "output"}     # projectName 可传 "all"
delete_labels  {"projectName": "..."}                            # projectName 可传 "all"
```

`delete_files` 的 `fileType` 取值：`output`（设备配置，默认）/ `yaml` / `output-sn` / `yaml-sn`

**⚠️ `projectName: "all"` 会清空所有项目** —— 这是最危险的参数，**必须**向用户明示范围并二次确认。

调用前必做：
1. 说清项目名 + 删除范围 + 不可恢复
2. `"all"` 要额外强调「将影响全部项目」
3. 拿到明确同意
4. enforce 模式带 `approvalToken`

## 七、⚠️ MC / AL 参数名差异表（跨端必看）

| 用途 | AL 参数 | MC 参数 |
|---|---|---|
| 项目名 | `projectName` | `projectName` ✅ 同 |
| 模板名 | `templateName` | `templateName` ✅ 同 |
| 导入源 | **`source`** | **`zipPath`** ❌ 异 |
| 导出目标 | **`outputPath`** | **`targetDir`** ❌ 异 |
| 文件路径 | `filePath` | `filePath` ✅ 同 |
| 资产根（启动参数） | **`--user-data`** | **`--workspace`** ❌ 异 |

→ 写跨端 skill 时**不要假设参数名通用**。

## 八、常见坑

| 坑 | 正解 |
|---|---|
| 用 `create_project` 期望「从模板中心创建」 | 用 `create_from_template` 或 `create_project_intelligent` |
| 用 `update_project` 改模板内容 | 改元数据用 `update_project`，改模板用 `update_template` |
| `delete_files` 传 `"all"` 不强调 | 会清空所有项目，必须二次确认 |
| 以为 `export_project` 是 notify | 是 🟢 auto（只打包） |
| 跨端假设参数名一致 | 见 §7 差异表（`source`/`zipPath`、`outputPath`/`targetDir`） |
| 排查渲染失败不读 Excel 表头 | `read_excel` 逐字比对 |

## 下一步

- 要渲染 → `mc-render-flow`
- 要改模板 → `mc-template-author`
- 要读知识/技能 → `mc-knowledge-skill`
