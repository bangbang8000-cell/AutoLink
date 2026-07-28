# AutoLink V2.3 PRD — 精细化打磨与体验升级

> V2.2 完成了核心缺陷修复和交互完善。V2.3 聚焦于代码质量、用户体验一致性、设计系统建设和运维可靠性。

---

## 一、多角色专业分析

### 1.1 系统架构师视角

**总体评价**：AutoLink V2.2 的架构设计达到了中小型桌面工具的上乘水平。Electron + React + Python 子进程的三层分离清晰，IPC 通信通道覆盖完整，Zustand 状态管理职责分明。

**架构亮点**：
- Activity + Tab 双导航系统设计合理，与 VS Code 设计理念一致
- Python 子进程的 60 秒超时 + SIGTERM/SIGKILL 双层清理机制严谨
- `sanitizePath()` 路径遍历防护和 `sanitizeName()` 输入净化体现了安全意识
- `contextIsolation: true` + `nodeIntegration: false` 安全基线正确

**架构问题**：

| 编号 | 问题 | 严重度 | 建议 |
|------|------|--------|------|
| A1 | `sandbox: false`，虽然当前安全基线足够，但开启 sandbox 是 Electron 安全最佳实践 | 中 | 评估 sandbox 兼容性后开启，需将 preload 中使用的 Node API 通过 IPC 代理 |
| A2 | handler 版本号硬编码 `"2.0.1"`，与 `package.json` 不一致 | 中 | 改为运行时动态读取 `package.json` |
| A3 | `categoryPathMap` 在 `handlers.ts` 中重复定义（`loadDeviceLibrary` 和 `getDeviceLibrary` 各一份） | 中 | 提取为模块级常量 |
| A4 | 前端 `parseINI()` 逐行 split 解析，不处理引号、多行值，仅适用于当前配置复杂度 | 低 | 当前足够，但需在注释中标记限制 |
| A5 | `rack.store.ts` 中 `saveRackLayout` 使用已弃用的 `unescape` | 低 | 改用 `TextEncoder` + Base64 或 IPC 层统一处理 |
| A6 | Python `requirements.txt` 缺少 `pytest` 和 `pytest-cov` | 低 | 添加开发依赖到 requirements.txt 或 setup.py extras |

### 1.2 软件设计师视角

**总体评价**：组件化程度较高，但在共享组件提取和接口设计上存在明显短板。多个核心组件存在严重代码重复。

**设计缺陷**：

| 编号 | 问题 | 严重度 | 影响范围 |
|------|------|--------|----------|
| D1 | **DesignPanel 与 DesignTab 中 7 个组件完全重复**：`FormSection`、`NumberInput`、`SelectInput`、`ToggleSwitch`、`DesignSummaryView`、`StatItem`、`MiniStat` | **高** | 任何功能变更需要同时修改两处，极易产生 bug |
| D2 | **SettingsPanel 与 SettingsExplorer 功能重叠但交互不一致**：两个入口到设置，一个简单列表，一个双列布局，部分选项只在一处出现 | 高 | 用户困惑，维护成本双倍 |
| D3 | 设备类型判断依赖字符串匹配（`type.includes('gpu')`），属于脆弱的隐式契约 | 中 | 类型枚举未在所有组件中统一使用 |
| D4 | `ProjectOverviewTab` 中 `EmptyState`、`SectionCard` 等通用组件未提取共享 | 中 | 其他 tab 需要空状态时各自实现 |
| D5 | 输入框/选择框样式沉余：相同的 Tailwind 类组合在 6+ 个文件中重复 | 中 | 缺少 `Input`、`Select` 原子 UI 组件 |
| D6 | `DeviceLibraryPicker` 厂商列表硬编码，新增厂商需要改源码 | 低 | 应改为动态从设备库数据中提取 |
| D7 | `WizardStepDevices` 中 `resolveIBDefaults` 和 `getDefaultRefs` 的自动切换逻辑过于隐式 | 低 | 用户不理解为何更换 GPU 后交换机自动改变了 |

### 1.3 程序员视角

**总体评价**：TypeScript 严格模式配置正确（`strict: true`），前端后端都有测试覆盖。但存在若干可导致运行时问题的代码缺陷。

**代码缺陷**：

