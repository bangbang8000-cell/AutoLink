---
name: "mc-validate-diff"
description: "MC 渲染域的校验与差异对比：模板语法校验、Excel 数据校验、项目质量分析、渲染结果差异对比。当用户说「校验一下模板」「Excel 数据有问题吗」「这个项目质量怎么样」「渲染结果和上次比改了什么」时使用。含四层校验的分工、交叉引用检查、以及校验全绿但渲染出错时的排查路径。"
---

# MC 校验与差异对比

## 一、四层校验（**分工不同，别只跑一个**）

| 工具 | 权限 | 查什么 | 层次 |
|---|---|---|---|
| `validate_template` | 🟢 auto | **Jinja2 模板语法** | 语法层 |
| `validate_excel` | 🟢 auto | **Excel 参数格式与取值** | 数据层 |
| `analyze_project` | 🟢 auto | **模板复杂度 / 变量使用 / 数据质量 / 交叉引用** | **契约层** |
| `diff_compare` | 🟢 auto | **渲染结果 vs 已有输出** | 结果层 |

**关键认知**：

> 前两个各查一半，**第三个才查两者的契约**。
> 最常见的渲染失败（变量名不一致）**前两个都查不出来**，只有 `analyze_project` 能抓到。

## 二、用法

```
validate_template {"projectName": "...", "templatePath": "templates/ASW.j2"}
validate_excel    {"projectName": "...", "excelName": "params.xlsx", "sheetName": "Sheet1"}
analyze_project   {"projectName": "..."}
diff_compare      {"projectName": "..."}
```

全部 🟢 **auto**，可随时调，无副作用。

### `analyze_project` 返回什么

- **模板复杂度**（嵌套深度、变量数量）
- **变量使用**（哪些定义了没用 / 用了没定义）
- **Excel 数据质量**（空值、类型、重复行）
- **模板与参数表交叉引用** ← **最有价值的一块**
- 优化建议报告

→ 用户问「这个项目质量怎么样 / 有什么要改的」时用它。

## 三、`diff_compare` — 差异对比

```
diff_compare {"projectName": "..."}
```

对比**当前渲染结果**与**已有输出**的差异。

**典型场景**：
- 用户改了 Excel / 模板，问「会影响哪些设备的配置」
- 重新渲染前想预览变化范围

**注意**：它对比的是**渲染结果**，不是模板本身。
想对比模板版本差异 → 直接 `read_file` 读两个版本人工比，或用源码态 `run_cli` 的 `diff` 子命令。

## 四、⚠️ 校验全绿但渲染仍出错时（**按这个顺序查**）

```
1. read_excel        → 拿到确切表头
2. read_file (模板)  → 拿到 {{ 变量 }}
3. 逐字比对          → 含空格 / 大小写 / 下划线 / 全半角
4. dry_run           → 看实际渲染输出
5. 若 dry_run 正常但 render_config 出错 → 看输出目录权限 / 是否有文件占用
```

> **判据**：`validate_template` + `validate_excel` 都过，但 `dry_run` 报 `UndefinedError`
> → **100% 是变量名不一致**，不是语法或数据问题。

## 五、模型层校验（AL 的能力，MC 没有）

MC **不提供** AL 那套规则校验（V001–V022）。跨端场景下：

| 要查 | 在哪做 |
|---|---|
| 模板语法 / Excel 数据 / 交叉引用 | **MC**（`validate_*` / `analyze_project`） |
| 设计合规性（收敛比、机柜功率、光模块容量…） | **AL**（`validate_design`，22 条规则） |

→ 用户问「这个配置合规吗」→ 这是 **AL 的活**，MC 侧只能查模板/数据层面。
→ 见 `cross-hub-guide` 与 `al-validate-repair`。

## 六、⚠️ MC 侧的回退路径（出问题时）

```
undo_render    {"projectName": "..."}    🟡 notify
delete_files   {"projectName": "...", "fileType": "output"}   🔴 confirm
delete_labels  {"projectName": "..."}                          🔴 confirm
```

| 场景 | 用 |
|---|---|
| 渲染错了想回到上一次 | `undo_render`（**只撤最近一次**） |
| 清掉渲染产物重来 | `delete_files`（🔴 confirm） |
| 清掉标签 | `delete_labels`（🔴 confirm） |

⚠️ `undo_render` 只撤一次，**不是多级回滚**。要回到更早版本要靠外部备份。
⚠️ `delete_files` / `delete_labels` 的 `projectName` 可传 **`"all"`** → **清空所有项目**，必须二次确认。

## 七、常见坑

| 坑 | 正解 |
|---|---|
| 只跑 `validate_template` 就以为校验完了 | 补 `analyze_project` 查交叉引用 |
| 校验全绿却报 `Undefined` | 变量名不一致，`read_excel` 逐字比对 |
| 以为 MC 能做设计合规校验 | V001–V022 是 AL 的能力 |
| 用 `undo_render` 做多级回滚 | 只撤最近一次 |
| `delete_files` 传 `"all"` 不强调 | 清空所有项目，必须二次确认 |
| 用 `diff_compare` 比模板版本 | 它比的是渲染结果 |

## 下一步

- 渲染 → `mc-render-flow`
- 改模板 → `mc-template-author`
- 设计合规校验 → `al-validate-repair`
