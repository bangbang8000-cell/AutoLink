# CHANGELOG

## [2.7.0] - 2026-08-01

### 三项核心修复

#### 1. 暗色模式拖拽分隔线颜色修复
- **问题**：暗色模式下中栏（文件浏览器）与工作区之间的垂直拖拽分隔线显示为白色，视觉突兀
- **根因**：`ResizableAppLayout.tsx` 使用 `dark:bg-edge-default` 类，但 Tailwind 的 `edge.DEFAULT` 生成的类名是 `bg-edge`（无后缀），`bg-edge-default` 是无效类，导致暗色模式下未覆盖亮色的 `bg-gray-200`
- **修复**：`dark:bg-edge-default` → `dark:bg-edge`（渲染为 `#484F58` 暗灰，与水平分隔线一致）

#### 2. 项目浏览器目录显示修复
- **问题**：应用重启后，项目浏览器中已展开的目录/子目录无法正确显示对应文件，点击无响应
- **根因**：`explorer.store.ts` 持久化了 `expandedProjects`（展开状态）但不持久化 `projectStructures`（结构缓存）。重启后项目显示为"已展开"但结构缓存为空，而 `toggleProjectExpand` 的条件 `!currently && !projectStructures[name]` 因 `currently===true` 跳过了结构拉取
- **修复**：
  - `toggleProjectExpand` 条件改为 `!projectStructures[projectName]`（不依赖当前展开状态）
  - 新增 `useEffect`：组件挂载时自动为所有"已展开但无结构缓存"的项目拉取结构

#### 3. 自动更新下载重构
- **问题**：检查到新版本后点击下载无反应或失败，原实现回退到打开浏览器而非真正下载
- **根因**：国内网络下 `electron-updater.checkForUpdates()` 失败后走 fallback 通道，但 fallback 只解析了 version 未解析下载信息；`downloadUpdate()` 因 electron-updater 内部无 `updateInfo` 缓存而抛错
- **修复**（`update.service.ts` 重构）：
  - **增强 fallback 检查**：解析 `latest.yml` 的 `path` 字段（当前平台安装包文件名），构造下载 URL 并缓存
  - **平台适配**：新增 `getPlatformYmlName()`，Windows/macOS/Linux 分别请求 `latest.yml`/`latest-mac.yml`/`latest-linux.yml`
  - **正向直接下载**：新增 `downloadInstallerFile()`，用 Electron net 模块直接下载安装包到本地下载目录，手动处理 GitHub 的 302 重定向，实时发送下载进度
  - **多级 fallback**：electron-updater 下载 → 直接下载安装包 → 打开浏览器
  - **安装支持**：`quitAndInstall()` 检测直接下载场景，打开本地安装包并退出应用

### 涉及文件
- `src/components/layout/ResizableAppLayout.tsx`：拖拽线颜色修复
- `src/components/layout/FileExplorer.tsx`：项目浏览器结构缓存恢复
- `electron/services/update.service.ts`：自动更新下载逻辑重构
- `README.md`：版本号更新至 2.7.0，自动更新章节重写
- `docs/deployment.md`：版本号更新至 2.7.0，自动更新机制章节重写，新增下载失败 FAQ
- `package.json`：版本号 2.6.9 → 2.7.0

### 回归测试
- TypeScript typecheck：0 errors
- ESLint：0 errors（7 warnings 为历史遗留）

---

## [2.6.5] - 2026-07-31

### 更新检查机制修复

#### 问题根因
v2.6.3 及之前版本的 `checkForUpdates` 在网络失败或 electron-updater 模块异常时,catch 吞掉错误并返回 `{ updateAvailable: false }`,前端显示"已是最新版本",误导用户以为没有新版本,实际是检查失败(国内 GitHub Releases 访问超时)。

#### 修复方案
- **备用更新检查通道**:新增 `checkLatestYmlFallback`,使用 Electron `net` 模块(走 Chromium 网络栈)直接请求 `releases/latest/download/latest.yml` 并解析版本号。当 electron-updater 主路径失败时自动启用
- **错误信息透传**:`checkForUpdates` 返回类型增加 `error?: string` 字段,前端可区分"无更新"与"检查失败"
- **15 秒超时**:备用通道设置 15 秒超时,避免长时间挂起
- **版本比较修正**:主路径增加 `compareVersions` 比较,避免 electron-updater 在 dev 模式下误报
- **手动下载入口**:检查失败时 UI 显示"手动下载"按钮,一键打开 GitHub Releases 页面
- **新增 IPC**:`app:open-releases-page` 打开浏览器跳转 Releases
- **5 语言 i18n**:新增 `update.manualDownload` key(手动下载/Manual Download/手動ダウンロード/수동 다운로드/手動下載)

