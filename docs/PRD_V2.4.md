# AutoLink V2.4 PRD — 智能化演进与专业能力升级

> 版本定位：V2.3 完成了原型打磨与体验一致性建设。V2.4 聚焦"从原型到专业工具"的跨越，围绕**更好用、更实用、更美观、更便捷、更高效、更智能**六大方向，结合智算数据中心行业最佳实践与主流厂商产品规格，构建差异化专业能力。
>
> 目标：让 AutoLink 成为智算中心网络规划领域**首个集成 AI 辅助、光模块管理、液冷评估、Rail-Optimized 架构**的专业桌面工具。
>
> V3.x 规划：AI HUB 大模型驱动的自然语言设计助手、云端协同、团队协作。

---

## 一、版本背景与演进主题

### 1.1 当前状态（V2.3.2）

| 维度 | 现状 | 成熟度 |
|------|------|--------|
| 核心功能链路 | 创建 → 设计 → 渲染 → 机柜 → 导出 | ✅ 完整可用 |
| 设备库 | 56 款（GPU 7 / 存储 9 / 通算 5 / 交换机 35） | ⚠️ 覆盖不足 |
| 拓扑算法 | 二层/三层 Fat-Tree + Access-Agg | ⚠️ 缺 Rail-Optimized |
| 输出能力 | 连接表 Excel + 拓扑 PNG + 上机表 | ⚠️ 缺光模块/布线指导 |
| 视觉化 | ECharts 矩形节点 + 机柜 U 位图 | ⚠️ 缺专业可视化 |
| 工程化 | 250 测试用例 + 三平台 CI | ⚠️ 缺 E2E 与性能基准 |
| 智能化 | 无 | ❌ 待建设 |

### 1.2 V2.4 六大演进方向

| 方向 | 主题 | 核心交付 | 优先级 |
|------|------|----------|--------|
| **更智能** | AI 辅助设计 + 专家系统 | 智能选型推荐、规则校验引擎、场景模板 | P0 |
| **更专业** | 智算领域深度能力 | Rail-Optimized、光模块库、液冷评估、国产化 | P0 |
| **更实用** | 工程落地交付物 | 布线指导表、BOM 估算、方案对比、PDF 报告 | P0 |
| **更美观** | 专业视觉升级 | 分层拓扑、Pod 分组、3D 机柜、热力图 | P1 |
| **更便捷** | 交互效率提升 | 快捷键体系、向导增强、项目克隆、设备对比 | P1 |
| **更高效** | 性能与工程化 | 大规模优化、E2E 测试、日志备份、增量计算 | P1 |

### 1.3 版本号策略

- 主版本 `2.4.0`：完成 P0 全部功能 + P1 部分
- 后续 `2.4.1` / `2.4.2`：补全 P1 + 缺陷修复（使用 build 号，不使用 alpha/beta 标签）
- CI 触发：`v2.4.0` 标签推送 GitHub Actions 三平台构建

---

## 二、多角色专业评估（V2.3 现状诊断）

### 2.1 系统架构师视角

**优势**：Electron + React + Python 三层分离清晰；IPC 通道覆盖完整；Zustand 状态职责分明；安全基线正确（contextIsolation + 路径净化）。

**演进诉求**：

| 编号 | 问题 | 影响 | V2.4 目标 |
|------|------|------|-----------|
| A1 | Python 子进程 60 秒固定超时，大规模拓扑（2048+ GPU）可能超时 | 阻塞大集群设计 | 分级超时策略 + 进度推送 |
| A2 | 无增量计算能力，参数微调需全量重算 | 效率低下 | 增量计算缓存层 |
| A3 | `sandbox: false`，未达 Electron 安全最佳实践 | 安全风险 | 评估 sandbox 兼容性后开启 |
| A4 | 无应用日志文件，问题定位困难 | 运维盲区 | 文件日志 + 滚动归档 |
| A5 | 设备库打包后只读，用户自定义设备依赖导入 | 扩展受限 | 用户设备库目录读写支持 |

### 2.2 软件设计师视角

**优势**：组件化程度较高；V2.3 已提取共享 UI 组件库。

**演进诉求**：

| 编号 | 问题 | 影响 | V2.4 目标 |
|------|------|------|-----------|
| D1 | 拓扑数据模型缺少 Rail 概念，无法表达 Rail-Optimized 架构 | 架构局限性 | 扩展 NetworkObject 支持 rail_id |
| D2 | 设备库 schema 缺少光模块、液冷、PUE 相关字段 | 专业能力不足 | DeviceProfile schema 2.0 扩展 |
| D3 | 无方案版本管理，单项目仅单方案 | 工程实践不便 | 多方案（Scheme）数据模型 |
| D4 | 状态管理 9 个 Store 数据孤岛，项目切换不同步 | 数据一致性风险 | ProjectContext 统一协调 |
| D5 | 导出器（exporter）输出格式单一，缺 PDF/Visio | 交付物不全 | 多格式导出抽象层 |

### 2.3 程序员视角

**优势**：TypeScript 严格模式；前后端测试覆盖；ESLint + Prettier 规范。

**演进诉求**：

| 编号 | 问题 | 影响 | V2.4 目标 |
|------|------|------|-----------|
| P1 | 大规模拓扑（1000+ 节点）ECharts 渲染卡顿 | 大集群不可用 | WebWorker + 虚拟渲染 |
| P2 | Excel 预览无虚拟滚动，万行连接表卡死 | 输出查看困难 | 虚拟滚动分页 |
| P3 | 拓扑算法对边界条件处理不完整（端口耗尽、单 Pod 超限） | 异常静默 | 边界校验 + 用户告警 |
| P4 | Python 引擎无缓存，重复设计请求重复计算 | 性能浪费 | LRU 缓存 + 增量计算 |
| P5 | 设备库 JSON schema 无运行时校验，错误数据可能导致引擎崩溃 | 稳定性风险 | JSON Schema 校验 + 容错 |

### 2.4 测试人员视角

**优势**：250 测试用例；Vitest + pytest 双栈；覆盖率报告就绪。

**演进诉求**：

| 编号 | 问题 | 影响 | V2.4 目标 |
|------|------|------|-----------|
| T1 | 无 E2E 测试，跨进程链路无保障 | 回归风险 | Playwright E2E 框架 |
| T2 | 无性能基准测试，大规模场景无回归基线 | 性能退化不可知 | 性能基准套件 |
| T3 | 前端组件测试覆盖率 < 30% | UI 回归风险 | 核心组件渲染测试补全 |
| T4 | 拓扑算法缺 2048+ GPU 大规模用例 | 边界覆盖不足 | 大规模边界测试 |
| T5 | 设备库 schema 校验无测试 | 数据质量风险 | schema 校验测试 |

### 2.5 UI/UX 与美工视角（含可视化能力专项诊断）

**优势**：VS Code 风格布局；V2.3 已建设计系统；语义色系 + Tokens。

**可视化能力专项诊断**（用户反馈重点）：

