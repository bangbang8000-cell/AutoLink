# AutoLink V2.0 PRD

## 一、产品概述

### 1.1 产品定位
AutoLink V2.0 是一款**AI智算中心网络规划与可视化工具**，从纯Python命令行工具升级为**Electron桌面应用**。核心能力：

- **网络拓扑设计**：自动计算参数网络（Fat-Tree）、存储网络、OOB/业务网络的Leaf-Spine拓扑
- **机房机柜规划**：可视化规划设备机柜号、上架U位（开始/结束）
- **网络拓扑可视化**：设备与连接关系的图形化展示
- **项目管理**：项目化组织设计方案，支持多项目、模板中心
- **工作台**：一键渲染连接关系表、上机表、拓扑图等输出

### 1.2 目标用户
- 数据中心网络工程师
- 智算中心方案设计师
- IT基础设施运维团队

### 1.3 与 V1.0（当前版本）的关系
V1.0 的 Python 计算引擎（models.py / topology.py / designer.py / exporter.py）完整保留，作为后端计算核心。V2.0 在其上构建 GUI 层。

### 1.4 GitHub 仓库
- **仓库地址**: https://github.com/bangbang8000-cell/AutoLink
- **CI/CD**: GitHub Actions（ci.yml + build.yml）
- **发布**: GitHub Releases（electron-builder + NSIS）

---

## 二、目录结构（对齐 MagicCommander）

### 2.1 仓库根目录

```
AutoLink/
├── src/                     # 前端 (React + TypeScript)
├── electron/                # Electron 主进程
├── backend/                 # Python 计算引擎
├── workspace/               # 工作区（项目存储目录）
│   ├── .gitkeep             # 保持目录存在
│   └── {项目名}/            # 每个项目一个子目录
│       ├── project.json          # 项目元数据
│       ├── network_config.ini    # 拓扑设计参数
│       ├── rack_layout.json      # 机柜布局数据
│       ├── topology.json         # 拓扑设计结果缓存
│       └── output/               # 生成的输出文件
│           ├── 连接关系表.xlsx
│           ├── 上机表.xlsx
│           ├── 设备清单.xlsx
│           └── 组网拓扑图.png
├── template/                # 模板中心（内置模板）
│   ├── .gitkeep
│   └── {模板名}/
│       ├── template.json         # 模板元数据
│       ├── network_config.ini    # 预设配置
│       └── rack_layout.json      # 预设机柜布局（可选）
├── docs/                    # 文档
│   ├── PRD_V2.0.md
│   └── 开发计划_V2.0.md
├── public/                  # 静态资源
├── scripts/                 # 构建脚本
├── .github/
│   └── workflows/
│       ├── ci.yml           # PR 检查（typecheck + lint + test）
│       └── build.yml        # Release 构建（打 tag 触发）
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
├── electron-builder.yml
└── README.md
```

### 2.2 workspace/ 工作区设计

**设计原则（对齐 MagicCommander）：**
- 每个项目 = 一个子目录，名称即项目名
- 项目目录内包含：配置、数据缓存、输出文件
- 在 Electron 中通过 `app.getPath('userData')` 或用户指定路径管理
- 应用启动时自动扫描 workspace/ 目录，列出所有项目

**项目目录标准结构：**
```
workspace/H100智算中心/
├── project.json               # 项目元数据
│   {
│     "name": "H100智算中心",
│     "description": "100台H100 GPU服务器组网方案",
│     "createdAt": "2026-07-26T12:00:00Z",
│     "updatedAt": "2026-07-26T20:00:00Z",
│     "version": 1
│   }
├── network_config.ini          # 拓扑设计参数（现有格式）
├── rack_layout.json            # 机柜布局数据
│   {
│     "racks": [
│       {
│         "id": "A01",
│         "name": "A01",
│         "location": "1F-A区",
│         "totalU": 42,
│         "devices": [
│           { "deviceName": "Spine-1", "deviceType": "param_spine",
│             "uStart": 35, "uEnd": 36, "uHeight": 2 }
│         ]
│       }
│     ]
│   }
├── topology.json               # 拓扑设计结果缓存（Python引擎输出）
│   {
│     "summary": { ... },
│     "nodes": [ ... ],
│     "edges": [ ... ]
│   }
└── output/                     # 渲染输出目录
    ├── 连接关系表_20260726_2024.xlsx
    ├── 上机表_20260726_2024.xlsx
    ├── 设备清单_20260726_2024.xlsx
    └── 组网拓扑图_20260726_2024.png
```