| 编号 | 问题 | 严重度 | 文件 | 修复方向 |
|------|------|--------|------|----------|
| P1 | **Toast 永不过期**：`toast.store.ts` 无 `autoRemove` 机制，错误消息堆积 | **高** | 添加 `duration` 参数 + `setTimeout` 自动移除 |
| P2 | **删除项目无确认对话框**：`ExplorerPanel.tsx` 中删除按钮直接调用 `deleteProject` | **高** | 添加确认对话框，提示不可恢复 |
| P3 | **向导创建项目失败静默**：`handleComplete` 中 `catch` 仅 `console.error`，无用户可见反馈 | 高 | 添加错误 Toast 通知 |
| P4 | 错误边界"重试"按钮仅 `setState({ hasError: false })`，不执行任何重试逻辑 | 中 | 增加 `onRetry` 回调，重新渲染子树 |
| P5 | `WorkbenchResultCard` 和 `OutputTab` 图片预览无缩放/全屏功能 | 中 | 添加图片查看器组件 |
| P6 | `ProjectOverviewTab` 骨架屏中使用 `Math.random()` 产生随机宽度 | 中 | 使用确定性值或 CSS animation |
| P7 | `OutputTab` 大文件 Excel 预览无虚拟滚动 | 中 | 引入虚拟滚动库或分页加载 |
| P8 | `DeviceLibraryTab` 组件树分类结构不一致：存储有子分类而 GPU/通算没有 | 低 | 统一分类层级设计 |
| P9 | 菜单"撤销/重做"有快捷键占位但无 action 回调 | 低 | 实现或移除 |

### 1.4 测试人员视角

**总体评价**：测试基础设施完善（前端 Vitest + 后端 pytest），覆盖率命令就绪。但测试用例在边界条件、异常路径和集成测试方面存在盲区。

**测试资产**：
- 后端：11 个测试文件，覆盖引擎入口、拓扑计算、模型、配置迁移、导出器
- 前端：5 个测试文件 + 1 个 setup，覆盖 4 个主要 Store + 1 个集成测试
- 有 `test:all` 统一入口，覆盖率 HTML 报告就绪

**测试缺口**：

| 编号 | 缺口 | 严重度 | 建议 |
|------|------|--------|------|
| T1 | **前端组件无测试**：所有 React 组件（ActivityBar、MenuBar、各 Tab、向导）完全没有单元测试或快照测试 | 高 | 至少为核心交互组件添加渲染测试 |
| T2 | **IPC 层无测试**：`handlers.ts` 的路径净化、错误包装等重要逻辑没有测试 | 高 | Mock Electron API 后添加单元测试 |
| T3 | **前端 store 测试覆盖不全**：`ui.store`、`wizard.store`、`render.store`、`toast.store`、`workspace.store` 没有测试文件 | 中 | 按重要性补充测试 |
| T4 | Python `engine.py` 主入口 `if __name__ == '__main__'` 块未被任何测试执行 | 中 | 添加端到端子进程测试 |
| T5 | **无 E2E 测试**：没有跨进程（Electron + Python）的端到端测试 | 中 | 引入 Playwright 或 Spectron |
| T6 | 设备库加载失败场景未覆盖（library_index.json 格式错误、设备文件缺失） | 低 | 添加 fixture 和异常路径测试 |
| T7 | 拓扑生成超大拓扑（1000+ 服务器）的性能测试缺失 | 低 | 添加性能基准测试 |

### 1.5 UI/UX 设计师视角

**总体评价**：VS Code 风格的布局选择正确，ActivityBar + Sidebar + Editor Tabs 的导航模式适合工具型应用。但设计系统不完整，视觉一致性和交互细节有明显的打磨空间。

**设计系统问题**：