| 编号 | 问题 | 现状根因 | 影响 |
|------|------|---------|------|
| V1 | **拓扑图设备排列重叠** | 服务器层/交换机层水平均匀分布（H_SPACING=120 固定），节点数 ≥64 时横向溢出重叠 | 大规模拓扑不可读 |
| V2 | **无功能分区** | 参数网/存储网/业务网/OOB 设备混排，无区域边框与底色 | 无法快速区分网络域 |
| V3 | **无组分区** | 服务器虽按 param_leaf 分组但无视觉边框；Pod 分组无任何可视化 | 组网结构不可见 |
| V4 | **交换机层不分组** | Leaf/Spine/Core 水平均匀分布，不按 Pod/Rail/网络域聚类 | 链路交叉严重 |
| V5 | **链路信息缺失** | 无速率/利用率标签，无聚合边渲染，curveness=0.15 导致大量交叉 | 无法判断链路类型与负载 |
| V6 | **机柜仅 2D 单柜视图** | 无机房平面布局；无机柜间走线；无多机柜对比 | 无法审视全局机柜布局 |
| V7 | **无机房平面图** | 完全缺失；无机柜行列排列、冷热通道、功率热力分布 | 无法评估机房空间与散热 |
| V8 | **机柜导出能力弱** | 仅 Excel 上机表；无机柜布局图导出（PNG/SVG/PDF） | 交付物不完整 |
| V9 | **调整能力不足** | 无拖拽移动设备（仅点击放置）；无批量操作；无撤销重做 | 调整效率低 |
| V10 | **节点信息密度低** | 节点标签仅显示 ID；tooltip 信息少；无端口利用率/功率标注 | 检查不便 |

**演进诉求**：

| 编号 | 问题 | 影响 | V2.4 目标 |
|------|------|------|-----------|
| U1 | 拓扑图层级不清晰，Core/Spine/Leaf/Server 混排 | 专业度不足 | 分层布局 + Pod 分组 |
| U2 | 机柜图仅 2D 平面，无功率热力可视化 | 直观性不足 | 等距 3D + 功率热力图 |
| U3 | 无设备类型专业图标，依赖通用图标 | 视觉识别弱 | 设备类型图标库 |
| U4 | 拓扑图无主题切换（打印/演示场景） | 场景适配弱 | 多主题（亮/暗/高对比/打印） |
| U5 | 链路无带宽热力图，收敛比不可视化 | 专业表达弱 | 链路着色 + 收敛比标注 |
| U6 | 无数据图表组件（功率/端口利用率趋势） | 信息表达单一 | ECharts 图表组件库 |

### 2.6 用户视角

**优势**：核心功能链路完整；V2.3 已加首次引导。

**演进诉求**：

| 编号 | 问题 | 严重度 | V2.4 目标 |
|------|------|--------|-----------|
| UU1 | 新用户不知道 128 GPU 该选什么网络架构 | 高 | 智能推荐（输入规模 → 推荐方案） |
| UU2 | 设计完成后不知道是否合理，无校验反馈 | 高 | 规则校验引擎 + 改进建议 |
| UU3 | 端口速率/光模块/线缆型号不会选 | 高 | 光模块自动选型 + 距离推荐 |
| UU4 | 方案对比需要手动开两个项目 | 中 | 多方案并排对比 |
| UU5 | 输出文件无法直接交付（缺报告） | 中 | PDF 设计报告一键生成 |
| UU6 | 设备库筛选维度少，找不到合适设备 | 中 | 多维度筛选 + 对比 |
| UU7 | 项目无法克隆/版本化，改坏无法回退 | 中 | 项目克隆 + 方案版本历史 |

### 2.7 运维人员视角

**优势**：三平台 CI；electron-updater 自动更新。

**演进诉求**：

| 编号 | 问题 | 严重度 | V2.4 目标 |
|------|------|--------|-----------|
| O1 | Python 环境未自包含，用户需自行安装 | 高 | 评估 PyInstaller / 嵌入式 Python |
| O2 | 无应用日志文件，远程支持困难 | 高 | 文件日志 + 滚动归档 + 一键导出 |
| O3 | 无数据备份/恢复机制 | 中 | 项目自动备份 + 手动恢复 |
| O4 | 设备库只读，自定义设备依赖导入 | 中 | 用户设备库目录读写支持 |
| O5 | 无配置导出/迁移功能 | 中 | 设置导出/导入 JSON |

### 2.8 智算数据中心领域专家视角（新增）

基于业界主流厂商产品调研与设计经验，AutoLink 当前在专业能力上存在以下关键差距：

| 编号 | 差距 | 业界实践 | V2.4 目标 |
|------|------|----------|-----------|
| E1 | **不支持 Rail-Optimized 架构** | NVIDIA SuperPOD 参考：8 GPU × 8 Rail，每 Rail 独立 leaf | 支持 Rail 分组与可视化 |
| E2 | **不支持光模块选型** | 400G SR4/DR4/FR4/LR4 + 800G SR8/DR8/2FR4，DAC/AOC 短距优先 | 光模块库 + 距离自动选型 |
| E3 | **不支持液冷评估** | 风冷 ≤15kW/柜，冷板液冷 30-60kW，浸没式 50-100kW+，NVL72 需 120kW+ | 散热方式选项 + 功率密度校验 |
| E4 | **不支持 PUE 估算** | 国家东数西算枢纽 PUE ≤1.25，新建 DC 目标 <1.20 | PUE 估算器 + 节能建议 |
| E5 | **不支持收敛比校验** | 参数网 1:1 无阻塞，存储网 1:1~2:1，业务网 3:1~4:1 | 自动计算 + 告警 |
| E6 | **不支持 NVIDIA Spectrum-X** | Spectrum-4 + BlueField-3 + ConnectX-7/8 端到端 RoCE | Spectrum-X 设备标识 + 校验 |
| E7 | **不支持 1.6T 演进** | 2026 年 1.6T 规模上量，CPO 共封装光学 | 光模块库预留 1.6T 字段 |
| E8 | **国产化设备覆盖不足** | 华为昇腾 910B、海光 DCU、寒武纪思元 690 | 补充国产 GPU/NPU 服务器 |
| E9 | **不支持并行文件系统** | BeeGFS / IBM Storage Scale / WekaIO AI 训练专用 | 存储类型新增"并行文件系统" |
| E10 | **无标准场景模板** | 128/256/512/1024/2048 GPU 标准档位 | 场景模板库 |

---

## 三、V2.4 核心功能规划

### 3.1 更智能 — AI 辅助设计引擎（P0）

#### 3.1.1 智能选型推荐

**功能描述**：用户输入 GPU 规模与训练场景，系统自动推荐网络架构、交换机型号、收敛比、Pod 划分。

**推荐引擎规则**：

| GPU 规模 | 推荐架构 | 推荐交换机 | 收敛比 | Pod 数 |
|----------|----------|-----------|--------|--------|
| ≤128 | 二层 Fat-Tree | NDR 400G 64 端口 | 1:1 | 1 |
| 256-512 | 二层 Fat-Tree | NDR 400G 64 端口 | 1:1 | 1-2 |
| 512-2048 | 三层 Fat-Tree | NDR 400G 64 端口 | 1:1 | 多 Pod |
| 2048-16384 | 三层 Fat-Tree | XDR 800G 64 端口 | 1:1 | 多 Pod |
| NVL72 集群 | Rail-Optimized | Spectrum-X SN5600 | 1:1 | 按 Rail |