### 2.3 template/ 模板中心设计

**设计原则：**
- 内置模板随应用发布（打包到 extraResources）
- 用户保存的模板存到应用数据目录
- 模板包含完整的 network_config.ini + 可选 rack_layout.json

**模板目录结构：**
```
template/
├── H100-100台/
│   ├── template.json
│   │   {
│   │     "id": "h100-100",
│   │     "name": "H100-100台方案",
│   │     "description": "100台H100 GPU + 14存储 + 20管理",
│   │     "scenario": "H100-100台",
│   │     "tags": ["H100", "100台", "2层"],
│   │     "updatedAt": "2026-07-26"
│   │   }
│   ├── network_config.ini
│   └── rack_layout.json
├── A100-256台/
│   ├── template.json
│   ├── network_config.ini
│   └── rack_layout.json
└── 空项目/
    ├── template.json
    └── network_config.ini
```

### 2.4 技术栈

| 层级 | 技术 | 说明 |
|------|------|------|
| **桌面框架** | Electron 28 | 跨平台桌面应用 |
| **前端框架** | React 18 + TypeScript 5 | 组件化UI |
| **构建工具** | Vite 5 | 开发与打包 |
| **UI样式** | TailwindCSS 3 | 原子化CSS |
| **状态管理** | Zustand 4 (persist) | 轻量级状态管理 + 持久化 |
| **图标** | lucide-react | 统一图标库 |
| **布局** | react-resizable-panels | 可拖拽面板 |
| **可视化** | ECharts 5 | 拓扑图 + 机柜图渲染 |
| **国际化** | i18next + react-i18next | 5语言支持 |
| **Excel处理** | xlsx | 读写 + 内建预览 |
| **后端引擎** | Python 3 | 现有计算引擎（子进程调用） |
| **打包** | electron-builder + NSIS | Windows安装包 |
| **CI/CD** | GitHub Actions | 自动检查 + 构建发布 |

---

## 三、架构设计（对齐 MagicCommander）

### 3.1 整体架构

```
AutoLink/
├── src/                     # 前端 (React + TypeScript)
│   ├── App.tsx              # 主入口
│   ├── main.tsx             # ReactDOM 入口
│   ├── components/
│   │   ├── layout/          # 布局组件
│   │   │   ├── Header.tsx          # 标题栏
│   │   │   ├── ActivityBar.tsx     # 活动栏
│   │   │   ├── StatusBar.tsx       # 状态栏
│   │   │   ├── Sidebar.tsx         # 侧边栏容器
│   │   │   └── ResizableAppLayout.tsx
│   │   ├── sidebar/         # 侧边栏面板
│   │   │   ├── ExplorerPanel.tsx   # 项目浏览器 + 模板中心
│   │   │   ├── WorkbenchPanel.tsx  # 工作台
│   │   │   ├── DesignPanel.tsx     # 拓扑设计
│   │   │   ├── RackPanel.tsx       # 机柜规划
│   │   │   ├── TopologyPanel.tsx   # 拓扑可视化
│   │   │   ├── OutputPanel.tsx     # 输出结果（内建预览）
│   │   │   └── SettingsPanel.tsx   # 设置
│   │   ├── common/          # 通用组件
│   │   ├── ui/              # 基础UI组件
│   │   ├── output/          # 输出预览组件
│   │   │   ├── OutputFileTree.tsx  # 输出文件树
│   │   │   ├── ExcelPreview.tsx    # Excel 内建预览（xlsx库）
│   │   │   └── ImagePreview.tsx    # 图片预览（拓扑图PNG）
│   │   ├── rack/            # 机柜规划组件
│   │   ├── topology/        # 拓扑可视化组件
│   │   └── workbench/       # 工作台子组件
│   ├── stores/              # Zustand 状态管理
│   ├── types/               # TypeScript 类型定义
│   ├── i18n/                # 国际化
│   ├── hooks/               # 自定义Hooks
│   └── utils/               # 工具函数
├── electron/                # Electron 主进程
│   ├── main.ts
│   ├── preload.ts
│   ├── config.ts
│   ├── ipc/
│   │   └── handlers.ts
│   └── services/
│       ├── python.service.ts      # Python引擎调用
│       └── update.service.ts      # 自动更新
├── backend/                 # Python 计算引擎
│   ├── engine.py
│   ├── designer.py
│   ├── models.py
│   ├── topology.py
│   └── exporter.py
├── workspace/               # 工作区（项目存储）
├── template/                # 内置模板
├── .github/workflows/       # CI/CD
│   ├── ci.yml
│   └── build.yml
├── docs/                    # 文档
├── package.json
├── vite.config.ts
├── tailwind.config.js
├── tsconfig.json
├── electron-builder.yml
└── README.md
```

