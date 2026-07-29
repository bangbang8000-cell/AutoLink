# AutoLink

**AI 智算中心网络规划与可视化工具 | AI Data Center Network Planning & Visualization**

[![Version](https://img.shields.io/badge/version-2.4.0-blue)](https://github.com/bangbang8000-cell/AutoLink/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#)
[![Languages](https://img.shields.io/badge/languages-5-orange)](#)
[![Devices](https://img.shields.io/badge/devices-109+-purple)](#)

> 专为 AI 数据中心设计的网络拓扑规划、Rail-Optimized 架构设计、PUE 估算、设备选型与机柜上架一体化工具。

## 三步完成智算中心网络规划

```
1. 选择模板或新建项目 → 配置网络参数与设备选型
2. 一键生成拓扑 → 查看拓扑/PUE/收敛比/布线指导
3. 渲染输出连接表、布线表、BOM、设备清单、拓扑图
```

## V2.4 核心能力

### Rail-Optimized 拓扑设计
- NVIDIA SuperPOD 8-Rail 架构自动计算
- Fat-Tree 胖树拓扑（二层/三层自适应）
- 参数网、存储网、OOB、业务网独立设计
- full / custom 双下行端口模式
- 设计摘要实时预览（节点数、端口使用率、收敛比）

### 拓扑可视化（react-flow 重构）
- 分层 × 分区 × 分组三维防重叠布局
- 参数网/存储网/业务网/OOB 功能分区
- Pod/Rail 分组视觉边框
- 节点拖拽、框选、缩放、小地图
- 按网络类型过滤视图
- 节点详情面板（类型、组、机柜、U位、连接数）

### PUE 与能耗估算
- 支持风冷 / 冷板液冷 / 浸没式液冷三种散热方式
- IT 功耗、制冷功耗、UPS 损耗分解
- PUE 达标判断（目标 < 1.25）
- 参数化重新估算（室外温度、负载率、UPS 效率、自然冷）
- 机柜功率密度评估与散热方式推荐

### 收敛比校验
- 参数网（目标 1:1）、存储网（1:1~2:1）、业务网（3:1~4:1）
- 阻塞/无阻塞判断
- 优化建议生成

### 光模块智能选型
- 30 款光模块库（100G / 200G / 400G / 800G / 1.6T）
- 根据速率、距离、线缆类型自动选择最优光模块
- 支持 DAC / AOC / SR4 / DR4 / FR4 / LR4 等规格
- 成本估算（价格区间）

### 机柜 U 位规划
- 42U/49U 机柜可视化，设备按类型色块区分
- 待分配设备池 → 点击 U 位放置，冲突自动检测
- 功率负载实时监控，超限红色告警（3 级色码）
- 支持多机柜切换、设备跨柜移动

### 设备库（109+ 款认证设备）
- **GPU 服务器**：NVIDIA DGX H100/B200/GB300、华为 Atlas 800T A2、海光 K100 AI、寒武纪 MLU590 等
- **存储服务器**：全闪 / 混闪 / 并行文件系统（BeeGFS、IBM Scale、WekaIO、DDN、VAST）
- **通算服务器**：通用计算节点
- **交换机**：参数面（NVIDIA Quantum/Spectrum、华为 CE16800、H3C S9820/S9850、锐捷 S6980/S9910）/ 存储 / 业务 / 带外
- **光模块**：100G-1.6T 全速率覆盖
- 分层分类浏览，设备详情含物理参数、端口配置、散热方式、Rail 兼容性

### 专业导出
- 连接表（Excel）：全量设备连接关系
- 布线指导表（Excel）：含光模块型号、长度估算、成本
- BOM 成本估算（Excel）：设备与光模块成本汇总
- 设备清单（Excel）：设备汇总表
- 报告视图（内置）：概览/架构/功耗/光模块/成本/校验

### 国际化
- 5 种语言：简体中文 / English / 日本語 / 한국어 / 繁體中文
- 关于对话框含快捷键速查表
- 设置面板支持外观 / 语言 / 项目默认值 / 输出 / 快捷键 / 设备库 / 网络 / 数据管理

## 快速开始

### 方式一：下载安装包（推荐）

前往 [Releases](https://github.com/bangbang8000-cell/AutoLink/releases) 下载对应平台安装包：
- **Windows**：`AutoLink-Setup-2.4.0-win.exe`（NSIS 安装包）
- **macOS**：`AutoLink-2.4.0-mac-x64.dmg` / `AutoLink-2.4.0-mac-arm64.dmg`
- **Linux**：`AutoLink-2.4.0-linux.AppImage` / `.deb`

安装后首次启动会自动创建 3 个示例项目，内置 11 套场景模板和 109+ 款设备库。

### 方式二：从源码运行

#### 环境要求
- **Node.js** ≥ 22
- **Python** ≥ 3.10（需安装 `pandas` 和 `openpyxl`）

```bash
git clone https://github.com/bangbang8000-cell/AutoLink.git
cd AutoLink
npm install
pip install -r backend/requirements.txt
npm run dev:all
```

### 打包构建

```bash
npm run dist:win    # Windows (NSIS .exe)
npm run dist:mac    # macOS (DMG x64 + arm64)
npm run dist:linux  # Linux (AppImage + DEB)
```

### 运行测试

```bash
npm test              # 前端测试
npm run test:backend  # 后端测试 (209 cases)
npm run test:all      # 全量测试
```

## 项目结构

```
AutoLink/
├── backend/              # Python 计算引擎
│   ├── engine.py         #   入口（stdin/stdout JSON-RPC）
│   ├── designer.py       #   网络设计协调层
│   ├── topology.py       #   FatTree 拓扑计算
│   ├── rail_topology.py  #   Rail-Optimized 拓扑算法
│   ├── estimation.py     #   PUE 估算与收敛比计算
│   ├── validation.py     #   规则校验引擎
│   ├── optical_selector.py # 光模块智能选型
│   ├── exporter.py       #   Excel 导出（连接表/布线/BOM/报告）
│   ├── device_library.py #   设备库加载器
│   └── models.py         #   数据模型
├── electron/             # Electron 主进程
│   ├── main.ts           #   应用入口
│   ├── preload.ts        #   安全桥接
│   ├── config.ts         #   路径与资源管理
│   └── ipc/handlers.ts   #   IPC 处理器
├── src/                  # React 前端
│   ├── components/       #   UI 组件
│   │   ├── workspace/tabs/  # 拓扑/机柜/PUE/报告等 Tab
│   │   ├── workbench/    #   工作台
│   │   ├── device/       #   设备库
│   │   └── wizard/       #   项目向导
│   ├── stores/           #   Zustand 状态管理
│   ├── i18n/             #   国际化（zh-CN/en/ja/ko/zh-TW）
│   └── types/            #   TypeScript 类型定义
├── template/             # 设备库 + 项目模板
│   ├── device_library/   #   109+ 设备 JSON
│   │   ├── gpu_servers/  #     GPU 服务器
│   │   ├── storage_servers/ #  存储（全闪/混闪/并行FS）
│   │   ├── switches/     #     交换机（参数/存储/业务/OOB）
│   │   └── optical_modules/ # 光模块（30 款）
│   └── */                #   11 套场景模板
├── docs/                 # 产品文档 + 部署指南
└── tests/backend/        # Python 后端测试（pytest）
```

## 内置模板

| 模板 | 场景 | 规模 |
|------|------|------|
| H100-100台 | NVIDIA H100 训练 | 100 台 GPU |
| H100-128台 | Rail-Optimized 4 组 | 128 台 GPU |
| L20-推理-64 | L20 推理集群 | 64 台 GPU |
| NVL72-单架 | NVLink Domain | 72 GPU 单架 |
| SuperPOD-256 | NVIDIA SuperPOD | 256 台 GPU |
| 国产-昇腾-256 | 华为昇腾 910B | 256 台 NPU |
| 液冷-H100-256 | 液冷场景 | 256 台 GPU |
| 大型-1024 | 大规模训练 | 1024 台 GPU |
| 超大-2048 | 超大规模 | 2048 台 GPU |

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
| `Ctrl+S` | 保存配置 |
| `Ctrl+W` | 关闭当前标签 |
| `Ctrl+Shift+T` | 恢复关闭标签 |

## 技术栈

- **前端**: React 18 + TypeScript + Zustand + Tailwind CSS + react-flow + ECharts
- **桌面**: Electron 28 + contextBridge
- **后端**: Python (pandas + openpyxl)
- **测试**: Vitest + pytest (209 cases)
- **i18n**: react-i18next（5 种语言）
- **CI/CD**: GitHub Actions（三平台矩阵构建）

## 文档

- [部署指南](docs/deployment.md)
- [V2.4 PRD](docs/PRD_V2.4.md)
- [V2.4 开发计划](docs/开发计划_V2.4.md)
- [更新日志](CHANGELOG.md)
- [Wiki](https://github.com/bangbang8000-cell/AutoLink/wiki)

## License

MIT