**输入**：GPU 型号 + 数量 + 训练场景（LLM/CV/推荐）
**输出**：推荐方案卡片（架构图缩略 + 设备清单 + 功耗 + 预估成本区间）

**交互**：向导首页增加"智能推荐"入口，或设计面板顶部"AI 推荐"按钮。

#### 3.1.2 规则校验引擎

**功能描述**：基于智算中心设计规范，对当前方案进行多维度校验，给出改进建议。

**校验规则库**（30+ 规则，分 4 类）：

| 类别 | 规则示例 | 严重度 |
|------|---------|--------|
| 拓扑完整性 | Leaf 上行端口是否全部连接 Spine | 错误 |
| 拓扑完整性 | 三层 Fat-Tree 的 Core 数量是否为 Spine/2 | 错误 |
| 收敛比 | 参数网收敛比是否为 1:1 | 警告 |
| 收敛比 | 业务网收敛比是否 ≤4:1 | 警告 |
| 端口利用 | 交换机端口利用率是否在 60-90% | 提示 |
| 端口利用 | 是否有端口未分配 | 提示 |
| 功率密度 | 单机柜功率是否超过散热方式上限 | 错误 |
| 功率密度 | 单机柜功率是否超过 80% 上限 | 警告 |
| 光模块 | 光模块速率是否匹配交换机端口速率 | 错误 |
| 光模块 | 线缆距离是否超过光模块规格 | 错误 |
| 协议兼容 | IB 交换机是否与 RoCE 交换机混用 | 错误 |
| Rail 架构 | Rail 数量是否为 8（NVIDIA 标准） | 警告 |
| PUE | 估算 PUE 是否 < 1.25 | 提示 |

**输出**：校验结果面板（错误/警告/提示分类）+ 每条规则的"查看详情"跳转。

#### 3.1.3 智算场景模板库

**功能描述**：内置业界标准 AI 训练集群规模档位模板，一键创建。

**内置模板**：

| 模板名 | GPU 规模 | 架构 | 参考来源 |
|--------|---------|------|---------|
| NVIDIA SuperPOD-128 | 128× H100 | 二层 Fat-Tree + Rail | NVIDIA 官方参考 |
| SuperPOD-256 | 256× H100 | 三层 Fat-Tree | NVIDIA 官方参考 |
| NVL72-单架 | 72× B200 | Rail-Optimized | GB200 NVL72 |
| 国产-昇腾-256 | 256× 910B | 三层 RoCE | 华为 Atlas 900 |
| 中型-512 | 512× H100 | 三层 Fat-Tree | 通用 |
| 大型-1024 | 1024× H100 | 三层 Fat-Tree | 通用 |
| 超大-2048 | 2048× H100 | 三层 Fat-Tree XDR | 通用 |

### 3.2 更专业 — 智算领域深度能力（P0）

#### 3.2.1 Rail-Optimized 架构支持

**功能描述**：支持 NVIDIA SuperPOD 参考架构的 Rail 分组设计与可视化。

**数据模型扩展**：

```python
# backend/models.py NetworkObject 新增字段
class NetworkObject:
    rail_id: Optional[int] = None  # 1-8，标识所属 Rail
    rail_role: str = "none"  # "rail_leaf" / "rail_spine" / "server_rail_endpoint"
```

**设计器扩展**：

```python
# backend/designer.py 新增 Rail 设计模式
class NetworkDesignerV2:
    rail_mode: bool = False  # 是否启用 Rail-Optimized
    rail_count: int = 8  # NVIDIA 标准 8 Rail

    def _design_rail_topology(self):
        """Rail-Optimized 拓扑设计
        - 每 GPU 服务器 8 张 NIC，每张 NIC 连一个 Rail
        - 每 Rail 独立 leaf 交换机
        - Rail leaf 之间通过 spine 互联
        """
```

**可视化**：拓扑图中每 Rail 一种颜色，服务器节点按 Rail 分组排列。

#### 3.2.2 光模块与线缆管理

**功能描述**：建立光模块型号库，根据连接距离自动推荐光模块型号，输出含光模块信息的布线指导表。

**光模块库 schema**：

```json
{
  "id": "400g_dr4_qsfpdd",
  "speed": "400G",
  "form_factor": "QSFP-DD",
  "spec": "DR4",
  "distance_m": 500,
  "fiber_type": "SMF",
  "power_watts": 10,
  "vendors": ["中际旭创", "海信宽带", "华工正源", "Finisar"],
  "price_range": "800-1500",
  "category": "光模块"
}
```

**光模块库覆盖**（V2.4 目标 30+ 型号）：

| 速率 | 规格 | 距离 | 封装 |
|------|------|------|------|
| 100G | SR4/CWDM4/LR4 | 100m/2km/10km | QSFP28 |
| 200G | SR4/DR4/FR4 | 100m/500m/2km | QSFP56 |
| 400G | SR8/DR4/FR4/LR4 | 100m/500m/2km/10km | QSFP-DD |
| 800G | SR8/DR8/2xFR4 | 100m/500m/2km | OSFP/QSFP-DD |
| 1.6T | (预留) | — | OSFP-XD |
| DAC | 400G/800G | 1-3m | OSFP/QSFP-DD |
| AOC | 400G/800G | 1-30m | OSFP/QSFP-DD |

**自动选型规则**：
- 同机柜内（<3m）：优先 DAC（成本最低）
- 同 POD 内（<30m）：AOC 或 400G SR8
- 跨 POD（<500m）：400G DR4 / 800G DR8
- 跨集群（>500m）：400G FR4/LR4

**布线指导表输出**（新增 Excel）：

| 线缆编号 | A 端设备 | A 端端口 | Z 端设备 | Z 端端口 | 线缆类型 | 光模块型号 | 数量 | 长度估算 | 单价 | 小计 |
|---------|---------|---------|---------|---------|---------|-----------|------|---------|------|------|
| C-001 | 参数Leaf-1 | port-01 | GPU-Srv-01 | port-01 | DAC | 400G DAC 2m | 1 | 2m | ¥200 | ¥200 |

#### 3.2.3 液冷与散热评估

**功能描述**：支持风冷/冷板液冷/浸没式液冷三种散热方式，校验单机柜功率密度，估算 PUE。

**机柜散热配置**：

```typescript
type CoolingType = 'air' | 'cold_plate' | 'immersion'

interface CoolingConfig {
  type: CoolingType
  maxPowerPerRack: number  // kW，根据类型自动填充默认值
  // air: 15, cold_plate: 60, immersion: 100
}

interface PUEEstimate {
  coolingType: CoolingType
  totalITPower: number  // kW
  estimatedPUE: number  // 风冷 1.35-1.50, 冷板 1.15-1.25, 浸没 1.10-1.20
  totalPower: number  // totalITPower * PUE
  suggestion: string  // 节能建议
}
```

**校验规则**：
- 单机柜功率 > 散热方式上限 → 错误
- 单机柜功率 > 上限 80% → 警告
- NVL72 等液冷必选设备选了风冷 → 错误

#### 3.2.4 收敛比自动计算与告警

**功能描述**：实时计算各网络收敛比，对照业界标准给出告警。

**计算公式**：

