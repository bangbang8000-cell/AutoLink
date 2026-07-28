# AutoLink V2.1 缺陷修复 PRD

> 本文档为 V2.1 开发过程中发现的 9 个缺陷的系统分析、修复方案与开发测试计划。
> 评审通过后方可开始编程。

---

## 问题分类

**全部 9 个问题均为产品缺陷，非环境/依赖缺失**。现有 `backend/requirements.txt`（openpyxl、pandas）和 `package.json` 已覆盖所有运行时依赖。

---

## 一、缺陷详细分析

### 缺陷 #1：设备清单缺失（功能缺失）

**现象**：Demo 项目一键渲染后，"设备清单"输出为空或内容不对。

**根因**：`backend/engine.py` 第 200-208 行的 `handle_export()` 中，`deviceList` 输出复用了 `exporter.py` 中的 `generate_summary_data()`。该函数（第 144-215 行）实际生成的是"网络设计摘要"（GPU数量、交换机数量、端口使用率、收敛比），不包含任何真实设备型号/厂商/功率/U位信息。

```python
# engine.py L200-208 — 当前实现
if 'deviceList' in output_types:
    summary_df = generate_summary_data(designer)  # ← 错误：生成设计摘要而非设备清单
    with pd.ExcelWriter(fn, engine='openpyxl') as writer:
        summary_df.to_excel(writer, sheet_name='设备清单', index=False)
```

**修复方案**：
- 在 `backend/exporter.py` 中新增 `generate_device_list()` 函数
- 从 `designer._device_profiles`（交换机引用）和拓扑节点统计中提取设备型号、数量、功耗、U位
- 输出列：设备类型 | 厂商 | 型号 | 数量 | 单机功耗(W) | U位高度 | 总功耗(W) | 总U位

