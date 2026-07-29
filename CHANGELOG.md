# CHANGELOG

## [2.4.0] - 2026-07-29

### Phase A: 数据资产扩展
- 设备库从 56 款扩展至 109+ 款
- 新增光模块库（30 款，100G-1.6T 全速率覆盖）
- 新增并行文件系统存储节点（BeeGFS、IBM Scale、WekaIO、DDN、VAST）
- 新增国产化 GPU（华为昇腾 910B、海光 K100 AI、寒武纪 MLU590）
- 新增 7 套智算场景模板（SuperPOD-256、NVL72、L20-推理等）

### Phase B: 后端引擎
- Rail-Optimized 拓扑算法（NVIDIA SuperPOD 8-Rail 架构）
- PUE 估算模型（风冷 / 冷板液冷 / 浸没式液冷）
- 收敛比计算（参数网 / 存储网 / 业务网）
- 规则校验引擎（10 条核心规则）
- 光模块智能选型器

### Phase C: 后端导出
- 布线指导表导出（含光模块型号、长度估算、成本）
- BOM 成本估算导出
- 报告数据生成（概览/架构/功耗/光模块/成本/校验）

### Phase D: 前端智能专业能力对接
- PUE 估算结果展示组件（能耗分解、达标判断、参数化重新估算）
- 报告数据可视化展示组件（可折叠，按需加载）
- 新增 cablingGuide / bom 导出选项

### 可视化重构（P0 重点）
- 拓扑渲染引擎从 ECharts 迁移至 react-flow
- 分层 × 分区 × 分组三维防重叠布局
- 节点拖拽、框选、缩放、小地图
- 参数网/存储网/业务网/OOB 功能分区

### 打包与部署
- 修复打包后模板路径（`resourcesPath/template`）
- 安装包内置 11 套场景模板 + 109+ 款设备库
- 首次启动自动创建 3 个示例项目
- 三平台 CI 矩阵（Windows NSIS / macOS DMG x64+arm64 / Linux AppImage+DEB）

---

## [2.3.0] - 2026-07-29

### 设计系统
- 新增 Tailwind 语义色系：`success`、`error`、`warning`、`info`
- 新增暗色模式自定义滚动条样式
- 新增 CSS Design Tokens（`--color-surface`、`--radius-*`、`--font-size-base`）
- 新增 `prefers-reduced-motion` 适配
- 新增共享 UI 组件库（`Button`、`Input`、`Select`、`EmptyState`、`SectionCard`、`FormSection`、`NumberInput`）

### 缺陷修复
- 修复 Toast 无最大条数限制（最多 5 条）
- 向导创建项目失败现在会显示错误 Toast
- 错误边界合并为通用组件，支持重试时强制重新挂载
- 修正 `app:getVersion` 从 `package.json` 动态读取版本号
- 移除 `handlers.ts` 中 `categoryPathMap` 三处重复定义，提取为模块常量
- 移除菜单中无功能的"撤销/重做"项

### 交互优化
- 新增 `Ctrl+S` 快捷键触发保存配置
- 新增 Tab 右键菜单（关闭 / 关闭其他 / 关闭右侧 / 关闭全部）
- 新增首次使用引导（"新建项目 / 打开 Demo"按钮）
- Resizable 面板拖拽手柄始终可见（`bg-gray-200`）
- ActivityBar 选中态增强（`bg-primary-100 dark:bg-primary-900/40`）

---

## [2.2.0] - 2026-07-29

### Bug 修复
- 修复 `rack.store` 中 `initFromTopology` 设备丢失 bug
- 修复 ActivityBar 切换后高亮不更新的问题
- 修复 4 个 P0 设备数据错误（端口速率/类型/品类）

### 功能增强
- MenuBar 全部 24 个菜单项关联功能回调
- ActivityBar 新增设备库入口（Cpu 图标，Ctrl+Shift+L）
- 侧边栏新增 DeviceLibExplorer（7 个设备分类）
- 设备库侧边栏与工作区 Tab 联动过滤

### 拓扑优化
- 节点改为矩形，服务器 `100×26` 横条、交换机 `72-96×32-44`
- 层级重排：业务/OOB 在上 → 服务器居中 → 参数/存储在下
- 服务器按连接的 param_leaf 自动分组，组间 80px 间隔
- 水平间距从 90 增至 120

### 机柜规划
- RackTab 新增左侧待分配设备列表 + 点击 U 位放置交互
- 设备冲突红色高亮、功率不足提示

---

## [2.1.0] - 2026-07-28

### 功能
- 设备库系统：50+ 设备 JSON 配置，按品类分类
- 项目向导：5 步创建（基本信息 → 网络 → 设备 → 机柜 → 确认）
- 机柜规划：42U/49U 可视化，功率监控，Excel 导出
- 拓扑可视化：ECharts 渲染，多网络过滤，布局保存/恢复

---

## [2.0.0] - 2026-07-27

### 初始版本
- Electron + React + Python 架构
- Activity + Tab 双导航系统
- Fat-Tree 拓扑自动计算（二层/三层）
- 连接表导出
- 5 种语言国际化
