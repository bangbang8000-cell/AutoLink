---
name: "al-export-delivery"
description: "AL 规划域的交付物导出：导出连接表/设备清单/布线说明/BOM/报告数据/PDF报告/合规包，以及报告数据 12 段的读取。当用户说「导出交付物」「给我连接表」「出 BOM」「生成 PDF 报告」「评审包」时使用。含可导出类型清单、表头契约、报告 12 段结构、成本口径边界。"
---

# AL 交付物导出

## 一、导出工具

```
export_outputs {
  "configFile": "<项目目录>/project_config.json",
  "outputDir": "output",
  "outputTypes": "connections,deviceList,cablingGuide,bom,reportData,pdfReport,compliance"
}
```

`outputDir` 缺省 `output`；`outputTypes` 缺省全导出。

### 可导出类型

| 类型 | 产物 | 用途 |
|---|---|---|
| `connections` | **连接表** | 逐条链路（含分光标注） |
| `deviceList` | 设备清单 | 型号 + 数量 |
| `cablingGuide` | 布线说明 | 走线指导 |
| `bom` | BOM | 物料清单 |
| `reportData` | 报告数据 | **12 段结构化数据**，供报告渲染 |
| `pdfReport` | PDF 报告 | 直接可发 |
| `compliance` | 合规包 | 规范符合性 |

🟡 **notify + 长耗时** → MCP 层自动异步 → `task_wait` 取结果。

> ⚠️ **导出前先问用户输出目录**，别默认往项目里塞文件。

## 二、⚠️ 表头契约（**加列必改两处**）

连接表 / 布线表的表头有**契约测试**守着：

- `export_check.py::_HEADER_CONTRACTS`
- `test_validation_export.py::_CABLING_HEADERS`

→ 若用户问「为什么加了一列 CI 就红了」，答案在这两处。
→ 外部 Agent **不要建议用户「只改导出代码加列」** —— 必须两处同改。

## 三、报告数据 12 段

`reportData` 是**结构化数据**（不是渲染好的报告），共 **12 段**。
用户问「报告里有哪些内容」时，按 12 段结构回答。
需要 PDF 成品 → 用 `pdfReport`。

## 四、⚠️ 分光在导出物里的呈现（口径不一致的已知缺陷）

**现状**：

| 位置 | 带 breakout？ |
|---|---|
| **连接表**（`exporter.py:754`） | ✅ 有「1分2扇出」列 |
| **拓扑图**（`engine.py:432` / `:949` 的 edges） | ❌ **不带** |
| 前端 `TopologyEdge` 类型 | ❌ **无此字段** |

→ **连接表与拓扑图对分光的呈现不一致（缺陷 P-7）**。
→ 要让拓扑图也画分光，须**后端边透出 + 两条前端渲染路径（设计优先 / plan 兜底）同约定** —— 只改一条必被下游发现。

**对外话术**：用户问「图上为什么没显示分光」→ 确认是已知缺陷，**连接表是可信的那一份**。

## 五、成本 / 价格的边界（**说清楚，别越界**）

- AL 的 `cost` 段是**启发式估算**（`capacity_recommend` 内），与市价差 **3–11 倍**
- **AL 只出「型号 + 数量 + 可追溯标注」**
- **单价 / 总价归下游报价软件**

→ 用户要报价时：给型号和数量，明示需下游系统出价。
→ 若已装 `aidc-cluster-quote` 技能，报价走那条链路。

## 六、导出校验

导出前建议先跑：

```
validate_design {"configFile": "<同上路径>"}
```

`valid = false` 时**不要导出**（5.3.0 D2：超限阻断导出）。
→ 先转 `al-validate-repair` 修完再导。

## 七、常见坑

| 坑 | 正解 |
|---|---|
| 默认往项目目录导 | 先问用户 `outputDir` |
| 给 `export_outputs` 套 `task_submit` | 已自动异步，会双重异步 |
| 建议只改导出代码加列 | 表头契约两处必须同改 |
| 用 AL 的 cost 当报价 | 启发式，差 3–11 倍；单价归下游 |
| `valid=false` 仍导出 | 会阻断；先修再导 |
| 拿拓扑图当分光依据 | 连接表才带分光（缺陷 P-7） |
| 把 `reportData` 当 PDF | `reportData` 是 12 段 JSON，PDF 用 `pdfReport` |

## 下一步

- 要修完再导 → `al-validate-repair`
- 要读导出结果 → `al-project-ops` 的 `project_read_file`
- 要跨端渲染 → `cross-plan-to-render`