### 3.2 数据流（对齐 MagicCommander）

```
用户操作 (React UI)
    │
    ▼
Zustand Store (状态管理 + persist 持久化)
    │
    ▼
window.electron.* API (preload 桥接)
    │
    ▼
Electron Main Process (ipcMain.handle)
    │
    ├── Python Engine (子进程, JSON stdin/stdout)
    │   └── engine.py → designer.py / exporter.py
    │
    └── 文件系统读写 (项目目录、配置文件)
    │
    ▼
计算结果 (JSON) → Store → UI 更新
```

### 3.3 主界面布局（对齐 MagicCommander 的 App.tsx 结构）

```
┌─────────────────────────────────────────────────────────┐
│  Header (标题栏: 菜单 + 项目名称 + 主题切换 + 窗口控制)    │
├──────┬──────────────────────────────────────────────────┤
│      │  Sidebar (左侧面板)                               │
│  A   │  ┌──────────────────────────────────────────┐   │
│  c   │  │  根据 ActivityBar 选中切换:               │   │
│  t   │  │  - 项目浏览器 (ExplorerPanel)              │   │
│  i   │  │  - 工作台 (WorkbenchPanel)                │   │
│  v   │  │  - 拓扑设计 (DesignPanel)                  │   │
│  i   │  │  - 机柜规划 (RackPanel)                   │   │
│  t   │  │  - 拓扑可视化 (TopologyPanel)              │   │
│  y   │  │  - 输出结果 (OutputPanel)                  │   │
│      │  │  - 设置 (SettingsPanel)                   │   │
│  B   │  └──────────────────────────────────────────┘   │
│  a   │                                                   │
│  r   │  ┌──────────────────────────────────────────┐   │
│      │  │  Bottom Panel (底部面板，可折叠)           │   │
│      │  │  - 渲染日志 / 错误信息 / 设计摘要           │   │
│      │  └──────────────────────────────────────────┘   │
├──────┴──────────────────────────────────────────────────┤
│  StatusBar (项目路径 | 设计状态 | 服务器数量 | 语言)      │
└─────────────────────────────────────────────────────────┘
```

### 3.4 ActivityBar 导航项（对齐 MagicCommander）

| 图标 | 面板 | 快捷键 | 说明 |
|------|------|--------|------|
| 🔍 搜索 | SearchPanel | Ctrl+Shift+F | 全局搜索（后续） |
| 📁 项目 | ExplorerPanel | Ctrl+Shift+E | 项目列表 + 模板中心 |
| ⚡ 工作台 | WorkbenchPanel | Ctrl+Shift+W | 渲染操作（连接表/上机表/拓扑图） |
| 🎛️ 设计 | DesignPanel | Ctrl+Shift+D | 拓扑设计配置 + 摘要 |
| 🗄️ 机柜 | RackPanel | Ctrl+Shift+R | 机柜U位规划 |
| 🔗 拓扑 | TopologyPanel | Ctrl+Shift+T | 拓扑可视化 |
| 📋 输出 | OutputPanel | Ctrl+Shift+O | 渲染输出结果 |
| ⚙️ 设置 | SettingsPanel | Ctrl+, | 设置 |