| 编号 | 问题 | 严重度 | 影响 |
|------|------|--------|------|
| U1 | **Tailwind 配置缺少语义色系**：全局使用 Tailwind 默认色系（green/red/amber），未在 `tailwind.config.js` 中统一定义 `success`/`error`/`warning`/`info` | 高 | 颜色调整需要全局搜索替换，主题切换一致性无法保证 |
| U2 | **无暗色模式自定义滚动条**：Windows 下默认滚动条在暗色背景下非常突兀 | 高 | 添加 `::-webkit-scrollbar` 样式 |
| U3 | 按钮样式不统一：有的用填充色 `bg-primary-500`，有的用描边 `border`，圆角也从 `rounded` 到 `rounded-lg` 不等 | 中 | 统一定义 Button 变体组件 |
| U4 | **无设计 tokens（CSS 变量）**：没有 `--color-surface`、`--radius-sm` 等自定义属性 | 中 | 在 `style.css` 中定义基础 token |
| U5 | Resizable 面板的拖拽手柄初始不可见（`bg-transparent`），hover 才显示 | 中 | 始终显示微妙的视觉指示线 |
| U6 | ActivityBar 选中态仅靠左侧 2px 色条，反馈偏弱 | 中 | 增加图标颜色变化和背景色差 |
| U7 | Header 的 Windows 窗口控制按钮（Minus/Square/X）与系统风格不一致 | 低 | 评估是否使用系统原生标题栏或优化自定义按钮样式 |
| U8 | 字体大小设置可能未生效：Settings 中有 12-18px 选项但未见 CSS 变量实现 | 低 | 通过 `#root` 级 CSS 自定义属性实现 |
| U9 | 各 Tab 的空状态（EmptyState）设计风格不统一 | 低 | 提取共享 `EmptyState` 组件 |
| U10 | `prefers-reduced-motion` 未适配：所有 `transition-*` 未做媒体查询适配 | 低 | 在 Tailwind 配置中定义 motion-safe/motion-reduce 变体 |

**交互体验问题**：

| 编号 | 问题 | 严重度 |
|------|------|--------|
| I1 | MenuBar 菜单行为不标准：首次进入不支持 hover 切换，必须点击后才可 hover 切换 | 中 |
| I2 | 标签页无右键菜单：store 有 `closeOtherTabs`/`closeAllTabs` 但 UI 未暴露 | 中 |
| I3 | 创建项目向导 5 步不可点击步骤指示器跳转，必须线性"上一步/下一步" | 中 |
| I4 | 向导中没有"保存草稿"功能，中途关闭数据全部丢失 | 中 |
| I5 | 快捷键 `Ctrl+S` 在 Electron 中可能与浏览器保存页面行为冲突 | 低 |
| I6 | 模态框打开后焦点未 trap，键盘用户可能 Tab 到背景元素 | 低 |

**可访问性差距**：
- 无 `aria-label`、无 `role` 属性（除 Toggle 组件外）
- 无键盘导航支持（ActivityBar、Tab 栏不可 Tab 访问）
- 色彩对比度未评估（大量 `text-gray-400` 可能在浅色背景上不达标）
- 无屏幕阅读器支持（图标无替代文本）

### 1.6 用户视角

**总体评价**：AutoLink 作为网络规划工具，核心功能链路（创建设计 → 生成拓扑 → 机柜规划 → 导出）完整可用。但学习曲线较陡，引导不足，部分操作反直觉。

**用户痛点**：

| 编号 | 痛点 | 严重度 | 场景 |
|------|------|--------|------|
| UU1 | **首次使用无引导**：新用户启动后看到空白工作区，不知道从哪里开始 | 高 | 首次启动体验 |
| UU2 | 设计面板的参数众多（17 个配置项），新用户不知道哪些是关键参数 | 中 | 拓扑设计 |
| UU3 | 生成拓扑后不清楚如何查看结果：拓扑图、机柜图、连接表分散在不同 Tab 中 | 中 | 渲染后查看 |
| UU4 | 项目输出文件（Excel）的命名格式不够直观（时间戳目录名） | 低 | 输出结果浏览 |
| UU5 | 没有最近项目快捷入口（store 有数据但 UI 未利用） | 低 | 日常使用 |
| UU6 | 设备库搜索只支持型号/厂商，不支持按端口速率、功耗等参数筛选 | 低 | 设备选型 |
| UU7 | 拓扑图上的节点数量大时，密密麻麻看不清，虽然有缩放但初始视图未优化 | 低 | 拓扑查看 |

### 1.7 运维人员视角

**总体评价**：打包配置完整（electron-builder 配置了 Windows NSIS / macOS zip / Linux AppImage+deb），发布流程通过 GitHub Actions CI 自动化。但在配置管理和环境依赖上有改进空间。

**运维问题**：