#### 涉及文件
- `electron/services/update.service.ts`:新增备用检查通道 + 错误透传 + openReleasesPage
- `electron/ipc/handlers.ts`:新增 `app:open-releases-page` IPC
- `electron/preload.ts`:暴露 `openReleasesPage` API
- `src/types/electron.d.ts`:更新 checkUpdate 返回类型
- `src/components/layout/UpdatePopover.tsx`:区分"无更新"与"检查失败",添加手动下载按钮
- `src/i18n/resources/*/common.json`:5 语言补充 manualDownload

### 回归测试
- TypeScript typecheck:0 errors
- 前端 vitest:196/196 通过

---

## [2.6.4] - 2026-07-31

### v2.6.3 收尾:文档补齐与 U3 组件抽取

- **U3 收尾**:抽取 `ui/Toggle.tsx` 和 `ui/SettingsRow.tsx` 通用组件,迁移 FileExplorer 内联定义(`Toggle`/`ToggleMini`/`SettingsSection`/`SettingsRow`/`INPUT_CLASS`)
- **CHANGELOG**:补齐 v2.5.0-v2.6.3 全部变更记录
- **README**:更新至 V2.6 功能说明(拓扑持久化/自动更新/本地用户指南/PDF 报告/设备库一致性校验)
- **deployment.md**:重写为 V2.6 版本(自动更新机制/数据持久化/reportlab 依赖/V2.6 常见问题)
- **user_guide.md**:新增第 11 章「自动更新」,项目结构补充 topology.json/rack_layout.json,输出类型补充 PDF 报告,设置补充「重置工作区」,常见问题补充 Q8-Q10
- **v2.6.3 PRD**:状态更新为已完成,验收清单全部勾选

### 回归测试
- TypeScript typecheck:0 errors
- ESLint:0 errors(78 warnings 为历史遗留)
- 前端 vitest:196/196 通过
- 后端 pytest:299/299 通过

---

## [2.6.3] - 2026-07-31

### UI 系统优化（U1-U9 全部完成）

#### P0 用户关注点
- **U1 项目浏览器信息密度增强**：项目项卡片化（状态点 + 名称 + 文件数 + 时间 + 收藏）；输出文件按扩展名显示类型图标（xlsx/csv/png/json 等）；模板项卡片化（描述 + 标签 + 内置徽章）
- **U2 关于界面排版优化**：4 区块内边距统一（px-6 / px-4）；字号梯度从 5 种收敛到 3 种；快捷链接图标统一 12px；版权走 i18n（`about.copyright`）；AboutSettings 版本号动态获取
- **U3 设置界面优化**：删除死代码 `SettingsPanel.tsx`；控件宽度统一（select w-32 / input w-20）；抽象 `ui/Toggle.tsx` + `ui/SettingsRow.tsx` + `INPUT_CLASS` 常量；快捷键列表以 MenuBar ShortcutsDialog 为权威源
- **U4 全局字体体系统一**：tailwind.config.js 新增 `text-2xs`(10px)/`text-3xs`(9px) token；中文字体堆栈配置 PingFang SC / Microsoft YaHei / Hiragino Sans GB / Source Han Sans CN；全项目迁移 `text-[10px]`/`text-[11px]`/`text-[9px]`/`text-[8px]` 任意值类（248 处 → 0）；修复 `gray-750`/`gray-850` 无效颜色类

#### P1 结构性优化
- **U5 颜色体系统一**：启用语义色板 success/error/warning/info 替换 green/red/amber/blue 基础色（333 处）；新建 `constants/topology-colors.ts` 统一 TopologyNodes 与 exportTopology 节点色常量
- **U6 通用 Modal 组件**：新建 `ui/Modal.tsx`（ESC 关闭/遮罩关闭/焦点陷阱/body 滚动锁定可配置）；迁移 ConfirmDeleteDialog / RenameProjectModal / CreateProjectWizardModal / AboutDialog / EditTemplateModal / ShortcutsDialog
- **U7 通用 ContextMenu 组件**：新建 `ui/ContextMenu.tsx`（统一 z-index / 点击外部关闭 / 分隔线 / 禁用态 / 危险态 / 图标支持）；迁移 FileExplorer + WorkspaceView 右键菜单
- **U8 i18n 补全**：App.tsx Tab 标题、18 处 toast 消息、ConfirmDeleteDialog、ErrorBoundary、WorkspaceErrorBoundary、LogPanel 全部走 i18n（5 语言对齐）
- **U9 删除死代码**：`SettingsPanel.tsx` / `WorkspaceWelcome.tsx` / `WorkspaceTabBar.tsx` 全部删除