```
收敛比 = 下行总带宽 / 上行总带宽
参数网目标：1:1（无阻塞 Fat-Tree）
存储网目标：1:1 ~ 2:1
业务网目标：3:1 ~ 4:1
```

**展示**：设计摘要面板新增"收敛比"区域，超阈值红色高亮。

#### 3.2.5 国产化设备扩展

**功能描述**：补充国产 GPU/NPU 服务器与交换机，支持国产替代场景。

**新增设备**（V2.4 目标 +15 款国产设备）：

| 类别 | 厂商 | 型号 | 关键规格 |
|------|------|------|---------|
| GPU 服务器 | 华为 | Atlas 800T A2 | 8× 昇腾 910B，64GB HBM/卡，RoCE 200G/400G |
| GPU 服务器 | 华为 | Atlas 800 训练（9000） | 8× 昇腾 910，4× 100G RoCE |
| GPU 服务器 | 海光 | DCU K100AI 服务器 | 8× K100AI，64GB HBM2e，PCIe 5.0 |
| GPU 服务器 | 寒武纪 | 思元 690 服务器 | 8× 思元 690，对标 H100 80% |
| 交换机 | 华为 | CloudEngine XH16800 | AI 智算专用，大规模 RoCE |
| 交换机 | 华为 | CE9860-4C-EI | 64× 400G/800G |
| 交换机 | H3C | S9850-G 系列 | 新一代 400G 数据中心 |
| 存储 | 华为 | OceanStor Pacific | 海量分布式存储 |

#### 3.2.6 并行文件系统支持

**功能描述**：存储类型新增"并行文件系统"类别，区分传统 SAN/NAS 与 AI 训练专用存储。

**存储类别扩展**：

```typescript
type StorageType = 'all_flash' | 'hybrid_flash' | 'parallel_fs'
// parallel_fs: BeeGFS / IBM Storage Scale / WekaIO / VAST Data
```

**新增设备**：

| 型号 | 类型 | 特点 |
|------|------|------|
| BeeGFS Appliance | parallel_fs | NVIDIA 参考架构，原生 RDMA |
| IBM Storage Scale System 6000 | parallel_fs | AI 专用，高吞吐 |
| WekaIO | parallel_fs | 全闪云原生，RDMA 优化 |

### 3.3 更实用 — 工程落地交付物（P0）

#### 3.3.1 布线指导表（Cabling Guide）

**功能描述**：输出独立 Excel，含每条线缆的光模块型号、长度估算、成本。

**实现**：`backend/exporter.py` 新增 `export_cabling_guide()` 函数，接收拓扑 + 机柜布局 + 光模块选型，生成布线表。

#### 3.3.2 BOM 成本估算

**功能描述**：汇总设备清单 + 光模块 + 线缆，输出带成本估算的 BOM 表。

**数据来源**：设备库 `price_range` 字段（区间估算）。

**输出**：BOM Excel（设备型号 + 数量 + 单价区间 + 小计 + 总计）。

#### 3.3.3 多方案对比

**功能描述**：单项目支持保存多套设计方案（A/B/C），并排对比关键指标。

**数据模型**：

```typescript
interface ProjectScheme {
  id: string
  name: string  // "方案A - 二层FatTree"
  createdAt: string
  config: ProjectConfig
  topology: ProjectTopology
  rackLayout: RackLayout
  metrics: SchemeMetrics  // GPU数/交换机数/收敛比/总功耗/成本
}
```

**对比维度**：GPU 规模、架构、交换机数量、收敛比、总功耗、PUE、成本估算、机柜数。

#### 3.3.4 PDF 设计报告

**功能描述**：一键生成专业 PDF 设计报告，可直接交付客户。

**报告结构**：

1. 封面（项目名 + 版本 + 日期）
2. 设计概述（GPU 规模 + 架构选型 + 设计依据）
3. 网络拓扑图（分层渲染）
4. 设备清单表
5. 机柜布局图
6. 收敛比与功率分析
7. 布线指导表摘要
8. 附录：光模块清单 + BOM

**实现**：前端 `jsPDF` + `html2canvas`，或后端 Python `reportlab`（更专业但依赖重）。V2.4 优先前端方案。

#### 3.3.5 项目克隆与版本历史

**功能描述**：项目可整体克隆；设计方案保存历史版本，可回退。

**实现**：项目目录新增 `schemes/` 子目录存储历史方案；克隆通过文件复制。

### 3.4 更美观 — 专业视觉升级（P1）

#### 3.4.1 拓扑图分层布局增强

**功能描述**：拓扑图严格分层（Core → Spine → Leaf → Server），Pod 分组带边框与底色。

**ECharts 配置**：

```typescript
// 四层布局，y 坐标固定
const LAYOUT_Y = {
  core: 100,
  spine: 250,
  leaf: 400,
  server: 550,
}

// Pod 分组用 markArea 绘制半透明背景
// Rail 分组用不同 nodeColor
```

#### 3.4.2 机柜 3D 等距视图

**功能描述**：机柜图升级为等距（isometric）2.5D 视图，支持正面/背面切换，功率热力图叠加。

**实现**：CSS 3D transform 或 SVG 等距投影。

#### 3.4.3 链路带宽热力图

**功能描述**：拓扑图链路按带宽利用率着色（绿 <60%，黄 <80%，红 ≥80%）。

#### 3.4.4 设备类型专业图标

**功能描述**：为 GPU 服务器/存储/交换机/光模块等设备类型设计专业 SVG 图标，替换通用 lucide 图标。

#### 3.4.5 拓扑图多主题

**功能描述**：拓扑图支持"亮色/暗色/高对比/打印友好"四主题切换。

### 3.5 更便捷 — 交互效率提升（P1）

#### 3.5.1 快捷键体系完善

**功能描述**：全局快捷键覆盖所有核心操作，支持自定义。

**快捷键清单**（30+ 项）：

| 操作 | 快捷键 |
|------|--------|
| 新建项目 | Ctrl+N |
| 打开项目 | Ctrl+O |
| 保存配置 | Ctrl+S |
| 生成拓扑 | Ctrl+G |
| 渲染输出 | Ctrl+R |
| 校验设计 | Ctrl+Shift+V |
| 切换活动 | Ctrl+Shift+E/D/W/V |
| 关闭 Tab | Ctrl+W |
| AI 推荐 | Ctrl+I |
| 导出 PDF | Ctrl+Shift+P |
| 设备库 | Ctrl+Shift+L |

#### 3.5.2 向导智能推荐

**功能描述**：向导首页增加"输入 GPU 规模 → 自动填充推荐配置"。

#### 3.5.3 项目标签与搜索

**功能描述**：项目支持标签分类（如"已交付/进行中/方案对比"），支持全文搜索。

#### 3.5.4 设备库多维度筛选与对比

**功能描述**：设备库支持厂商/速率/端口数/功耗/U高多维筛选；支持 2-3 款设备并排参数对比。

### 3.6 更高效 — 性能与工程化（P1）

#### 3.6.1 大规模拓扑优化

**功能描述**：1000+ GPU 拓扑渲染优化，ECharts 使用 WebWorker + 虚拟渲染。

#### 3.6.2 Python 引擎缓存

**功能描述**：相同配置的设计请求使用 LRU 缓存；参数变更只重算受影响部分。

