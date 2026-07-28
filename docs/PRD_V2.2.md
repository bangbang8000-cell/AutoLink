# AutoLink V2.2 PRD — 精细化打磨与缺陷修复

> V2.1 完成了架构重构。V2.2 聚焦于缺陷修复、数据校准、交互完善。

---

## 一、问题诊断总表

| # | 问题 | 根因定位 | 严重度 |
|---|------|---------|--------|
| 1 | 设备库移到 ActivityBar | `ActivityType` 无 `device_library` 类型 | 功能缺失 |
| 2 | 菜单功能未关联 | MenuBar 24个菜单项全部无 `action` 回调 | **Bug** |
| 3 | ActivityBar 高亮异常 | `handleActivityClick` 对 design/workbench/visualization 不调 `setActiveActivity` | **Bug** |
| 4 | 输出/模板文件不列举 | IPC 链路正确，需验证运行时数据 | 待验证 |
| 5 | 机柜无法分配设备 | `rack.store.ts:167` `devices: []` 丢弃了已收集的设备数据 | **Bug** |
| 6 | 存储服务器移除参数网 | 存储网络在后端已独立于参数网，无需移除；前端WizardStep中存储交换机不受协议切换联动 | 确认无需改动 |
| 7 | 设备数据错误 | 4个文件端口速率错误、2个品类描述错误、1个散热方式错误 | **数据错误** |
| 8 | 拓扑图密集+圆形节点 | `symbolSize` 强制圆形；节点尺寸偏小 | UI优化 |
| 9 | 机柜上架和Excel导出 | 放置UI缺失；因#5 bug导致设备从未被放置 | 功能缺失 |

---

## 二、详细修复规格

### 缺陷 #2：菜单栏功能关联

