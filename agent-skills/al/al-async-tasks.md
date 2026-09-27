---
name: "al-async-tasks"
description: "AL 规划域的异步长任务编排：提交/轮询/等待/取消任务，以及哪些工具已自动异步。当任务超过 MCP 超时、用户问「跑到哪了」「还要多久」，或需要编排多步长任务时使用。含长耗时工具清单、task_wait vs task_query 的选用判据、双重异步陷阱。"
---

# AL 异步任务编排

## 一、五个任务工具（🟢 全 auto）

```
task_submit {"tool": "generate_design", "arguments": {...}}   → 返回 task_id
task_query  {"taskId": "..."}                                 → pending/running/done/error + percent/message
task_list   {}                                                → 全部任务
task_wait   {"taskId": "...", "timeout": 60}                  → 阻塞到完成或超时
task_cancel {"taskId": "..."}                                 → pending/running → 取消为 error
```

## 二、⚠️ 先看：这 13 个工具**已经自动异步**了

```
generate_design      report               export_outputs     export_project
project_export       template_export      room_optimize      atop_recommend
capacity_recommend   project_import       template_import    repair_apply
optimize_apply
```

**MCP 层会自动把它们转成异步任务并返回 `task_id`。**

→ ✅ **直接调用**，拿 `task_id`，用 `task_query` / `task_wait` 取结果
→ ❌ **绝不要**再套一层 `task_submit` —— 会**双重异步**，外层任务包着内层任务，`task_wait` 拿不到真实结果

## 三、`task_wait` vs `task_query` 的选用

| 场景 | 用 | 理由 |
|---|---|---|
| 需要结果才能继续下一步 | `task_wait` | 阻塞等，省一次往返 |
| 用户问「跑到哪了」 | `task_query` | 拿快照，不阻塞 |
| 要并行提交多个任务 | 先都 `task_submit`，再逐个 `task_query` | 避免串行阻塞 |
| 预计超过 60 秒 | `task_query` 轮询 | `task_wait` 默认 60 秒会超时返回 |

```
task_wait {"taskId": "abc", "timeout": 120}    # 大任务把 timeout 调大
```

`task_query` 返回结构：
```
{ status: "pending|running|done|error", percent: 45, message: "正在生成拓扑", result: {...} | error: "..." }
```

## 四、典型编排

### 单个长任务

```
1. generate_design {"configFile": "..."}      → {"task_id": "t1"}
2. task_wait {"taskId": "t1", "timeout": 180} → 设计结果
```

### 多个长任务（并行）

```
1. export_outputs {"configFile":"...", "outputTypes":"connections"}  → t1
2. export_outputs {"configFile":"...", "outputTypes":"bom"}          → t2
3. task_wait {"taskId":"t1", "timeout":180}
4. task_wait {"taskId":"t2", "timeout":180}
```

> 别串行：先都提交，再一起等。

### 取消

```
task_cancel {"taskId": "t1"}
```

用户说「算了别跑了」时用。`error` 状态表示已取消。

## 五、⚠️ 异步任务的两个坑

### 坑 1：任务状态不跨进程

`task_id` 只在**当前 MCP Server 进程**内有效。Server 重启后旧 `task_id` 全部失效。

→ 若 `task_query` 返回「任务不存在」，先确认 Server 有没有重启过。

### 坑 2：异步任务**不改变权限语义**

`task_submit` 本身是 🟢 auto，但它提交的工具**保留原权限档**。

→ 提交一个 `confirm` 档工具为异步任务，**仍然需要用户确认**。
→ 不要用 `task_submit` 绕过确认（这是设计上堵死的路径）。

## 六、什么时候**不**用任务工具

| 情况 | 做法 |
|---|---|
| 工具不在 13 个自动异步名单里，且很快返回 | **直接同步调**，别套任务 |
| 只是想读数据（`project_info` 等） | 直接同步调 |
| 工具已自动异步 | 直接调 + 轮询，**不套 submit** |

> 判据：**只有「工具本身是同步的，但这次调用会跑很久」才需要 `task_submit`。**
> 实践上这种情况很少 —— 长任务都已在名单里。

## 七、常见坑

| 坑 | 正解 |
|---|---|
| 给 `generate_design` 套 `task_submit` | 双重异步，拿不到结果 |
| 用 `task_wait` 等大任务却只给 60 秒 | 调大 `timeout` |
| 多任务串行 `wait` | 先全提交，再逐个等 |
| 用 `task_submit` 绕 `confirm` | 权限档会保留，绕不过 |
| Server 重启后还用旧 `task_id` | 任务已失效，重新提交 |
| 把同步快工具也套任务 | 直接同步调 |

## 下一步

- 设计流程 → `al-design-flow`
- 导出 → `al-export-delivery`
- 读取任务结果里的配置 → `al-project-ops`