#### 3.6.3 应用日志与备份

**功能描述**：文件日志（按天滚动）+ 项目自动备份（每次保存创建 .bak）。

#### 3.6.4 E2E 测试框架

**功能描述**：引入 Playwright E2E 测试，覆盖核心链路（创建 → 设计 → 渲染 → 导出）。

#### 3.6.5 性能基准测试

**功能描述**：建立 128/512/2048 GPU 三档性能基准，CI 中回归监控。

---

### 3.7 可视化能力全面升级（P0，用户重点反馈）

> 本章节为 V2.4 重点专项，针对用户反馈"拓扑图设备排列重叠、无功能分区、无组分区、非常不方便检查组网拓扑"进行全面重构。涵盖拓扑图、机房布局、机架展示、调整交互、导出能力四大方向。

#### 3.7.1 拓扑图重构 — 分层分区防重叠布局（P0）

**功能描述**：彻底重构拓扑图布局算法，实现"分层 × 分区 × 分组"三维布局，消除重叠，清晰表达组网结构。

**布局策略（三层维度正交）**：

```
纵向分层（Y 轴固定）：           横向分区（X 轴按网络域分列）：      分组（区内按 Pod/Rail 聚簇）：
  Core 层（y=100）                 [参数网区] [存储网区] [业务网区]    Pod1 组 / Pod2 组 / ...
  Spine 层（y=250）                每区独立 X 范围，区间留 GAP         Rail1 组 / Rail2 组 / ...
  Leaf 层（y=400）                 区内设备按 Pod/Rail 聚簇            组内设备紧凑排列
  Server 层（y=550）               组间留 GROUP_GAP
```

**防重叠布局算法**：

```typescript
interface LayoutConfig {
  layerY: Record<string, number>          // 各层 Y 坐标固定
  networkDomains: NetworkDomain[]         // 网络域分区：参数/存储/业务/OOB
  domainGap: number                       // 分区间距（如 300px）
  podGap: number                          // Pod 间距（如 120px）
  railGap: number                         // Rail 间距（如 80px）
  nodeGap: number                         // 节点间距（自适应 60-120px）
  autoScale: boolean                      // 节点多时自动缩放节点尺寸
  minNodeSize: number                     // 最小节点尺寸（防过小）
}

// 自适应间距：节点数多时间距缩小但保证不重叠
function computeAdaptiveGap(nodeCount: number, availableWidth: number): number {
  const idealGap = 120
  const minGap = 40
  const required = nodeCount * idealGap
  if (required <= availableWidth) return idealGap
  return Math.max(minGap, availableWidth / nodeCount)
}
```

**功能分区可视化**：

| 网络域 | 视觉表达 |
|--------|---------|
| 参数网 | 蓝色半透明背景区 + "参数网络"标签 + 边框 |
| 存储网 | 绿色半透明背景区 + "存储网络"标签 + 边框 |
| 业务网 | 紫色半透明背景区 + "业务网络"标签 + 边框 |
| OOB | 灰色半透明背景区 + "带外管理"标签 + 边框 |

**分组可视化**：

| 分组类型 | 视觉表达 |
|---------|---------|
| Pod 分组 | 虚线边框 + "Pod 1" 标签 + 浅色底色 |
| Rail 分组 | 实线边框 + "Rail 1-8" 标签 + 8 种区分色 |
| Leaf 聚簇 | 服务器按所属 Leaf 聚簇，Leaf 节点居中上方 |

**链路渲染优化**：

- 同类链路聚合边（多端口捆绑显示为一条粗线 + 端口数标注）
- 链路按网络域着色（参数网蓝/存储网绿/业务网紫/OOB 灰）
- 链路曲率自适应（同源同汇的链路分散曲率避免重叠）
- 链路悬浮显示速率/利用率/光模块型号
- 高负载链路热力着色（绿 <60%，黄 <80%，红 ≥80%）

**节点信息增强**：

- 节点显示：图标 + 型号简称 + 关键参数（GPU 数/端口数/功率）
- 节点着色：按设备类型 + 网络域双重着色
- 节点悬浮：完整规格 + 端口利用率 + 所在机柜/U 位
- 节点点击：高亮该节点所有链路 + 对端节点

**视图模式切换**：

| 模式 | 用途 | 特点 |
|------|------|------|
| 全景模式 | 整体组网审视 | 所有网络域 + 所有层 |
| 参数网模式 | AI 训练后端审视 | 仅参数网 + Rail/Pod 分组突出 |
| 存储网模式 | 存储架构审视 | 仅存储网 + 存储 Leaf/Spine |
| 业务网模式 | 前端网络审视 | 仅业务网 + OOB |
| Pod 视图 | 单 Pod 内部结构 | 选中 Pod 放大显示内部拓扑 |
| Rail 视图 | 单 Rail 内部结构 | 选中 Rail 放大显示 |

#### 3.7.2 机房平面布局（P0，全新功能）

**功能描述**：新增机房平面图视图，支持机柜行列排列、冷热通道、功率热力分布，填补机房级可视化空白。

**数据模型**：

```typescript
interface DataCenterLayout {
  id: string
  name: string                    // "一号机房"
  rows: CabinetRow[]              // 机柜行列
  coldAisleOrientation: 'north' | 'south' | 'east' | 'west'  // 冷通道朝向
  aisleWidth: number              // 通道宽度（米）
}

interface CabinetRow {
  id: string
  name: string                    // "A 排"
  orientation: 'front-north' | 'front-south'  // 机柜正面朝向
  position: { x: number; y: number }  // 排的起始坐标
  cabinetIds: number[]            // 该排包含的机柜 ID 顺序
}

interface CabinetPlacement {
  cabinetId: number
  rowId: string
  indexInRow: number              // 排内序号
  // 派生：位置、功率、设备数、散热方式
}
```

**机房平面图功能**：

| 功能 | 描述 |
|------|------|
| 机柜排列 | 拖拽机柜到排内，支持多排（A/B/C/D 排） |
| 冷热通道 | 相邻两排面对面/背对背，自动标注冷通道（蓝色）/热通道（红色） |
| 功率热力图 | 机柜按功率密度着色（绿 <60% / 黄 <80% / 红 ≥80%） |
| 散热方式标识 | 机柜角标显示散热方式（风冷/冷板/浸没） |
| 机柜信息悬浮 | 显示机柜名/设备数/功率/U 利用率/散热方式 |
| 点击跳转 | 点击机柜跳转到机架 Tab 详情 |
| 自动布局 | 根据机柜数量自动生成推荐排列（每排 8-12 柜） |
| 撤销/重做 | 布局调整支持撤销重做 |

**机房统计面板**：

| 指标 | 展示 |
|------|------|
| 机柜总数 / 已用 / 空闲 | 数字卡片 |
| 总功率 / 总功率上限 / 平均功率密度 | 数字 + 进度条 |
| 散热方式分布 | 饼图（风冷/冷板/浸没占比） |
| 功率分布 | 柱状图（各机柜功率） |
| PUE 估算 | 数字 + 节能建议 |

#### 3.7.3 机架展示增强（P0）

**功能描述**：机架视图从 2D 单柜升级为多视图、多柜对比、3D 等距、热力图叠加。

**视图模式**：

