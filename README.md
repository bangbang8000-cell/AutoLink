<div align="center">

# AIDC AutoLink

**AI 智算中心网络规划与可视化工具 | AI Data Center Network Planning, Topology Design & Visualization**

*面向 AI 数据中心 / 智算中心 / GPU 集群的网络架构设计、拓扑生成、设备选型、机柜规划与交付报告一体化平台*

[![Version](https://img.shields.io/badge/version-2.9.3-blue)](https://github.com/bangbang8000-cell/AutoLink/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#)
[![Languages](https://img.shields.io/badge/languages-5-orange)](#)
[![Templates](https://img.shields.io/badge/templates-16-teal)](#)
[![Devices](https://img.shields.io/badge/devices-118-purple)](#)
[![CI](https://img.shields.io/badge/tests-885%20passed-brightgreen)](#)

</div>

---

**AIDC AutoLink** 是一款专为 **AI 数据中心（AIDC）** 设计的**网络规划与可视化工具**：从 GPU 集群 **Scale-Up 双栈拓扑**（NVLink / UALink / UB）到 Scale-Out 网络架构（Fat-Tree / Rail-Optimized / UEC），从**设备选型**到**机柜上架**，从 **PUE 能耗估算**到 **PDF/Excel 交付报告**，全流程一站完成。输入服务器规模，一键生成可交付的智算中心网络设计方案。

> 🚀 典型场景：**1024 GPU 训练集群** / **NVL72 单架域** / **华为 CloudMatrix 384** / **昇腾超节点** / **大模型推理集群** —— 从模板到完整交付报告仅需数分钟。

---

## ✨ 为什么选择 AIDC AutoLink

| 维度 | 能力 |
|------|------|
| **全栈规划** | Scale-Up（卡间互联）+ Scale-Out（网间互联）双栈一体化，支持 IB / RoCE / UEC 三种 Scale-Out 协议 |
| **真材实料** | 118 款主流设备库（NVIDIA / 华为 / H3C / 锐捷 / 浪潮 / 寒武纪 / 海光）+ 34 款光模块 |
| **硬核校验** | 19 条校验规则（V001-V019）：拓扑连通性、端口容量、光模块匹配、功率上限，杜绝"设计失守" |
| **交付级报告** | 连接表 / 布线表 / BOM / 设备清单 / 机柜表 / 9 章 PDF 报告，收敛比全部按计算值输出 |
| **开箱即用** | 16 套场景模板 + 5 种语言 + 自动更新，Windows / macOS / Linux 三平台 |

---

## 🚀 三步完成智算中心网络规划

```
1️⃣ 选择模板或新建项目 → 配置规模参数与设备选型（向导分步校验，错误即时提示）
2️⃣ 一键生成拓扑 → 查看拓扑图 / PUE / 收敛比 / Scale-Up 域规划 / 校验结果
3️⃣ 渲染交付 → 输出连接表、布线表、BOM、设备清单、机柜表、PDF 报告
```

---

## 🧩 核心能力

### 1. Scale-Up 双栈拓扑（v2.9 转正）

GPU 卡间高速互联（Scale-Up 域）与服务器间网络（Scale-Out）协同规划：

- **三大协议**：NVLink（NVL72）、UALink 1.0（1024 GPU Pod）、UB（CloudMatrix 384 单域）
- **全对等互联**：域内 GPU 全对等边自动生成，域自动切分（domain_id），每 GPU 独立机柜、域内柜号相邻
- **配置驱动**：JSON `scale_up` 段 / INI `[scale_up]` section，兼容旧字段 `bandwidth_per_link_gbps`，旧配置自动降级不报错
- **前端可视**：拓扑图渲染 Scale-Up 边，机柜视图琥珀色 Scale-Up 柜

### 2. Scale-Out 网络拓扑设计

- **Fat-Tree 胖树**：二层/三层自适应，参数网、存储网、OOB、业务网独立设计
- **Rail-Optimized**：NVIDIA SuperPOD 8-Rail 架构自动计算
- **协议支持**：IB / RoCE / **UEC**（Ultra Ethernet，CPO 硅光交换机自动选型）
- **下行端口**：full / custom 双模式，端口命名前缀按设备接口模型自动解析

### 3. 交互式拓扑可视化

- 分层 × 分区 × 分组防重叠自动布局，参数网/存储网/业务网/OOB/Scale-Up 功能分区
- **框选多节点拖动、对齐工具栏**（左/右/上/下）、节点删除与撤销
- 链路悬浮高亮 + 详情面板（源端/目标端/速率/网络类型/缆型）
- 布局落盘 `topology.json`，重新生成保留已保存布局；切换项目数据隔离
- 暗色模式自适应，节点类型/机柜/功率信息悬浮即显

### 4. 智能校验引擎（19 条硬规则）

| 规则 | 校验内容 |
|------|----------|
| V001-V015 | 拓扑连通性、端口溢出、设备一致性、PUE 合规等 |
| **V016** | 服务器网卡总数 vs Leaf 下行容量 |
| **V017** | 光模块封装 / 距离 / 速率匹配 |
| **V018** | Pod / Scale-Up 域规模合理性 |
| **V019** | 整机房功耗 vs 供电容量 |

### 5. PUE 与能耗估算

- 风冷 / 冷板液冷 / 浸没式液冷三种散热方式
- IT 功耗、制冷功耗、UPS 损耗分解，PUE 达标判断（目标 < 1.25）
- 参数化重算（室外温度、负载率、UPS 效率、自然冷），机柜功率密度评估与散热方式推荐

### 6. 收敛比校验（非硬编码）

- 参数网（目标 1:1）、存储网（1:1~2:1）、业务网（3:1~4:1）
- 阻塞/无阻塞判断与优化建议，PDF/Excel 报告读取**计算值**而非固定值

### 7. 光模块智能选型

- 34 款光模块库（100G / 200G / 400G / 800G / 1.6T）
- 按速率、距离、线缆类型自动选型，DAC / AOC / SR4 / DR4 / FR4 / LR4 全规格
- 成本估算（价格区间），支持 V017 光模块匹配校验

### 8. 机柜 U 位规划

- 42U / 49U 机柜可视化，设备按类型色块区分，功率 3 级色码监控（绿/黄/红）
- 多约束自动装箱（功率 / U 位 / 散热），Scale-Up GPU 单柜独占
- 布局落盘 `rack_layout.json`（500ms 防抖自动保存），跨柜移动、冲突检测

### 9. 专业交付导出

- **Excel**：连接表 / 布线指导表（含光模块型号与成本）/ BOM（按型号聚合）/ 设备清单 / 机柜表
- **PDF 报告**：9 章节（概览/架构/功耗/光模块/成本/校验/**设备清单**/**收敛比**/机柜），机柜表全量渲染无截断
- 项目名称取自配置（非硬编码），2048 台超大规模报告完整无失真

### 10. 国际化与本地化

- 5 种语言：简体中文 / English / 日本語 / 한국어 / 繁體中文，i18n key 完整性测试防回归
- 首启 3 步引导、空状态引导、键盘快捷键速查表

---

## 📦 快速开始

### 方式一：下载安装包（推荐）

前往 [Releases](https://github.com/bangbang8000-cell/AutoLink/releases) 下载对应平台安装包：

- **Windows**：`AutoLink-Setup-2.9.3-win.exe`（NSIS 安装包）
- **macOS**：`AutoLink-2.9.3-mac-x64.dmg` / `AutoLink-2.9.3-mac-arm64.dmg`
- **Linux**：`AutoLink-2.9.3-linux.AppImage` / `.deb`

安装后首次启动自动创建 3 个示例项目，内置 **16 套场景模板** 与 **118 款设备库**。

### 方式二：从源码运行

#### 环境要求
- **Node.js** ≥ 22
- **Python** ≥ 3.10（需安装 `pandas`、`openpyxl`、`reportlab`）

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
npm test              # 前端测试（Vitest 341 cases）
npm run test:backend  # 后端测试（pytest 544 cases）
npm run test:all      # 全量测试（885 cases）
npm run typecheck     # TypeScript 类型检查（含 preload）
npm run lint          # ESLint 代码检查（0 error）
python scripts/validate_templates.py  # 16 模板验证
```

---

## 🗂️ 内置模板（16 套）

| 模板 | 场景 | 规模 | Scale-Up |
|------|------|------|----------|
| NVL72-单架 | NVIDIA GB200 NVLink 域 | 72 GPU | NVLink 72 单域 ✅ |
| ualink_1_0_1024 | UALink 1.0 1024 GPU Pod | 1024 GPU | UALink 1024 ✅ |
| cloudmatrix_384 | 华为 CloudMatrix 384 | 384 GPU | UB 384 单域 ✅ |
| uec_1_0_cluster | UEC 1.0 集群 | 1024 GPU | — |
| SuperPOD-256 | NVIDIA SuperPOD | 256 GPU | — |
| H100-100台 / H100-128台 | NVIDIA H100 训练 | 100 / 128 GPU | — |
| L20-推理-64 | L20 推理集群 | 64 GPU | — |
| 国产-昇腾-256 | 华为昇腾 910B | 256 NPU | — |
| 液冷-H100-256 | 液冷场景 | 256 GPU | — |
| 中型-512 / 大型-1024 / 超大-2048 | 训练集群 | 512 / 1024 / 2048 GPU | — |
| 空项目 | 从零开始 | — | — |

---

## 🛠️ 技术栈

- **前端**：React 18 + TypeScript + Zustand + Tailwind CSS + react-flow + ECharts
- **桌面**：Electron + contextBridge（安全隔离）+ electron-updater（双通道更新）
- **后端**：Python（pandas + openpyxl + reportlab），JSON-RPC 桥接
- **测试**：Vitest（341）+ pytest（544）
- **i18n**：react-i18next（5 种语言）
- **CI/CD**：GitHub Actions 三平台矩阵构建（win / mac / linux）

---

## 📁 项目结构

```
AutoLink/
├── backend/                # Python 计算引擎
│   ├── engine.py           #   入口（JSON-RPC）
│   ├── designer.py         #   网络设计协调层（含 Scale-Up 接入）
│   ├── scaleup_topology.py #   Scale-Up 拓扑（NVLink/UALink/UB）
│   ├── ub_topology.py      #   UB（昇腾）拓扑
│   ├── rail_topology.py    #   Rail-Optimized 拓扑算法
│   ├── rack_allocation.py  #   多约束机柜分配
│   ├── validation.py       #   19 条校验规则引擎
│   ├── optical_selector.py #   光模块智能选型
│   ├── exporter.py         #   Excel/PDF 导出
│   └── device_library.py   #   设备库加载器
├── electron/               # Electron 主进程（IPC / 更新服务）
├── src/                    # React 前端（ui 组件库 / stores / i18n）
├── template/               # 设备库（118 款）+ 16 套场景模板
├── docs/                   # 产品文档 / 用户指南 / PRD
└── tests/backend/          # Python 后端测试
```

---

## 📚 文档

- [用户指南](docs/user_guide/user_guide.md)（应用内「帮助 → 用户指南」可离线查看）
- [部署指南](docs/deployment.md)
- [更新日志](CHANGELOG.md)
- [Wiki](https://github.com/bangbang8000-cell/AutoLink/wiki)

---

## ❓ FAQ

**Q: AIDC AutoLink 支持哪些网络协议？**
A: Scale-Out 支持 IB、RoCE、UEC 三种；Scale-Up 支持 NVLink、UALink、UB 三种。可组合出 NVL72、CloudMatrix 384、UALink 1024 GPU Pod 等主流智算中心形态。

**Q: 支持多大的集群规模？**
A: 支持从 64 GPU 推理集群到 2048 台服务器的超大规模训练集群，内置 16 套模板可直接使用，也可从空项目自定义。

**Q: 生成的报告包含哪些内容？**
A: 连接表、布线指导表、BOM 成本、设备清单、机柜表（Excel），以及 9 章节 PDF 报告（概览/架构/功耗/光模块/成本/校验/设备清单/收敛比/机柜），全部基于真实计算值。

**Q: 是否需要联网使用？**
A: 不需要。所有规划、计算、校验均在本地完成，离线可用；仅自动更新需要联网。

---

## 📄 License

[MIT](LICENSE) © AutoLink Team

---

*AIDC AutoLink —— 让每一座智算中心，都有据可依、开箱即达。*