| 编号 | 问题 | 严重度 |
|------|------|--------|
| O1 | Python 环境依赖未在安装包中管理：用户需自行安装 Python 3.8+ 和 pandas/openpyxl | 高 |
| O2 | `requirements.txt` 缺少测试依赖（pytest/pytest-cov），CI 中 `pip install -r` 会失败 | 中 |
| O3 | 无应用日志文件：所有日志仅通过 `console.log` + IPC 推送，未写入磁盘 | 中 |
| O4 | 设备库和模板目录在安装后为只读（打包到 `resources/`），用户自定义设备需依赖导入功能 | 中 |
| O5 | 无数据备份/恢复机制：项目数据仅存储在工作区目录，无自动备份 | 低 |
| O6 | 无应用配置导出功能：用户无法迁移设置到另一台机器 | 低 |
| O7 | Python 进程超时 60 秒固定值，对大型拓扑可能不够 | 低 |

### 1.8 运营推广人员视角

**总体评价**：产品核心定位清晰（AI 智算中心网络规划），功能差异化明显。但在新用户获取、文档完善度和社区建设方面有较大提升空间。

**运营建议**：

| 编号 | 建议 | 优先级 |
|------|------|--------|
| M1 | **缺少产品官网/Landing Page**：GitHub README 是唯一对外的文档入口 | 高 |
| M2 | **缺少使用视频/截图展示**：即使 README 中也没有产品截图 | 高 |
| M3 | 没有内置的"示例项目快速体验"入口：已有 Demo 项目但用户不会自动打开 | 中 |
| M4 | 模板市场潜力未挖掘：目前 3 个内置模板，可开放社区模板贡献 | 中 |
| M5 | 设备库可作为独立卖点推广（行业首个 AI 数据中心设备全景库） | 中 |
| M6 | 缺少更新日志（CHANGELOG.md）：用户不知道每个版本改了什么 | 低 |
| M7 | 国际化不完整：日/韩/繁体部分翻译可能为机翻，缺少专业术语校准 | 低 |

---

## 二、V2.3 版本定位

> **V2.3 主题：质量内建与体验一致性**
>
> 不做新功能，专注代码质量提升、设计系统建设、测试补充和交互细节打磨。
> 目标：为后续功能扩展打下坚实的基础。

---

## 三、V2.3 功能与优化列表

### 阶段一：设计系统建设（P0，3天）

| 编号 | 任务 | 描述 | 文件 |
|------|------|------|------|
| DS1 | Tailwind 语义色系 | 在 `tailwind.config.js` 中定义 `success/error/warning/info` 色系，替换全局硬编码 | `tailwind.config.js` |
| DS2 | 暗色滚动条 | `style.css` 中添加自定义滚动条样式（亮/暗双主题） | `style.css` |
| DS3 | CSS 变量与 Design Tokens | 定义 `--color-surface`、`--radius-sm/md/lg`、`--font-size-base`，连接字体大小设置 | `style.css`, `tailwind.config.js` |
| DS4 | 提取共享 UI 组件 | 创建 `src/components/ui/` 目录：`Input`、`Select`、`Button`（primary/secondary/danger/ghost）、`EmptyState`、`SectionCard`、`FormSection`、`NumberInput`、`ToggleSwitch` | 新建 |
| DS5 | 组件迁移 | 将 DesignPanel/DesignTab 中重复组件替换为共享 UI 组件，消除代码重复 | `DesignPanel.tsx`, `DesignTab.tsx` |

### 阶段二：缺陷修复（P0，2天）

| 编号 | 任务 | 描述 | 文件 |
|------|------|------|------|
| BF1 | Toast 自动消失 | 添加 `duration` 参数（默认 5s），超时自动移除，最大保留 5 条 | `toast.store.ts`, `ToastContainer.tsx` |
| BF2 | 删除项目确认对话框 | 删除前弹出确认对话框，提示不可恢复 | `ExplorerPanel.tsx` |
| BF3 | 向导失败反馈 | `handleComplete` 捕获错误时显示 Toast，不静默 | `CreateProjectWizardModal.tsx` |
| BF4 | 错误边界修复 | 合并两个 ErrorBoundary 为通用组件，重试逻辑改为 `key` 递增强制重挂载 | `ErrorBoundary.tsx`, `WorkspaceErrorBoundary.tsx` |
| BF5 | handler 版本号动态读取 | `app:getVersion` 从 `package.json` 动态读取 | `handlers.ts` |
| BF6 | categoryPathMap 去重 | 提取为模块级常量 | `handlers.ts` |
| BF7 | 菜单死项处理 | 撤销/重做：移除快捷键占位（或实现简单的 undo/redo 栈） | `MenuBar.tsx` |

