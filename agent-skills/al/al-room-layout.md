---
name: "al-room-layout"
description: "AL 规划域的机房矩阵与机柜落位：建机房矩阵、校验布局、标记机柜类型、上架/移除机柜、智能落位优化。当用户说「规划机房」「机柜怎么摆」「A1 放 GPU 柜」「帮我做落位方案」「功率怎么均衡」时使用。含 1柜1台默认口径、单柜功率 12000W 上限、落位方案不落盘的三条硬规则。"
---

# AL 机房矩阵与机柜落位

## 一、五个工具

| 工具 | 权限 | 用途 |
|---|---|---|
| `room_create` | 🟡 notify | 创建机房矩阵（行列框架） |
| `room_validate` | 🟢 auto | 校验布局（占位/类型/U位/功率） |
| `room_optimize` | 🟡 notify | **智能落位**（约束满足 + 多目标优化） |
| `room_set_type` | 🟡 notify | 标记某位置的机柜类型 |
| `room_place` | 🟡 notify | 上架 / 移除机柜 |

## 二、建矩阵

```
room_create {"rows": ["A","B","C"], "cols": [1,2,3], "name": "机房"}
```

- `rows` 行命名（字符串数组）
- `cols` 列编号（整数数组）
- 位置标识 = 行+列拼接，如 `A1` / `D5`

## 三、⚠️ 三条硬口径（**回答机房问题时必须遵守**）

### 口径 1：默认「1 柜 1 台」

**8 卡服务器也是一柜一台。**

- ❌ 严禁「按卡数折柜」（会把柜数算成 8 倍）
- ✅ 「机柜台数 ≈ GPU 服务器台数」是**正确预期**

例外：1 柜多台时，必须**同时**设置：
- `power_limit_per_rack`（如 `36000`）
- `gpu_per_cabinet = 2`

> ⚠️ **`gpu_per_cabinet` 是「每柜台数」，不是「每柜卡数」** —— 这个名字极易误读。

### 口径 2：单柜功率上限默认 **12000W**

后端 7 处 + 前端 6 处**全链路统一**为 12000W。

- 此前存在 6000 与 `designer.py`/`config_schema.py` 不同源的问题，**已修正**
- 校验时若 `power_watts` 超限，`room_place` 会拒绝

### 口径 3：落位方案**只计算不落盘**

`room_optimize` 返回的是**方案**，需要用户确认后由前端应用。

→ **外部 Agent 拿到方案后不要直接写库**，要交用户确认。

## 四、智能落位

```
room_optimize {
  "project": "万卡-H200-QM9700-三层-IB",
  "counts": {"gpu": 1250, "network": 60, "storage": 60},
  "objectives": {"power_balance": 1, "thermal_zones": 1, "network_locality": 1, "shortest_cable": 1},
  "constraints": {"powerLimitPerRack": 12000},
  "time_budget_s": 5,
  "reset_existing": false
}
```

**两种输入**：`counts`（类型→数量）或 `cabinets`（机柜列表 `[{id,type,power_watts}]`）。**`cabinets` 优先于 `counts`。**

**四个优化目标**（可加权）：
| 目标 | 含义 |
|---|---|
| `power_balance` | 功率均衡 |
| `thermal_zones` | 散热分区 |
| `network_locality` | 网络就近 |
| `shortest_cable` | 布线最短 |

**返回**：
```json
{
  "success": true,
  "placements": [{"position": "A1", "type": "gpu", "cabinetId": 3, "powerWatts": 11000}],
  "scores": {...}, "issues": [...], "stats": {...}
}
```

**`reset_existing`**：
- `false`（默认）→ **保留手动放置**
- `true` → 清空已落位重排

→ ⚠️ 用户没说「重排」时**不要传 `true`**，会毁掉人工调整。

`time_budget_s` 默认 5 秒 —— 大规模矩阵可适当加大。

## 五、手动落位

```
room_set_type {"project":"...", "position":"D1", "type":"network"}
```
可用类型：`gpu` / `network` / `storage` / `compute` / `combined` / `empty`

```
room_place {"project":"...", "position":"A1", "cabinet_id": 3,
            "cabinet_type": "gpu", "power_watts": 11000,
            "constraints": {"powerLimitPerRack": 12000}}
```

- `cabinet_id = 0` → **移除**该位置的机柜
- 提供 `cabinet_type` → 做类型域校验
- 提供 `power_watts` → 做上限校验（超 12000 拒绝）

## 六、校验

```
room_validate {"layout": "<room_layout.json 路径>"}
```

校验四类问题：**占位 / 类型 / U位 / 功率**。🟢 auto，可随时调。

## 七、典型流程

```
1. room_create          建矩阵
2. room_set_type        标记分区（D/E/F 列 = 网络柜区）
3. room_optimize        出落位方案
4. 向用户展示方案        ⚠️ 确认点
5. room_place / 前端应用  实际落位
6. room_validate        校验
```

> 第 3 步之后**必须停一次问用户**：方案涉及上千个位置，自动应用风险大。

## 常见坑

| 坑 | 正解 |
|---|---|
| 按卡数折柜（8 卡算 8 柜） | 默认 1 柜 1 台；1 柜多台要设 `gpu_per_cabinet` + `power_limit_per_rack` |
| 把 `gpu_per_cabinet` 当卡数 | 它是**台数** |
| 单柜功率用 6000 | 全链路已统一 **12000W** |
| `reset_existing: true` 当默认 | 默认必须 `false`，保住人工调整 |
| `room_optimize` 后直接落盘 | 方案不落盘，需用户确认 |
| 同时传 `counts` 和 `cabinets` 却不清楚谁生效 | `cabinets` 优先 |

## 下一步

- 项目/配置操作 → `al-project-ops`
- 导出机房表 → `al-export-delivery`
- 校验与修缺陷 → `al-validate-repair`