---

## 四、功能需求

### 4.1 项目管理（对齐 MagicCommander 的 ExplorerPanel + project.store）

**项目数据结构：**
```
Project/
├── project.json          # 项目元数据
├── network_config.ini    # 拓扑设计参数
├── rack_layout.json      # 机柜布局数据
├── output/               # 生成的连接表/上机表/拓扑图
└── topology.json         # 拓扑设计结果缓存
```

**功能点：**
- P1: 项目列表（ExplorerPanel，含项目名、状态、数量徽标）
- P1: 创建项目（Modal对话框，支持从模板创建或空项目）
- P1: 项目分组：收藏夹、最近使用、全部项目
- P1: 项目搜索、排序（按名称/日期）
- P1: 删除项目（单个/批量，二次确认）
- P1: 项目右键菜单（打开文件夹、删除、收藏）
- P1: 项目选中 → 自动加载项目结构
- P2: 项目批量渲染（多选 → 一键生成所有项目）
- P2: 项目导入/导出

### 4.2 模板中心（对齐 MagicCommander 的 TemplateCenterPanel）

**模板数据结构：**
```typescript
interface TemplateMeta {
  id: string;
  name: string;
  description: string;
  scenario: string;        // 场景标签，如 "H100-100台", "A100-256台"
  sourceProject: string;   // 来源项目
  updatedAt: string;
  networkConfig: object;   // network_config.ini 内容
  rackLayout: object;      // 机柜布局（可选）
}
```

**功能点：**
- P1: 模板列表（卡片视图，显示名称、场景、描述）
- P1: 从模板创建项目（选择模板 → 自动填充配置）
- P1: 保存项目为模板（当前项目 → 另存为模板）
- P1: 删除模板
- P2: 内置示例模板（H100-100台、A100-256台等常见方案）
- P2: 模板导入/导出

### 4.3 工作台（对齐 MagicCommander 的 WorkbenchPanel + render.store）

**工作台是核心操作面板，将设计好的项目一键渲染为各种输出：**

```
┌──────────────────────────────────────────────┐
│  工作台                                       │
├──────────────────────────────────────────────┤
│  ▼ 项目范围                                   │
│  ┌──────────────────────────────────────┐    │
│  │ ○ 当前项目: H100智算中心              │    │
│  │ □ 批量渲染: [项目A] [项目B] [项目C]    │    │
│  └──────────────────────────────────────┘    │
├──────────────────────────────────────────────┤
│  ▼ 就绪检查                                   │
│  ┌──────────────────────────────────────┐    │
│  │ ✅ 拓扑设计已完成 (100 GPU + 14 存储)  │    │
│  │ ⚠️ 机柜布局未完成 (32/134 设备已分配)  │    │
│  │ [校验拓扑] [校验机柜]                 │    │
│  └──────────────────────────────────────┘    │
├──────────────────────────────────────────────┤
│  ▼ 输出类型                                   │
│  ┌──────────────────────────────────────┐    │
│  │ ☑ 连接关系表 (Excel)                  │    │
│  │ ☑ 上机表 (机柜U位分配表 Excel)        │    │
│  │ ☑ 组网拓扑图 (PNG)                    │    │
│  │ ☐ 设备清单 (Excel)                    │    │
│  └──────────────────────────────────────┘    │
├──────────────────────────────────────────────┤
│  ▼ 渲染操作                                   │
│  ┌──────────────────────────────────────┐    │
│  │ [🚀 一键渲染] [👁 预览] [🗑 清除输出]  │    │
│  │                                       │    │
│  │ 进度: ████████░░ 80%                  │    │
│  │ 正在生成: 连接关系表...                 │    │
│  └──────────────────────────────────────┘    │
├──────────────────────────────────────────────┤
│  ▼ 渲染结果                                   │
│  ┌──────────────────────────────────────┐    │
│  │ ✅ 连接关系表已生成 (2026-07-26 20:30) │    │
│  │ ✅ 上机表已生成 (2026-07-26 20:30)    │    │
│  │ ✅ 拓扑图已生成 (2026-07-26 20:31)    │    │
│  │ [📂 打开文件夹] [📋 查看输出]          │    │
│  └──────────────────────────────────────┘    │
└──────────────────────────────────────────────┘
```