### 阶段三：交互体验优化（P1，2.5天）

| 编号 | 任务 | 描述 | 文件 |
|------|------|------|------|
| UX1 | MenuBar 交互修复 | 菜单打开后支持 hover 切换；添加 `preventDefault` 处理 Ctrl+S | `MenuBar.tsx` |
| UX2 | Tab 右键菜单 | 添加右键菜单："关闭"、"关闭其他"、"关闭右侧"、"关闭全部" | `WorkspaceView.tsx` |
| UX3 | 向导步骤可点击跳转 | 已完成的步骤可点击返回，当前步骤高亮 | `CreateProjectWizardModal.tsx` 等 |
| UX4 | 向导草稿保存 | 向导状态持久化到 localStorage，关闭后重新打开可恢复 | `wizard.store.ts`, `CreateProjectWizardModal.tsx` |
| UX5 | 首次使用引导 | 无项目时显示引导卡片"新建项目 / 打开 Demo 项目"，引导用户快速开始 | `WorkspaceView.tsx` 空状态 |
| UX6 | Resizable 面板拖拽提示 | 拖拽手柄始终显示微弱的视觉指示线（30% 透明度） | `ResizableAppLayout.tsx` |
| UX7 | ActivityBar 选中态增强 | 选中时图标颜色变为 primary + 背景色差 + 左侧色条三层反馈 | `ActivityBar.tsx` |

### 阶段四：测试补充（P1，2天）

| 编号 | 任务 | 描述 | 文件 |
|------|------|------|------|
| TST1 | UI 组件渲染测试 | ActivityBar、MenuBar、Tab 栏核心渲染测试（Vitest + React Testing Library） | `src/test/` |
| TST2 | Store 测试补全 | 补充 `ui.store`、`workspace.store`、`toast.store` 测试 | `src/test/` |
| TST3 | IPC 净化函数测试 | `sanitizePath`/`sanitizeName` 单元测试 | `src/test/` 或独立 test |
| TST4 | Python Engine 入口测试 | 通过 subprocess 调用 `engine.py`，覆盖主入口路径 | `tests/backend/` |

### 阶段五：资产与文档（P2，1.5天）

| 编号 | 任务 | 描述 | 文件 |
|------|------|------|------|
| DOC1 | README 完善 | 添加产品截图/GIF、核心功能介绍、快速开始指南 | `README.md` |
| DOC2 | CHANGELOG | 创建 CHANGELOG.md，记录 V2.0→V2.3 版本变更 | `CHANGELOG.md` |
| DOC3 | requirements.txt 补全 | 添加 pytest/pytest-cov 测试依赖 | `backend/requirements.txt` |
| DOC4 | 国际化补全 | 补充 `en/device.json`，修复 ProjectOverviewTab 硬编码中文 | i18n 文件 + `ProjectOverviewTab.tsx` |

---

## 四、修改文件清单

