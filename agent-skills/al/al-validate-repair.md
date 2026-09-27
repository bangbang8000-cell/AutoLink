---
name: "al-validate-repair"
description: "AL 规划域的校验与智能修复闭环：跑校验读 rule_id 级问题、生成修复方案、应用修复并复核。当用户说「这个配置有什么错误」「帮我修一下」「校验一下设计」「为什么校验不过」时使用。含 V001–V022 规则定位、repair_plan→用户挑选→repair_apply 的正确流程、golden 基线纪律。"
---

# AL 校验与智能修复

## 一、四个工具

| 工具 | 权限 | 用途 |
|---|---|---|
| `validate_design` | 🟢 auto | 跑校验，返回 `{valid, errors, validationIssues}` |
| `repair_plan` | 🟢 auto | 产出**修复方案**（不落盘） |
| `repair_apply` | 🟡 notify | **应用**修复并复核 |
| `estimate` | 🟢 auto | 规模估算（PUE / 收敛比） |

## 二、校验

```
validate_design {"configFile": "<project_config.json 或 network_config.ini 路径>"}
```

返回的 `validationIssues` 每条含四个字段：

| 字段 | 用途 |
|---|---|
| `rule_id` | 规则编号（V001–V022） |
| `severity` | 严重度（`error` / `warning`） |
| `message` | 问题描述 |
| **`recommendation`** | **修复建议** |

> ⚠️ **直接引用 `recommendation` 讲给用户**，这是产品内置口径，比你自己编的准。
> 不要只报 `message` 然后自己猜修法。

## 三、修复闭环（**三步走，中间必须停**）

```
① repair_plan   {"configFile": "..."}         🟢 auto
     ↓ 返回可自动修复的 error 项 + patch
② 把修复项列给用户挑选                          ⚠️ 必经确认点
     ↓ 用户选定
③ repair_apply  {"configFile": "...", "fixes": [{"rule_id":"V002","patch":{...}}]}   🟡 notify
     ↓ 合并写入 → 宽松校验 → 写回 → 重新校验返回剩余错误
```

**`repair_plan` 支持的规则**（可自动修复的）：

| rule_id | 主题 |
|---|---|
| V002 | 机柜功率 |
| V007 | Rail |
| V010 | 收敛比 |
| V016 | 网卡容量 |
| V018 | Scale-Up 域 |
| V019 | 供电 |
| V020 | ZCube |

→ 不在这个列表里的 error **不能自动修**，只能向用户解释。

> ⚠️ **不要自动 apply 全部修复项**，必须让用户挑。

`repair_apply` 是**长耗时**工具 → 自动异步 → `task_wait`。

## 四、⚠️ 校验规则的三个已知陷阱

### 陷阱 1：`rule_id` 数量 = 22（V001–V022）

用户问「有多少条校验规则」→ **22 条**。

### 陷阱 2：跨模块键名耦合会静默放行（**血训 ×3**）

历史缺陷：`engine` 读 `需求上联总数`，而生产者写的是 `上联需求总数`（**字序颠倒**）。

后果：
```python
.get("需求上联总数", 0)   # 恒读 0
```
⇒ 校验**静默放行**（以为需求是 0，一切通过）。

> **手搓 cfg 的单测全绿也漏掉** ⇒ 必须有「生产者 → 消费者」**端到端**用例。
> 外部 Agent 若发现「校验说没问题，但连接表数字明显不对」→ 优先怀疑这类键名耦合。

### 陷阱 3：`valid=false` 时阻断导出

5.3.0 裁定 D2：**超限阻断导出 + `valid=False`**。
→ 所以「导出失败」有时根因是**校验没过**，不是导出本身的问题。先 `validate_design` 再看。

### 陷阱 4：单柜功率默认 12000W

7 处后端 + 6 处前端全链路统一。V002 校验用这个值。
→ 用户见到 6000 的旧文档数字，以 **12000** 为准。

## 五、⚠️ golden 基线纪律（**改缺陷时必读**）

`tests/backend/golden/` 有 **28 个 JSON** 基线（23 模板 + 3 双平面 + 2 ZCube）。

> ⚠️ **修缺陷时，基线可能编码的正是错计数。**
> ⇒ 必须**同批重生成 + 逐条归因**。
> ⇒ **无法解释的差异，当缺陷回退排查**，不要「反正基线红了就更新基线」。

另外：写 golden JSON 必须 `newline='\n'`（否则 CRLF 与 `.gitattributes` 打架 → 内容未变却显示已改）。

## 六、⚠️ 门禁顺序（本地「四连」不够）

CI 的实际顺序（fail-fast）：

```
typecheck → lint → test:report → build:renderer → build:electron
  → Security baseline → validate_templates → validate_device_library
  → doc numbers → conflict markers → changelog claims
  → gen_golden --check → pytest
```

**关键**：`validate_templates.py`（23 套模板端到端，JSON + INI 双路径）是 **INI 路径的唯一端到端门禁**。

> ⚠️ 本地惯跑的「门禁四连」**不含它** ⇒ 本地全绿而 CI 红。
> **改 `designer.py` 必须跑 `validate_templates.py`。**

改 `designer._link_speed_for()` 同样**必须跑 `validate_templates.py`**（分光口径变更）。

## 七、常见坑

| 坑 | 正解 |
|---|---|
| 只报 `message` 自己猜修法 | 用产品给的 `recommendation` |
| 自动 apply 全部修复 | 让用户挑 |
| 校验说没问题就信 | 键名耦合会静默放行 → 对数字 |
| 基线红了就更新基线 | 同批重生成 + 逐条归因 |
| 本地四连绿了就当没问题 | 补 `validate_templates.py` |
| 以为单柜功率是 6000 | 已是 **12000W** |
| 改 `designer.py` 不跑模板门禁 | 必跑 `validate_templates.py` |

## 下一步

- 修完重跑设计 → `al-design-flow`
- 导出 → `al-export-delivery`
- 跨端渲染 → `cross-plan-to-render`
