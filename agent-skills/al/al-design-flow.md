---
name: "al-design-flow"
description: "AL 规划域主流程：把用户需求（自然语言 / 实例文件 / 规模数字）变成一份可用的项目设计。当用户说「帮我设计一个 N 卡集群」「从需求生成方案」「按这个 Excel 建项目」「一键设计」时使用。含 requirement→preview→confirm→create→design→validate 的完整链路与每步的确认点。"
---

# AL 主流程：需求 → 设计

这是 AL 规划域**最高频**的一条链路。核心原则：**需求生成只出预览不落盘，落盘必须经用户确认。**

## 主干链路

```
用户需求
  ↓ ①（可选）parse_file        解析用户上传的示例文件
  ↓ ②（可选）capacity_recommend / atop_recommend   规模 → 网络配置建议
  ↓ ③ generate_project         需求 → 规范化 ProjectConfig（只预览，不落盘）
  ↓ ④ 向用户复述 + 确认          ⚠️ 必经确认点
  ↓ ⑤ create_project / create_from_template        落盘建项目
  ↓ ⑥ generate_design          一键设计（自动选型 + 拓扑）
  ↓ ⑦ validate_design          校验（含 rule_id 级修复建议）
  ↓ ⑧ export_outputs           导出交付物
```

## ① 解析用户给的实例文件（有附件时才做）

```
parse_file {"path": "<文件绝对路径>", "type": "excel"}
```

- `type` 可省，按扩展名识别（`excel` / `json` / `csv` / `text`）。
- 返回 `result.parsed`：表格行 / JSON 对象 / 文本摘录。
- 🟢 **AUTO，只读**，可直接调。

> 用户给的是需求表 / 现有配置表时**先 parse**，别让用户手抄数字。

## ② 规模 → 网络建议（可选，但强烈建议）

用户只说了「多少卡」没说网络怎么配时，用这两个工具补：

```
capacity_recommend {"model": "deepseek-v3", "num_gpus": 10000}
```

返回：Scale-Up/Scale-Out 协议与速率、收敛比、层数、**FP8 通信量（exact）**、Pipeline 分段显存、**TCO 分项成本**。

```
atop_recommend {"num_gpus": 10000, "model": "deepseek-v3"}
```

返回：通信特征、**ZCube 2D/3D 维度**、**可直接渲染的 topology（nodes/edges，含 zcube_group/plane_id 分组元数据）**、V020 结构校验结果、推荐理由。

**怎么选**：
- 问「N 卡怎么配网络 / 收敛比多少」→ `capacity_recommend`
- 问「用什么拓扑 / 怎么组网」→ `atop_recommend`

两者都是 🟢 **AUTO 只读计算**，返回 `estimated=true`（误差 ±15–20%）。
→ ⚠️ **必须向用户说明这是预估值**，不可当作承诺指标。

两者都是长耗时工具，MCP 层自动异步，拿 `task_id` 后 `task_wait` 取结果。

## ③ 需求 → 规范化配置（**只预览，不落盘**）

```
generate_project {
  "name": "万卡-H200-QM9700-三层-IB",
  "config": {
    "topology": {"num_gpu_servers": 1250, "protocol": "IB", ...},
    "networks": {...},
    "rack_config": {...},
    "meta": {"name": "..."}
  }
}
```

`config` 是**你自己从用户话里抽出来的 ProjectConfig JSON**，工具负责：
migrate_config → 补默认值 → 宽松校验 → 置信度标注。

返回含 **`annotations{confidence, missingFields}`**：

> ⚠️ **`missingFields` 里的字段是「默认推导值」，不是用户说的。必须逐条向用户说明「这几项我按默认填了 X，对吗」。**

🟡 **notify**：本工具**不落盘**，但属写路径，调完要说明。

## ④ 确认点（**不可跳过**）

把 ③ 的结果整理成人类可读的形式给用户过目：

```
即将创建项目「万卡-H200-QM9700-三层-IB」
  规模：1250 台 GPU 服务器 / 10000 卡
  参数网：IB / 400G / 三层 / QM9700
  存储网：IB / 400G→2×200G 分光
  机柜：1 柜 1 台，单柜功率上限 12000W
  ⚠️ 以下为默认推导，请确认：storage_protocol、biz_agg_chassis_spec ...

确认创建？还是先调整？
```

**只有用户明确同意后才进 ⑤。**

## ⑤ 落盘建项目

两条路径，按用户是否指定模板选：

```
create_from_template {"projectName": "...", "templateName": "万卡-H200-QM9700-三层-IB"}   # 有模板，推荐
create_project       {"projectName": "...", "description": "..."}                          # 无模板，走默认配置
```

> 不知道选哪个模板 → 先 `template_recommend {"protocol":"IB","gpuModel":"H200","scale":1250}`

两者都 🟡 **notify**：落盘后**必须告诉用户项目建在哪、叫什么**。

⚠️ `create_project` 有**两个同名工具**（`project_create` / `create_project`），行为一致但 `create_project` 走「默认配置」，`create_from_template` 才带模板 —— **别用 `create_project` 传 templateName**（它不吃这个参数）。

## ⑥ 一键设计

```
generate_design {"configFile": "<项目目录>/project_config.json"}
```

**⚠️ 关键点**：AL 的设计工具吃的是 **`configFile` 路径**，不是 `projectName`。
先用 `project_info {"name": "<项目名>"}` 拿到项目目录，再拼 `project_config.json` 路径。
或 `project_list_files` 看目录里到底有什么文件。

返回：与 GUI 设计结果一致的拓扑（设备数 / 链路数 / 收敛比）。

长耗时 → 自动异步 → `task_wait`。

## ⑦ 校验

```
validate_design {"configFile": "<同上路径>"}
```

返回 `{valid, errors, validationIssues}`，每条 issue 含：
`rule_id` / `severity` / `message` / **`recommendation`（修复建议）**

→ **直接把 `recommendation` 讲给用户**，这是产品内置的修复口径，比你自己编的准。

有 error 且用户想修 → 转 `al-validate-repair`。

## ⑧ 导出

```
export_outputs {
  "configFile": "<同上路径>",
  "outputDir": "output",
  "outputTypes": "connections,deviceList,cablingGuide,bom,reportData,pdfReport,compliance"
}
```

可导出类型：`connections` / `deviceList` / `cablingGuide` / `bom` / `reportData` / `pdfReport` / `compliance`

→ 细节与每个产物的用途见 `al-export-delivery`。
→ 🟡 **notify** + 长耗时：**先问用户输出到哪个目录**，别默认往项目里塞。

## 常见坑

| 坑 | 表现 | 正解 |
|---|---|---|
| 把 `projectName` 传给 `generate_design` | 报缺参数 / 找不到文件 | 设计类工具统一吃 `configFile` 路径 |
| 跳过 ④ 确认直接建项目 | 用户不知情地被落盘 | ③④ 分离是设计要求，不可合并 |
| 把 `annotations.missingFields` 当用户原话 | 交付物与需求不符 | 逐条向用户复述并确认 |
| 给 `task_submit` 套 ⑥⑦⑧ 的工具 | 双重异步，拿不到结果 | 长耗时工具直接调，只轮询一次 |
| 容量/拓扑结果当承诺 | 用户按预估值排产 | 明示 `estimated=true`、±15–20% |

## 下一步

- 项目已存在，要查/改 → `al-project-ops`
- 要挑设备型号 → `al-device-select`
- 要机房落位 → `al-room-layout`
- 要交付 → `al-export-delivery`
