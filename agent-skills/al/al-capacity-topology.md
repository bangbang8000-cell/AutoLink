---
name: "al-capacity-topology"
description: "AL 规划域的容量估算与拓扑推荐：算收敛比/通信量/TCO、按模型与卡数推荐网络配置、ATOP 式 ZCube 拓扑推荐、批量优化建议。当用户问「N 卡怎么配网络」「收敛比多少合适」「用什么拓扑组网」「这个项目有哪些优化点」时使用。含 k²/(2p) 二层判据、预估误差声明、FC/三层判据的已知缺陷。"
---

# AL 容量估算与拓扑推荐

## 一、三个工具的分工

| 用户问法 | 工具 | 权限 |
|---|---|---|
| 「N 卡怎么配网络 / 收敛比 / 成本多少」 | `capacity_recommend` | 🟢 auto |
| 「用什么拓扑组网 / 怎么连通」 | `atop_recommend` | 🟢 auto |
| 「这个项目有哪些优化点 / 怎么改进」 | `optimize_suggest` | 🟢 auto |
| 「把建议应用上去」 | `optimize_apply` | 🟡 notify |

## 二、`capacity_recommend` — 容量与成本

```
capacity_recommend {
  "model": "deepseek-v3",        # 模型档案 id 或模型名
  "num_gpus": 10000,             # 目标 GPU 数
  "budget": "standard",          # economy / standard / premium
  "precision": "fp8",            # fp8 / fp16 / bf16
  "tp": 8, "dp": 1, "pp": 1      # 并行度（pp>1 启用 Pipeline 建模）
}
```

返回三块：

| 块 | 内容 | 可信度 |
|---|---|---|
| FP8 分块精度通信 | 通信量（**exact**），含与解析法的误差对照 | 高（精确值） |
| Pipeline 分段显存 | `pp > 1` 时的分段显存 | 建模值 |
| **TCO 成本** | 硬件 / 电力 / 空间分项 | ⚠️ **启发式，与市价差 3–11 倍** |

**可用 `cost_params` 覆盖单价**：`{"gpu_watts": 1000, "electricity_per_kwh": 0.6}`

> ⚠️ **必须向用户声明 `estimated=true`，误差 ±15–20%。**
> ⚠️ **AL 只出「型号 + 数量 + 可追溯标注」，单价归下游报价软件。** 不要把 cost 值当报价讲给用户。

## 三、`atop_recommend` — ZCube 拓扑推荐

```
atop_recommend {
  "num_gpus": 10000,
  "model": "deepseek-v3",
  "pp": 1,
  "switch_ports": 0        # 0 = 按规模自动档位
}
```

返回：

| 字段 | 含义 |
|---|---|
| `communication_pattern` | 通信模式（`allreduce` / `alltoall` / `p2p`） |
| `comm_ratio` / `traffic_breakdown` | 通信占比与流量分解 |
| cube 维度 | **2D / 3D** —— MoE 模型（如 deepseek-v3）→ All-to-All 主导 → 3D |
| `topology.nodes` / `topology.edges` | **可直接渲染**的拓扑，含 `zcube_group` / `plane_id` 分组着色元数据 |
| `validation` | V020 结构规则校验（期望无 error） |
| `rationale` | 推荐理由 |

**判据**：`num_experts > 0` → 判定 All-to-All 主导 → 倾向 3D cube。

> ⚠️ 返回的 `topology` **不带 breakout 信息**（已知缺陷 P-7）—— 图里画不出分光，但连接表里有。
> 若用户对着拓扑图问「这里怎么没有分光」，说明是**渲染口径与连接表不一致**，是缺陷。

## 四、⚠️ 二层 vs 三层的判据（**已知缺陷，必读**）

### 正确公式

```
二层最大台数 = k² / (2p)
二层最大卡数 = k² / 2
```

- `k` = 交换机端口数（如 QM9700 的 64）
- `p` = 上联口数（如 6）

### 已知缺陷：原公式差一半

`topology.py:14` 的注释把 **leaf 台数**当成了 `k/2`，导致公式算出**一半**的台数。

**杀伤面**（现被误判为三层）：

| 场景 | 实际台数 | 被误判阈值 | 结论 |
|---|---|---|---|
| 256 台 / 2048 卡 | 256 | 128 | 误判三层 |
| 1024 台 / 8192 卡 | 1024 | 512 | 误判三层 |
| 1250 台 / 10000 卡 | 1250 | 648 | 误判三层 |

→ **既有 23 套模板从未暴露此缺陷**（都不在这个规模区间）。

**修复要点**：4 个调用点**必须单源**修，只修二层：
`topology.py:65` / `designer.py:760` / `designer.py:790` / `dual_plane_topology.py:87`

### 对外话术

用户报告「10000 卡被规划成三层但应该是二层」→ **这是缺陷，不是用户说错。** 确认公式后如实告知。

## 五、⚠️ 框数口径（三层场景）

```
框数 = ceil(上联需求 / 单框下行口)
上联需求 = ceil(服务器数 / 每接入下联口) × 2(MLAG) × 上联口数
```

相关口径键：
- `biz_agg_oversubscription`（默认 1.0）
- `biz_agg_chassis_spec`（默认 32）
- `biz_group_granularity`（默认 `merge`）
- `biz_access_uplinks`（默认 **6** —— 5.3.1 由 8 改为 6）

> ⚠️ **INI 路径不做 `port_count − uplinks`，只有 JSON 路径做。这是有意的不对称，勿「修」。**

## 六、批量优化

```
optimize_suggest {"configFile": "<project_config.json 路径>"}
```

返回建议数组，每条含：
`category` / `title` / `description` / **`patch`（`{section:{key:value}}`）** / `impact`

```
optimize_apply {"configFile": "...", "suggestions": [{"category":"...","title":"...","patch":{...}}]}
```

**流程**：`optimize_suggest` → **把建议列给用户挑** → 用户选定后 `optimize_apply` 写回。

→ ⚠️ **不要自动 apply 全部建议**，必须让用户挑（每条建议会改配置）。

## 七、规模事实

- **万卡 = 10000 卡 = 1250 台**（三套场景统一口径）
- ⚠️ 注意：曾出现过 `10368` 的说法，**已纠正为 10000**

## 常见坑

| 坑 | 正解 |
|---|---|
| 用 `k/(2p)` 算二层台数 | 正确是 `k²/(2p)`；现状代码有「差一半」缺陷 |
| 直接把 cost 段当报价 | 启发式，差 3–11 倍；单价归下游 |
| 不声明 `estimated` | 必须明示 ±15–20% |
| 自动 apply 全部优化建议 | 让用户挑 |
| 拿拓扑图当分光依据 | 图里无 breakout（缺陷 P-7），连接表才有 |
| 以为 INI/JSON 口径应相同 | 有意不对称 |

## 下一步

- 拿到建议要落设计 → `al-design-flow`
- 要校验和修缺陷 → `al-validate-repair`
- 要导出 → `al-export-delivery`