| 模式 | 描述 | 用途 |
|------|------|------|
| 2D 单柜（现有） | U 位列表，保留并优化 | 精确 U 位调整 |
| 2D 多柜对比 | 横向并排显示 2-4 个机柜 | 机柜间设备对比 |
| 3D 等距单柜 | SVG 等距投影，正/背面切换 | 演示与评审 |
| 3D 等距多柜 | 等距视角下多机柜排列 | 机房级审视 |

**2D 单柜增强**：

- 设备块显示：图标 + 型号 + U 位范围 + 功率
- 功率热力叠加：设备块按功率密度着色
- 端口信息：设备块右侧显示已用端口/总端口
- 线缆走线：设备块显示对端设备连接（悬浮查看）
- 批量选择：Shift 多选设备，支持批量移动/删除

**3D 等距视图**：

```typescript
interface IsometricRackConfig {
  view: 'front' | 'rear' | 'both'   // 正面/背面/双面
  showPowerHeatmap: boolean          // 功率热力叠加
  showCabling: boolean               // 线缆走线示意
  showLabels: boolean                // 设备标签
  rotateAngle: number                // 旋转角度（0/90/180/270）
}
```

**机柜属性编辑增强**：

- 机柜类型：GPU 柜/存储柜/网络柜/通算柜/安全柜/自定义
- 散热方式：风冷/冷板液冷/浸没式（影响功率上限）
- 功率上限：根据散热方式自动填充默认值，可手动调整
- U 高度：42U/45U/48U 可选
- 机柜命名：支持批量重命名（A01、A02...）

#### 3.7.4 调整与交互能力增强（P0）

**功能描述**：全面提升拓扑图与机架的调整交互效率。

**拓扑图交互**：

| 交互 | 描述 |
|------|------|
| 拖拽移动节点 | 长按拖拽节点到任意位置，自动避让 |
| 框选多节点 | 鼠标拖拽框选，批量移动/删除/高亮 |
| 撤销/重做 | Ctrl+Z / Ctrl+Y，记录布局调整历史 |
| 对齐工具 | 选中多节点后一键对齐（左/中/右/上/下） |
| 等距分布 | 选中多节点后一键等距分布 |
| 折叠/展开 | Pod/Rail 分组可折叠为单个节点，展开还原 |
| 小地图 | 右下角缩略图，大图时快速导航 |
| 搜索定位 | 输入设备名搜索并高亮定位 |

**机架调整交互**：

| 交互 | 描述 |
|------|------|
| 拖拽移动设备 | 长按设备拖拽到目标 U 位，实时显示冲突 |
| 跨机柜拖拽 | 拖拽设备到另一机柜，自动迁移 |
| 批量移动 | Shift 多选设备，批量移动到目标机柜 |
| 撤销/重做 | Ctrl+Z / Ctrl+Y |
| 自动排列 | 一键按设备类型/功率自动排列机柜内设备 |
| 智能建议 | 高功率设备建议放置在散热最优 U 位 |

#### 3.7.5 导出能力增强（P0）

**功能描述**：全面扩展可视化导出能力，覆盖交付与演示场景。

**拓扑图导出**：

| 格式 | 用途 | 实现 |
|------|------|------|
| PNG（现有） | 通用图片 | ECharts getDataURL，提升至 3x 像素比 |
| SVG（新增） | 矢量图，可缩放 | ECharts renderer: 'svg' |
| PDF（新增） | 打印交付 | jsPDF 嵌入 SVG/PNG |
| Visio/Draw.io（新增） | 可编辑导入 | 导出 VSDX/XML 格式（评估） |

**机柜/机房导出**：

| 导出项 | 格式 | 说明 |
|--------|------|------|
| 单机柜布局图 | PNG/SVG/PDF | 2D 或 3D 视图截图 |
| 多机柜对比图 | PNG/SVG/PDF | 多柜并排截图 |
| 机房平面图 | PNG/SVG/PDF | 机房俯视图 |
| 机房功率热力图 | PNG/SVG/PDF | 功率着色俯视图 |
| 上机表 Excel（现有） | XLSX | 保留并优化 |
| 机柜清单 CSV（现有） | CSV | 保留 |

**导出选项**：

```typescript
interface ExportOptions {
  format: 'png' | 'svg' | 'pdf'
  pixelRatio: number              // PNG 像素比（1/2/3x）
  includeLabels: boolean          // 是否包含标签
  includePowerHeatmap: boolean    // 是否包含功率热力
  includeCabling: boolean         // 是否包含线缆走线
  background: 'white' | 'transparent' | 'dark'
  watermark?: string              // 水印（项目名/日期）
}
```

---

## 四、设备库扩展计划

### 4.1 V2.4 目标：56 → 100+ 款

| 类别 | V2.3 现有 | V2.4 新增 | 小计 |
|------|----------|----------|------|
| GPU 服务器 | 7 | +8（国产 4 + NVIDIA HGX B200/H200 + GB200 + 海光 + 寒武纪） | 15 |
| 全闪存储 | 5 | +3（BeeGFS / IBM Scale / Pure Storage） | 8 |
| 混闪存储 | 5 | +2（Dell PowerMax / VAST Data） | 7 |
| 并行文件系统 | 0 | +3（BeeGFS / IBM Scale / WekaIO） | 3 |
| 通算服务器 | 5 | +2（Dell R760 / Supermicro） | 7 |
| 参数网交换机 | 17 | +5（QM3700 / SN4700 / XH16800 / S9850-G / 国产） | 22 |
| 存储网交换机 | 5 | +2（SN4700 / 新款 H3C） | 7 |
| 业务网交换机 | 7 | 0 | 7 |
| 带外交换机 | 7 | 0 | 7 |
| 光模块 | 0 | +30（100G/200G/400G/800G/DAC/AOC） | 30 |
| **合计** | **56** | **+55** | **111+** |

### 4.2 DeviceProfile Schema 2.0 扩展

```typescript
interface DeviceProfile {
  // V2.3 既有字段
  id: string
  vendor: string
  model: string
  category: string
  u_height: number
  power_watts: number
  ports: InterfaceModel[]

  // V2.4 新增字段
  cooling?: 'air' | 'cold_plate' | 'immersion' | 'hybrid'  // 散热方式
  rail_compatible?: boolean  // 是否支持 Rail-Optimized
  spectrum_x?: boolean  // 是否 Spectrum-X 认证
  nvlink_domain?: number  // NVLink 域大小（如 576）
  rdma_type?: 'IB' | 'RoCEv2' | 'both'  // RDMA 协议
  price_range?: string  // 价格区间（用于 BOM 估算）
  datasheet_url?: string  // 规格书链接
  eol_date?: string  // 停产日期（选型提醒）
}
```

### 4.3 光模块库 schema

```typescript
interface OpticalModule {
  id: string
  speed: '100G' | '200G' | '400G' | '800G' | '1.6T'
  form_factor: 'QSFP28' | 'QSFP56' | 'QSFP-DD' | 'OSFP' | 'OSFP-XD'
  spec: 'SR4' | 'SR8' | 'DR4' | 'DR8' | 'FR4' | '2xFR4' | 'LR4' | 'DAC' | 'AOC'
  distance_m: number
  fiber_type: 'MMF' | 'SMF' | 'copper'
  power_watts: number
  vendors: string[]
  price_range: string
}
```

