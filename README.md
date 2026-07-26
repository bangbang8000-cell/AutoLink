# AutoLink

**AI智算中心网络规划与可视化工具 | AI Data Center Network Planning & Visualization**

[![Version](https://img.shields.io/badge/version-2.0.0-blue)](https://github.com/bangbang8000-cell/AutoLink)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Windows](https://img.shields.io/badge/Windows-NSIS-blue)](https://github.com/bangbang8000-cell/AutoLink/releases)
[![Languages](https://img.shields.io/badge/languages-5-orange)](https://github.com/bangbang8000-cell/AutoLink)

## 一句话介绍

你还在用 Excel 手工规划智算中心的网络拓扑和机柜布局吗？

AutoLink 帮你**三步完成**：输入参数 → 自动计算拓扑 → 一键渲染连接关系表、上机表、拓扑图。

---

## 三步完成智算中心网络规划

### 1. 选择模板，配置参数
从模板中心选择 H100-100台 等预设方案，或新建空项目。在可视化配置面板中调整 GPU 数量、交换机端口数、下行口数限制等参数。

### 2. 一键生成拓扑，拖拽分配机柜
点击"生成拓扑"，Python 引擎自动计算 Fat-Tree 拓扑的 Leaf/Spine/Core 数量。在机柜视图中，将设备拖拽到 42U 标准机柜的指定 U 位。

### 3. 渲染输出
在工作台一键渲染：
- 连接关系表 (Excel)
- 上机表 - 机柜U位分配表 (Excel)
- 组网拓扑图 (PNG)
- 设备清单 (Excel)

所有输出文件在应用内可直接预览，无需切换外部工具。

---

## 核心功能

### 智能拓扑设计
- 自动计算 Fat-Tree 拓扑的参数网络（Leaf-Spine）
- 存储网络 / OOB带外管理网络 / 业务网络的接入-汇聚拓扑
- 支持 full（满接）和 custom（自定义下行口数）两种模式
- 拓扑验证：自动检测端口溢出和服务器覆盖完整性

### 机柜U位规划
- 42U 标准机柜正面可视化
- 拖拽/表单方式分配设备到指定 U 位
- 自动检测 U 位冲突
- 不同设备类型用不同颜色区分

### 网络拓扑可视化
- ECharts 分层拓扑图（Server → Leaf → Spine → Core）
- 按网络类型筛选（参数/存储/OOB/业务）
- 点击设备查看连接详情
- Hover 高亮相关连接

### 项目模板中心
- 内置 H100-100台、空项目等模板
- 从模板一键创建项目，自动填充配置
- 保存当前项目为模板，团队复用

### 一键渲染输出
- 连接关系表 (6-7 Sheet Excel)
- 上机表 (机柜号 + U位范围)
- 组网拓扑图 (PNG)
- 设备清单 (Excel)
- 内建 Excel/图片预览，无需外部工具

### 5 种语言、亮暗双主题
- 简体中文 / English / 日本語 / 한국어 / 繁體中文
- 亮色 / 暗色 / 跟随系统三种主题模式
- 所有可视化组件（拓扑图、机柜图）完整适配

---

## 技术栈

Electron 28 · React 18 · TypeScript 5 · Vite 5 · TailwindCSS 3 · Zustand 4 · ECharts 5 · xlsx · i18next · lucide-react · react-resizable-panels · Python 3 · openpyxl · pandas

---

## 项目结构

```
AutoLink/
├── src/                   # 前端 (React + TypeScript)
│   ├── components/
│   │   ├── layout/        # Header, ActivityBar, StatusBar, ResizableAppLayout
│   │   ├── sidebar/       # ExplorerPanel, WorkbenchPanel, DesignPanel, RackPanel, TopologyPanel, OutputPanel, SettingsPanel
│   │   ├── output/        # OutputFileTree, ExcelPreview, ImagePreview
│   │   ├── rack/          # RackView, RackList, DevicePool
│   │   ├── topology/      # TopologyGraph, DeviceDetail, FilterBar
│   │   ├── workbench/     # ScopeCard, ReadinessCard, OutputCard, ActionCard, ResultCard
│   │   ├── common/
│   │   └── ui/            # Button, Modal, Toast
│   ├── stores/            # Zustand (ui, project, design, rack, render)
│   ├── types/             # TypeScript 类型
│   ├── i18n/              # 5语言国际化
│   └── hooks/
├── electron/              # Electron 主进程
│   ├── main.ts            # 窗口管理
│   ├── preload.ts         # IPC 桥接
│   ├── config.ts          # 路径配置
│   ├── ipc/handlers.ts    # IPC 处理器
│   └── services/
│       └── python.service.ts  # Python 引擎调用
├── backend/               # Python 计算引擎
│   ├── engine.py          # 统一引擎接口 (JSON stdin/stdout)
│   ├── designer.py        # 网络设计协调层
│   ├── topology.py        # FatTree/接入汇聚拓扑
│   ├── models.py          # 数据模型
│   └── exporter.py        # Excel 导出
├── workspace/             # 工作区 (项目存储)
├── template/              # 内置模板
├── docs/                  # 文档 (PRD + 开发计划)
├── .github/workflows/     # CI/CD
│   ├── ci.yml             # PR 检查
│   └── build.yml          # Release 构建
└── README.md
```

---

## 三分钟上手

### 安装

从 [GitHub Releases](https://github.com/bangbang8000-cell/AutoLink/releases) 下载安装包。

或从源码运行：

```bash
git clone https://github.com/bangbang8000-cell/AutoLink.git
cd AutoLink
npm install
pip install -r backend/requirements.txt
npm run dev:all
```

### 创建项目

打开 AutoLink，点击 ActivityBar 的项目浏览器图标，新建项目 → 选择模板或空项目 → 自动生成项目目录。

### 配置 → 生成 → 输出

1. 切换到设计面板 → 调整参数 → 点击"生成拓扑"
2. 切换到机柜面板 → 拖拽设备到 U 位
3. 切换到工作台 → 勾选输出类型 → 一键渲染

---

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+B` | 切换侧边栏 |
| `Ctrl+J` | 切换底部面板 |
| `Ctrl+Shift+E` | 切换到项目浏览器 |
| `Ctrl+Shift+W` | 切换到工作台 |
| `Ctrl+Shift+D` | 切换到拓扑设计 |
| `Ctrl+Shift+R` | 切换到机柜规划 |
| `Ctrl+Shift+T` | 切换到拓扑可视化 |
| `Ctrl+Shift+O` | 切换到输出结果 |
| `Ctrl+,` | 打开设置 |

---

## 版本历史

| 版本 | 日期 | 更新内容 |
|------|------|---------|
| **2.0.0** | 2026-07-26 | 初始版本：Electron 桌面应用，拓扑设计、机柜规划、拓扑可视化、项目管理、模板中心、工作台、5语言/双主题 |

---

## 参与贡献

欢迎提交 Issue 和 Pull Request。如有功能建议或问题反馈，请在 [GitHub Issues](https://github.com/bangbang8000-cell/AutoLink/issues) 中提出。

---

## 许可证

MIT License © 2026 AutoLink Team