| 阶段 | 文件 | 操作 |
|------|------|------|
| DS1-3 | `tailwind.config.js` | 修改：语义色系 + 主题扩展 |
| DS3-4 | `src/style.css` | 修改：Design Tokens + 滚动条样式 |
| DS4 | `src/components/ui/Input.tsx` | **新建** |
| DS4 | `src/components/ui/Select.tsx` | **新建** |
| DS4 | `src/components/ui/Button.tsx` | **新建** |
| DS4 | `src/components/ui/EmptyState.tsx` | **新建** |
| DS4 | `src/components/ui/SectionCard.tsx` | **新建** |
| DS4 | `src/components/ui/FormSection.tsx` | **新建** |
| DS4 | `src/components/ui/index.ts` | **新建**（统一导出） |
| DS5 | `src/components/sidebar/DesignPanel.tsx` | 修改：迁移到共享组件 |
| DS5 | `src/components/workspace/tabs/DesignTab.tsx` | 修改：迁移到共享组件 |
| DS5 | `src/components/workspace/tabs/ProjectOverviewTab.tsx` | 修改：迁移共享组件 + i18n |
| BF1 | `src/stores/toast.store.ts` | 修改：autoRemove + maxItems |
| BF1 | `src/components/layout/ToastContainer.tsx` | 修改：autoRemove 动画 |
| BF2 | `src/components/sidebar/ExplorerPanel.tsx` | 修改：确认对话框 |
| BF3 | `src/components/wizard/CreateProjectWizardModal.tsx` | 修改：错误反馈 |
| BF4 | `src/components/layout/ErrorBoundary.tsx` | 修改：合并 + 重试逻辑 |
| BF5-6 | `electron/ipc/handlers.ts` | 修改：版本号 + 去重 |
| BF7 | `src/components/layout/MenuBar.tsx` | 修改：死项清理 |
| UX1 | `src/components/layout/MenuBar.tsx` | 修改：hover 切换 + Ctrl+S |
| UX2 | `src/components/workspace/WorkspaceView.tsx` | 修改：右键菜单 |
| UX3-4 | `src/components/wizard/CreateProjectWizardModal.tsx` 等 | 修改：可点击导航 + 草稿 |
| UX4 | `src/stores/wizard.store.ts` | 修改：草稿持久化 |
| UX5 | `src/components/workspace/WorkspaceView.tsx` | 修改：空状态引导 |
| UX6 | `src/components/layout/ResizableAppLayout.tsx` | 修改：拖拽指示线 |
| UX7 | `src/components/layout/ActivityBar.tsx` | 修改：选中态增强 |
| TST1-3 | `src/test/` 新增测试文件 | **新建** |
| TST4 | `tests/backend/test_engine_entry.py` | **新建** |
| DOC1-2 | `README.md`, `CHANGELOG.md` | **修改/新建** |
| DOC3 | `backend/requirements.txt` | 修改 |
| DOC4 | `src/i18n/resources/en/device.json` | **新建** |
| DOC4 | `src/components/workspace/tabs/ProjectOverviewTab.tsx` | 修改：i18n |

---

## 五、开发计划

| 阶段 | 主题 | 工作量 | 产出 |
|------|------|--------|------|
| **阶段一** | 设计系统建设（DS1-DS5） | 3天 | 统一 UI 组件库 + 语义色系 + Tokens |
| **阶段二** | 缺陷修复（BF1-BF7） | 2天 | Toast/确认框/错误处理修复 |
| **阶段三** | 交互优化（UX1-UX7） | 2.5天 | MenuBar 修复 / Tab 右键 / 向导升级 / 引导 |
| **阶段四** | 测试补充（TST1-TST4） | 2天 | 组件测试 + Store 测试 + IPC 测试 |
| **阶段五** | 文档与资产（DOC1-DOC4） | 1.5天 | README / CHANGELOG / i18n 补全 |
| **总计** | | **11天** | |

---

## 六、不做事项（明确排除）

以下需求虽然合理，但归属后续版本：

- **新功能开发**：拓扑链路带宽计算、机柜 3D 视图、网络流量仿真
- **性能优化**：虚拟滚动、WebWorker 渲染、大文件流式加载
- **E2E 测试框架引入**：Playwright / Spectron 集成
- **可访问性全面改造**：WCAG 2.1 AA 合规
- **跨平台窗口管理优化**：macOS 交通灯适配、Linux 托盘
- **Python 环境自包含**：PyInstaller 打包或嵌入式 Python

---

## 七、验收标准

1. **零组件代码重复**：DesignPanel 和 DesignTab 中不再有重复定义的 FormSection/NumberInput 等组件
2. **Toast 5 秒自动消失**，最多同时显示 5 条
3. **删除项目有确认对话框**，不可跳过
4. **向导失败有 Toast 通知**，创建成功自动选中新项目
5. **菜单 hover 切换**正常工作（打开一个菜单后移入其他菜单名自动切换）
6. **Tab 右键菜单**包含"关闭"、"关闭其他"、"关闭右侧"、"关闭全部"
7. **所有新增前端测试通过**（`npm run test` 零失败）
8. **TypeScript 编译零错误**（排除已有 test/ 目录和 CSS 引入问题）
9. **README 包含至少 2 张产品截图**和快速开始步骤
10. **V2.3 CHANGELOG** 记录本次所有变更

---

> **评审确认后进入开发阶段。**
