---
name: "cross-plan-to-render"
description: "跨端链路：把 AL 规划域的设计结果接到 MC 渲染域出设备配置。当用户说「规划完再渲染」「把 AL 的方案拿去出配置」「端到端跑一遍」「万卡集群从规划到配置」时使用。含 plan:table v1.3 衔接契约、六场景清单、以及跨端必经的三个确认点与已知断点。"
---

# 跨端链路：AL 规划 → MC 渲染

## 一、契约：`plan:table v1.3`

AL 与 MC 之间以 **`plan:table v1.3`** 衔接。

```
AL 侧产出                       MC 侧消费
─────────────────────────────────────────────
项目 project_config.json   ┐
plan.json                  ├→  Excel 参数表
连接表 connections          │   Jinja2 模板
设备清单 deviceList         ┘   → 设备配置 output/
```

> **衔接点是「连接表 + 设备型号」，不是「配置文本」。**
> AL 说「哪些设备、怎么连、什么型号」；MC 说「这些设备按什么模板渲染出什么命令」。

## 二、端到端链路

```
【AL 规划域】
① generate_project    需求 → ProjectConfig（预览）
② ⚠️ 确认：向用户复述配置
③ create_from_template / create_project
④ generate_design     设计（自动异步 → task_wait）
⑤ validate_design     校验（22 条规则）
⑥ 有 error → repair_plan → ⚠️ 确认 → repair_apply
⑦ export_outputs      导出 connections / deviceList / reportData
        ↓  跨端传递（plan:table v1.3）

【MC 渲染域】
⑧ 确认 MC 设备库是否有对应型号  ← ⚠️ 常见断点
⑨ create_from_template / create_project_intelligent
⑩ write_excel / write_text_file   参数表 + 模板
⑪ validate_template + validate_excel + analyze_project
⑫ dry_run             预演
⑬ ⚠️ 确认：渲染会覆盖 output/
⑭ render_config       渲染（自动异步 → task_wait）
⑮ generate_label_md → 确认 → generate_labels
⑯ export_project      交付包
```

## 三、⚠️ 跨端必经的三个确认点

| # | 位置 | 为什么必须停 |
|---|---|---|
| 1 | AL `generate_project` 之后 | `missingFields` 是**默认推导值**，不是用户原话 |
| 2 | AL `repair_plan` 之后 | 修复会改配置，要用户挑 |
| 3 | MC `dry_run` 之后 | `render_config` 会**覆盖** `output/` |

**跨端链路里这三处一次都不能省** —— 上游错会传导到下游产物。

## 四、⚠️ 已知断点（**跑跨端链路必查**）

| 断点 | 现象 | 处置 |
|---|---|---|
| **MC 设备库仅 13 台** | AL 规划出的 H200 / B300 / Q3400 / Spectrum-X **在 MC 没有档案** | 先确认或补档案，否则模板无法落 |
| **`project_single.py:423`** | MC **无条件产全部角色 j2** | 不能按需只出部分角色，产物会多 |
| **分光呈现不一致** | AL 连接表有「1分2扇出」列，**拓扑图没有**（缺陷 P-7） | 以**连接表**为准 |
| **MC `switches/storage/` 无 IB 存储交换机** | AL 规划的 IB 存储网在 MC 无对应设备 | 5 台全以太 |
| **`storage_ports_per_server` 单值** | AL 侧 GPU 1 口 / 存储 4 口**无法分别表达**（缺陷 P-6） | 连接表口数可能与层级判定对不上 |

> **跨端第一步就该查**：AL 规划用到的型号，MC 设备库里有没有。
> 没有 → **提前告诉用户**，别等渲染到一半才报错。

## 五、六场景清单（跨端内容建设的基准）

| # | 场景 | 服务器 | 台/卡 | 参数网交换机 | 层级 | 协议 | MC 渲染 |
|---|---|---|---|---|---|---|---|
| ① | 万卡 A | H200 | 1250/10000 | QM9700 64×400G | 三层 | IB | ❌ |
| ② | 万卡 B | H200 | 1250/10000 | Q3400 72×1.6T→288×400G | 二层 | IB | ❌ |
| ③ | 万卡 C | H200 | 1250/10000 | X400 128×400G | 三层 | RoCE | ✅ |
| ④ | 二层最大 A | H200 | 256/2048 | QM9700 | 二层 | IB | ❌ |
| ⑤ | 二层最大 B | H200 | 1024/8192 | X400 | 二层 | RoCE | ✅ |
| ⑥ | 万卡 B300 | DGX B300 | 1250/10000 | Q3400 1.6T→144×800G | 二层 | IB | ❌ |

**命名**（AL `template/` ≡ MC `example/` 同名）：

```
万卡-H200-QM9700-三层-IB        万卡-H200-Q3400-二层-IB
万卡-H200-X400-三层-RoCE        二层最大-2048卡-QM9700-IB
二层最大-8192卡-X400-RoCE       万卡-B300-Q3400-二层-IB
```

**关键口径**：
- 万卡 = **10000 卡 = 1250 台**（三套统一）
- 参数网 H200 `8×400G` / B300 `8×800G`；**200G 落存储网**
- **分光按角色**：IB QM9700 **仅存储网** `400G→2×200G`；RoCE X400 两侧都不分光
- AL 模板全部标 `isSample=true`（进 golden 门禁）
- MC 的 IB 存储网复用 `nvidia_mqm9700_64_400g_ib`

## 六、跨端数据怎么传

| AL 产出 | 传什么 | MC 怎么用 |
|---|---|---|
| `connections` | 连接表（含分光扇出） | 生成 Excel 参数表的行 |
| `deviceList` | 型号 + 数量 | **核对 MC 设备库是否有档案** |
| `reportData` | 12 段结构化数据 | 供报告/模板变量 |
| `project_config.json` | 全量配置 | 参考，不直接喂 MC |

> ⚠️ **不要直接把 AL 的 `project_config.json` 当 MC 的 Excel 用** —— 格式不同。
> 要**转换成 MC 的参数表结构**（表头 = 模板变量名）。

## 七、⚠️ AL 与 MC 的渲染口径差异

| 项 | AL | MC |
|---|---|---|
| 分光表达 | 连接表「1分2扇出」列 | **子接口命名** `TwoHundredGigE1/0/1:1` / `:2` |
| 产物 | 12 段 reportData + PDF | 设备配置 `.cfg` + 标签 |
| 校验 | 22 条规则（V001–V022） | Jinja2 / Excel / 交叉引用 |
| 装置 | 无 | `example/` 模板中心 |

→ MC 的分光基准来自 `roce_templates.py` / `verify_baseline.py`：**Leaf 400G 1分2 → 200G 下联 GPU**。

## 八、常见坑

| 坑 | 正解 |
|---|---|
| 不查 MC 设备库就开渲染 | 跨端第一步就核对型号 |
| 把 AL 的 `project_config.json` 直接喂 MC | 要转成 MC 参数表结构 |
| 跳过三个确认点 | 一处都不能省 |
| 用拓扑图当分光依据 | 连接表才带（缺陷 P-7） |
| 以为 MC 能做设计合规校验 | V001–V022 只在 AL |
| MC 产物多了却以为出错 | `project_single.py:423` 无条件产全角色 j2 |

## 下一步

- AL 侧细节 → `al-design-flow` / `al-export-delivery`
- MC 侧细节 → `mc-render-flow` / `mc-template-author`
- 出问题 → `cross-troubleshoot`
