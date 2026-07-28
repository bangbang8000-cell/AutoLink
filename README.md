# AutoLink

**AI 智算中心网络规划与可视化工具 | AI Data Center Network Planning & Visualization**

[![Version](https://img.shields.io/badge/version-2.3.0-blue)](#)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#)
[![Languages](https://img.shields.io/badge/languages-5-orange)](#)

> 专为 AI 数据中心设计的网络拓扑规划、设备选型与机柜上架一体化工具。

## 三步完成智算中心网络规划

```
1. 选择模板或新建项目 → 配置网络参数
2. 一键生成拓扑 → 拖拽分配机柜 U 位
3. 渲染输出连接表、上机表、拓扑图
```

## 核心功能

### 智能拓扑设计
- Fat-Tree 胖树拓扑自动计算（二层/三层自适应）
- 支持参数网、存储网、OOB、业务网独立设计
- full / custom 双下行端口模式
- 设计摘要实时预览（节点数、端口使用率、收敛比）

### 机柜 U 位规划
- 42U/49U 机柜可视化，设备按类型色块区分
- 待分配设备池 → 点击 U 位放置，冲突自动检测
- 功率负载实时监控，超限红色告警
- 支持多机柜切换、设备跨柜移动

### 拓扑可视化
- ECharts 网络拓扑图，矩形节点 + 分层布局
- 服务器按参数 Leaf 自动分组，组间清晰间隔
- 支持缩放、拖拽、布局保存、PNG 导出
- 按网络类型（参数/存储/OOB/业务）过滤视图
- 节点详情面板：类型、组、Pod、机柜、连接数

### 设备库（50+ 款认证设备）
- **GPU 服务器**：NVIDIA DGX H100/B200/B300/GB300 等
- **存储服务器**：全闪 / 混闪存储节点
- **通算服务器**：通用计算节点
- **交换机**：参数面 / 存储 / 业务 / 带外（华为/H3C/锐捷等）
- 分层分类浏览，设备详情：物理参数、端口配置、接口模型
- 页签复用模式（设置中可切换），支持搜索和厂商筛选

### 工作台
- 项目就绪状态检查（拓扑验证 + 机柜规划）
- 输出类型选择（连接表 / 上机表 / 拓扑图 / 设备清单）
- 一键渲染导出

### 国际化
- 5 种语言：简体中文 / English / 日本語 / 한국어 / 繁體中文
- 关于对话框含快捷键速查表
- 设置面板支持外观 / 语言 / 项目默认值 / 输出 / 快捷键 / 设备库 / 网络 / 数据管理

## 快速开始

### 环境要求

- **Node.js** ≥ 18
- **Python** ≥ 3.8（需安装 `pandas` 和 `openpyxl`）
- **Git**（可选，用于克隆仓库）

### 安装

```bash
git clone https://github.com/bangbang8000-cell/AutoLink.git
cd AutoLink
npm install
pip install -r backend/requirements.txt
```

### 开发运行

```bash
npm run dev:all
```

### 打包构建

```bash
npm run dist:win    # Windows
npm run dist:mac    # macOS
npm run dist:linux  # Linux
```

### 运行测试

```bash
npm test              # 前端测试
npm run test:backend  # 后端测试
npm run test:all      # 全量测试
```

## 项目结构

```
AutoLink/
├── backend/              # Python 计算引擎
│   ├── engine.py         #   入口（stdin/stdout JSON-RPC）
│   ├── designer.py       #   网络设计协调层
│   ├── topology.py       #   FatTree 拓扑计算
│   ├── models.py         #   数据模型
│   └── exporter.py       #   Excel 导出
├── electron/             # Electron 主进程
│   ├── main.ts           #   应用入口
│   ├── preload.ts        #   安全桥接
│   └── ipc/handlers.ts   #   IPC 处理器
├── src/                  # React 前端
│   ├── components/       #   UI 组件（layout/workspace/device/wizard/sidebar）
│   ├── stores/           #   Zustand 状态管理
│   ├── constants/        #   共享常量（标签映射等）
│   ├── i18n/             #   国际化（zh-CN/en/ja/ko/zh-TW）
│   ├── hooks/            #   自定义 Hooks
│   └── types/            #   TypeScript 类型定义
├── template/             # 设备库 + 项目模板
│   ├── device_library/   #   50+ 设备 JSON 配置
│   ├── H100-128台/       #   128 台 H100 GPU 模板
│   └── H100-100台/       #   100 台 H100 GPU 模板
├── docs/                 # 产品文档 + 部署指南
└── tests/backend/        # Python 后端测试（pytest）
```

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+E` | 项目浏览器 |
| `Ctrl+Shift+D` | 拓扑设计 |
| `Ctrl+Shift+W` | 工作台 |
| `Ctrl+Shift+V` | 可视化 |
| `Ctrl+Shift+L` | 设备库 |
| `Ctrl+,` | 设置 |
| `Ctrl+B` | 显示/隐藏侧栏 |
| `Ctrl+J` | 显示/隐藏面板 |
| `Ctrl+W` | 关闭当前标签 |
| `Ctrl+Shift+T` | 恢复关闭标签 |

## 开发命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 仅启动 Vite 开发服务器 |
| `npm run dev:all` | 编译 Electron + 启动 Vite + 启动 Electron |
| `npm run build` | 编译前后端 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint 代码检查 |
| `npm test` | 前端 Vitest 测试 |
| `npm run test:backend` | 后端 pytest |
| `npm run test:all` | 全量测试 |

## 技术栈

- **前端**: React 18 + TypeScript + Zustand + Tailwind CSS + ECharts
- **桌面**: Electron 28 + contextBridge
- **后端**: Python (pandas + openpyxl)
- **测试**: Vitest + pytest
- **i18n**: react-i18next（5 种语言）

## License

MIT
