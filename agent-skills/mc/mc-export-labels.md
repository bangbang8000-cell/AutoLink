---
name: "mc-export-labels"
description: "MC 渲染域的产物输出：生成 Word / Markdown 设备标签、导出项目包、清理输出文件。当用户说「出标签」「生成设备标签」「导出差分包」「清掉输出」「重新出一次」时使用。含 Word 与 Markdown 标签的选用判据、清理操作的危险参数、以及导出包的落点。"
---

# MC 产物输出与清理

## 一、标签生成

```
generate_labels    {"projectName": "..."}    🟡 notify → Word（.docx）
generate_label_md  {"projectName": "..."}    🟡 notify → Markdown
```

| 要什么 | 用 |
|---|---|
| **拿去打印 / 给施工方** | `generate_labels`（Word） |
| **在程序里直接看 / 让 Agent 读** | `generate_label_md`（Markdown） |

**判据**：用户要**物理标签**（贴机柜）→ Word；用户要**看内容 / 让 AI 分析**→ Markdown。

两者都是 🟡 notify + 长耗时 → 自动异步 → `task_wait`。

## 二、导出项目包

```
export_project {"projectName": "...", "targetDir": "D:/out"}     🟢 auto
```

- **默认落点**：`workspace/_exports/<项目名>.zip`
- `targetDir` 可指定其它目录
- 🟢 **auto**（只打包，不写项目文件）

**包内容**：项目目录全量（templates / excel / output / meta）。

**导入回去**：
```
import_project {"zipPath": "D:/in/xxx.zip", "projectName": "..."}   🟡 notify
```
解压到 `workspace/<项目名>`，内置 **zip-slip 路径穿越防护**。

> ⚠️ 参数名是 **`zipPath`**（AL 用 `source`）、导出目标是 **`targetDir`**（AL 用 `outputPath`）。

## 三、⚠️ 清理操作（**危险，全 confirm**）

```
undo_render   {"projectName": "..."}                             🟡 notify
delete_files  {"projectName": "...", "fileType": "output"}       🔴 confirm
delete_labels {"projectName": "..."}                             🔴 confirm
delete_project {"projectName": "..."}                            🔴 confirm
```

### `delete_files` 的 `fileType` 取值

| 值 | 清什么 |
|---|---|
| `output` | 设备配置（**默认**） |
| `yaml` | YAML |
| `output-sn` | 设备配置（SN 变体） |
| `yaml-sn` | YAML（SN 变体） |

### ⚠️ `"all"` 参数 —— 最危险的一处

`delete_files` 和 `delete_labels` 的 `projectName` **可以传 `"all"`**：

```
delete_files {"projectName": "all", "fileType": "output"}   ← 清空所有项目的输出
delete_labels {"projectName": "all"}                         ← 清空所有项目的标签
```

**调用前必须**：
1. 明确复述：「将删除**全部项目**的 X，不可恢复」
2. 让用户**再次确认**（这是唯一需要二次确认的场景）
3. enforce 模式带 `approvalToken`

→ **能不用 `"all"` 就不用**。用户说「清掉输出」时先确认是**哪个项目**。

## 四、回退路径

| 场景 | 用 | 说明 |
|---|---|---|
| 渲染错了，回到上一次 | `undo_render` | **只撤最近一次**，非多级回滚 |
| 清掉产物重来 | `delete_files` | 🔴 confirm |
| 清掉标签重出 | `delete_labels` | 🔴 confirm |

⚠️ 选了 `delete_files` 就**没有 undo 了**（`undo_render` 只在有备份时有效）。
→ 优先级：`undo_render` > `delete_files`。
→ 用户说「重来一次」→ **优先建议 `undo_render`**，不够再 `delete_files`。

## 五、典型输出流程

```
1. render_config     渲染（render 后才有 output/）
2. diff_compare      看改了什么
3. generate_label_md 出 Markdown 标签（先让用户看内容）
4. 用户确认后 generate_labels  出 Word
5. export_project    打包交付
```

> 第 3→4 步的顺序建议：**先 Markdown 后 Word**。Markdown 便宜、可读、可让 Agent 分析；确认无误再生成 Word。

## 六、常见坑

| 坑 | 正解 |
|---|---|
| `delete_files` 传 `"all"` 不二次确认 | 必须强调范围 + 二次确认 |
| 「重来一次」直接 `delete_files` | 优先 `undo_render`（可回退） |
| 用 Markdown 标签去打印 | 打印用 Word（`generate_labels`） |
| 用 `undo_render` 做多级回滚 | 只撤最近一次 |
| 跨端假设导出参数名一致 | MC 是 `targetDir` / `zipPath` |
| 不知道导出包在哪 | 默认 `workspace/_exports/<项目名>.zip` |

## 下一步

- 渲染 → `mc-render-flow`
- 项目操作 → `mc-project-ops`
- 跨端交付 → `cross-plan-to-render`
