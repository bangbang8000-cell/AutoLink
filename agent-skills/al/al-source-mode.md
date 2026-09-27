---
name: "al-source-mode"
description: "AL 源码态（--mode source）专有能力的用法：run_cli 白名单 CLI 透传、read_file/list_dir/read_source 沙箱文件读取。当 64 个 CLI action 需要触达（产品工具没覆盖）、要读仓库源码、要列目录时使用。含白名单根域、沙箱范围、以及「编译态下这些工具不存在」的判别。"
---

# AL 源码态能力（run_cli / 文件系统）

## 一、先确认模式

```
python -m autolink_hub.mcp_server.run --mode source --user-data <dir>
```

| 工具 | compiled | source |
|---|---|---|
| `run_cli` | ❌ | ✅ |
| `read_file` | ❌ | ✅ |
| `list_dir` | ❌ | ✅ |
| `read_source` | ❌ | ✅ |

→ 如果工具列表里找不到它们，**先确认 `--mode`**，不要以为是权限问题。

四者权限档均为 🔴 **confirm**（需用户确认；enforce 模式需 `approvalToken`）。

## 二、`run_cli` — CLI action 透传

```
run_cli {"action": "project:list", "params": {}}
run_cli {"action": "template:view", "params": {"name": "万卡-H200-QM9700-三层-IB"}}
```

**白名单根域**（`_AL_CLI_ALLOWED_ROOTS`）：

```
design    validate   export    report    room     config
project   template   capacity  atop      optimize  repair
file      device     migrate
```

不在白名单 → 返回 `CLI action 不在白名单: <action>`。

**AL 共 64 个 CLI action。** 常见形态：

| 形态 | 例 |
|---|---|
| 单段 | `design` / `validate` / `export` / `report` / `estimate` / `migrate` |
| 冒号分段 | `project:list` / `project:info` / `project:create` / `template:view` |
| 多段 | `room:create` / `room:set-type` / `config:apply-preset` / `device:defaults` |

## 三、⚠️ 什么时候用 `run_cli`（**判据**）

> **只有当某个能力「产品工具没覆盖」时才用 `run_cli`。**

优先用专用工具，理由：

| 维度 | 专用工具 | `run_cli` |
|---|---|---|
| 参数校验 | JSON Schema 完整 | 靠 `params` 自己拼 |
| MCP 元数据 | 有 permission / annotations | 无 |
| 异步化 | 长耗时自动转异步 | 不转，可能超时 |
| 审计 | 有 | 有，但 action 粒度更粗 |
| 稳定性 | 受契约测试保护 | 依赖 CLI 内部实现 |

**反例**：`run_cli {"action": "design"}` == `generate_design`，但后者更好（会自动异步）。

**正例**：需要 `file:parse` 的某个未暴露子选项、或 CLI 特有的组合参数。

## 四、文件系统三件套

```
read_file   {"path": "<沙箱内绝对路径>"}                     ← 源码态通用读
read_file   {"projectName": "...", "filePath": "..."}       ← 项目内读（两模式都可用）
list_dir    {"path": "<沙箱内目录路径>"}
read_source {"path": "<沙箱内文件路径>"}
```

**沙箱范围**：用户数据目录 / 仓库根。**超范围直接拒绝。**

### `read_file` 的两种模式

| 调用方式 | 可用性 | 说明 |
|---|---|---|
| `path=...` | **仅源码态** | 沙箱内绝对路径 |
| `projectName` + `filePath` | 两模式都可 | 项目内相对路径，防目录穿越 |

→ 只想读项目内文件时，**用 `project_read_file`**（🟢 auto，更合适）。
→ 要读**项目外**的仓库文件（如设备库定义、模板源文件）才需要源码态的 `read_file`。

## 五、典型用途

### 查设备库原始定义

```
list_dir  {"path": "<仓库根>/backend/device_library"}
read_file {"path": "<仓库根>/backend/device_library/switches/nvidia_mqm9700_64_400g_ib.json"}
```

用于核对 `device_get` 返回的字段与实际定义是否一致（排查「档案自相矛盾」类缺陷）。

### 查模板源文件

```
list_dir  {"path": "<仓库根>/backend/template"}
read_file {"path": "<仓库根>/backend/template/<模板名>/project_config.json"}
```

### 查 golden 基线

```
read_file {"path": "<仓库根>/tests/backend/golden/<name>.json"}
```

用于「golden 基线编码的是不是错计数」的归因。

## 六、⚠️ 安全边界

- 沙箱**只读**：这四个工具都**不能写文件**
- 要写文件用 `project_write_file`（🟡 notify，仅限项目内）
- `run_cli` 不能绕过 `write_gate`：CLI 内部的写入仍过 **L2 结构 + L3 幂等** 检查
- `run_cli` **不能执行**被屏蔽的破坏性 action（编译态屏蔽在注册期已生效）

> ⚠️ **`write_gate.py` 是写入语义层**（L2 结构 + L3 幂等），**不管「是否允许执行」**。
> 门禁顺序：`模式校验 → 权限门禁 → write_gate`。

## 七、常见坑

| 坑 | 正解 |
|---|---|
| 用 `run_cli` 代替专用工具 | 专用工具优先（有 schema/异步/审计） |
| 编译态找不到 `run_cli` 就以为坏了 | 切 `--mode source` |
| 用 `read_file` 读项目内文件 | 用 `project_read_file`（auto） |
| 以为 `run_cli` 能写文件 | 沙箱只读；写用 `project_write_file` |
| 以为 `run_cli` 能绕过门禁 | 仍过 `write_gate` |
| 越沙箱路径 | 直接拒绝，无例外 |

## 下一步

- 常规操作优先走专用工具 → `al-project-ops` / `al-design-flow`
- 接入与模式选择 → `al-connect`