**影响范围**：
- [backend/exporter.py](file:///D:/mycoding/AutoLink/backend/exporter.py) — 新增函数
- [backend/engine.py](file:///D:/mycoding/AutoLink/backend/engine.py) — 修改 deviceList 导出逻辑
- [src/stores/render.store.ts](file:///D:/mycoding/AutoLink/src/stores/render.store.ts) — 无需改动

---

### 缺陷 #2：新建向导弹窗高度不足（UI缺陷）

**现象**：小窗口模式下，设备选型(WizardStepDevices)和机柜(WizardStepRack)步骤内容溢出，"下一步"按钮不可见，无纵向滚动条。

**根因**：
1. `CreateProjectWizardModal.tsx` 第 42 行：弹窗外壳 `max-h-[85vh]`，扣除 header(~48px) + 步骤指示器(~48px) + footer(~36px)，在 900px 屏幕下内容区仅约 633px
2. `WizardStepDevices.tsx` 启用 4 个网络时，渲染 13+ 行配置项（含 DeviceLibraryPicker），内容远超可用高度
3. `ProjectWizard.tsx` 中 `flex-1 overflow-auto` 正确设置了滚动，但**实际不生效**——原因是 `CreateProjectWizardModal` 的外层 `flex-1 min-h-0` 与 `ProjectWizard` 的 `h-full` 链条存在 CSS 层叠上下文断裂

**修复方案**：
- 在每个 WizardStep 的内容区显式设置 `overflow-y-auto max-h-[calc(85vh-140px)]`
- 减小步骤指示器高度（`py-2` → `py-1.5`）
- DeviceLibraryPicker 中的 z-index 冲突：Picker 自身 `z-50` 与父弹窗冲突，需要提升到 `z-[60]`

**影响范围**：
- [src/components/wizard/CreateProjectWizardModal.tsx](file:///D:/mycoding/AutoLink/src/components/wizard/CreateProjectWizardModal.tsx) — 调整 max-h
- [src/components/wizard/ProjectWizard.tsx](file:///D:/mycoding/AutoLink/src/components/wizard/ProjectWizard.tsx) — 修复 overflow 链
- [src/components/wizard/WizardStepDevices.tsx](file:///D:/mycoding/AutoLink/src/components/wizard/WizardStepDevices.tsx) — 内容区 max-h
- [src/components/wizard/WizardStepRack.tsx](file:///D:/mycoding/AutoLink/src/components/wizard/WizardStepRack.tsx) — 内容区 max-h
- [src/components/wizard/DeviceLibraryPicker.tsx](file:///D:/mycoding/AutoLink/src/components/wizard/DeviceLibraryPicker.tsx) — z-index 修复

---

### 缺陷 #3：设备选型不能删除/替换（Bug）

**现象**：新建项目设备选型步骤中，默认设备 X 按钮点击无效，不能切换其他设备。GPU/存储/通算选型打开 picker 后与当前网络类型不对应。

**根因分析**：

**3a. 设备无法删除：[wizard.store.ts](file:///D:/mycoding/AutoLink/src/stores/wizard.store.ts) L67-68**
```typescript
updateDeviceRefs: (refs) =>
  set((s) => ({ config: { ...s.config, device_refs: { ...s.config.device_refs, ...refs } } })),
```
JavaScript 的 spread merge 只能新增/更新属性，**无法删除**旧属性。`WizardStepDevices.tsx` L190-197 的 `handleClear` 调用 `delete newRefs[refKey]` 后被 `updateDeviceRefs` 以 spread 方式合并回去，被删的 key 又恢复了。

**3b. 设备无法替换**：同上原因，即使选了新设备也是 spread merge，但替换场景下会被覆盖为新的 library_id，这是 OK 的。真正的问题在于**不能清空**——一旦选择了一个设备就无法取消选择回到"未选择"状态。

**3c. GPU/存储/通算 picker 不与网络类型对应**：
`WizardStepDevices.tsx` 第 351 行的 `DeviceLibraryPicker` 没有根据当前编辑的设备类型（GPU服务器/存储服务器/通算服务器）筛选设备分类，用户打开 picker 后看到的是全部设备而非该分类下的设备。

**修复方案**：
- 3a/3b：在 `wizard.store.ts` 中新增 `removeDeviceRef(refKey: string)` 方法，使用 `delete` 后再 set
- 3c：给 `DeviceLibraryPicker` 传入 `initialCategory` prop，根据当前设备类型过滤分类

**影响范围**：
- [src/stores/wizard.store.ts](file:///D:/mycoding/AutoLink/src/stores/wizard.store.ts) — 新增 removeDeviceRef
- [src/components/wizard/WizardStepDevices.tsx](file:///D:/mycoding/AutoLink/src/components/wizard/WizardStepDevices.tsx) — 修改 handleClear 调用，传入 category
- [src/components/wizard/DeviceLibraryPicker.tsx](file:///D:/mycoding/AutoLink/src/components/wizard/DeviceLibraryPicker.tsx) — 接收 initialCategory prop

---

### 缺陷 #4：IB 设备默认选型错误（逻辑缺陷）

**现象**：参数网 IB 设备默认值对所有 GPU 类型统一，不符合实际工程规范。

**根因**：[WizardStepDevices.tsx](file:///D:/mycoding/AutoLink/src/components/wizard/WizardStepDevices.tsx) L13-18

```typescript
const IB_DEFAULTS: Record<string, string> = {
  param_leaf_switch: 'nvidia_mqm9700_64_400g_ib',   // MQM9700 — OK for H100
  param_spine_switch: 'nvidia_q3200_72_800g_ib',    // Q3200 — 错误！应为 MQM9700（H100时代）
  param_core_switch: 'nvidia_q3400_144_800g_ib',    // Q3400 — 错误！应为 MQM9700（H100时代）
}
```

当前实现完全不考虑 GPU 代际（H100/B200/B300/GB300）。

**规范定义**：

| GPU 代际 | 网卡速率 | Leaf 默认 | Spine 默认 | Core 默认 |
|----------|---------|-----------|-----------|-----------|
| H100 及以下 (H800/H100/A100) | 400G NDR | MQM9700 | MQM9700 | MQM9700 |
| B200/B300 | 800G NDR | Q3200 | Q3400 | Q3400 |
| GB300 NVL72 | 800G NDR | Q3400 | Q3400 | Q3400 |

**修复方案**：
- 在 `WizardStepDevices.tsx` 中将 `IB_DEFAULTS` 改为 GPU 型号感知的二级映射
- 检测逻辑：从 `wizard.store` 中读取 `gpu_server` 的 `library_id`（如 `nvidia_dgx_h100` / `nvidia_dgx_b200` / `nvidia_dgx_gb300_nvl72`），匹配对应的交换机默认值

**影响范围**：
- [src/components/wizard/WizardStepDevices.tsx](file:///D:/mycoding/AutoLink/src/components/wizard/WizardStepDevices.tsx) — 新增 IB_DEFAULTS_BY_GPU 映射，修改 getDefaultRefs

---

### 缺陷 #5：暗色模式工作台右侧白色块（CSS 缺陷）

**现象**：暗色模式下，工作台区域文字右侧出现白色块。

**根因**：[WorkbenchPanel.tsx](file:///D:/mycoding/AutoLink/src/components/sidebar/WorkbenchPanel.tsx) L36，项目信息卡片的 `bg-white dark:bg-gray-800` 类名中，`dark:bg-gray-800` 在 Tailwind v3 中需要 `darkMode: 'class'` + `<html class="dark">` 配合。

从代码审查看，所有的 Workbench 子卡片（ScopeCard、ReadinessCard、OutputCard、ActionCard、ResultCard）都正确声明了 `dark:` 变体。**白色块最可能来自 `WorkbenchReadinessCard.tsx` 中 `bg-yellow-50` / `bg-green-50` / `bg-red-50` 这类浅色背景被暗色变体没有覆盖**。

另一个可能来源：`WorkbenchResultCard.tsx` 中 `resultLabels`（L13-18）的文本未设置 `dark:text-gray-xxx`。

**修复方案**：
- 检查所有 Workbench 子组件中的 `bg-*-50` 类，确保有对应 `dark:bg-*-900/20` 变体
- 补充缺失的 `dark:text-gray-*` 类
- 在 `WorkbenchPanel.tsx` L46 的 "Ready" 徽章的 `dark:bg-green-900/30` 确认生效

**影响范围**：
- [src/components/workbench/WorkbenchReadinessCard.tsx](file:///D:/mycoding/AutoLink/src/components/workbench/WorkbenchReadinessCard.tsx) — 暗色背景
- [src/components/workbench/WorkbenchResultCard.tsx](file:///D:/mycoding/AutoLink/src/components/workbench/WorkbenchResultCard.tsx) — 暗色文本
- [src/components/workbench/WorkbenchActionCard.tsx](file:///D:/mycoding/AutoLink/src/components/workbench/WorkbenchActionCard.tsx) — 暗色按钮状态

---

### 缺陷 #6：非中文语言含中文（i18n 缺失）

**现象**：切换到日语/韩语/繁体中文后，多处仍显示简体中文。

**根因**：

| 语言 | project.json | design.json | rack.json | workbench.json | topology.json |
|------|-------------|-------------|-----------|----------------|---------------|
| ja | 全部中文 | `{"title":""}` | `{"title":""}` | `{"title":""}` | `{"title":""}` |
| ko | 全部中文 | `{"title":""}` | `{"title":""}` | `{"title":""}` | `{"title":""}` |
| zh-TW | 全部中文 | `{"title":""}` | `{"title":""}` | `{"title":""}` | `{"title":""}` |

这些文件是从 zh-CN 直接复制但**未翻译**；design/rack/workbench/topology 四个 JSON 被清空为 `{"title":""}`。

此外，**组件中存在大量硬编码中文**（问题 #5 分析中已详列：WorkbenchResultCard、WorkbenchReadinessCard、WorkbenchActionCard、ImportCabinetsModal、RackPowerBar、DeviceImportModal、SwitchProfileForm、ServerProfileForm、WizardStepDevices、ErrorBoundary）。

**修复方案**：
- 翻译 ja/ko 的 project.json（共 16 个 key）
- 补充 ja/ko/zh-TW 的 design.json、rack.json、workbench.json、topology.json（参照 zh-CN）
- 将组件中的硬编码中文迁移到 i18n，工作量较大，建议分批处理

**影响范围**：
- 6 个 locale 目录的 18 个 JSON 文件
- 约 8 个组件中的硬编码中文字符串

---

### 缺陷 #7：拓扑生成报错"验证失败"（逻辑缺陷）

**现象**：生成拓扑后显示红色"验证失败"。

**根因**：`backend/designer.py` L719-757 的 `validate_topology()` 使用中文字符串匹配端口名来区分网络类型：

```python
# designer.py L731
if "参数" in conn.a_port:     # 匹配参数网连接
    # ...
elif "存储" in conn.a_port:   # 匹配存储网连接
    # ...
```

当端口名使用自定义前缀或设备库中的英文前缀（如来自 DeviceProfile 的 `downlink_prefix: "NIC"`）时，中文字符串无法匹配，导致计数错误，触发验证失败。

此外还可能触发验证失败的情况：
- 交换机端口数不足（`max_ports` 配置过小）
- 服务器端口配置与下行口数不一致
- Python 子进程异常退出

**修复方案**：
- 将端口名匹配改为基于 `conn.network_type` 属性的匹配（如果 Connection 对象有此属性）
- 如无此属性，在 `create_network_objects()` 中为每条连接标注网络类型
- 增加更友好的验证错误消息，明确告知哪个检查项未通过

**影响范围**：
- [backend/designer.py](file:///D:/mycoding/AutoLink/backend/designer.py) — 修改 validate_topology() 和 create_network_objects()
- [backend/models.py](file:///D:/mycoding/AutoLink/backend/models.py) — Connection 类增加 network_type 字段（如需要）
- [backend/engine.py](file:///D:/mycoding/AutoLink/backend/engine.py) — 优化错误消息返回

---

### 缺陷 #8：机柜无法加载到工作区展示（功能缺失）

**现象**：生成的机柜布局无法在工作区视图中展示，点击后只见机柜列表。

**根因分析**：

**8a. 初始化逻辑 Bug：[RackPanel.tsx](file:///D:/mycoding/AutoLink/src/components/sidebar/RackPanel.tsx) L30-50**

两个 `useEffect` 的执行顺序导致拓扑数据被丢弃：
1. 第一个 useEffect (L30-44)：`loadRackLayout()` → 找不到文件 → `initDefault(134)` → `cabinets.length = 4`
2. 第二个 useEffect (L46-50)：检查 `cabinets.length === 0` → false → **永远不调用 `initFromTopology()`**

这意味着拓扑设计计算出的精确机柜数据（含每个服务器的 cabinet_id/start_u/end_u）被丢弃，用户总是看到 4 个空默认机柜。

**8b. 缺少独立的机柜可视化组件**

`WorkspaceView.tsx` 中 `rack` 类型页签渲染的是 `<RackPanel />`（侧边栏面板），只显示机柜列表（名称 + 使用率），没有渲染机柜内部的 U 位网格视图。

PRD V2.1 规划的 `RackTab.tsx`（全尺寸 42U 机柜网格视图）未实现。

**8c. initFromTopology 丢弃 topology 中的机柜数据**

`rack.store.ts` L108-139 的 `initFromTopology()` ：
- 仅用服务器数量计算所需机柜数（`Math.ceil(serverCount / 42)`）
- 完全忽略 topology nodes 中已有的 `cabinetId`、`cabinetName`、`startU`、`endU`
- 硬编码每个设备 `height: 4`、`power_watts: 2000`

**修复方案**：
- 8a：修改 RackPanel.tsx 初始化逻辑，优先从 topology 导入，仅在无 topology 时 fallback 到默认
- 8b：创建 `RackTab.tsx`（全尺寸机柜网格视图），WorkspaceView 根据 tab.state.cabinetId 渲染对应机柜
- 8c：重构 `initFromTopology()` 使用 topology 中的实际机柜分配数据

**影响范围**：
- [src/components/sidebar/RackPanel.tsx](file:///D:/mycoding/AutoLink/src/components/sidebar/RackPanel.tsx) — 修复初始化顺序
- [src/stores/rack.store.ts](file:///D:/mycoding/AutoLink/src/stores/rack.store.ts) — 重构 initFromTopology
- [src/components/workspace/tabs/RackTab.tsx](file:///D:/mycoding/AutoLink/src/components/workspace/tabs/RackTab.tsx) — **新建**：全尺寸机柜视图
- [src/components/workspace/WorkspaceView.tsx](file:///D:/mycoding/AutoLink/src/components/workspace/WorkspaceView.tsx) — 修改 rack 类型渲染

---

### 缺陷 #9：生成的 Excel 无法在工作区加载（功能缺失）

**现象**：渲染生成的 Excel 文件（连接关系表、上机表），点击后在工作区无法预览内容。

**根因**：

**9a. 缺少文件内容查看器组件**

`WorkspaceView.tsx` 中 `output` 类型页签渲染的是 `<OutputPanel />`（侧边栏文件列表），该组件：
- 从文件系统列出文件（`window.electron.project.listOutputFiles()`）
- 点击文件时调用 `openTab({ type: 'output', state: { fileName, fileType } })`
- 但 WorkspaceView 渲染 `output` 标签时，**完全不读取 `tab.state.fileName`**，始终渲染文件列表

**9b. tab state 完全被忽略**

`OutputPanel` 不接受 `fileName` 参数，它的渲染逻辑完全独立于标签页状态。

**9c. 缺少 Excel 渲染基础设施**

需要以下能力来渲染 Excel 文件内容：
- 通过 IPC `getFileBinary` 获取文件的 Base64 数据
- 用 `xlsx` 库解析 Excel 为行列数据
- 渲染为 HTML 表格（需考虑大表格性能，建议使用虚拟滚动或分页）

**修复方案**：
- 创建 `OutputTab.tsx`：接收 `fileName` + `fileType`，根据类型渲染不同内容
  - `.xlsx`/`.xls` → Excel 表格查看器（多 Sheet 切换）
  - `.png`/`.jpg` → 图片查看器
- `WorkspaceView.tsx` 中 `output` 类型改为渲染 `OutputTab`，传入 `tab.state`
- Excel 查看器使用项目已有的 `xlsx` 依赖 (`npm: xlsx`) 解析文件

**影响范围**：
- [src/components/workspace/tabs/OutputTab.tsx](file:///D:/mycoding/AutoLink/src/components/workspace/tabs/OutputTab.tsx) — **新建**：文件预览页签
- [src/components/workspace/WorkspaceView.tsx](file:///D:/mycoding/AutoLink/src/components/workspace/WorkspaceView.tsx) — 修改 output 类型渲染
- [src/components/sidebar/OutputPanel.tsx](file:///D:/mycoding/AutoLink/src/components/sidebar/OutputPanel.tsx) — 无需改动（精简版文件列表）
- [electron/ipc/handlers.ts](file:///D:/mycoding/AutoLink/electron/ipc/handlers.ts) — 确认 getFileBinary 可用

---

## 二、影响范围汇总

| 缺陷 | 类型 | 新增文件 | 修改文件 | 涉及后端 |
|------|------|---------|---------|---------|
| #1 设备清单 | 功能缺失 | 0 | 2（exporter.py, engine.py） | 是 |
| #2 向导弹窗高度 | UI缺陷 | 0 | 5（Modal/Picker/Wizard Step） | 否 |
| #3 设备不能删除 | Bug | 0 | 3（store/Step/Picker） | 否 |
| #4 IB默认值 | 逻辑缺陷 | 0 | 1（WizardStepDevices） | 否 |
| #5 暗色白色块 | CSS缺陷 | 0 | 3（Workbench子卡片） | 否 |
| #6 i18n缺失 | 数据缺失 | 0 | 18（locale JSON）+ 8组件 | 否 |
| #7 拓扑验证失败 | 逻辑缺陷 | 0 | 3（designer.py, models.py, engine.py） | 是 |
| #8 机柜无法加载 | 功能缺失 | 1（RackTab.tsx） | 3（Panel/Store/View） | 否 |
| #9 Excel无法预览 | 功能缺失 | 1（OutputTab.tsx） | 2（View/IPC） | 否 |

---

## 三、开发计划

### 阶段一：阻塞性 Bug 修复（优先级 P0，预计 3 天）

| # | 任务 | 文件 | 关联缺陷 |
|---|------|------|---------|
| P0-1 | wizard.store 新增 removeDeviceRef | wizard.store.ts | #3 |
| P0-2 | WizardStepDevices 修复删除和分类筛选 | WizardStepDevices.tsx, DeviceLibraryPicker.tsx | #3 |
| P0-3 | 修复向导弹窗滚动和 z-index | CreateProjectWizardModal.tsx, ProjectWizard.tsx, WizardStepDevices.tsx, WizardStepRack.tsx, DeviceLibraryPicker.tsx | #2 |
| P0-4 | 修复 RackPanel 初始化逻辑 | RackPanel.tsx, rack.store.ts | #8 |
| P0-5 | 修复 topology 验证逻辑 | designer.py, models.py | #7 |

### 阶段二：功能补全（优先级 P0，预计 4 天）

| # | 任务 | 文件 | 关联缺陷 |
|---|------|------|---------|
| P0-6 | 实现 generate_device_list() | exporter.py（新增函数）, engine.py（修改调用） | #1 |
| P0-7 | 实现 IB_DEFAULTS_BY_GPU 映射 | WizardStepDevices.tsx | #4 |
| P0-8 | 创建 RackTab.tsx（全尺寸机柜视图） | **新建** RackTab.tsx, 修改 WorkspaceView.tsx | #8 |
| P0-9 | 创建 OutputTab.tsx（Excel/图片预览） | **新建** OutputTab.tsx, 修改 WorkspaceView.tsx | #9 |
| P0-10 | 暗色模式修复 | WorkbenchReadinessCard.tsx, WorkbenchResultCard.tsx, WorkbenchActionCard.tsx | #5 |

### 阶段三：i18n 完善（优先级 P1，预计 2 天）

| # | 任务 | 文件 | 关联缺陷 |
|---|------|------|---------|
| P1-1 | 翻译 ja/ko 的 project.json | 2 个 JSON 文件 | #6 |
| P1-2 | 补充 ja/ko/zh-TW 的 design/rack/workbench/topology | 12 个 JSON 文件 | #6 |
| P1-3 | 组件硬编码中文迁移（第一批：Workbench 系列） | WorkbenchResultCard, WorkbenchReadinessCard, WorkbenchActionCard | #6 |
| P1-4 | 组件硬编码中文迁移（第二批：设备/向导系列） | ImportCabinetsModal, RackPowerBar, DeviceImportModal, SwitchProfileForm, ServerProfileForm, ErrorBoundary | #6 |

### 阶段四：集成验证（P0, 预计 1 天）

| # | 任务 |
|---|------|
| I-1 | 全链路回归测试（创建项目 → 设计拓扑 → 渲染 → 查看输出） |
| I-2 | 交叉平台验证（Windows/macOS/Linux） |
| I-3 | 5 种语言切换验证 |

---

## 四、测试计划

### 4.1 缺陷修复验证用例

| 缺陷 | 测试用例 | 预期结果 |
|------|---------|---------|
| #1 | Demo-128台H100 → 工作台 → 勾选"设备清单" → 一键渲染 → 查看输出 | 输出目录下生成 `设备清单_full_*.xlsx`，内容含：设备类型、厂商、型号、数量、单机功耗、总功耗、U位 |
| #2 | 新建项目向导 → 4 个网络全选 → 设备选型步骤 → 缩小窗口到 900px 高 | 内容区可纵向滚动，底部"下一步"按钮始终可见 |
| #3a | 新建项目 → 设备选型 → 点击默认 GPU 服务器的 X 按钮 | 该项变为"选择设备"占位按钮 |
| #3b | 新建项目 → 设备选型 → 点击已选设备 → 在 picker 中选择另一个 | 设备成功替换 |
| #3c | 设备选型 → 点击 GPU 服务器的"选择设备" → 打开 picker | picker 默认显示 GPU 服务器分类 |
| #4 | 新建项目 → 选 H100 模板 → 检查参数网交换机默认值 | Leaf/Spine/Core 均为 MQM9700 |
| #4 | 新建项目 → 选 B300 对应的 GPU → 检查参数网交换机默认值 | Leaf: Q3200, Spine/Core: Q3400 |
| #5 | 暗色模式 → 工作台 → 检查所有卡片和文字 | 无白色块，所有文字可读 |
| #6 | 切换到日语 → 浏览项目浏览器、设计面板、工作台 | 全部日语文本，无中文 |
| #6 | 切换到韩语 → 同上 | 全部韩语文本，无中文 |
| #6 | 切换到繁体中文 → 同上 | 全部繁体中文，无简体中文 |
| #7 | Demo 项目 → 拓扑设计 → 修改端口参数 → 生成拓扑 | 无"验证失败"错误（除非确实配置不合理） |
| #7 | 验证失败时 → 查看错误消息 | 明确告知哪个检查项未通过（如"参数网连接数不足"） |
| #8 | 拓扑设计 → 生成拓扑 → 切换到机柜规划 | 正确显示拓扑计算的机柜和设备分配 |
| #8 | 侧边栏机柜列表 → 点击机柜 → 工作区打开 | 全尺寸 42U 网格视图，显示每个 U 位的设备 |
| #9 | 渲染输出 → 输出面板 → 点击 .xlsx 文件 | 工作区新标签页显示 Excel 内容表格，支持 Sheet 切换 |
| #9 | 渲染输出 → 输出面板 → 点击 .png 文件 | 工作区新标签页显示拓扑图，支持缩放 |

### 4.2 回归测试用例

| # | 测试场景 | 步骤 |
|---|---------|------|
| R1 | 完整 Demo 流程 | Demo-128台H100 → 拓扑设计 → 生成拓扑 → 机柜规划 → 工作台一键渲染 → 查看 4 种输出 |
| R2 | 新建空项目流程 | 新建项目(空模板) → 配置网络 → 设备选型 → 生成拓扑 → 机柜规划 → 渲染 |
| R3 | 新建向导流程 | 新建项目 → 基本信息 → 选择网络 → 设备选型 → 机柜配置 → 确认创建 → 进入设计 |
| R4 | 多语言切换 | zh-CN → en → ja → ko → zh-TW，每步检查核心 UI 无中文残留 |
| R5 | 主题切换 | 亮色 → 暗色 → 跟随系统，检查全部界面可读性 |

---

## 五、部署文档更新

现有 [deployment.md](file:///D:/mycoding/AutoLink/docs/deployment.md) 已完整覆盖环境要求（Node.js >= 22, Python >= 3.10, openpyxl + pandas）。本次修复**不引入新依赖**，无需更新部署文档。

以下是更新建议（可选，非阻塞）：
- 补充 Windows 上 Python 路径配置说明（如何指定非系统默认 Python）
- 补充 `npm run dev:all` 首次启动可能较慢的提示（需先编译 TypeScript → dist-electron/）

---

## 六、风险评估

| 风险 | 等级 | 缓解措施 |
|------|------|---------|
| RackTab.tsx 全尺寸机柜视图工作量可能超出预估 | 中 | 先实现基础版（42U 色块 + 设备名），后期增强拖拽/详情面板 |
| OutputTab.tsx Excel 大文件渲染性能 | 低 | 使用 xlsx 库的分页读取 + 分页导航，单页显示 100 行 |
| i18n 翻译质量（ja/ko 需外部验证） | 低 | ja/ko 使用 LLM 翻译 + 标注"待人工审核" |

---

> **评审确认后进入开发阶段。请逐项审批以上分析与方案。**