**渲染输出类型：**
| 输出 | 格式 | 引擎 | 说明 |
|------|------|------|------|
| 连接关系表 | Excel (.xlsx) | exporter.py | 现有功能，服务器/交换机视角 |
| 上机表 | Excel (.xlsx) | 新增 | 设备 → 机柜号 → U位（开始/结束） |
| 组网拓扑图 | PNG | ECharts 截图 | 参数/存储网络拓扑图 |
| 设备清单 | Excel (.xlsx) | 新增 | 设备汇总表（型号、数量、端口） |

**功能点：**
- P1: 项目范围选择（当前项目/批量多项目）
- P1: 就绪检查（拓扑设计状态、机柜布局状态，校验按钮）
- P1: 输出类型勾选（连接关系表、上机表、拓扑图、设备清单）
- P1: 一键渲染（调用Python引擎 → 实时进度条 → 结果展示）
- P1: 渲染结果卡片（成功/失败状态、时间戳、打开文件夹）
- P1: 清除输出
- P2: Dry-run 预览（预览不写文件）
- P2: 渲染日志面板

### 4.4 拓扑设计（保留升级）

**功能点：**
- P1: 配置面板（network_config.ini 的 GUI 表单编辑，带参数说明 tooltip）
- P1: 一键生成拓扑（调用 Python 引擎）
- P1: 设计摘要面板（展示 Leaf/Spine 数量、端口使用率等）
- P1: 拓扑验证结果展示（通过/错误列表）
- P2: full/custom 模式切换预览
- P2: 设计历史记录

### 4.5 机房机柜布局规划（核心新增）

**数据模型：**
```typescript
interface Rack {
  id: string;
  name: string;
  location: string;
  totalU: number;        // 默认 42U
  devices: RackDevice[];
}

interface RackDevice {
  deviceName: string;
  deviceType: string;
  uStart: number;        // 起始U位 (1-based)
  uEnd: number;          // 结束U位
  uHeight: number;       // 占U数
}
```

**功能点：**
- P1: 机柜列表管理（增删机柜，显示U位使用率进度条）
- P1: 待分配设备池（从拓扑设计结果中提取设备列表）
- P1: 设备分配到机柜（拖拽或表单指定U位范围）
- P1: 42U机柜正面可视化（色块表示设备，不同颜色区分类型）
- P1: U位冲突自动检测（重叠标红）
- P1: Hover设备显示详情（设备名、类型、U位范围、端口数）
- P2: 机房机柜总览（卡片视图，所有机柜排列）
- P2: 导出上机表为 Excel

### 4.6 网络拓扑可视化（核心新增）

**功能点：**
- P1: 拓扑图渲染（ECharts Graph，节点=设备，边=连接关系）
- P1: 分层布局（Server层 → Leaf层 → Spine层 → Core层）
- P1: 网络类型筛选（参数/存储/OOB/业务 切换）
- P1: 节点详情面板（点击设备 → 连接列表、端口使用率）
- P1: 连接线高亮（Hover 设备时高亮相关连接）
- P1: 设备图标区分（服务器/Leaf/Spine/Core 不同颜色和形状）
- P2: 拓扑导出 PNG
- P2: 缩放与平移

### 4.7 主题系统（亮色/暗色双主题）

**设计目标：** 对齐 MagicCommander 的主题系统，支持亮色、暗色、跟随系统三种模式，所有组件（包括拓扑图、机柜图）统一适配。