---

## 五、修改文件清单（预估）

| 模块 | 文件 | 操作 | 说明 |
|------|------|------|------|
| **数据模型** | `backend/models.py` | 修改 | NetworkObject 新增 rail_id/rail_role |
| | `backend/designer.py` | 修改 | 新增 Rail-Optimized 设计模式 |
| | `backend/topology.py` | 修改 | Rail 拓扑计算 |
| | `backend/exporter.py` | 修改 | 新增布线指导表/BOM/PDF |
| | `backend/engine.py` | 修改 | 新增缓存 + 增量计算 |
| | `src/types/device-profile.ts` | 修改 | Schema 2.0 扩展 |
| | `src/types/project-config.ts` | 修改 | 新增 Scheme/Cooling/OpticalModule 类型 |
| **设备库** | `template/device_library/gpu_servers/` | 新增 8 个 JSON | 国产 + 新型号 |
| | `template/device_library/storage_servers/parallel_fs/` | **新建目录** + 3 JSON | 并行文件系统 |
| | `template/device_library/optical_modules/` | **新建目录** + 30 JSON | 光模块库 |
| | `template/device_library/library_index.json` | 修改 | 新增分类与索引 |
| **智能引擎** | `backend/recommender.py` | **新建** | 智能选型推荐引擎 |
| | `backend/validator.py` | **新建** | 规则校验引擎 |
| | `backend/rules/` | **新建目录** | 校验规则库（YAML/JSON） |
| | `backend/pue_estimator.py` | **新建** | PUE 估算器 |
| **前端-智能** | `src/components/wizard/AIRecommendCard.tsx` | **新建** | AI 推荐卡片 |
| | `src/components/design/ValidationPanel.tsx` | **新建** | 校验结果面板 |
| | `src/components/design/ConvergenceRatio.tsx` | **新建** | 收敛比展示 |
| | `src/stores/recommend.store.ts` | **新建** | 推荐状态 |
| **前端-专业** | `src/components/topology/RailGroupView.tsx` | **新建** | Rail 分组可视化 |
| | `src/components/device/OpticalModulePicker.tsx` | **新建** | 光模块选择器 |
| | `src/components/rack/CoolingConfigPanel.tsx` | **新建** | 散热配置 |
| | `src/components/rack/PUEEstimateView.tsx` | **新建** | PUE 估算展示 |
| **前端-实用** | `src/components/workbench/CablingGuideExport.tsx` | **新建** | 布线指导导出 |
| | `src/components/workbench/BOMExport.tsx` | **新建** | BOM 导出 |
| | `src/components/workbench/PDFReportExport.tsx` | **新建** | PDF 报告导出 |
| | `src/components/project/SchemeCompare.tsx` | **新建** | 方案对比 |
| | `src/stores/scheme.store.ts` | **新建** | 多方案管理 |
| **前端-美观** | `src/components/topology/LayeredTopology.tsx` | 修改 | 分层布局增强 |
| | `src/components/rack/IsometricRackView.tsx` | **新建** | 等距 3D 机柜 |
| | `src/components/topology/LinkHeatmap.tsx` | **新建** | 链路热力图 |
| | `src/assets/icons/device/` | **新建** | 设备类型 SVG 图标 |
| **前端-可视化** | `src/components/topology/TopologyLayoutEngine.ts` | **新建** | 分层分区防重叠布局算法 |
| | `src/components/topology/NetworkDomainZone.tsx` | **新建** | 网络域功能分区背景 |
| | `src/components/topology/GroupBorder.tsx` | **新建** | Pod/Rail 分组边框 |
| | `src/components/topology/EdgeAggregator.ts` | **新建** | 链路聚合边渲染 |
| | `src/components/topology/NodeDetail.tsx` | **新建** | 增强节点信息展示 |
| | `src/components/topology/MiniMap.tsx` | **新建** | 小地图导航 |
| | `src/components/topology/ViewModeSwitcher.tsx` | **新建** | 视图模式切换（全景/参数/存储/业务/Pod/Rail） |
| | `src/components/topology/TopologyExportPanel.tsx` | **新建** | 拓扑图导出（PNG/SVG/PDF） |
| | `src/components/datacenter/DataCenterLayout.tsx` | **新建** | 机房平面布局视图 |
| | `src/components/datacenter/CabinetRow.tsx` | **新建** | 机柜排组件 |
| | `src/components/datacenter/ColdHotAisle.tsx` | **新建** | 冷热通道标识 |
| | `src/components/datacenter/DataCenterStats.tsx` | **新建** | 机房统计面板 |
| | `src/components/datacenter/DataCenterExport.tsx` | **新建** | 机房平面图导出 |
| | `src/components/rack/RackView2D.tsx` | 修改 | 2D 单柜增强（热力/端口/线缆） |
| | `src/components/rack/RackCompareView.tsx` | **新建** | 2D 多柜对比 |
| | `src/components/rack/RackIsometricView.tsx` | 修改 | 3D 等距视图（与现有 IsometricRackView 合并） |
| | `src/components/rack/RackExportPanel.tsx` | **新建** | 机柜布局图导出 |
| | `src/stores/datacenter.store.ts` | **新建** | 机房布局状态管理 |
| | `src/stores/topology-layout.store.ts` | **新建** | 拓扑布局/视图模式状态 |
| | `src/hooks/useUndoRedo.ts` | **新建** | 撤销重做历史栈 |
| **前端-便捷** | `src/hooks/useHotkeys.ts` | **新建** | 全局快捷键 |
| | `src/components/device/DeviceCompare.tsx` | **新建** | 设备对比 |
| | `src/components/project/ProjectTags.tsx` | **新建** | 项目标签 |
| **模板** | `template/superpod_128/` | **新建** | SuperPOD-128 模板 |
| | `template/superpod_256/` | **新建** | SuperPOD-256 模板 |
| | `template/nvl72_rack/` | **新建** | NVL72 模板 |
| | `template/ascend_256/` | **新建** | 昇腾 256 模板 |
| | `template/cluster_512/` | **新建** | 512 GPU 模板 |
| | `template/cluster_1024/` | **新建** | 1024 GPU 模板 |
| | `template/cluster_2048/` | **新建** | 2048 GPU 模板 |
| **运维** | `electron/services/logger.service.ts` | **新建** | 文件日志 |
| | `electron/services/backup.service.ts` | **新建** | 自动备份 |
| **测试** | `tests/backend/test_recommender.py` | **新建** | 推荐引擎测试 |
| | `tests/backend/test_validator.py` | **新建** | 校验引擎测试 |
| | `tests/backend/test_rail_topology.py` | **新建** | Rail 拓扑测试 |
| | `tests/backend/test_cabling_guide.py` | **新建** | 布线指导测试 |
| | `tests/backend/test_optical_module.py` | **新建** | 光模块库测试 |
| | `tests/e2e/` | **新建目录** | Playwright E2E |
| | `tests/perf/` | **新建目录** | 性能基准 |

---

## 六、非功能性需求