**根因**: [MenuBar.tsx](file:///D:/mycoding/AutoLink/src/components/layout/MenuBar.tsx) — 24个菜单项的 `action` 字段全部为空。

**修复方案**：为每个菜单项填充 `action` 回调，传入所需的 store hooks。

| 菜单 | 菜单项 | action 实现 |
|------|--------|------------|
| 文件 | 新建项目 | 触发 `CreateProjectWizardModal` |
| 文件 | 打开项目目录 | `window.electron.shell.showItemInFolder(projectPath)` |
| 文件 | 在文件管理器中打开 | 同上 |
| 文件 | 保存配置 | `designStore.saveConfig()` |
| 文件 | 退出 | `window.electron.window.close()` |
| 编辑 | 首选项 | `setActiveActivity('settings')` |
| 视图 | 文件浏览器 | `toggleSidebar()` |
| 视图 | 日志面板 | `togglePanel()` |
| 视图 | 全屏 | `window.electron.window.maximize()` |
| 项目 | 验证拓扑 | `designStore.validate(projectName)` |
| 项目 | 渲染输出 | 触发工作台渲染 |
| 帮助 | 快捷键参考 | 打开设置→快捷键分类 |
| 帮助 | 检查更新 | `window.electron.app.checkUpdate()` |
| 帮助 | 关于 | 打开 AboutDialog |

**MenuBar 改造**：从纯展示组件改为接收必要的回调 props，或在组件内部直接使用 Zustand stores。

### 缺陷 #3：ActivityBar 高亮

**根因**: [App.tsx](file:///D:/mycoding/AutoLink/src/App.tsx) L103-116 — `handleActivityClick` 仅对 project/settings 调用 `setActiveActivity`，design/workbench/visualization 跳过后仅 `openTab`。

**修复**: 对所有活动都调用 `setActiveActivity(activity)`，无论是否在 WORKSPACE_TAB_CONFIG 中。

```typescript
const handleActivityClick = useCallback((activity: ActivityType) => {
  setActiveActivity(activity)  // 始终更新
  const config = WORKSPACE_TAB_CONFIG[activity]
  if (config) {
    openTab({ type: config.type, title: config.title, closable: config.closable })
  }
}, [openTab, setActiveActivity, selectedProjectName])
```

### 缺陷 #4：输出/模板文件不列举

**根因**: IPC 链路（handlers → preload → FileExplorer）代码正确。问题可能在运行时目录不存在。

**修复**:
1. 在 `electron/config.ts` 的 `ensureDemoProjects` 中检查输出目录是否存在
2. 在 `OutputSection` 和 `TemplateSection` 组件中增加加载失败的错误提示
3. 确认 `project:listOutputBatches` 返回空数组时显示"暂无输出批次"（已有）

### 缺陷 #5：机柜设备分配

**根因**: [rack.store.ts](file:///D:/mycoding/AutoLink/src/stores/rack.store.ts) L167 — `devices: []` 应改为 `devices: c.devices`

**修复**:
```typescript
// L161-168 修改为：
const cabinets: RackCabinet[] = Array.from(cabinetMap.values()).map((c) => ({
  id: c.id,
  name: c.name,
  totalU: rackType,
  type: 'gpu' as CabinetType,
  power_limit: powerLimit,
  devices: c.devices,  // ← 修复
}))
```

同时，`unplacedDevices` 中应移除已放置到机柜中的设备（当前是全部放入 unplaced）。

### 缺陷 #7：设备库数据校准

#### P0 严重错误（4个文件）

| 文件 | 错误 | 修正 |
|------|------|------|
| `nvidia_sn5400_64_200g.json` | `port_speed: "400G"` | → `"200G"` |
| `huawei_ce6860_48s6cq.json` | 25G交换机标为200G存储交换机 | 全字段重写：`port_speed: "25G"`, `port_type: "SFP28"`, category → `switches_biz` |
| `h3c_s5560x_54s_ei.json` | `port_speed: "25G"` | → `"10G"`, `port_type: "SFP+"` |
| `nvidia_sn4600c.json` | `port_speed: "200G"` | → `"100G"`, `port_type: "QSFP28"` |

#### P1 中等错误（4个文件）

| 文件 | 问题 | 修正 |
|------|------|------|
| `huawei_ce8860_4c_ei.json` | 模块化交换机描述误导 | 修正描述或在 tags 标注"模块化" |
| `h3c_s9820_8c.json` | 同上 | 同上 |
| `ruijie_rg_s6250.json` | RG-S6250 品类待核实（交换机前缀） | 核实后处理 |
| `inspur_nf5688m7.json` | U 高 8U 偏大 | → `6U` |

#### P2 轻微问题

| 项目 | 修正 |
|------|------|
| `huawei_atlas_900.json` cooling | 增加 `tags: ["液冷"]` |
| 全局交换机 | 统一数据结构，增加 `mgmt_ports` 字段 |
| 全局 | 补充 Dell/超微/Arista 品牌设备 |

### 缺陷 #8：拓扑图矩形节点 + 缩放优化

**当前**: 圆形节点 (`symbolSize`)，22-40px，大拓扑密集。

**优化**:
1. 使用 `symbol: 'rect'` + `symbolSize: [width, height]` 实现矩形节点
2. 服务器：`[100, 24]`（横长条）；交换机：`[80, 40]`（矩形）
3. 节点内显示简短名称
4. 初始缩放自动适应：用 `scaleLimit.min` 设置更小的缩放下限（0.15）
5. 添加自动排列按钮（重新计算 layout）

### 缺陷 #9：机柜上架UI + Excel导出

**机柜放置UI**（RackTab 增强）:
1. 左侧：待分配设备列表（可拖拽）
2. 中间：机柜U位网格视图
3. 点击待分配设备 → 选择目标 U 位 → 放置
4. 设备冲突红色高亮

**Excel 导出**（已有基础，需验证）:
- `rack.store.ts` 的 `exportToExcel` 已实现上机表导出
- 需确认按钮可见且功能正常

### 功能 #1：ActivityBar 增加设备库入口

**修改文件**:
1. `ui.store.ts`: `ActivityType` 新增 `'device_library'`
2. `ActivityBar.tsx`: 活动列表增加第 6 项（Cpu 图标，Ctrl+Shift+L）
3. `App.tsx`: `handleActivityClick` 处理 `device_library`
4. `FileExplorer.tsx`: 新增 `DeviceLibraryExplorer` 模式（分类树）
5. `WorkspaceView.tsx`: device_library 类型渲染 DeviceLibraryTab

---

## 三、开发计划

### 阶段一：阻塞性 Bug 修复（P0，2天）

| # | 任务 | 文件 |
|---|------|------|
| B1 | rack.store `devices: []` → `devices: c.devices` | rack.store.ts |
| B2 | RackTab 增加待分配设备列表 + 放置交互 | RackTab.tsx |
| B3 | ActivityBar 高亮修复 | App.tsx |
| B4 | MenuBar 全部菜单项关联 action | MenuBar.tsx, Header.tsx |

### 阶段二：设备库数据校准（P0，1.5天）

| # | 任务 | 文件 |
|---|------|------|
| D1 | 修正 4 个 P0 设备的端口速率/类型 | 4 个 JSON |
| D2 | 修正 4 个 P1 设备的描述/品类 | 4 个 JSON |
| D3 | ActivityBar 增加设备库入口 | 5 个 ts/tsx |
| D4 | DeviceLibraryExplorer 模式实现 | FileExplorer.tsx |

### 阶段三：拓扑图优化（P1，1天）

| # | 任务 | 文件 |
|---|------|------|
| T1 | 矩形节点 + 尺寸优化 | TopologyTab.tsx |
| T2 | 自动缩放适应 | TopologyTab.tsx |
| T3 | 节点内文本显示 | TopologyTab.tsx |

### 阶段四：验证与收尾（P0，1天）

| # | 任务 | 内容 |
|---|------|------|
| V1 | 全链路回归 | 创建设计→渲染→机柜放置→查看拓扑 |
| V2 | MenuBar 功能全覆盖测试 | 每个菜单项点击验证 |
| V3 | ActivityBar 6项高亮验证 | 切换高亮正确 |
| V4 | Vite 编译验证 | 零错误 |

---

## 四、修改文件清单

| 分类 | 文件 | 操作 |
|------|------|------|
| Store | `ui.store.ts` | 修改：新增 ActivityType |
| Store | `rack.store.ts` | 修复：devices: [] bug |
| Layout | `ActivityBar.tsx` | 修改：6项图标列表 |
| Layout | `MenuBar.tsx` | 修改：填补所有 action |
| Layout | `Header.tsx` | 修改：MenuBar props |
| Layout | `FileExplorer.tsx` | 修改：+DeviceLibraryExplorer |
| App | `App.tsx` | 修复：高亮+device_library处理 |
| Tabs | `RackTab.tsx` | 增强：放置交互UI |
| Tabs | `TopologyTab.tsx` | 优化：矩形节点+缩放 |
| Data | 8个设备 JSON | 修正：端口/品牌/U高 |
| Data | `library_index.json` | 更新：修正后的设备索引 |

---

> **评审确认后进入开发阶段。**