**主题配置：**
```typescript
type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeState {
  theme: ThemeMode           // 当前主题模式
  isDark: boolean            // 实际是否暗色（system模式跟随OS）
  syncSystemTheme: () => void // 监听OS主题变化
  setTheme: (mode: ThemeMode) => void
  toggleTheme: () => void    // 亮色 ↔ 暗色快速切换
}
```

**实现方案：**
- TailwindCSS `darkMode: 'class'` → 通过 `<html class="dark">` 切换
- Zustand persist 持久化用户选择
- `Window.matchMedia('(prefers-color-scheme: dark)')` 监听系统主题
- 所有组件使用 `dark:` 前缀适配暗色样式
- ECharts 拓扑图动态切换主题配色（`echarts.theme`）
- 机柜U位图的色块在暗色模式下降低亮度

**色彩体系（对齐 MagicCommander）：**

| 元素 | 亮色模式 | 暗色模式 |
|------|---------|---------|
| 背景 | `bg-gray-50` | `bg-gray-900` |
| 侧边栏 | `bg-white` | `bg-gray-800` |
| 卡片 | `bg-white` | `bg-gray-800` |
| ActivityBar | `bg-gray-100` | `bg-gray-900` |
| 文字主色 | `text-gray-900` | `text-gray-100` |
| 文字次色 | `text-gray-500` | `text-gray-400` |
| 分割线 | `border-gray-200` | `border-gray-700` |
| 主色调 | `primary-500` | `primary-400` |
| Header | `bg-gray-50` | `bg-gray-900` |
| StatusBar | `bg-gray-100` | `bg-gray-800` |

### 4.8 多国语言国际化

**设计目标：** 支持 5 种语言，对齐 MagicCommander 的 i18next 架构。

**语言列表：**

| 代码 | 语言 | 说明 |
|------|------|------|
| `zh-CN` | 简体中文 | 默认语言 |
| `en` | English | 英文 |
| `ja` | 日本語 | 日文 |
| `ko` | 한국어 | 韩文 |
| `zh-TW` | 繁體中文 | 繁体中文 |

**实现方案：**
```typescript
// src/i18n/index.ts
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import zhCN from './resources/zh-CN'
import en from './resources/en'
import ja from './resources/ja'
import ko from './resources/ko'
import zhTW from './resources/zh-TW'

i18n.use(initReactI18next).init({
  resources: { 'zh-CN': zhCN, en, ja, ko, 'zh-TW': zhTW },
  lng: 'zh-CN',
  fallbackLng: 'zh-CN',
  interpolation: { escapeValue: false },
})
```

**翻译文件结构：**
```
src/i18n/resources/
├── zh-CN/
│   ├── common.json      # 通用：菜单、按钮、状态
│   ├── project.json     # 项目管理
│   ├── design.json      # 拓扑设计
│   ├── rack.json        # 机柜规划
│   ├── topology.json    # 拓扑可视化
│   └── workbench.json   # 工作台
├── en/        (同上结构)
├── ja/        (同上结构)
├── ko/        (同上结构)
└── zh-TW/     (同上结构)
```

**语言切换入口：**
- Header 标题栏右侧语言下拉菜单（对齐 MagicCommander 的 LanguagePopover）
- 设置面板 → 语言选项

**Zustand persist 持久化用户语言选择，下次启动自动恢复。**

### 4.9 自动更新机制

**设计目标：** 对齐 MagicCommander 的 electron-updater 方案，支持 GitHub Releases 自动检测和静默下载。

**实现方案：**

```typescript
// electron/services/update.service.ts
import { autoUpdater } from 'electron-updater'
import { BrowserWindow } from 'electron'

class UpdateService {
  private mainWindow: BrowserWindow | null = null

  setWindow(win: BrowserWindow) { this.mainWindow = win }

  async checkForUpdates(): Promise<void> {
    autoUpdater.autoDownload = false  // 先检查，用户确认后下载
    autoUpdater.autoInstallOnAppQuit = true
    await autoUpdater.checkForUpdatesAndNotify()
  }

  async downloadUpdate(): Promise<void> {
    await autoUpdater.downloadUpdate()
  }

  quitAndInstall(): void {
    autoUpdater.quitAndInstall()
  }
}
```

