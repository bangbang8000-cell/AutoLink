# AutoLink V2.0

AI 智算中心网络规划与可视化工具 — 一站式完成拓扑设计、机柜规划、连接关系表导出。

## 功能

- **拓扑设计** — full/custom 双模式，自动计算 Leaf/Spine/Core 数量，支持参数网、存储网、OOB、业务网络
- **机柜规划** — 42U 机柜可视化，设备上架 U 位分配，冲突检测
- **拓扑可视化** — ECharts 分层图渲染，按网络类型筛选，设备详情查询
- **项目管理** — 项目创建/删除/收藏，模板中心，工作区文件浏览
- **Excel 导出** — 连接关系表、上机表一键导出
- **多语言** — 简体中文 / English / 日本語 / 한국어 / 繁體中文
- **亮暗主题** — 跟随系统 / 手动切换

## 技术栈

| 层 | 技术 |
|---|------|
| 桌面框架 | Electron 28 |
| 前端 | React 18 + TypeScript + Vite 5 + TailwindCSS 3 |
| 状态管理 | Zustand (persist) |
| 图表 | ECharts 6 + echarts-for-react |
| 国际化 | i18next + react-i18next |
| 计算引擎 | Python 3 (子进程 JSON stdin/stdout 通信) |
| 打包 | electron-builder + NSIS |
| CI/CD | GitHub Actions |

## 项目结构

```
AutoLink V2.0/
├── src/                    # 前端源码
│   ├── components/
│   │   ├── layout/         # Header, ActivityBar, StatusBar, ResizableLayout, Toast
│   │   └── sidebar/        # ExplorerPanel, DesignPanel, RackPanel, TopologyPanel...
│   ├── stores/             # Zustand stores (ui, project, design, rack, toast)
│   ├── i18n/               # i18next 多语言资源
│   └── types/              # TypeScript 类型定义
├── electron/               # Electron 主进程
│   ├── main.ts             # 应用入口
│   ├── preload.ts          # 预加载脚本 (contextBridge)
│   ├── config.ts           # 路径配置
│   ├── ipc/handlers.ts     # IPC 通道处理器
│   └── services/           # Python 子进程服务
├── backend/                # Python 计算引擎
│   ├── engine.py           # 统一 JSON 接口
│   ├── designer.py         # 网络设计协调层
│   ├── topology.py         # 拓扑算法 (FatTree / AccessAgg)
│   ├── models.py           # 数据模型
│   ├── exporter.py         # Excel 导出
│   └── network_config.ini  # 默认配置文件
├── workspace/              # 工作区 (项目文件)
├── template/               # 内置模板
└── .github/workflows/      # CI/CD (ci.yml / build.yml)
```

## 快速开始

### 环境要求

- Node.js >= 22
- Python >= 3.10 (需安装 openpyxl, pandas)
- Windows / macOS / Linux

### 安装依赖

```bash
npm install
pip install -r backend/requirements.txt
```

### 开发模式

```bash
# 同时启动 Vite + Electron
npm run dev:all

# 仅前端
npm run dev

# 仅 Electron
npm run dev:electron
```

### 构建

```bash
# 构建所有
npm run build

# 仅前端
npm run build:renderer

# 仅 Electron
npm run build:electron
```

### 打包安装包

```bash
# Windows NSIS 安装包
npm run dist:win

# macOS
npm run dist:mac

# Linux AppImage / deb
npm run dist:linux
```

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+Shift+E` | 项目浏览器 |
| `Ctrl+Shift+W` | 工作台 |
| `Ctrl+Shift+D` | 拓扑设计 |
| `Ctrl+Shift+R` | 机柜规划 |
| `Ctrl+Shift+T` | 拓扑可视化 |
| `Ctrl+Shift+O` | 输出结果 |
| `Ctrl+,` | 设置 |
| `Ctrl+B` | 切换侧边栏 |

## CI/CD

- **CI**: push/PR 到 main 自动运行 typecheck + lint + build
- **Release**: 推送 `v*` tag 自动构建并发布到 GitHub Releases

```bash
# 创建版本
git tag v2.0.0
git push origin v2.0.0
```

## 许可证

MIT License
