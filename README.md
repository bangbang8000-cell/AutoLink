# AutoLink

**AI 智算中心网络规划与可视化工具 | AI Data Center Network Planning & Visualization**

[![Version](https://img.shields.io/badge/version-2.0.1-blue)](#)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#)
[![Languages](https://img.shields.io/badge/languages-5-orange)](#)

> 你还在用 Excel 手工规划智算中心的网络拓扑和机柜布局吗？

## 三步完成智算中心网络规划

```
1. 选择模板或新建项目 → 配置网络参数
2. 一键生成拓扑 → 拖拽分配机柜 U 位
3. 渲染输出连接表、上机表、拓扑图
```

## 核心功能

### 智能拓扑设计
- full / custom 双模式，自动计算参数网络（Fat-Tree）Leaf / Spine / Core 数量
- 支持参数网、存储网、OOB、业务网络的独立设计
- 设计摘要面板实时预览端口使用率、收敛比
- 拓扑验证：自动检测配置合理性

### 机柜 U 位规划
- 42U 标准机柜可视化，设备按色块区分类型（GPU 蓝色、存储绿色、其他紫色）
- 待分配设备池 — 从拓扑设计结果自动提取设备列表
- U 位冲突自动检测 — 重叠位置红色高亮
- 设备详情面板：类型、U 位范围、端口数
- **上机表 Excel 一键导出**

### 网络拓扑可视化
- ECharts 分层布局渲染：Server 层 → Leaf 层 → Spine 层 → Core 层
- 按网络类型筛选（参数网络 / 存储网络 / OOB / 业务网络）
- 点击设备查看连接列表和端口使用率
- 设备 hover 时高亮相关连接线
- **拓扑图 PNG 一键导出**

### 项目与模板
- 项目创建 / 删除 / 收藏 / 最近使用
- 模板中心：内置 H100-128台 / H100-100台 / 空项目 模板
- 从模板一键创建项目，自动填充配置
- Demo 项目开箱即用

### 工作台
- 项目范围选择（当前项目 / 批量多项目）
- 就绪检查（拓扑设计状态、机柜布局状态）
- 输出类型勾选（连接关系表 / 上机表 / 拓扑图 / 设备清单）
- 一键渲染 + 实时进度条

### 输出与预览
- 输出文件树：按项目分组，文件类型图标区分
- **Excel 内建预览**：支持多 Sheet 切换、排序、筛选
- **图片内建预览**：拓扑图缩放查看
- 打开文件所在文件夹 / 外部程序打开

### 5 语言 · 亮暗双主题
- 简体中文 / English / 日本語 / 한국어 / 繁體中文
- 亮色 / 暗色 / 跟随系统 三种模式
- ECharts 拓扑图、机柜图同步适配主题

### 自动更新
- 基于 electron-updater + GitHub Releases
- 启动静默检查 → Header 更新图标提示
- 下载进度条 → 就绪后重启安装

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面框架 | Electron 28 |
| 前端 | React 18 + TypeScript + Vite + TailwindCSS 3 |
| 状态管理 | Zustand (persist 持久化) |
| 图表可视化 | ECharts 6 + echarts-for-react |
| 布局 | react-resizable-panels |
| 图标 | lucide-react |
| 国际化 | i18next + react-i18next (5 语言) |
| Excel 处理 | xlsx (读写 + 内建预览) |
| 计算引擎 | Python 3 (子进程 JSON stdin/stdout 通信) |
| 打包 | electron-builder + NSIS |
| 自动更新 | electron-updater + GitHub Releases |
| CI/CD | GitHub Actions |

## 项目结构

```
AutoLink/
├── src/                        # 前端 (React + TypeScript)
│   ├── components/
│   │   ├── layout/             # Header, ActivityBar, StatusBar, ResizableAppLayout, Toast
│   │   ├── sidebar/            # ExplorerPanel, WorkbenchPanel, DesignPanel, RackPanel,
│   │   │                       # TopologyPanel, OutputPanel, SettingsPanel
│   │   ├── workbench/          # 工作台子组件 (ScopeCard, ReadinessCard, OutputCard,
│   │   │                       # ActionCard, ResultCard)
│   │   ├── output/             # ExcelPreview, ImagePreview
│   │   └── common/             # 通用组件
│   ├── stores/                 # Zustand stores (ui, project, design, rack, render, toast)
│   ├── i18n/                   # 5 语言翻译资源
│   ├── types/                  # TypeScript 类型定义
│   ├── hooks/                  # 自定义 Hooks
│   └── utils/                  # 工具函数
├── electron/                   # Electron 主进程
│   ├── main.ts                 # 应用入口 + 窗口管理
│   ├── preload.ts              # 预加载脚本 (contextBridge) — 类型参考
│   ├── config.ts               # 路径配置 + Demo 项目初始化
│   ├── ipc/handlers.ts         # IPC 通道处理器 (project/design/render/export/update)
│   └── services/
│       ├── python.service.ts   # Python 子进程调用服务
│       └── update.service.ts   # 自动更新服务
├── backend/                    # Python 计算引擎
│   ├── engine.py               # 统一 JSON stdin/stdout 接口
│   ├── designer.py             # 网络设计协调层
│   ├── topology.py             # 拓扑算法 (FatTree / AccessAgg)
│   ├── models.py               # 数据模型
│   ├── exporter.py             # Excel 导出
│   └── network_config.ini      # 默认配置
├── template/                   # 内置模板
│   ├── H100-128台/             # 128台H100 GPU 方案
│   ├── H100-100台/             # 100台H100 GPU 方案
│   └── 空项目/                 # 空白模板
├── workspace/                  # 工作区 (运行时生成，Git 忽略)
├── .github/workflows/          # CI/CD
│   ├── ci.yml                  # PR 检查 (typecheck + lint)
│   └── build.yml               # Release 构建 (tag 触发)
└── docs/                       # 文档
    ├── PRD_V2.0.md
    └── 开发计划_V2.0.md
```

## 快速开始

### 环境要求

- **Node.js** >= 22
- **Python** >= 3.10（需 `pip install -r backend/requirements.txt` 安装 openpyxl、pandas）
- Windows 10/11（优先支持）/ macOS / Linux

### 安装

```bash
npm install
pip install -r backend/requirements.txt
```

### 开发

```bash
# 一键启动（编译 Electron + Vite + Electron 窗口）
npm run dev:all

# 仅前端
npm run dev

# 仅 Electron（需先 npm run dev 启动 Vite）
npm run dev:electron
```

### 构建与打包

```bash
# 构建
npm run build

# Windows NSIS 安装包
npm run dist:win

# macOS
npm run dist:mac

# Linux AppImage / deb
npm run dist:linux
```

### 代码检查

```bash
npm run typecheck    # TypeScript 类型检查
npm run lint         # ESLint
npm run format       # Prettier 格式化
```

## 快捷键

| 快捷键 | 功能 | 快捷键 | 功能 |
|--------|------|--------|------|
| `Ctrl+Shift+E` | 项目浏览器 | `Ctrl+Shift+R` | 机柜规划 |
| `Ctrl+Shift+W` | 工作台 | `Ctrl+Shift+T` | 拓扑可视化 |
| `Ctrl+Shift+D` | 拓扑设计 | `Ctrl+Shift+O` | 输出结果 |
| `Ctrl+,` | 设置 | `Ctrl+B` | 切换侧边栏 |

## CI/CD

- **CI** ([ci.yml](.github/workflows/ci.yml)): push / PR 到 `main` 自动运行 typecheck + lint
- **Release** ([build.yml](.github/workflows/build.yml)): 推送 `v*` tag 自动构建三平台安装包并发布到 GitHub Releases

```bash
git tag v2.0.1
git push origin v2.0.1
```

## 版本历史

| 版本 | 日期 | 主要变更 |
|------|------|---------|
| v2.0.1 | 2026-07 | 自动更新机制（UpdatePopover + electron-updater）、上机表 Excel 导出、拓扑图 PNG 导出、U 位冲突可视化高亮、预加载脚本 CJS 修复、IPC 错误处理强化 |
| v2.0.0 | 2026-07 | Electron 桌面应用初始版本：拓扑设计 / 机柜规划 / 拓扑可视化 / 项目管理 / 工作台 / 5 语言 / 亮暗主题 / CI/CD |

## 许可证

MIT License