### 回归测试
- TypeScript typecheck：0 errors
- ESLint：0 errors（78 warnings 为历史遗留）
- 前端 vitest：196/196 通过
- 后端 pytest：299/299 通过

---

## [2.6.2] - 2026-07-31

### 核心功能修复与持久化

#### T1 更新功能致命 bug 修复
- **根因**：`electron-updater` 错误放在 `devDependencies`，打包后 asar 内模块缺失，`import('electron-updater')` 静默失败导致更新功能完全失效
- **修复**：将 `electron-updater` 移到 `dependencies`；`update.service.ts` 增加 dev 模式 `forceDevRunConfig` 支持
- **验证**：打包后 app.asar 内包含 electron-updater 模块

#### T2 关于页面软件栈修复
- `handlers.ts` 使用 `app.getAppPath()` 替代 `__dirname/../..` 读取 package.json（修复打包后路径失效）
- 依赖读取合并 `dependencies` + `devDependencies`（修复 typescript/vite 显示 `-`）
- Python 检测增加 `py --version`（Windows py launcher）回退

#### T3 关于页面产品简介
- AboutDialog 新增 `app.description` 段落
- 5 语言 common.json 补充 `app.description` key

#### T4 菜单栏 Logo
- Header.tsx 在 MenuBar 前插入 Logo（macOS 自动避让红绿灯按钮）

#### T5 编辑菜单扩充
- Edit 菜单从 1 项扩充为 9 项：撤销/重做/剪切/复制/粘贴/全选/查找/首选项
- 调用 Clipboard API 与 `document.execCommand` 实现基础功能

#### T6 拓扑数据按项目持久化（核心）
- 新增 `project:saveFile` IPC（白名单：`topology.json` / `rack_layout.json` / `network_config.ini`）
- `design.store` 改为读写项目根目录 `topology.json`；加载失败清空 store（不残留上个项目）
- `rack.store` 改为保存 `rack_layout.json` 到项目根目录；防抖 500ms 自动保存
- `project.store.selectProject` 统一加载入口：异步加载 config + topology + rack layout
- 项目导出 ZIP 白名单纳入 `topology.json` / `rack_layout.json`

### 测试验证
- TypeScript typecheck：0 errors
- 前端 vitest：196/196 通过
- 后端 pytest：299/299 通过
- CI 三平台构建成功（run id: 30614761805）

---

## [2.6.1] - 2026-07-31

### 体验完善与死代码清理

#### R12 全局 ErrorBoundary
- App.tsx 最外层加 ErrorBoundary 包裹整个 render 树
- 各 Modal 独立 ErrorBoundary，避免组件崩溃导致白屏
- Workspace 组件均包裹 WorkspaceErrorBoundary

#### R13 workspace.store 持久化校验
- 加载持久化 tabs 时通过 `project:list` 校验项目存在性，无效 tabs 自动过滤
- `reopenLastClosedClosed` 同步校验
- Tab 状态持久化在 localStorage，可通过「Reset Workspace」按钮重置

#### R14-R15 死代码清理与拆分
- 删除 `sidebar/` 目录 9 个未引用文件
- 删除 `WorkspaceTabBar.tsx` / `WorkspaceWelcome.tsx`
- FileExplorer.tsx 从 1736 行按模块拆分为 6 个 Explorer 子组件
- TopologyTab.tsx 从 855 行按职责拆分为 hooks + 子组件

#### R16 TopologyTab 暗色模式适配
- 使用 MutationObserver 追踪 dark mode 变化
- ECharts 配色方案随主题切换

#### R17-R18 MenuBar i18n 与快捷键单一数据源
- MenuBar 全部菜单名/菜单项/Toast/ShortcutsDialog 走 i18n（5 语言）
- AboutDialog 快捷键链接复用 ShortcutsDialog 单一数据源
- 菜单栏语言随 UI 语言切换同步更新

---

## [2.6.0] - 2026-07-30

### 紧急缺陷修复（用户反馈 8 项 + P0 隐藏 bug）

#### R1 多语言机制修复
- `device` 命名空间 4 语言（en/ja/ko/zh-TW）补齐
- `i18n/index.ts` 启动时从 `ui.store` 读取持久化 language，修复刷新后语言错位
- 关键硬编码中文（SettingsPanel/FileExplorer 右键菜单/WorkspaceView 卡片）i18n 化

