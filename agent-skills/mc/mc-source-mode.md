---
name: "mc-source-mode"
description: "MC 源码态（--mode source）专有能力的用法：run_cli 白名单 CLI 透传（project/template/render/validate/diff/label/analyze/file）、list_dir / read_source 沙箱读取。当产品工具没覆盖某个能力、要读仓库源码、要列目录时使用。含白名单子命令清单与「编译态下这些工具不存在」的判别。"
---

# MC 源码态能力

## 一、先确认模式

```
python -m ai_hub.mcp_server.run --mode source --workspace <dir>
```

| 工具 | compiled | source | 权限 |
|---|---|---|---|
| `run_cli` | ❌ | ✅ | 🔴 confirm |
| `list_dir` | ❌ | ✅ | 🔴 confirm |
| `read_source` | ❌ | ✅ | 🔴 confirm |
| `read_file` | ✅ | ✅ | 🟢 auto |

> ⚠️ **`read_file` 在 MC 是 🟢 auto 且编译态可用**（与 AL 的 confirm + 仅源码态**不同**）。
> → MC 里 `read_file` 走 `projectName`+`filePath` 读项目内文件；走 `path` 需源码态读沙箱内任意文件。

## 二、`run_cli` — CLI 透传

```
run_cli {"action": "render", "params": {"projectName": "..."}}
run_cli {"action": "project", "params": {"sub": "list"}}
```

**白名单子命令**：

```
project   template   render   validate   diff   label   analyze   file
```

不在白名单 → 拒绝。

## 三、⚠️ 什么时候用 `run_cli`

> **只有当某个能力「产品工具没覆盖」时才用。**

| 维度 | 专用工具 | `run_cli` |
|---|---|---|
| 参数校验 | JSON Schema | 自己拼 `params` |
| MCP 元数据 | 有 permission / annotations | 无 |
| 异步化 | 长耗时自动转异步 | **不转，可能超时** |
| 稳定性 | 受契约测试保护 | 依赖 CLI 内部实现 |

**反例**：`run_cli {"action":"render"}` ≈ `render_config`，但后者更好（自动异步 + schema 校验）。

**正例**：需要某个 CLI 独有的子命令或参数组合。

## 四、`read_source` / `list_dir`

```
list_dir    {"path": "<工作区内目录路径>"}
read_source {"path": "<工作区内文件路径>"}
```

**沙箱范围**：工作区 / 仓库根。**超范围拒绝。**

### 典型用途

| 用途 | 命令 |
|---|---|
| 看项目模板源文件 | `read_source {"path": "<工作区>/<项目>/templates/ASW.j2"}` |
| 看模板中心 | `list_dir {"path": "<仓库>/example"}` |
| 看设备库定义 | `list_dir {"path": "<仓库>/ai_hub/device_library"}` |
| 看内置技能 | `read_source {"path": "<仓库>/ai_hub/skills/skills/render-and-validate.md"}` |

## 五、⚠️ 安全边界

- `run_cli` / `list_dir` / `read_source` **只读或受控**
- 写文件要走项目工具：`write_text_file` / `write_excel` / `render_config`
- `run_cli` **不能绕过 `write_gate`** —— CLI 内部写入仍过 **L2 结构 + L3 幂等** 检查
- `run_cli` **不能执行**被编译态屏蔽的破坏性 action

> ⚠️ **`write_gate.py` 是写入语义层**（L2 结构 + L3 幂等），**不管「是否允许执行」**。
> 门禁顺序：`模式校验 → 权限门禁 → write_gate`。

## 六、MC 的 `read_file` 双模式细节

```
read_file {"projectName": "...", "filePath": "templates/ASW.j2"}   # 项目内，两模式都可用
read_file {"path": "<沙箱内绝对路径>"}                              # 仅源码态
```

→ 只读**项目内**文件 → 用 `projectName`+`filePath`（更安全，防目录穿越）
→ 要读**项目外**（模板中心 / 设备库 / 源码）→ 需源码态的 `path`

## 七、对比 AL 的源码态（跨端必看）

| | AL | MC |
|---|---|---|
| `run_cli` 白名单 | 15 个根域（design/validate/export/...） | 8 个子命令（project/template/render/...) |
| CLI action 总数 | **64** | （见 CLI 子命令清单） |
| `read_file` | 🔴 confirm，**仅源码态** | 🟢 **auto，两模式都可** |
| `list_dir` / `read_source` | 🔴 confirm | 🔴 confirm |
| 资产根参数 | `--user-data` | `--workspace` |

→ **`read_file` 的权限差异是最容易踩的**：写跨端 skill 时不能假设「读文件都是 confirm」。

## 八、常见坑

| 坑 | 正解 |
|---|---|
| 编译态找不到 `run_cli` 就以为坏了 | 切 `--mode source` |
| 用 `run_cli` 代替专用工具 | 专用工具优先（有 schema / 异步） |
| 以为 `run_cli` 能写文件绕过门禁 | 仍过 `write_gate` |
| 以为 MC 的 `read_file` 也是 confirm | MC 是 🟢 auto 且编译态可用 |
| 越沙箱路径 | 直接拒绝 |
| 读项目内文件用 `path` | 用 `projectName`+`filePath`（更安全） |

## 下一步

- 常规操作走专用工具 → `mc-project-ops` / `mc-render-flow`
- 接入与模式选择 → `mc-connect`
