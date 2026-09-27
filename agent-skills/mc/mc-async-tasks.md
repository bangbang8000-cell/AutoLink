---
name: "mc-async-tasks"
description: "MC 渲染域的异步长任务编排：提交/轮询/等待/取消任务，以及渲染导出类工具的自动异步。当渲染耗时超过 MCP 超时、用户问「渲染到哪了」，或需要批量渲染多个项目时使用。含长耗时工具识别、与 AL 的任务工具权限差异。"
---

# MC 异步任务编排

## 一、五个任务工具

```
task_submit {"tool": "render_config", "arguments": {...}}   → task_id
task_query  {"taskId": "..."}                               → status + percent/message + result/error
task_list   {}                                              → 全部任务
task_wait   {"taskId": "...", "timeout": 60}                → 阻塞到完成或超时
task_cancel {"taskId": "..."}                               → 取消
```

> ⚠️ **MC 的 `task_*` 五个工具权限表未登记 → 兜底 confirm**（AL 侧是显式 auto）。
> 这是双端同源缺陷（见 `工具面清单.md` §3.2）→ 若被要求确认，属已知登记问题，正常放行。

## 二、⚠️ 先看：这些工具**已自动异步**

MC 在 MCP 层自动转异步的工具：

```
render_config        render_yaml        generate_labels      generate_label_md
export_project       import_project     reverse_engineer_config
create_project_intelligent
```

→ ✅ **直接调用**，拿 `task_id`，`task_wait` 取结果
→ ❌ **绝不要**套 `task_submit`（双重异步）

**判据**：渲染类 + 打包类 + 反推类 + 智能创建类 = 长耗时 → 自动异步。

## 三、`task_wait` vs `task_query`

| 场景 | 用 |
|---|---|
| 需要结果才能继续 | `task_wait`（阻塞，省往返） |
| 用户问「跑到哪了」 | `task_query`（快照，不阻塞） |
| 预计 > 60 秒 | `task_query` 轮询（`task_wait` 默认 60 秒超时） |
| 批量任务 | 先全 `task_submit`，再逐个等 |

```
task_wait {"taskId": "abc", "timeout": 300}    # 大项目渲染给足时间
```

## 四、批量渲染多个项目

```
1. render_config {"projectName": "项目A"}   → t1
2. render_config {"projectName": "项目B"}   → t2
3. render_config {"projectName": "项目C"}   → t3
4. task_wait {"taskId":"t1", "timeout":300}
5. task_wait {"taskId":"t2", "timeout":300}
6. task_wait {"taskId":"t3", "timeout":300}
```

> **先提交再等**，别串行「提交-等待-提交」—— 那样总耗时是累加的。

## 五、✅ 渲染前必做（**这条能省大量返工**）

任务化之前先跑**同步校验**：

```
validate_template  → validate_excel  → analyze_project  → dry_run
```

这四个都是 🟢 auto 且**同步返回**。

→ 校验通过再提交异步渲染。
→ **反模式**：直接把 10 个项目丢进异步渲染 → 全跑到一半报 `UndefinedError` → 全白跑。

## 六、⚠️ 任务状态不跨进程

`task_id` 只在**当前 MCP Server 进程**内有效。Server 重启后全部失效。

→ `task_query` 返回「任务不存在」时，先确认 Server 有没有重启。

## 七、⚠️ 异步不改变权限

`task_submit` 提交一个 🔴 confirm 档工具（如 `render_config`），**仍然需要用户确认**。

→ 不要用 `task_submit` 绕确认（设计上堵死了）。

## 八、常见坑

| 坑 | 正解 |
|---|---|
| 给 `render_config` 套 `task_submit` | 已自动异步 |
| 批量渲染串行等待 | 先全提交再逐个等 |
| 大项目只等 60 秒 | 调大 `timeout` |
| 不做同步校验就批量提交 | 先 `validate_*` + `dry_run` |
| 用 `task_submit` 绕 confirm | 权限档会保留 |
| 重启后还用旧 `task_id` | 已失效，重新提交 |
| `task_*` 被要求确认 | 权限表登记缺陷，正常放行 |

## 下一步

- 渲染 → `mc-render-flow`
- 校验 → `mc-validate-diff`
- 接入 → `mc-connect`