#### R3 关于弹窗内容修正
- 软件栈补充 Python 后端版本（11 项）
- 快捷键链接改为打开本地弹窗（非跳转浏览器）
- 版权信息动态年份、Logo 尺寸修正为 96px
- 移除 `t()` 调用的第二参数回退文案

#### R4 向导对话框滚动机制
- CreateProjectWizardModal 模态添加 `overflow-hidden`
- Header/步骤指示器/底部按钮栏加 `shrink-0`
- 800px 屏幕下底部按钮始终可见

#### R5 设备选型 IB/RoCE 联动
- `migration.py` 存储交换机按 `protocol` 分流（IB → NVIDIA Quantum，RoCE → 华为 CE6881）
- `WizardStepDevices.tsx` `STORAGE_DEFAULTS_BY_PROTOCOL` 区分协议
- 协议切换联动纳入 `storage_leaf_switch`
- 设备库补充 IB 存储交换机型号（NVIDIA SN5600/SN4700）

#### R6 设备库数据纠正
- 修正 `h3c_s6850_56hf.json`：从错误的 200G 存储交换机改为 25G 业务交换机（category/port_speed/port_type/description/tags 全字段修正，物理文件移目录）
- 修正 `library_index.json` 中 `huawei_ce6860_48s6cq` 归属（switches_storage → switches_biz）
- `device_library.py` 加载时加一致性校验（category 字段与目录一致）
- 业务交换机默认选型从 10G 改为 25G，与 `biz_port_speed='25G'` 对齐

#### R7 一键渲染修复
- `handleQuickRender` 改为跳转工作台 + toast 提示（方案 A）
- `OutputTab.tsx` 修复 `getFileBinary` 调用参数（从 useProjectStore 取 projectName，路径加 `output/` 前缀）

#### R8 项目浏览器文件树展开
- "全部项目" TreeItem 改为可展开，调 `project:getStructure` 拉取目录树递归渲染
- 新增"输入文件" Section（network_config.ini / project_config.json / project.json）
- 展开状态提升到 `explorer.store`，关闭侧栏再开状态保留

#### R9-R11 P0 隐藏 bug 修复
- preload 暴露 `dialog.openDirectory`（此前完全未实现）
- `getFileBinary` 返回类型统一为 `Promise<string | null>`（base64）
- `device-library:export` 返回类型对齐
- `versions` 类型补 chromium 字段
- `shell:openPath`/`showItemInFolder` 移除 `sanitizePath` 限制（修复导出 ZIP 打开目录被拦截）
- 根目录 5 个重复 Python 文件清理

### 测试验证
- 前端 vitest：196/196 通过
- 后端 pytest：299/299 通过

---

## [2.5.0] - 2026-07-30

### V2.4 系列延续与质量验收

- 完成 V2.4 PRD 验收与质量评估（完成度 65% → 验收通过）
- Logo 设计规范文档化（[docs/v2.5/logo_specification.md](docs/v2.5/logo_specification.md)）
- 启动加载动画优化（粒子背景 + 旋转环 + 进度条）
- 更新机制完善：版本号动态化、首次启动自动检测更新并 toast 通知、Release Notes 折叠展示、下载进度条优化
- 项目复制/重命名/导出导入 ZIP（含安全校验：路径遍历检测、文件白名单、名称冲突自动追加 _导入）
- 批量项目导出（工具栏按钮）
- 模板编辑功能（名称/描述/场景/标签/配置内容，内置模板不可编辑）
- 模板导入导出 ZIP
- 项目搜索筛选 + 收藏置顶（星标按钮，hover 显示）
- 5 种语言 i18n 文案补齐

### 测试验证
- 后端 pytest：267/267 通过
- TypeScript typecheck：无错误

---

## [2.4.6] - 2026-07-30

### 补齐半成品功能（V2.4 PRD 完成度 48% → 65%）

#### Phase J1: Rail-Optimized 架构集成
- NetworkObject 新增 `rail_id`/`rail_role` 字段（NVIDIA SuperPOD 8-Rail 标准）
- rail_topology.py 传递 Rail 字段到 Leaf/Spine
- designer.py 新增 `rail_mode` 配置开关（standard / rail_optimized）
- 新增 `_create_rail_optimized_switches` 和 `_wire_rail_optimized` 方法
- engine.py 输出 `railMode`/`railCount`/`railId`/`railRole` 字段
- 新增 9 个 Rail-Optimized 单元测试 + 集成测试