**更新流程：**

```
应用启动 (延迟3秒)
    │
    ▼
静默检查更新 (autoUpdater.checkForUpdates)
    │
    ├── 无更新 → 静默结束
    │
    └── 有新版本
        │
        ▼
    Header 显示更新图标 (UpdatePopover 气泡提示)
        │
        ├── 用户点击 [下载更新]
        │   ├── 显示下载进度条
        │   └── 下载完成 → 提示 [重启安装]
        │
        └── 用户忽略 → 下次启动再提示
```

**electron-builder publish 配置：**
```json
{
  "build": {
    "publish": [{
      "provider": "github",
      "owner": "bangbang8000-cell",
      "repo": "AutoLink"
    }]
  }
}
```

**IPC 通道：**
- `app:check-update` → 手动检查更新
- `app:download-update` → 开始下载
- `app:quit-and-install` → 重启安装

**StatusBar 底部显示版本号和更新状态。**

### 4.10 输出结果面板（OutputPanel + 内建预览）

**设计目标：** 在应用内直接查看生成的输出文件（Excel 连接表、上机表、拓扑图 PNG），无需切换到外部工具。

**OutputPanel 布局：**
```
┌──────────────────────────────────────────────────┐
│  输出结果                                         │
├────────────────────┬─────────────────────────────┤
│  输出文件树         │  文件预览区                   │
│  ┌──────────────┐  │  ┌──────────────────────┐   │
│  │ 📁 H100项目   │  │  │ [Sheet: 服务器连接表]  │   │
│  │  ├─ 📊 连接关系表│  │  │                      │   │
│  │  ├─ 📊 上机表  │  │  │ podid | 服务器分组 | ..│   │
│  │  ├─ 🖼 拓扑图  │  │  │ pod-1 | GPU组1    | ..│   │
│  │  └─ 📊 设备清单│  │  │ pod-1 | GPU组1    | ..│   │
│  │                │  │  │ pod-2 | GPU组2    | ..│   │
│  │  📁 A100项目   │  │  │ ...                  │   │
│  │  ...           │  │  └──────────────────────┘   │
│  └──────────────┘  │  支持: 排序 | 筛选 | 分页     │
│                     │  [打开文件夹] [外部打开]      │
├────────────────────┴─────────────────────────────┤
│  状态: 共 4 个文件 | 当前: 连接关系表.xlsx         │
└──────────────────────────────────────────────────┘
```

**功能点：**
- P1: 输出文件树（按项目分组，显示文件类型图标）
- P1: Excel 内建预览（`xlsx` 库解析 → 可排序可筛选表格）
- P1: Sheet 切换（多 Sheet Excel 下拉切换）
- P1: 图片预览（拓扑图 PNG 缩放查看）
- P1: 搜索/筛选（按设备名、接口名、线缆类型过滤）
- P1: 打开文件所在文件夹（`shell.showItemInFolder`）
- P1: 外部程序打开（`shell.openPath`）
- P2: 数据导出（当前预览的数据导出为 CSV）

### 4.11 GitHub CI/CD

**设计目标：** 对齐 MagicCommander 的 GitHub Actions 配置，实现 PR 自动检查和 tag 触发自动构建发布。

#### ci.yml（PR 检查）

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v5
        with: { node-version: '22' }
      - uses: actions/setup-python@v6
        with: { python-version: '3.12' }
      - run: npm ci --ignore-scripts
      - run: pip install -r backend/requirements.txt
      - run: npm run typecheck
      - run: npm run lint
      - run: npm test
      - run: cd backend && python -m pytest tests/ -v
```

**触发条件：** push/PR 到 main 分支

**检查项：**
1. TypeScript 类型检查（`npm run typecheck`）
2. ESLint 代码规范（`npm run lint`）
3. 前端单元测试（`npm test`）
4. Python 后端测试（`pytest`）

#### build.yml（Release 构建）

```yaml
name: Build & Release
on:
  push:
    tags: ['v*']
  workflow_dispatch:
concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: true
jobs:
  build:
    name: Build (${{ matrix.os }})
    runs-on: ${{ matrix.os }}
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: windows-latest
            platform: win
          - os: macos-latest
            platform: mac
          - os: ubuntu-latest
            platform: linux
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v5
        with: { node-version: '22', cache: 'npm' }
      - uses: actions/setup-python@v6
        with: { python-version: '3.11' }
      - run: pip install -r backend/requirements.txt
      - run: npm ci
      - run: npm run build
      - run: npx electron-builder --${{ matrix.platform }} --publish=never
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - uses: actions/upload-artifact@v4
        with:
          name: AutoLink-${{ matrix.platform }}
          path: release/*.{exe,zip,AppImage,deb,blockmap,yml}
          retention-days: 30
  release:
    name: Create Release
    if: startsWith(github.ref, 'refs/tags/v')
    needs: build
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - uses: actions/download-artifact@v4
        with: { path: release }
      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release delete "${{ github.ref_name }}" --yes || true
          find release -name "builder-debug.yml" -delete
          gh release create "${{ github.ref_name }}" \
            release/*/*.{exe,zip,AppImage,deb,blockmap,yml} \
            --title "${{ github.ref_name }}" \
            --generate-notes
```

**触发条件：** 推送 `v*` 标签（如 `v2.0.0`）或手动触发

**构建流程：**
1. 三平台并行构建（Windows / macOS / Linux）
2. npm ci → npm run build → electron-builder
3. 上传构建产物为 artifacts
4. 创建 GitHub Release 并附加所有平台安装包

### 4.12 README 与文档

**README.md 结构（对齐 MagicCommander 风格）：**

```markdown
# AutoLink

**AI智算中心网络规划与可视化工具 | AI Data Center Network Planning & Visualization**

[![Version](https://img.shields.io/badge/version-2.0.0-blue)](...)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Windows](https://img.shields.io/badge/Windows-NSIS-blue)](...)
[![Languages](https://img.shields.io/badge/languages-5-orange)](...)

## 一句话介绍
你还在用 Excel 手工规划智算中心的网络拓扑和机柜布局吗？

## 三步完成智算中心网络规划
1. 选择模板或新建项目 → 配置参数
2. 一键生成拓扑 → 拖拽分配机柜U位
3. 渲染输出连接表、上机表、拓扑图

## 核心功能
### 智能拓扑设计
### 机柜U位规划
### 网络拓扑可视化
### 项目模板中心
### 一键渲染输出
### 5 种语言、亮暗双主题

## 三分钟上手
## 技术栈
## 项目结构
## 快捷键
## 版本历史
## 参与贡献
```

**docs/ 目录：**
```
docs/
├── PRD_V2.0.md           # 产品需求文档
├── 开发计划_V2.0.md        # 开发计划
└── screenshot/            # 截图（README用）
    ├── main.png
    ├── design.png
    ├── rack.png
    └── topology.png
```

---

## 五、优先级定义

| 优先级 | 含义 | 阶段 |
|--------|------|------|
| **P0** | 必须实现，否则无法交付 | Phase 0-1 |
| **P1** | 核心功能，第一版必须包含 | Phase 1-3 |
| **P2** | 重要但可延后 | Phase 4 |
| **P3** | 锦上添花 | 后续版本 |

主题系统（亮色/暗色/跟随系统）和 5 语言国际化均提升为 **P1**，在 Phase 1 AppShell 中搭建基础框架，Phase 4 补充翻译和打磨。自动更新为 **P2**。

---

## 六、非功能性需求

- **性能**：拓扑生成（100台服务器规模）< 5秒；拓扑图渲染 < 3秒
- **可靠性**：Python引擎崩溃不影响前端，可重试
- **兼容性**：Windows 10/11 64位（优先），macOS（后续）
- **安装包体积**：目标 < 200MB（含嵌入式Python）
- **代码规范**：ESLint + Prettier（对齐 MagicCommander）
- **状态持久化**：Zustand persist（主题、语言、最近项目、收藏）