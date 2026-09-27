---
name: "mc-template-author"
description: "MC 渲染域的模板创作与复用：写/改 Jinja2 模板、从已有配置反推模板、按设备类型厂商推荐模板、模板与 Excel 的变量对齐。当用户说「写个模板」「改一下模板」「从这份配置反推模板」「推荐个模板」「模板里少了变量」时使用。含 reverse_engineer_config 能力边界、模板↔Excel 变量契约、智能创建后必须微调。"
---

# MC 模板创作与复用

MC 的核心工作流是「**Excel 参数 + Jinja2 模板 → 设备配置**」。模板是这套流程的骨架。

## 一、四条获得模板的路径

| 路径 | 用什么 | 适用 |
|---|---|---|
| 从模板中心（example）取 | `create_from_template` → 微调 | 有现成模板 |
| 按设备类型+厂商生成骨架 | `create_project_intelligent` → 微调 | 从零开始，有标准结构可套 |
| 从已有设备配置**反推** | `reverse_engineer_config` | 已有 `show run` 输出 |
| 手写 | `write_text_file` | 特殊场景 |
| 让 MC 推荐 | `recommend_template` | 不知道用哪个 |

## 二、`recommend_template`（🟢 auto）

```
recommend_template {"deviceType": "switch", "vendor": "huawei"}
recommend_template {"projectName": "现有项目"}      # 分析现有模板 + 给优化建议
```

支持：**华为 / 思科 / H3C** 的 **交换机 / 路由器 / 防火墙** 模板。

→ 用户问「用哪个模板好」时先调它，**不要自己列 `template_list` 让用户挑**。

## 三、`reverse_engineer_config`（🔴 confirm）

```
reverse_engineer_config {
  "configText": "<完整的 show run 输出>"
}
```

**能做什么**：从网络设备配置文本自动识别并提取变量，生成 **Jinja2 模板 + Excel 参数表**。

**自动识别的变量类型**（内置正则）：
`IP` / `主机名` / `VLAN` / `SNMP` / `AAA`（含 AAA 名称、AAA 地址、**AAA 认证密钥**）等

**能力边界（⚠️ 必须向用户说明）**：
- 依赖**正则模式匹配** → 配置风格偏离标准语法时**可能漏提取**
- 生成的是**骨架** → 复杂逻辑（条件分支、循环）需要人工补
- **不能反推业务语义**（它不知道「这个 VLAN 是管理网」）

→ 用户期望「一键完美反推」时要**降低预期**：能省 60–70% 体力，剩下要人工。

**确认点**：🔴 confirm + 长耗时 → 先说明会生成什么、拿到同意再调。

## 四、⚠️ 模板 ↔ Excel 的变量契约（**最容易踩的坑**）

MC 渲染失败**最常见**的原因不是语法错，而是**模板的变量名与 Excel 表头不一致**。

```
模板里：  {{ hostname }}        ← 变量名
Excel 表头： 主机名              ← 不一致！→ UndefinedError
```

**对齐流程**：

```
1. read_excel    {"projectName":"...", "excelName":"params.xlsx"}
     → 拿到确切表头
2. read_file     {"projectName":"...", "filePath":"templates/ASW.j2"}
     → 拿到模板里的 {{ ... }}
3. 逐字比对（含空格、大小写、下划线）
4. analyze_project {"projectName":"..."}   ← 交叉引用检查兜底
```

→ **不要凭记忆假设表头**。中文表头、下划线位置、大小写都是常见不一致点。

## 五、写模板

```
write_text_file {"projectName": "...", "filePath": "templates/new.j2", "content": "..."}
```

🟡 **notify**。**覆盖语义**，不是追加 —— 改已有模板前先 `read_file` 读全文，改完整体写回。

> ⚠️ 项目已有的 `templates/` 下可能有多个 j2 文件 —— 先 `list_project_files` 确认路径。

## 六、改模板内容（**与改元数据区分**）

| 想改 | 用 |
|---|---|
| 模板正文（`.j2`） | `write_text_file` |
| 模板元数据（含 `template.meta.json`） | `update_project` |

⚠️ **MC 没有独立的 `update_template` 写正文**吗？**有**：

```
update_template {"templateName": "...", "content": "..."}     🟡 notify
```

- `update_template` 改的是**模板中心（example）的模板**，不是项目内模板
- `write_text_file` 改的是**项目内**文件

**判据**：
- 改「共享模板」→ `update_template`
- 改「这个项目的模板副本」→ `write_text_file`

## 七、模板与项目的关系

```
example/         模板中心（共享，被 create_from_template 复制）
  <模板名>/
    templates/*.j2
    excel/*.xlsx
    template.meta.json

workspace/
  <项目名>/      项目（从模板复制出来的独立副本）
    templates/*.j2     ← write_text_file 改这里
    excel/*.xlsx
    output/            ← render_config 写这里
```

→ **改模板中心会影响后续新建项目；改项目只影响该项目。** 要问清用户意图。

## 八、⚠️ 已知缺口（如实告知）

| 缺口 | 表现 |
|---|---|
| MC 设备库仅 13 台 | **无 H200 / B300 / Q3400 / Spectrum-X** |
| `project_single.py:423` | **无条件产全部角色 j2**，不能按需只出部分角色 |
| B300 档案自相矛盾 | 描述 2×400G vs 字段 8×800G → 以**字段 8×800G** 为准 |
| Q3400 描述 | 写 NDR，应为 **XDR** |
| `switches/storage/` | 5 台全以太，**无 IB 存储交换机** |

→ 用户要写 H200/B300 的模板 → 先确认设备档案存在；不存在说「MC 设备库没有，需先补档案」。

## 九、模板骨架的既有基准（**扩命令族照它写**）

MC 现模板即「**Leaf 400G 1分2 → 200G 下联 GPU**」：

- 子口命名基准：`TwoHundredGigE1/0/1:1` / `TwoHundredGigE1/0/1:2`
- 实现参考：`roce_templates.py` / `verify_baseline.py`

→ 要扩新厂商/新速率（如 X400 族）→ **在此基线上扩命令族**，不要另起一套写法。

## 常见坑

| 坑 | 正解 |
|---|---|
| 渲染报 `Undefined` 就改模板 | 先 `read_excel` 比对表头，大概率是变量名不一致 |
| 凭记忆假设 Excel 表头 | 必须 `read_excel` 拿确切值 |
| 分不清 `update_template` 和 `write_text_file` | 前者改模板中心，后者改项目内 |
| 期望 `reverse_engineer_config` 完美反推 | 正则驱动，只出骨架，需人工补 |
| 改模板中心以为只影响本项目 | 会影响后续新建项目 |
| 对 H200/B300 写模板 | MC 设备库没有这些档案 |

## 下一步

- 写完模板去渲染 → `mc-render-flow`
- 项目操作 → `mc-project-ops`
- 沉淀模板经验 → `mc-knowledge-skill`