#### Phase J2: 规则校验前端
- engine.py 新增 `validationIssues` 结构化问题列表输出
- design.store.ts 新增 `ValidationIssue` 类型和 `validationIssues` 状态
- 新建 ValidationPanel.tsx 组件：问题列表 + 严重程度图标 + 修复建议
- DesignTab.tsx 集成 ValidationPanel 替换原布尔值显示
- 5 种语言 i18n 文案更新（zh-CN/en/zh-TW/ja/ko）

#### Phase J3: PDF 报告生成
- 新增 reportlab 依赖
- exporter.py 新增 `export_pdf_report` 函数：6 章节 PDF（概览/架构/功耗/光模块/成本/校验）
- 中文字体自动检测（Windows 微软雅黑 / Linux 文泉驿 / fallback Helvetica）
- engine.py 新增 `pdfReport` 导出类型
- ReportViewPanel.tsx 新增"导出 PDF"按钮
- 新增 3 个 PDF 生成测试

#### Phase J4: 液冷配置面板
- 确认 PUEEstimatePanel 已完整实现液冷配置：
  - 散热方式选择（风冷 / 冷板液冷 / 浸没式液冷）
  - 室外温度、负载率、UPS 效率、自然冷开关

#### Phase J5: cluster_512 模板
- 新增"中型-512"模板：512 H100 GPU + 48 存储 + 24 通算
- 三层 Fat-Tree 400G，4 POD × 128 GPU/POD

### 测试验证
- 后端 pytest：267/267 通过（含新增 12 个测试）
- TypeScript typecheck：无错误
- 累计完成率：65%

## [2.4.5] - 2026-07-29

### 拓扑布局四象限分区 + 服务器组垂直居中
- 重构布局算法：服务器区中心化 + 四象限网络设备分区（OOB 左上 / 业务 右上 / 参数 左下 / 存储 右下）
- 服务器区"概念宽度"自适应容纳网络设备区，网络设备始终在服务器区 X 范围内（需求8：服务器左右无网络设备）
- 左右半区对称分配（以中心为界），确保左半区在中心左侧、右半区在中心右侧
- 服务器节点在概念宽度内居中排列
- 服务器组垂直居中：动态计算 verticalGap，使上方间距 ≈ 下方间距（差值 ≤ 20px）
- topRegionHeight 包含 Y_AGG 顶部边距，消除计算偏差
- layoutBottomRegion 使用动态 verticalGap，确保底部间距与顶部间距相等
- 16:9 比例自适应（容差 ±15%）
- 布局版本号升级到 v4，自动清除旧 localStorage 布局数据
- POD 背景框改为轻量细虚线样式，减少视觉干扰

### 测试覆盖
- 新增 AC10 服务器组垂直居中测试（上方间距 ≈ 下方间距，差值 ≤ 20px）
- 27 个前端布局测试全部通过（含四象限分区 AC2/AC3/AC4/AC6/AC7/AC9/AC10 + E2E H100-100台 217节点）
- 255 个后端 pytest 全部通过
- TypeScript typecheck 无错误

## [2.4.1] - 2026-07-29

### 项目与模板生命周期管理完善
- 新增项目复制功能（右键菜单 → 复制项目，自动追加 _副本 后缀）
- 新增项目重命名功能（右键菜单 → 重命名）
- 新增项目导出/导入 ZIP（含安全校验：路径遍历检测、文件白名单、名称冲突自动追加 _导入）
- 新增批量项目导出（工具栏按钮，选择目录后批量打包）
- 新增模板编辑功能（名称/描述/场景/标签/配置内容，内置模板不可编辑）
- 新增模板导出/导入 ZIP
- 新增项目搜索筛选 + 收藏置顶（星标按钮，hover 显示）
- 新增 5 种语言 i18n 文案（zh-CN/en/ja/ko/zh-TW）
- 优化 TemplateSection 标题栏，hover 显示导入按钮
- 优化 Section 组件支持右侧操作按钮

### 应用图标与启动动画
- 新应用图标：网络拓扑"A"形设计，蓝青色渐变（build/logo.svg）
- 新启动加载动画：粒子背景 + 旋转环 + 进度条 + 三点加载指示器（public/splash.html）
- 启动时主窗口隐藏，加载完成后显示

### 更新机制完善
- 版本号动态化（从 package.json 读取，不再硬编码）
- 启动时自动检测更新并 toast 通知（仅首次提示）
- Release Notes 折叠展示（点击展开/收起）
- 下载进度条 + 错误提示优化

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
