<div align="center">

# AIDC AutoLink

**AI 智算中心网络规划与可视化工具 | AI Data Center Network Planning, Topology Design & Visualization**

*面向 AI 数据中心 / 智算中心 / GPU 集群的网络架构设计、拓扑生成、设备选型、机柜规划与交付报告一体化平台*

[![Version](https://img.shields.io/badge/version-3.2.0-blue)](https://github.com/bangbang8000-cell/AutoLink/releases)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#)
[![Languages](https://img.shields.io/badge/languages-5-orange)](#)
[![Templates](https://img.shields.io/badge/templates-19-teal)](#)
[![Devices](https://img.shields.io/badge/devices-120-purple)](#)
[![CI](https://img.shields.io/badge/tests-1458%20passed-brightgreen)](#)

</div>

---

**AIDC AutoLink** 是一款专为 **AI 数据中心（AIDC）** 设计的**网络规划与可视化工具**：从 GPU 集群 **Scale-Up 双栈拓扑**（NVLink / UALink / UB）到 Scale-Out 网络架构（Fat-Tree / Rail-Optimized / UEC），从**设备选型**到**机柜上架**，从 **PUE 能耗估算**到 **PDF/Excel 交付报告**，全流程一站完成。输入服务器规模，一键生成可交付的智算中心网络设计方案。

> 🚀 典型场景：**1024 GPU 训练集群** / **NVL72 单架域** / **华为 CloudMatrix 384** / **昇腾超节点** / **大模型推理集群** —— 从模板到完整交付报告仅需数分钟。

---

## ✨ 为什么选择 AIDC AutoLink

| 维度 | 能力 |
|------|------|
| **全栈规划** | Scale-Up（卡间互联）+ Scale-Out（网间互联）双栈一体化，支持 IB / RoCE / UEC 三种 Scale-Out 协议 |
| **真材实料** | 120 款主流设备库（NVIDIA / 华为 / H3C / 锐捷 / 浪潮 / 寒武纪 / 海光）+ 35 款光模块 |
| **硬核校验** | 22 条校验规则（V001-V022）：拓扑连通性、端口容量、光模块匹配、功率上限、三合一融合域，杜绝"设计失守" |
| **交付级报告** | 连接表 / 布线表 / BOM / 设备清单 / 机柜表 / 9 章 PDF 报告，收敛比全部按计算值输出 |
| **开箱即用** | 19 套场景模板 + 5 种语言 + 自动更新，Windows / macOS / Linux 三平台 |

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

### 4. 智能校验引擎（22 条硬规则）

| 规则 | 校验内容 |
|------|----------|
| V001-V015 | 拓扑连通性、端口溢出、设备一致性、PUE 合规等 |
| **V016** | 服务器网卡总数 vs Leaf 下行容量（1 分 2 扇出按逻辑口计算） |
| **V017** | 光模块封装 / 距离 / 速率匹配（含分裂线缆） |
| **V018** | Pod / Scale-Up 域规模合理性 |
| **V019** | 整机房功耗 vs 供电容量 |
| **V020** | ZCube 扁平二部图接入容量 |
| **V021** | 华为超节点 UB 域内全对等 + 域间 Scale-Out |
| **V022** | 三合一融合网（融合交换机存在 + 带内管理可达） |

### 5. PUE 与能耗估算

- 风冷 / 冷板液冷 / 浸没式液冷三种散热方式
- IT 功耗、制冷功耗、UPS 损耗分解，PUE 达标判断（目标 < 1.25）
- 参数化重算（室外温度、负载率、UPS 效率、自然冷），机柜功率密度评估与散热方式推荐

### 6. 收敛比校验（非硬编码）

- 参数网（目标 1:1）、存储网（1:1~2:1）、业务网（3:1~4:1）
- 阻塞/无阻塞判断与优化建议，PDF/Excel 报告读取**计算值**而非固定值

### 7. 光模块智能选型

- 35 款光模块库（100G / 200G / 400G / 800G / 1.6T）
- 按速率、距离、线缆类型自动选型，DAC / AOC / SR4 / DR4 / FR4 / LR4 全规格
- 成本估算（价格区间），支持 V017 光模块匹配校验
- **1 分 2 分裂线缆**：800G→2×400G、400G→2×200G、1.6T→2×800G 自动辨识，按物理口速率匹配

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

### 11. 双平面与超大规模拓扑（v3.0.1）

- 双平面（dual-plane）16 Leaf / 800G IB：每平面独立 Leaf/Spine，服务器双口网卡逐平面接入
- 3-tier 服务器超级 Pod 分组，Pod 归一化渲染；B300 默认 Leaf 自动选型 Q3400
- 超大规模降载：EDGE_LIMIT 边裁剪与折叠粒度归一化，2048 台全量报告无失真

### 12. 三合一融合网与 1 分 2 扇出（v3.0.2）

- **三合一融合网（eth_combined）**：存储 + 业务 + 带内管理合并为单一融合以太网域（单层 Leaf），OOB 独立保留，GB300-NVL72 模板落地
- **1 分 2 扇出（breakout）**：交换机 1 个物理高速口 → 2 个逻辑低速口（Q3200 800G→2×400G、MQM9700 400G→2×200G），服务器双口自动落同一物理口分裂子口（端口1-1/端口1-2）
- 分裂线缆选型闭环：布线指导表标注"1 分 2"，V016 容量按逻辑口校验

### 13. ZCube 与华为超节点（v3.0.2）

- **ZCube 扁平二部图**：无 Spine 双口混合接入，CloudMatrix 384/512 模板
- **华为超节点（huawei_supernode）**：UB 域内全对等 + 域间 800G Scale-Out 上联，V021 校验

### 14. 机房矩阵可视化（v3.0.4）

- **矩阵定义**：行×列命名自定义（如 A15~O15=225 柜），`room_layout.json` 按项目持久化
- **占位与类型标记**：空调/柱子占位、GPU/网络/存储/通算/组合机柜类型，点击即标（同项再点切换）
- **手动落位与调整**：机柜面板拖拽上架/移动，落位即时校验（占位阻止/类型域/U 位/功率/散热密度警告）

### 15. 配置体系（v3.0.4）

- **统一配置模型**：应用设置/项目配置/模板/向导四类 schema 版本化 + 宽松校验 + 迁移链框架
- **场景预设**：IB 全闪 H100 / RoCE 通用 / L20 推理 / UEC 数据中心一键套用
- **导入导出**：统一包裹格式（format + version）导出/导入，设置搜索与分组重置

### 16. AI 对话与 AIHUB（v3.1.x）

- **对话式管理**：设备/模板/项目对话查询，自然语言需求 → 项目配置预览 → 确认落盘，示例文件解析（Excel/JSON/CSV/文本）
- **共享选型规则**：LLM 与向导共用同一份默认映射（`device_defaults`），对话推荐与手动选型双端一致
- **多 Provider**：9 大厂商（deepseek / openai / claude / gemini / qwen / glm / grok / ollama / custom）+ 本地 Mock，工具权限分级（AUTO/NOTIFY/CONFIRM）

### 17. 容量规划（v3.1.3 / v3.2.0）

- **17 模型档案**（含 5 个国产场景：昇腾 910B/910C、寒武纪、海光、昆仑芯，带来源标注）→ 通信量估算（AllReduce/All-to-All/P2P）→ 拓扑推荐（Scale-Up/Scale-Out/收敛比/层数）+ TCO 成本
- **v2 精确版**：FP8 分块精度通信（与解析法误差对照 <15%）、Pipeline 分段显存建模、TCO 全口径（硬件/电力/空间）、自定义档案追加
- 前端推荐向导：模型/GPU/预算 → 推荐结果 → 一键应用（速率/协议/规模映射）

### 18. ATOP 自动拓扑优化（v3.2.0）

- 模型通信特征（MoE→All-to-All / 稠密→AllReduce / Pipeline→P2P）→ ZCube 2D/3D cube 拓扑推荐
- GPU A/B 组均衡分组着色（zcube_group/plane_id）、V020 结构校验、推荐理由生成
- 端到端：deepseek-v3 1024 卡 → 11×11×9 3D cube、1056 节点 8704 链路可渲染，一键应用到画布

### 19. 批量优化与智能修复（v3.2.0）

- **批量优化**：收敛比/成本/散热建议批量生成（确定性规则引擎），全选/逐条批量应用落盘
- **智能修复**：校验错误（rule_id 级：V002 机柜功率 / V007 Rail / V010 收敛比 / V016 网卡容量 / V018 Scale-Up 域 / V019 供电 / V020 ZCube）→ 修复 patch 预览 → 一键应用 → **复核闭环**（剩余错误数下降）

### 20. 机房智能落位（v3.1.4）

- **约束满足 + 多目标优化**：占位跳过、类型域匹配、单柜功率上限、保留手动放置，四维评分（功率均衡/散热分区/网络就近/布线最短）
- **矩阵落位可视化**：方案预览（评分 + issues）→ 确认应用 → 拖拽手动调整
- **对话驱动闭环**：AIHUB 中直接描述需求（"225 柜按 120 GPU + 60 网络 + 45 存储落位"）→ 自动创建矩阵 → 生成方案 → 前端确认应用

---

## 📦 快速开始

### 方式一：下载安装包（推荐）

前往 [Releases](https://github.com/bangbang8000-cell/AutoLink/releases) 下载对应平台安装包：

- **Windows**：`AutoLink-Setup-3.2.0-win.exe`（NSIS 安装包）
- **macOS**：`AutoLink-3.2.0-mac-x64.dmg` / `AutoLink-3.2.0-mac-arm64.dmg`
- **Linux**：`AutoLink-3.2.0-linux.AppImage` / `.deb`

安装后首次启动自动创建 3 个示例项目，内置 **19 套场景模板** 与 **120 款设备库**。

### 方式二：从源码运行

#### 环境要求
- **Node.js** ≥ 22
- **Python** ≥ 3.12（推荐；需 `pandas`、`openpyxl`、`reportlab`）

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

> V3.0.0 起：`electron-builder` 前自动用 **PyInstaller** 将 Python 引擎打包为免 Python 运行的后端（`scripts/pyinstaller.spec`），安装包内置 `backend-dist`。

### 运行测试

```bash
npm test              # 前端测试（Vitest 467 cases）
npm run test:backend  # 后端测试（pytest 991 cases）
npm run test:all      # 全量测试（1458 cases）
npm run typecheck     # TypeScript 类型检查（含 preload）
npm run lint          # ESLint 代码检查（0 error）
python scripts/validate_templates.py  # 19 模板验证
python scripts/gen_golden.py --check  # golden 基线比对
```

---

## 🗂️ 内置模板（19 套）

| 模板 | 场景 | 规模 | Scale-Up |
|------|------|------|----------|
| NVL72-单架 | NVIDIA GB200 NVLink 域 | 72 GPU | NVLink 72 单域 ✅ |
| **GB300-NVL72-三合一** | GB300 冷板液冷 + 三合一融合网 | 72 GPU | NVLink 72 单域 ✅ |
| ualink_1_0_1024 | UALink 1.0 1024 GPU Pod | 1024 GPU | UALink 1024 ✅ |
| cloudmatrix_384 | 华为 CloudMatrix 384 | 384 GPU | UB 384 单域 ✅ |
| cloudmatrix_512 | 华为 CloudMatrix 双域 | 512 NPU | UB 双域 ✅ |
| uec_1_0_cluster | UEC 1.0 集群 | 1024 GPU | — |
| SuperPOD-256 | NVIDIA SuperPOD | 256 GPU | — |
| DP3Tier-1024 | 3-tier 双平面 800G | 1024 GPU | — |
| H100-100台 / H100-128台 | NVIDIA H100 训练 | 100 / 128 GPU | — |
| L20-推理-64 | L20 推理集群 | 64 GPU | — |
| 国产-昇腾-256 | 华为昇腾 910B | 256 NPU | — |
| cambricon_mlu_cluster | 寒武纪 MLU 集群 | — | — |
| hygon_dcu_cluster | 海光 DCU 集群 | — | — |
| 液冷-H100-256 | 液冷场景 | 256 GPU | — |
| 中型-512 / 大型-1024 / 超大-2048 | 训练集群 | 512 / 1024 / 2048 GPU | — |
| 空项目 | 从零开始 | — | — |

---

## 🛠️ 技术栈

- **前端**：React 18 + TypeScript + Zustand + Tailwind CSS + @xyflow/react + ECharts + Vite
- **桌面**：Electron + contextBridge（安全隔离）+ electron-updater（双通道更新）
- **后端**：Python（pandas + openpyxl + reportlab），JSON-RPC 子进程桥接，PyInstaller 免 Python 打包
- **测试**：Vitest（467）+ pytest（991）
- **i18n**：react-i18next（5 种语言）
- **CI/CD**：GitHub Actions 三平台矩阵构建（win / mac / linux）+ 模板/golden 门禁

---

## 📁 项目结构

```
AutoLink/
├── backend/                # Python 计算引擎
│   ├── facade.py           #   CLI 入口（JSON-RPC + 设计流程编排）
│   ├── engine.py           #   action 分发（design/validate/export/estimate/capacity/atop/optimize/repair/room）
│   ├── designer.py         #   网络设计协调层（四网 + 三合一融合网）
│   ├── dual_plane_topology.py # 双平面拓扑
│   ├── zcube_topology.py   #   ZCube 扁平二部图拓扑
│   ├── ub_topology.py      #   UB（昇腾）拓扑
│   ├── network_plugin.py   #   插件化接线（HuaweiSuperNode 等）
│   ├── rail_topology.py    #   Rail-Optimized 拓扑算法
│   ├── rack_allocation.py  #   多约束机柜分配
│   ├── room_optimizer.py   #   机房智能落位（约束满足 + 多目标优化）
│   ├── validation.py       #   22 条校验规则引擎（V001-V022）
│   ├── optical_selector.py #   光模块智能选型（含 1 分 2 分裂线缆）
│   ├── exporter.py         #   Excel/PDF 导出
│   ├── device_library.py   #   设备库加载器（120 款）
│   ├── optimization.py     #   批量优化（收敛比/成本/散热建议 + 应用）
│   ├── fixit.py            #   智能修复（校验错误 → 修复 patch → 复核闭环）
│   ├── atop/               #   ATOP 自动拓扑优化（特征解析 + ZCube 推荐）
│   ├── capacity_planning/  #   容量规划内核（档案/通信量/TCO/自定义档案）
│   └── autolink_hub/       #   AIHUB（Provider / 工具注册 / 技能 / 对话 Agent）
├── electron/               # Electron 主进程（IPC / 更新服务 / Python service）
├── src/                    # React 前端（ui 组件库 / stores / i18n）
├── template/               # 设备库（120 款）+ 19 套场景模板
├── scripts/                # pyinstaller.spec / validate_templates / gen_golden
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
A: 支持从 64 GPU 推理集群到 2048 台服务器的超大规模训练集群，内置 19 套模板可直接使用，也可从空项目自定义。

**Q: 生成的报告包含哪些内容？**
A: 连接表、布线指导表、BOM 成本、设备清单、机柜表（Excel），以及 9 章节 PDF 报告（概览/架构/功耗/光模块/成本/校验/设备清单/收敛比/机柜），全部基于真实计算值。

**Q: 是否需要联网使用？**
A: 不需要。所有规划、计算、校验均在本地完成，离线可用；仅自动更新需要联网。

---

## 📄 License

[MIT](LICENSE) © AutoLink Team

---

*AIDC AutoLink —— 让每一座智算中心，都有据可依、开箱即达。*