| 维度 | 指标 |
|------|------|
| **性能** | 2048 GPU 拓扑生成 < 10 秒；拓扑图渲染 < 5 秒；Excel 万行预览流畅 |
| **可靠性** | Python 引擎崩溃不影响前端；设计请求缓存命中率 > 60% |
| **兼容性** | Windows 10/11 64 位（优先）；macOS x64/arm64；Linux x64 |
| **安装包体积** | 目标 < 250MB（含光模块库与模板扩展） |
| **日志** | 应用日志按天滚动，保留 7 天；一键导出诊断包 |
| **备份** | 项目保存自动创建 .bak；最多保留 5 个历史版本 |
| **覆盖率** | 前端 ≥ 85%，后端 ≥ 80% |
| **E2E** | 核心链路 E2E 测试通过（创建→设计→渲染→导出） |
| **国际化** | 5 语言同步更新，新增术语专业校准 |

---

## 七、不做事项（明确排除）

以下需求归属后续版本（V3.x）：

- **AI HUB 大模型助手**：自然语言对话式设计（"帮我设计一个 1024 卡 H100 集群"）
- **云端协同**：多用户协作、云端项目同步
- **团队协作**：权限管理、评论、变更审批
- **网络流量仿真**：实际 collective 通信流量模拟
- **3D 机房漫游**：VR/AR 机房可视化
- **实时监控集成**：对接 Prometheus/Grafana 实时数据
- **Python 自包含打包**：PyInstaller 嵌入式 Python（V2.4 仅评估可行性）
- **macOS 原生标题栏**：交通灯适配（V2.4 保持自定义标题栏）
- **WCAG 2.1 AA 全面合规**：可访问性全面改造

---

## 八、验收标准

### 8.1 功能验收

1. **智能推荐**：输入 128/256/512/1024 GPU 规模，系统能给出符合业界实践的架构推荐
2. **规则校验**：30+ 校验规则覆盖拓扑/收敛比/功率/光模块/协议兼容，错误能精确定位
3. **Rail-Optimized**：能生成 8 Rail 分组拓扑，可视化中每 Rail 独立着色
4. **光模块选型**：根据距离自动推荐光模块型号，布线指导表含光模块信息与成本
5. **液冷评估**：支持风冷/冷板/浸没式三种散热，单机柜功率超限能告警
6. **PUE 估算**：三种散热方式均能给出 PUE 区间与节能建议
7. **多方案对比**：单项目能保存 ≥3 套方案并并排对比 8 项关键指标
8. **PDF 报告**：一键生成包含 8 章节的专业 PDF 设计报告
9. **设备库扩展**：设备库从 56 款扩展至 100+ 款，含 30+ 光模块
10. **场景模板**：内置 7 套智算标准场景模板，一键创建

### 8.2 质量验收

11. **E2E 测试**：Playwright E2E 覆盖核心链路，全部通过
12. **性能基准**：2048 GPU 拓扑生成 < 10 秒，渲染 < 5 秒
13. **覆盖率**：前端 ≥ 85%，后端 ≥ 80%
14. **TypeScript 编译**：零错误
15. **三平台构建**：Windows/macOS/Linux CI 全绿
16. **应用日志**：日志文件正常生成与滚动
17. **项目备份**：保存项目自动创建 .bak

### 8.3 体验验收

18. **拓扑分层**：Core/Spine/Leaf/Server 严格分层，Pod 分组带边框
19. **机柜 3D**：等距视图可切换正面/背面，功率热力图叠加
20. **快捷键**：30+ 快捷键全部生效，设置面板可查看
21. **设备对比**：2-3 款设备参数并排对比正常
22. **5 语言**：新增功能 5 语言同步翻译完成

### 8.4 可视化能力验收（重点）

23. **拓扑防重叠**：512 GPU 规模拓扑图无节点重叠，所有节点可读
24. **功能分区**：参数网/存储网/业务网/OOB 四区域有独立背景色与边框，分区清晰
25. **分组可视化**：Pod 分组显示虚线边框 + 标签；Rail 分组显示 8 色区分
26. **视图模式**：全景/参数网/存储网/业务网/Pod/Rail 六种视图模式可切换
27. **链路聚合**：同类多端口链路聚合为一条粗线 + 端口数标注
28. **链路热力**：链路按负载着色（绿/黄/红）
29. **拓扑交互**：拖拽移动、框选、撤销重做、对齐分布、折叠展开、小地图、搜索定位全部可用
30. **机房平面图**：机柜按排列显示，冷热通道标注正确，功率热力图着色正确
31. **机房统计**：机柜数/功率/散热分布/PUE 等统计面板数据准确
32. **机架多视图**：2D 单柜/2D 多柜对比/3D 等距单柜/3D 等距多柜四种视图可切换
33. **机架调整**：拖拽移动设备、跨机柜拖拽、批量移动、自动排列、撤销重做全部可用
34. **拓扑导出**：PNG/SVG/PDF 三格式导出，含标签/热力/线缆选项
35. **机柜导出**：单机柜/多机柜对比/机房平面图/功率热力图可导出 PNG/SVG/PDF

---

## 九、风险评估

| 风险 | 影响 | 概率 | 缓解措施 |
|------|------|------|---------|
| Rail-Optimized 算法复杂度高 | 延期 | 中 | 参考 NVIDIA SuperPOD 文档，先实现基础 8 Rail |
| 光模块库数据收集工作量大 | 延期 | 高 | 优先覆盖 400G/800G 主流型号，1.6T 预留字段 |
| PDF 报告前端方案质量不足 | 交付质量 | 中 | 评估 reportlab 后端方案作为备选 |
| ECharts 大规模渲染性能瓶颈 | 性能 | 高 | WebWorker + 虚拟渲染，必要时降采样 |
| 国产设备规格数据不全 | 数据质量 | 中 | 标注"数据待核实"，提供自定义编辑 |
| E2E 测试环境搭建复杂 | 测试延期 | 中 | 优先 Windows 平台，macOS/Linux 后续 |
| 拓扑图防重叠布局算法复杂 | 延期 | 中 | 参考 dagre/elk-js 图布局库，分阶段实现 |
| 机房平面图 SVG 渲染性能 | 性能 | 中 | 限制单机房机柜数 ≤200，超出分页 |
| 3D 等距视图开发工作量大 | 延期 | 中 | 优先 2D 增强，3D 可顺延至 2.4.1 |
| 可视化交互（拖拽/框选/撤销）复杂 | 延期 | 中 | 使用 react-flow 等成熟库替代原生 ECharts 交互 |

---

## 十、版本演进路线

```
V2.4.0 (本版本)
├── 智能推荐 + 规则校验 + 场景模板
├── Rail-Optimized + 光模块 + 液冷 + PUE
├── 布线指导表 + BOM + 多方案 + PDF 报告
├── 拓扑分层 + 3D 机柜 + 热力图
├── 快捷键 + 设备对比 + 项目标签
└── E2E 测试 + 性能基准 + 日志备份

V2.4.1 / V2.4.2 (迭代优化)
├── P1 功能补全
├── 缺陷修复
└── 用户反馈迭代

V3.0 (下一代)
├── AI HUB 大模型设计助手
├── 云端协同 + 团队协作
├── 网络流量仿真
└── 实时监控集成
```

---

> **评审确认后进入开发阶段。本 PRD 与《开发计划_V2.4》分离，开发计划详见独立文档。**
