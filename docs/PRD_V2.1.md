# AutoLink V2.1 PRD — 精细化建模与参数定制

## 一、版本定位

V2.0 实现了基础的项目管理、拓扑设计、机柜规划、可视化渲染全链路闭环。V2.1 的目标是 **从"能用"升级为"好用"**——对智算中心网络规划的所有对象进行精细化参数建模，使每个设备、每条连接、每个机柜的参数都可以按项目定制，渲染输出全面对接工程实施。

---

## 二、现有架构分析与不足

### 2.1 当前数据模型 (V2.0)

```
NetworkObject(name, obj_type, group, max_ports, podid)
  ├── connections: Connection[]
  ├── downlink_counter / uplink_counter / core_counter / port_counter
  ├── downlink_limit / uplink_limit / core_limit / port_limit
  └── 端口命名: 硬编码 "端口N" / "参数网卡N" / "存储网卡1" / "OOB口1" / "业务口1"

RackCabinet(id, name, totalU=42, devices: RackDevice[])
  └── RackDevice(id, name, type, cabinetId, startU, endU)

network_config.ini
  └── 全局参数: num_servers, switch_ports, speed, cable_type, etc.
```

### 2.2 核心不足

| 维度 | V2.0 现状 | V2.1 需求 |
|------|----------|----------|
| 设备建模 | 只有 name/type/ports，无厂商/型号/功率 | 完整的设备参数卡片 |
| 端口命名 | 硬编码 `端口1`/`参数网卡1`/`OOB口1` | 按项目可定制的接口编号前缀 |
| 机柜模型 | 固定 42U，无功率概念 | 42U/49U 可选，功率定额与评估 |
| 网络类型 | boolean 开关 (oob_enabled, biz_enabled) | 参数/存储/业务/OOB 四网独立开关 |
| 服务器 | GPU/存储/通算 共用同一 NetworkObject | 各有独立接口模型（不同网卡数/类型/速率） |
| 连接表输出 | A/Z端设备名+端口，无机柜位置 | 含机柜号+U位编号或范围，可指导布线 |
| 拓扑图 | 只读可视化，不可编辑 | 可拖拽调整布局、调整接线、保存 |
| 上架图 | 基础 42U 色块，手动分配 | 功率评估、导入机柜矩阵、AI辅助布局 |
| UI布局 | 所有功能挤在侧边栏（280px），主工作区空置 | 内容型功能（机柜/拓扑/输出/设备库）在全尺寸工作区页签中展示 |
| 设备筛选 | 仅搜索框，无分类/厂商筛选 | 按分类/厂商/设备类型多维度组合筛选 |

---

## 三、V2.1 核心架构：项目级设备参数系统

### 3.1 设计理念

每个项目是一个完整的智算中心方案，包含：
- **网络拓扑参数**：选择包含哪些网络、每类网络选择什么设备
- **设备参数卡片**：每类设备独立配置厂商/型号/功率/接口模型
- **机房环境参数**：机柜类型(42U/49U)、单柜功率上限、可用机柜列表

### 3.2 项目配置文件 (project_config.json) — 引用设备库

项目通过 `device_refs` 引用设备库中的设备，而非内嵌完整设备参数。引用支持本地覆盖（override），实现"库中取基准，项目调差异"。

```
project_config.json
├── meta                          # 项目元数据
│   ├── name, description, version
│   └── created_at, updated_at
├── networks                      # 网络包含选择
│   ├── param_network: bool
│   ├── storage_network: bool
│   ├── biz_network: bool
│   └── oob_network: bool
├── topology                      # 拓扑计算参数
│   ├── downlink_mode: full|custom
│   ├── num_gpu_servers: int
│   ├── num_storage_servers: int
│   ├── num_compute_servers: int
│   └── ... (各网络下行口数、速率等)
├── device_refs                   # 设备库引用 + 按项目微调
│   ├── gpu_server: {
│   │     library_id: "nvidia_dgx_h100",
│   │     overrides: { power_watts: 10200, ... }   # 可选：覆盖库中参数
│   │   }
│   ├── storage_server:           # 存储服务器引用
│   ├── compute_server:           # 通算服务器引用
│   ├── param_leaf_switch:        # 参数网 Leaf 引用
│   ├── param_spine_switch:       # 参数网 Spine 引用
│   ├── param_core_switch:        # 参数网 Core 引用
│   ├── storage_leaf_switch:      # 存储网 Leaf 引用
│   ├── storage_spine_switch:     # 存储网 Spine 引用
│   ├── oob_access_switch:        # OOB 接入引用
│   ├── oob_agg_switch:           # OOB 汇聚引用
│   ├── biz_access_switch:        # 业务网 接入引用
│   └── biz_agg_switch:           # 业务网 汇聚引用
├── rack_config                   # 机柜配置
├── rack_layout                   # 机柜布局数据
└── topology_visual               # 拓扑可视化数据
```

### 3.3 设备参数卡片 (DeviceProfile) 数据结构

```typescript
interface DeviceProfile {
  // --- 基础信息 ---
  vendor: string                    // 厂商: "NVIDIA" | "H3C" | "Huawei" | "Arista" | ...
  model: string                     // 型号: "DGX-H100" | "5500-48Y8C" | "CE9860-4C-EI" | ...
  description: string               // 描述

  // --- 物理参数 ---
  power_watts: number               // 额定功率(W)  例如 GPU服务器: 10000, 交换机: 600
  weight_kg: number                 // 重量(kg)
  u_height: number                  // U位高度       例如 GPU服务器8U, 交换机1U/2U
  depth_mm: number                  // 深度(mm)     用于机柜匹配
  cooling: 'air' | 'liquid'        // 散热方式

  // --- 命名规则 ---
  name_prefix: string               // 设备名前缀   例如 "GPU-Server", "Param-Spine"

  // --- 接口模型 (仅服务器) ---
  interface_models?: InterfaceModel[]

  // --- 端口配置 (仅交换机) ---
  port_count: number                // 总端口数
  port_speed: string                // 端口速率     "400G" | "200G" | "100G" | "25G" | "10G" | "1G"
  port_type: string                 // 端口类型     "QSFP-DD" | "QSFP56" | "QSFP28" | "SFP28" | "SFP+" | "RJ45"
  downlink_prefix: string           // 下行端口前缀 例如 "Eth1/0/"
  uplink_prefix: string             // 上行端口前缀 例如 "Eth1/0/"
}
```

### 3.4 接口模型 (InterfaceModel) 数据结构

```typescript
interface InterfaceModel {
  network_type: 'param' | 'storage' | 'biz' | 'oob'   // 归属网络
  port_count: number                // 接口数量       例如 GPU: 8×参数网卡
  port_speed: string                // 接口速率       "400G" | "200G" | "100G" | "25G" | "10G" | "1G"
  port_type: string                 // 接口类型       "QSFP56" | "SFP28" | "RJ45"
  cable_type: string                // 连接线缆       "MPO-16" | "AOC" | "Cat6A" | "单模光纤" | "DAC"
  downlink_prefix: string           // 下行端口编号前缀  "Eth"
  uplink_prefix: string             // 上行端口编号前缀  "Eth"
  port_numbering: 'sequential' | 'grouped'   // 编号方式
}
```

### 3.5 完整设备参数卡片示例

**GPU服务器 (NVIDIA DGX-H100):**
```json
{
  "vendor": "NVIDIA",
  "model": "DGX-H100",
  "power_watts": 10200,
  "u_height": 8,
  "depth_mm": 900,
  "cooling": "air",
  "name_prefix": "GPU-DGXH100",
  "interface_models": [
    {
      "network_type": "param",
      "port_count": 8,
      "port_speed": "400G",
      "port_type": "QSFP56",
      "cable_type": "MPO-16",
      "downlink_prefix": "NIC",
      "uplink_prefix": "NIC",
      "port_numbering": "sequential"
    },
    {
      "network_type": "storage",
      "port_count": 2,
      "port_speed": "200G",
      "port_type": "QSFP56",
      "cable_type": "AOC",
      "downlink_prefix": "NIC",
      "uplink_prefix": "NIC",
      "port_numbering": "sequential"
    },
    {
      "network_type": "biz",
      "port_count": 1,
      "port_speed": "25G",
      "port_type": "SFP28",
      "cable_type": "光纤",
      "downlink_prefix": "NIC",
      "uplink_prefix": "NIC",
      "port_numbering": "sequential"
    },
    {
      "network_type": "oob",
      "port_count": 1,
      "port_speed": "1G",
      "port_type": "RJ45",
      "cable_type": "Cat6A网线",
      "downlink_prefix": "NIC",
      "uplink_prefix": "NIC",
      "port_numbering": "sequential"
    }
  ]
}
```

**参数网 Leaf 交换机 (H3C 5500-48Y8C):**
```json
{
  "vendor": "H3C",
  "model": "LS-5850-54QS",
  "power_watts": 350,
  "u_height": 1,
  "depth_mm": 460,
  "cooling": "air",
  "name_prefix": "Param-Leaf",
  "port_count": 64,
  "port_speed": "400G",
  "port_type": "QSFP56",
  "downlink_prefix": "Eth1/0/",
  "uplink_prefix": "Eth1/0/"
}
```

### 3.6 设备获取来源

项目的设备参数通过 `device_refs` 引用设备库，而非在项目内重复存储完整参数。设备库的定义详见下一章。

---

## 四、设备类型库 (Device Library)

### 4.1 设计理念

设备类型库是一个**全局共享、独立于项目和模板**的设备参数数据库。它预置了主流厂商经过调研的真实设备参数，项目通过引用（`library_id`）+ 可选覆盖（`overrides`）的方式使用设备。

**核心原则：**
- **库中取基准，项目调差异** — 设备基准参数存在库中，项目只存覆盖值
- **一次调研，全局复用** — 华为 S9850 的参数只需调研录入一次，所有项目均可引用
- **覆盖不污染库** — 项目中的参数覆盖不影响设备库，也不影响其他项目
- **库可迭代升级** — 设备库更新后，项目可选择同步或保持当前版本

### 4.2 设备库数据模型

```typescript
// 设备库索引
interface DeviceLibrary {
  version: string                          // 库版本号
  updated_at: string
  categories: DeviceCategory[]
}

interface DeviceCategory {
  id: string                               // "gpu_servers" | "storage_servers_all_flash" | ...
  name: string                             // "GPU服务器" | "全闪存储服务器" | ...
  description: string
  devices: LibraryDevice[]                 // 该分类下的所有设备
}

// 库中的设备条目
interface LibraryDevice {
  id: string                               // 唯一标识：厂商_型号 如 "nvidia_dgx_h100"
  vendor: string                           // 厂商
  model: string                            // 型号
  category: string                         // 分类ID
  description: string                      // 描述

  // 物理参数
  power_watts: number                      // 额定功率(W)
  weight_kg: number                        // 重量(kg)
  u_height: number                         // U位高度
  depth_mm: number                         // 深度(mm)
  cooling: 'air' | 'liquid'               // 散热方式

  // 命名规则
  name_prefix: string                      // 设备名前缀

  // 接口模型 (服务器) 或 端口配置 (交换机)
  interface_models?: InterfaceModel[]      // 仅服务器
  port_count?: number                      // 仅交换机：总端口数
  port_speed?: string                      // 仅交换机：端口速率
  port_type?: string                       // 仅交换机：端口类型
  downlink_prefix?: string                 // 仅交换机：下行端口前缀
  uplink_prefix?: string                   // 仅交换机：上行端口前缀

  // 适用场景标签
  tags: string[]                           // 如 ["400G", "RoCEv2", "DCB"]
  applicable_networks: NetworkType[]       // 适用的网络类型

  // 元数据
  source: 'builtin' | 'custom'            // 来源：内置 / 用户自定义
  verified: boolean                        // 参数是否经过验证
  datasheet_url?: string                   // 规格书链接
  added_at: string
  updated_at: string
}

// 项目对库设备的引用
interface DeviceRef {
  library_id: string                       // 指向 LibraryDevice.id
  overrides?: Partial<LibraryDevice>       // 项目中覆盖的字段（仅存差异）
  locked_version?: string                  // 锁定库版本（可选）
}
```

### 4.3 设备库分类体系

```
device_library/
├── library_index.json                     # 库索引
├── gpu_servers/                           # GPU服务器
│   ├── nvidia_dgx_h100.json              # NVIDIA DGX-H100
│   ├── nvidia_dgx_b200.json              # NVIDIA DGX-B200
│   ├── nvidia_dgx_gb300_nvl72.json       # NVIDIA DGX-GB300 (NVL72)
│   ├── huawei_atlas_900.json             # 华为 Atlas 900 PoD
│   ├── h3c_r5500_g7.json                 # H3C UniServer R5500 G7
│   ├── inspur_nf5688m7.json              # 浪潮 NF5688M7
│   └── generic_4u_gpu.json               # 通用GPU服务器
├── storage_servers/                       # 存储服务器
│   ├── all_flash/                         # 全闪存储
│   │   ├── huawei_oceanstor_dorado_8000.json
│   │   ├── huawei_oceanstor_dorado_6000.json
│   │   ├── h3c_unistor_cf22000.json
│   │   ├── inspur_as13000.json
│   │   └── generic_all_flash.json
│   └── hybrid_flash/                      # 混闪存储
│       ├── huawei_oceanstor_5310.json
│       ├── huawei_oceanstor_5510.json
│       ├── h3c_unistor_x10000.json
│       ├── inspur_as5500.json
│       └── generic_hybrid_flash.json
├── compute_servers/                       # 通算服务器
│   ├── huawei_2288h_v7.json
│   ├── h3c_r4900_g7.json
│   ├── inspur_nf5280m7.json
│   ├── ruijie_rg_s6250.json
│   └── generic_2u_compute.json
├── switches/
│   ├── param/                             # 参数网络交换机
│   │   ├── nvidia_sn5600_64_400g.json    # NVIDIA Spectrum-4 SN5600
│   │   ├── nvidia_sn5400_64_200g.json    # NVIDIA Spectrum-X SN5400
│   │   ├── huawei_ce9860_4c_ei.json      # 华为 CE9860-4C-EI
│   │   ├── huawei_ce8850_64cq_ei.json    # 华为 CE8850-64CQ-EI
│   │   ├── h3c_s9850_64h.json            # H3C S9850-64H
│   │   ├── h3c_s9820_8c.json             # H3C S9820-8C (Spine)
│   │   ├── ruijie_rg_s6980_64qc.json     # 锐捷 RG-S6980-64QC
│   │   └── generic_64p_400g.json         # 通用参数交换机
│   ├── storage/                           # 存储网络交换机
│   │   ├── h3c_s6850_56hf.json           # H3C S6850-56HF
│   │   ├── huawei_ce6860_48s6cq.json     # 华为 CE6860-48S6CQ-EI
│   │   ├── nvidia_sn4600c.json           # NVIDIA SN4600C
│   │   ├── ruijie_rg_s6510_48vs8cq.json  # 锐捷 RG-S6510
│   │   └── generic_48p_200g.json         # 通用存储交换机
│   ├── biz/                               # 业务/带内管理 交换机
│   │   ├── h3c_s5560x_54s_ei.json        # H3C S5560X-54S-EI
│   │   ├── huawei_s5735_l48p4x_a.json    # 华为 S5735-L48P4X-A
│   │   ├── ruijie_rg_s5310_48gt4xs.json  # 锐捷 RG-S5310-48GT4XS
│   │   └── generic_48p_25g.json          # 通用业务交换机
│   └── oob/                               # 带外管理 交换机
│       ├── h3c_s5130s_52p_ei.json        # H3C S5130S-52P-EI
│       ├── huawei_s5735_l48t4x_a.json    # 华为 S5735-L48T4X-A
│       ├── ruijie_rg_s2928g.json         # 锐捷 RG-S2928G
│       └── generic_48p_1g.json           # 通用OOB交换机
└── custom/                                # 用户自定义设备
    └── ...
```

### 4.4 内置设备库清单（按厂商调研）

#### 4.4.1 GPU 服务器 (7款)

| 条目ID | 厂商 | 型号 | 功率(W) | U高 | 参数网卡 | 存储网卡 | 散热 |
|--------|------|------|---------|-----|---------|---------|------|
| `nvidia_dgx_h100` | NVIDIA | DGX-H100 | 10,200 | 8U | 8×400G QSFP56 | 2×200G QSFP56 | 风冷 |
| `nvidia_dgx_b200` | NVIDIA | DGX-B200 | 14,400 | 10U | 8×800G QSFP-DD | 2×400G QSFP-DD | 液冷 |
| `nvidia_dgx_gb300_nvl72` | NVIDIA | DGX-GB300 NVL72 | 16,000 | 12U | 8×800G QSFP-DD | 4×800G QSFP-DD | 液冷 |
| `huawei_atlas_900` | 华为 | Atlas 900 PoD | 8,000 | 8U | 8×400G QSFP56 | 2×200G QSFP56 | 风冷/液冷 |
| `h3c_r5500_g7` | H3C | UniServer R5500 G7 | 9,500 | 6U | 8×400G QSFP56 | 2×200G QSFP56 | 风冷 |
| `inspur_nf5688m7` | 浪潮 | NF5688M7 | 9,600 | 8U | 8×400G QSFP56 | 2×200G QSFP56 | 液冷 |
| `generic_4u_gpu` | 通用 | 4U-GPU-Server | 6,000 | 4U | 8×200G QSFP56 | 1×200G QSFP56 | 风冷 |

#### 4.4.2 存储服务器 — 全闪 (5款)

| 条目ID | 厂商 | 型号 | 功率(W) | U高 | 类型 |
|--------|------|------|---------|-----|------|
| `huawei_oceanstor_dorado_8000` | 华为 | OceanStor Dorado 8000 V6 | 2,400 | 4U | 全闪 NVMe |
| `huawei_oceanstor_dorado_6000` | 华为 | OceanStor Dorado 6000 V6 | 1,800 | 4U | 全闪 NVMe |
| `h3c_unistor_cf22000` | H3C | UniStor CF22000 | 2,200 | 4U | 全闪 NVMe |
| `inspur_as13000` | 浪潮 | AS13000G5 | 1,500 | 4U | 全闪 |
| `generic_all_flash` | 通用 | 4U-AllFlash | 1,800 | 4U | 全闪 |

#### 4.4.3 存储服务器 — 混闪 (4款)

| 条目ID | 厂商 | 型号 | 功率(W) | U高 | 类型 |
|--------|------|------|---------|-----|------|
| `huawei_oceanstor_5310` | 华为 | OceanStor 5310 V6 | 1,200 | 2U | 混闪 |
| `huawei_oceanstor_5510` | 华为 | OceanStor 5510 V6 | 1,600 | 4U | 混闪 |
| `h3c_unistor_x10000` | H3C | UniStor X10000 G5 | 1,000 | 2U | 混闪 |
| `inspur_as5500` | 浪潮 | AS5500G5 | 1,100 | 2U | 混闪 |

#### 4.4.4 通算服务器 (4款)

| 条目ID | 厂商 | 型号 | 功率(W) | U高 |
|--------|------|------|---------|-----|
| `huawei_2288h_v7` | 华为 | FusionServer 2288H V7 | 800 | 2U |
| `h3c_r4900_g7` | H3C | UniServer R4900 G7 | 900 | 2U |
| `inspur_nf5280m7` | 浪潮 | NF5280M7 | 800 | 2U |
| `ruijie_rg_s6250` | 锐捷 | RG-S6250 | 750 | 2U |

#### 4.4.5 参数网络交换机 (8款)

| 条目ID | 厂商 | 型号 | 端口 | 速率 | 功率(W) | U高 |
|--------|------|------|------|------|---------|-----|
| `nvidia_sn5600_64_400g` | NVIDIA | Spectrum-4 SN5600 | 64 | 400G QSFP56 | 600 | 1U |
| `nvidia_sn5400_64_200g` | NVIDIA | Spectrum-X SN5400 | 64 | 200G QSFP56 | 450 | 1U |
| `huawei_ce9860_4c_ei` | 华为 | CE9860-4C-EI | 4+32 | 400G QSFP56 | 1,200 | 4U |
| `huawei_ce8850_64cq_ei` | 华为 | CE8850-64CQ-EI | 64 | 400G QSFP56 | 800 | 2U |
| `h3c_s9850_64h` | H3C | S9850-64H | 64 | 400G QSFP56 | 550 | 1U |
| `h3c_s9820_8c` | H3C | S9820-8C | 8 | 400G QSFP56 | 300 | 2U |
| `ruijie_rg_s6980_64qc` | 锐捷 | RG-S6980-64QC | 64 | 400G QSFP56 | 500 | 1U |
| `generic_64p_400g` | 通用 | 64P-400G-Switch | 64 | 400G QSFP56 | 550 | 1U |

#### 4.4.6 存储网络交换机 (4款)

| 条目ID | 厂商 | 型号 | 端口 | 速率 | 功率(W) |
|--------|------|------|------|------|---------|
| `h3c_s6850_56hf` | H3C | S6850-56HF | 48×25G + 8×100G | 25G/100G | 350 |
| `huawei_ce6860_48s6cq` | 华为 | CE6860-48S6CQ-EI | 48×25G + 6×100G | 25G/100G | 400 |
| `nvidia_sn4600c` | NVIDIA | SN4600C | 64 | 100G QSFP28 | 350 |
| `ruijie_rg_s6510_48vs8cq` | 锐捷 | RG-S6510-48VS8CQ | 48×25G + 8×100G | 25G/100G | 350 |

#### 4.4.7 业务/带内管理交换机 (4款)

| 条目ID | 厂商 | 型号 | 端口 | 速率 | 功率(W) |
|--------|------|------|------|------|---------|
| `h3c_s5560x_54s_ei` | H3C | S5560X-54S-EI | 48×1G/10G + 4×25G + 2×40G | 1G/10G/25G/40G | 150 |
| `huawei_s5735_l48p4x_a` | 华为 | S5735-L48P4X-A | 48×1G + 4×10G SFP+ | 1G/10G | 120 |
| `ruijie_rg_s5310_48gt4xs` | 锐捷 | RG-S5310-48GT4XS | 48×1G + 4×10G SFP+ | 1G/10G | 100 |
| `generic_48p_25g` | 通用 | 48P-25G-Switch | 48×25G + 8×100G | 25G/100G | 250 |

#### 4.4.8 带外管理交换机 (4款)

| 条目ID | 厂商 | 型号 | 端口 | 速率 | 功率(W) |
|--------|------|------|------|------|---------|
| `h3c_s5130s_52p_ei` | H3C | S5130S-52P-EI | 48×1G + 4×10G SFP+ | 1G/10G | 60 |
| `huawei_s5735_l48t4x_a` | 华为 | S5735-L48T4X-A | 48×1G + 4×10G SFP+ | 1G/10G | 55 |
| `ruijie_rg_s2928g` | 锐捷 | RG-S2928G-E | 24×1G + 4×10G SFP+ | 1G/10G | 45 |
| `generic_48p_1g` | 通用 | 48P-1G-Switch | 48×1G + 4×10G | 1G/10G | 60 |

**内置设备总计：40款**

#### 4.4.9 NVIDIA InfiniBand 专用交换机 (6款) — V1.1 新增

| 条目ID | 厂商 | 型号 | 端口 | 速率 | 功率(W) | U高 | 管理口 |
|--------|------|------|------|------|---------|-----|--------|
| `nvidia_mqm9700_64_400g_ib` | NVIDIA | MQM9700-NS2F (Quantum-2) | 64 | NDR 400G QSFP56 | 750 | 1U | 有 |
| `nvidia_mqm9790_64_400g_ib` | NVIDIA | MQM9790-NS2F (Quantum-2) | 64 | NDR 400G QSFP56 | 700 | 1U | 无 |
| `nvidia_mqm8700_40_200g_ib` | NVIDIA | MQM8700 (Quantum HDR) | 40 | HDR 200G QSFP56 | 550 | 1U | 有 |
| `nvidia_mqm8790_40_200g_ib` | NVIDIA | MQM8790 (Quantum HDR) | 40 | HDR 200G QSFP56 | 500 | 1U | 无 |
| `nvidia_q3200_72_800g_ib` | NVIDIA | Q3200 (Quantum-3) | 72 | NDR 800G OSFP | 1200 | 1U | 有 |
| `nvidia_q3400_144_800g_ib` | NVIDIA | Q3400 (Quantum-3) | 144 | NDR 800G OSFP | 2200 | 2U | 有 |

#### 4.4.10 参数网络 RoCE 交换机 (V1.1 新增型号)

| 条目ID | 厂商 | 型号 | 端口 | 速率 | 功率(W) | U高 | 适用层级 |
|--------|------|------|------|------|---------|-----|---------|
| `h3c_s9820_64h` | H3C | S9820-64H | 64 | 400G QSFP56 | 600 | 2U | Spine/Core |
| `huawei_ce8860_4c_ei` | 华为 | CE8860-4C-EI | 128(满配) | 400G QSFP56 | 1500 | 4U | Spine/Core |
| `ruijie_rg_s6990_64oc2xs` | 锐捷 | RG-S6990-64OC2XS | 64 | 800G OSFP | 950 | 2U | Leaf |
| `ruijie_rg_s9910_128oc2vs` | 锐捷 | RG-S9910-128OC2VS | 128 | 800G OSFP | 1600 | 3U | Spine |

#### 4.4.11 业务/带内管理网络交换机 (V1.1 新增型号)

| 条目ID | 厂商 | 型号 | 端口 | 速率 | 功率(W) | 适用层级 |
|--------|------|------|------|------|---------|---------|
| `h3c_s6520x_54qc_ei` | H3C | S6520X-54QC-EI | 48×25G + 6×100G | 25G/100G | 200 | 汇聚 |
| `huawei_s6730_h48x6c` | 华为 | S6730-H48X6C | 48×10G + 6×100G | 10G/100G | 180 | 汇聚 |
| `ruijie_rg_s6120_48xs8cq` | 锐捷 | RG-S6120-48XS8CQ | 48×25G + 8×100G | 25G/100G | 160 | 汇聚 |

#### 4.4.12 带外管理网络交换机 (V1.1 新增型号)

| 条目ID | 厂商 | 型号 | 端口 | 速率 | 功率(W) | 适用层级 |
|--------|------|------|------|------|---------|---------|
| `h3c_s5120v3_52p_ei` | H3C | S5120V3-52P-EI | 48×1G + 4×10G | 1G/10G | 70 | 汇聚 |
| `huawei_s5732_h48s6q` | 华为 | S5732-H48S6Q | 48×1G + 6×40G | 1G/40G | 80 | 汇聚 |
| `ruijie_rg_s5750c_48gt4xs_h` | 锐捷 | RG-S5750C-48GT4XS-H | 48×1G + 4×10G | 1G/10G | 60 | 汇聚 |

**V1.1 设备库总计：56款**（原40款 + 新增16款交换机）

### 4.5 设备库 UI 功能

| 功能 | 说明 | 优先级 |
|------|------|--------|
| 设备库浏览面板 | ActivityBar 新增「设备库」入口，分类浏览所有设备 | P0 |
| 搜索与筛选 | 按厂商、类型、速率、端口数、功率范围筛选 | P1 |
| 设备详情查看 | 点击查看完整参数卡片（只读），含规格书链接 | P0 |
| 设备对比 | 选择 2-3 款设备并排对比参数 | P1 |
| **手工添加服务器** | 表单填写 GPU/存储/通算 服务器的完整参数（厂商/型号/功率/U高/接口模型） | P0 |
| **手工添加交换机** | 表单填写参数网/存储/业务/OOB 交换机的完整参数（厂商/型号/端口数/速率/端口前缀） | P0 |
| **编辑设备参数** | 修改自定义设备的任意参数；内置设备可通过"复制到自定义"后编辑 | P0 |
| 删除自定义设备 | 删除用户自定义设备（内置设备不可删除） | P1 |
| 复制到自定义 | 以内置设备为基础创建自定义变体 | P2 |
| **批量导入设备** | 从 CSV/Excel 批量导入服务器或交换机参数，自动校验格式并分类入库 | P0 |
| **导出设备库** | 将设备库中选定设备导出为 CSV/Excel/JSON，便于分享和备份 | P1 |
| 库版本检查 | 应用启动时检查设备库是否有更新 | P2 |

### 4.5.1 手工添加/编辑设备流程

```
设备库面板 → [添加设备] 按钮
  ├── 选择设备类型：GPU服务器 / 全闪存储 / 混闪存储 / 通算服务器 / 参数网交换机 / 存储网交换机 / 业务网交换机 / OOB交换机
  ├── 显示对应类型的参数表单
  │   ├── 服务器类型表单：厂商/型号/功率/U高/深度/散热/名称前缀 + 接口模型表格
  │   │   └── 接口模型表格：按网络类型逐行配置端口数/速率/类型/线缆/编号前缀
  │   └── 交换机类型表单：厂商/型号/功率/U高/深度/端口数/端口速率/端口类型/下行前缀/上行前缀
  ├── 填写完成 → 校验 → 保存到 `custom/` 目录
  └── 自动生成 library_id（厂商_型号 格式，自动去重）

编辑设备 → 点击设备 → [编辑] 按钮
  ├── 自定义设备：直接在原表单上修改 → 保存
  └── 内置设备：自动触发"复制到自定义" → 在新副本上修改
```

### 4.5.2 批量导入/导出格式

**导入 CSV/Excel 格式（服务器）：**
```
设备类型,厂商,型号,功率(W),U高,深度(mm),散热,名称前缀,参数网卡数,参数网卡速率,参数网卡类型,参数网卡线缆,存储网卡数,存储网卡速率,存储网卡类型,存储网卡线缆,业务网卡数,业务网卡速率,业务网卡类型,业务网卡线缆,OOB网卡数,OOB网卡速率,OOB网卡类型,OOB网卡线缆
GPU服务器,NVIDIA,DGX-H100,10200,8,900,风冷,GPU-DGXH100,8,400G,QSFP56,MPO-16,2,200G,QSFP56,AOC,1,25G,SFP28,光纤,1,1G,RJ45,Cat6A
```

**导入 CSV/Excel 格式（交换机）：**
```
设备类型,厂商,型号,功率(W),U高,深度(mm),散热,名称前缀,端口数,端口速率,端口类型,下行前缀,上行前缀,适用网络
参数网交换机,NVIDIA,SN5600,600,1,500,风冷,Param-Leaf,64,400G,QSFP56,Eth1/0/,Eth1/0/,param
存储网交换机,H3C,S6850-56HF,350,1,460,风冷,Stor-Leaf,56,25G/100G,SFP28/QSFP28,Eth1/0/,Eth1/0/,storage
```

**导出格式：**
- 支持选中单条/多条设备导出为 JSON（完整 DeviceProfile）
- 支持按分类批量导出为 Excel（带格式化表头）
- 支持全库导出为 ZIP 包（含目录结构和所有 JSON）

### 4.6 项目中对设备库的使用流程

```
新建项目向导 Step3 → 打开设备选择器
  ├── 浏览设备库分类
  ├── 搜索/筛选目标设备
  ├── 选中设备 → 预览参数卡片
  ├── 确认选择 → 记录 library_id
  └── [可选] 修改参数 → 存入 device_refs.overrides

设计面板 → 查看/调整设备选型
  ├── 点击设备名称 → 打开选型对话框
  ├── 重新从设备库选择
  └── overrides 临时调整参数 → 实时更新

Python 引擎 →
  1. 读取 project_config.json
  2. 根据 device_refs 从设备库加载完整 DeviceProfile
  3. 应用 overrides 覆盖
  4. 用最终参数生成拓扑
```

### 4.7 设备库数据流

```
template/device_library/  (内置设备 JSON)
         │
         ▼
   DeviceLibraryStore (Zustand + IPC)
         │
         ├── 设备库浏览面板 (DeviceLibraryPanel)
         │     └── 搜索、筛选、对比、添加自定义
         │
         ├── 新建项目向导 Step3 (DevicePicker)
         │     └── 选择设备 → device_refs
         │
         ├── 设计面板 (DesignPanel)
         │     └── 查看/更换选型 → 更新 device_refs
         │
         └── Python 引擎
               └── 加载 DeviceProfile + overrides → 生成拓扑
```

---

## 五、机柜系统增强

### 5.1 机柜类型

```
RackType:
├── 42U: 标准机柜，高度 2000mm，深度 1000/1100/1200mm
└── 49U: 高柜，高度 2200mm，深度 1100/1200mm
```

### 4.2 机柜参数

```typescript
interface RackConfig {
  rack_type: '42U' | '49U'
  rack_power_limit_w: number      // 单柜功率上限，默认 42U: 8000W, 49U: 12000W
  rack_depth_mm: number           // 机柜深度
  rack_name_prefix: string        // 机柜命名前缀，默认 "A"
  rack_start_number: number       // 起始编号，默认 1
}
```

### 4.3 功率评估公式

```
单柜已用功率 = Σ(柜内设备功率)
单柜功率使用率 = 已用功率 / 功率上限 × 100%

自动评估:
  - 按功率上限推荐每柜最大设备数
  - 按U位上限推荐每柜最大设备数
  - 取 min(功率上限设备数, U位上限设备数) 作为实际推荐
  - 功率超标标红警告
```

### 4.4 导入可用机柜

用户可以导入一个 Excel/CSV 文件描述机房已有机柜列表：

```csv
机柜编号, 机柜名称, 类型, U数, 功率上限(W), 已用U, 可用U, 位置, 备注
A01, A01, GPU柜, 49U, 12000, 0, 49, 1F-A区-1排-1号,
A02, A02, GPU柜, 49U, 12000, 0, 49, 1F-A区-1排-2号,
B01, B01, 存储柜, 42U, 8000, 0, 42, 1F-B区-1排-1号,
C01, C01, 网络柜, 42U, 6000, 0, 42, 1F-C区-1排-1号, 放置Leaf/Spine
D01, D01, 通算柜, 42U, 8000, 0, 42, 1F-D区-1排-1号,
E01, E01, 安全柜, 42U, 6000, 0, 42, 1F-E区-1排-1号, 防火墙等
```

导入后，系统可以：
- 在机柜列表中使用该编号和位置
- 按设备类型自动推荐分配到对应类型机柜
- 可视化总览机柜矩阵

### 5.5 机柜类型分类（用于导入/自动分配）

```
机柜类型 enum:
  - gpu_rack       GPU服务器柜
  - storage_rack   存储服务器柜
  - network_rack   网络设备柜（交换机）
  - compute_rack   通算服务器柜
  - security_rack  安全设备柜（防火墙/IPS等）
  - mixed_rack     混合柜
```

---

## 六、新建项目向导

### 6.1 向导流程

```
步骤1: 基本信息
  ├── 项目名称
  ├── 项目描述
  └── 项目位置

步骤2: 网络选择
  ├── ☑ 参数网络 (算力互联)      [默认开启]
  ├── ☑ 存储网络                [默认开启]
  ├── ☐ 业务/带内管理 网络       [默认关闭]
  └── ☐ 带外管理 OOB 网络        [默认开启]

步骤3: 设备选择与参数确认
  对每个选中的网络类型:
  ├── 服务器
  │   ├── GPU服务器: [从模板库选择] → 查看/修改参数卡片
  │   ├── 存储服务器: [从模板库选择] → 查看/修改参数卡片
  │   └── 通算服务器: [从模板库选择] → 查看/修改参数卡片
  ├── 数量配置
  │   ├── GPU服务器数量: [100]
  │   ├── 存储服务器数量: [14]
  │   └── 通算服务器数量: [20]
  └── 交换机
      ├── 参数网Leaf: [从模板库选择]
      ├── 参数网Spine: [从模板库选择]
      ├── OOB接入: [从模板库选择]
      └── ...

步骤4: 机柜环境
  ├── 机柜类型: [42U] [49U]
  ├── 单柜功率上限: [8000W / 12000W]
  ├── □ 导入可用机柜列表 (可选)
  └── 机柜命名规则: [A] [01] 从 [1] 开始

步骤5: 汇总确认
  ├── 网络拓扑参数预览
  ├── 预计设备总数
  ├── 预计机柜数量
  └── [确认创建] [返回修改]
```

### 5.2 从模板创建

选择内置模板后同样进入向导，但参数已预填充：
- H100-100台模板 → 自动选择 DGX-H100 设备卡 + 默认交换机
- 空项目模板 → 从步骤1开始全部手动配置

### 6.3 IB/RoCE 协议选择（V1.1 新增）

向导步骤2中，参数网络增加了 **IB / RoCEv2** 协议选择：

```
┌─ 参数网络 ───────────────────────────────────────────── ☑ ─┐
│ 协议类型:  [ InfiniBand (IB) ]  [ RoCEv2 ]                 │
│ IB 优先推荐 NVIDIA 交换机                                    │
└─────────────────────────────────────────────────────────────┘
```

**智能默认选型规则：**
| 协议 | Leaf 交换机 | Spine 交换机 | Core 交换机 |
|------|-----------|------------|------------|
| IB | NVIDIA MQM9700 (64×400G) | NVIDIA Q3200 (72×800G) | NVIDIA Q3400 (144×800G) |
| RoCE | H3C S9850-64H (64×400G) | H3C S9820-64H (64×400G) | H3C S9820-8C (8×400G) |

**行为**：切换 IB/RoCE 协议时，如果当前选中的是默认交换机，自动切换到新协议的默认交换机；如果用户已手动更换过设备，保留用户选择。

### 6.4 存储服务器数量拆分（V1.1 新增）

将原来单一的"存储服务器数量"拆分为两类独立定制：

| 存储类型 | U位 | 默认数量 | 说明 |
|---------|------|---------|------|
| 全闪存储 (2U) | 2U | 8 台 | NVMe 全闪存，高性能低延迟 |
| 混闪存储 (4U) | 4U | 6 台 | SSD + HDD 混闪，大容量 |

对应的 `device_refs` key 也拆分为：
- `all_flash_storage_server` — 全闪存储服务器
- `hybrid_flash_storage_server` — 混闪存储服务器

**向后兼容**：配置文件中的 `num_storage_servers` 旧字段仍被 Python 引擎和 IPC 层识别，当 `num_all_flash_storage` 和 `num_hybrid_flash_storage` 存在时优先使用新字段。

---

## 六、拓扑图动态编辑

### 6.1 功能描述

在当前只读拓扑图基础上增加交互编辑能力：

| 功能 | 说明 |
|------|------|
| 拖拽节点 | 拖动任意设备节点到新位置 |
| 批量选中 | Ctrl+点击多选，框选 |
| 对齐 | 选中多个节点 → 水平/垂直对齐 |
| 连线调整 | 调整边的弯曲度(curveness)和路径 |
| 撤销/重做 | Ctrl+Z / Ctrl+Shift+Z |
| 保存布局 | 节点位置和连线调整保存到 `topology_visual.json` |
| 加载布局 | 打开项目时恢复上次保存的拓扑图布局 |
| 导出PNG | 导出当前调整后的拓扑图 |

### 7.2 数据模型

```typescript
interface TopologyVisualData {
  node_positions: Record<string, { x: number; y: number }>  // 设备ID → 坐标
  edge_adjustments: Record<string, { curveness: number }>   // 边ID → 弯曲度
  viewport: { zoom: number; centerX: number; centerY: number }
}
```

---

## 七、连接关系表增强

### 7.1 输出列增强

V2.0 连接表输出列：
```
podid | 服务器分组 | A端设备 | A端接口 | A端模块 | Z端设备 | Z端接口 | Z端模块 | 线缆 | 描述
```

V2.1 连接表输出列（增加布线信息）：
```
podid | A端分组 | A端设备 | A端机柜 | A端U位 | A端接口 | A端模块 |
Z端设备 | Z端机柜 | Z端U位 | Z端接口 | Z端模块 | 线缆类型 | 线缆长度(预估) | 描述
```

### 8.2 接口命名改造

V2.0 硬编码命名：
- 服务器端：`参数网卡1` / `存储网卡1` / `OOB口1` / `业务口1`
- 交换机端：`端口1` / `端口33`

V2.1 可配置命名（基于 DeviceProfile.interface_models）：
- 服务器端：`{downlink_prefix}1/{0}/1` → 如 `Eth1/0/1` 或 `NIC1`
- 交换机端下联：`{downlink_prefix}{port_num}` → 如 `Eth1/0/1`
- 交换机端上联：`{uplink_prefix}{port_num}` → 如 `Eth1/0/33`

### 7.3 布线表附加输出

新增独立的**布线指导表（Cabling Guide）**输出：
```
源机柜 | 源设备 | 源端口 | 目标机柜 | 目标设备 | 目标端口 | 线缆类型 | 线缆编号 | 预估长度 | 备注
```

---

## 九、上架图增强

### 9.1 视图增强

- 每个设备格显示：设备名、型号简称、功率(W)
- 底部汇总条：已用U数/U总数，已用功率/功率上限
- 功率超标格子标红
- 支持在 RackPanel 中直接拖拽设备调整U位
- 修改后实时保存到 `rack_layout.json`

### 8.2 上架图导出

导出为标准 Excel 上机表（增强版）：
```
机柜编号 | 机柜位置 | U位(起) | U位(止) | 设备名称 | 设备型号 | 设备类型 | 功率(W) | 厂商 | 备注
```

---

## 十、PRD 功能需求清单

| # | 需求 | 优先级 |
|---|------|--------|
| 1 | **DeviceProfile 系统**：每类设备独立参数卡片（厂商/型号/功率/U高/接口模型/名称前缀） | P0 |
| 2 | **InterfaceModel 系统**：服务器可按网络类型配置接口个数/类型/速率/编号前缀 | P0 |
| 3 | **网络包含选择**：参数/存储/业务/OOB 四网独立开关 | P0 |
| 4 | **设备类型库（全局）**：独立于项目/模板的共享设备参数库，40款内置设备 | P0 |
| 5 | **设备库引用机制**：项目通过 library_id + overrides 引用设备库 | P0 |
| 6 | **设备库浏览面板**：ActivityBar 新增入口，分类浏览/搜索/筛选/查看设备详情 | P0 |
| 7 | **新建项目向导**：5步向导式参数配置，Step3 从设备库选择设备 | P0 |
| 8 | **project_config.json** 替代 network_config.ini，device_refs 引用机制 | P0 |
| 9 | **DesignPanel 改造**：所有参数表单适配 DeviceProfile + 设备库选型 | P0 |
| 10 | **Python 引擎改造**：适配 project_config.json，从设备库加载 DeviceProfile | P0 |
| 11 | **机柜类型扩展**：42U/49U可选，功率上限可配 | P1 |
| 12 | **功率评估**：单柜功率使用率计算与超标告警 | P1 |
| 13 | **连接表增强**：含机柜号、U位编号、可配置端口前缀 | P1 |
| 14 | **布线指导表**：独立的 cabling guide Excel 输出 | P1 |
| 15 | **拓扑图动态编辑**：节点拖拽、连线调整、保存/加载布局 | P1 |
| 16 | **上架图拖拽调整**：RackPanel 中拖拽调整U位并实时保存 | P1 |
| 17 | **上机表增强导出**：含型号/功率/厂商/位置 | P1 |
| 18 | **设备库搜索筛选**：按厂商/类型/速率/端口数/功率范围筛选 | P1 |
| 19 | **设备库对比**：选择2-3款设备并排对比参数 | P1 |
| 20 | **自定义设备管理**：用户在设备库中添加/编辑/删除自定义设备 | P1 |
| 21 | **Workbench 就绪检查增强**：校验设备参数完整性 + 设备库引用有效性 | P1 |
| 22 | **i18n 翻译补全**：新UI的5语言翻译 | P1 |
| 23 | **导入机柜列表**：CSV/Excel 导入可用机柜 | P2 |
| 24 | **AI/人工机柜布局优化**：按设备类型自动建议机柜分配 | P2 |
| 25 | **机柜矩阵总览视图**：机房级别的机柜排列可视化 | P2 |
| 26 | **设备库导入/导出**：CSV/JSON 导入导出设备参数 | P2 |
| 27 | **设备库版本检查**：启动时检查设备库更新 | P2 |
| 28 | **复制到自定义**：以内置设备为基础创建自定义变体 | P2 |

---

## 十、非功能性需求

- **向后兼容**：V2.0 的 network_config.ini 项目可自动迁移到 project_config.json
- **性能**：拓扑生成（1000台设备规模）< 10s
- **状态持久化**：Zustand persist 保存用户编辑的拓扑布局和机柜调整
- **深色主题适配**：新UI组件全面支持 dark mode
- **设备模板可扩展**：支持用户新增/保存自定义设备模板

---

## 十一、测试与验证需求

### 11.1 测试策略总览

| 层级 | 框架 | 覆盖目标 | 当前状态 |
|------|------|---------|---------|
| 前端单元测试 | Vitest | Store 状态管理、组件逻辑、工具函数 | 84 个用例，5 个测试文件 |
| 后端单元测试 | pytest | 数据模型、拓扑算法、设计器、导出器、引擎 | 166 个用例，9 个测试文件 |
| 集成测试 | Vitest + pytest | IPC 通信、前后端联调、配置迁移 | 纳入 unit test |
| E2E 测试 | (待定) | 完整用户流程 | 未开始 |

### 11.2 单元测试覆盖率要求

| 模块 | 最低覆盖率 | 说明 |
|------|----------|------|
| `src/stores/` | ≥ 80% | 所有 Zustand store 的状态变更、异步操作、错误处理 |
| `src/utils/` | ≥ 80% | 工具函数全覆盖 |
| `src/components/` | ≥ 60% | 核心组件渲染和交互逻辑 |
| `backend/models.py` | ≥ 90% | NetworkObject, Connection 所有方法和边界条件 |
| `backend/topology.py` | ≥ 85% | FatTree, AccessAgg 拓扑算法 |
| `backend/designer.py` | ≥ 80% | NetworkDesignerV2 配置加载、对象创建、连接生成 |
| `backend/engine.py` | ≥ 75% | 设计/验证/导出/功率评估全流程 |
| `backend/device_library.py` | ≥ 80% | 设备库加载、解析、引用解析 |
| `backend/exporter.py` | ≥ 80% | Excel 导出、视图生成 |

### 11.3 关键测试场景清单

#### 11.3.1 前端 Store 测试

| 场景 | 优先级 | 状态 |
|------|--------|------|
| DesignStore: 配置更新/重置/INI转换/生成/验证/清除 | P0 | 已完成 |
| ProjectStore: 项目列表/收藏/最近/删除/IPC异常处理 | P0 | 已完成 |
| RackStore: 初始化/42U+49U/设备放置/功率计算/导入导出 | P0 | 已完成 |
| DeviceLibraryStore: 加载/筛选/对比/保存/错误处理 | P0 | 已完成 |
| WizardStore: 步骤导航/数据持久化/回退/确认 | P1 | 待补充 |
| UIStore: 主题切换/侧边栏/面板状态 | P2 | 待补充 |
| ToastStore: 消息队列/自动消失/类型 | P2 | 待补充 |

#### 11.3.2 后端模型与算法测试

| 场景 | 优先级 | 状态 |
|------|--------|------|
| NetworkObject: 端口分配/上联/下联/Core/耗尽/异常 | P0 | 已完成 |
| Connection: 创建/默认值/机柜字段/部分机柜/U位范围 | P0 | 已完成 |
| FatTree: 层次计算/对象创建/连接生成/3-tier边界 | P0 | 已完成 |
| AccessAgg: 单机/冗余/零服务器/奇数/容量超限 | P0 | 已完成 |
| 拓扑边界条件: 负数/零值/超大值/无效名称/空列表 | P0 | 已完成 |
| 端口计数边界: 奇数口/小端口数/单端口 | P1 | 已完成 |

#### 11.3.3 后端集成测试

| 场景 | 优先级 | 状态 |
|------|--------|------|
| INI配置: 最小/满接/自定义下行/附加服务器/3层 | P0 | 已完成 |
| project_config: 基础/49U/网络开关/满接/缺失文件 | P0 | 已完成 |
| 设计验证: 小规模/大规模 | P0 | 已完成 |
| OOB设计: 启用/禁用 | P0 | 已完成 |
| 业务网设计: 启用 | P0 | 已完成 |
| 设备库: 加载/获取/分类/匹配/解析引用/覆盖 | P0 | 已完成 |
| 配置迁移: INI↔JSON共存/仅INI/默认值/网络开关 | P0 | 已完成 |
| 引擎: 配置获取/设计/验证/导出/功率汇总 | P0 | 已完成 |
| 导出器: 数字提取/排序/视图生成/Excel导出 | P0 | 已完成 |

#### 11.3.4 前端集成测试

| 场景 | 优先级 | 状态 |
|------|--------|------|
| DesignStore ↔ RackStore: 设计生成后初始化机柜/功率计算 | P0 | 已完成 |
| DeviceLibrary ↔ ProjectConfig: 引用解析/覆盖/无效引用/批量 | P0 | 已完成 |
| IPC 通信模拟: 设计生成/导出/项目创建/错误处理 | P0 | 已完成 |
| 错误状态处理: 缺参数/文件不存在/JSON错误/超时/路径遍历 | P0 | 已完成 |
| 配置格式兼容: INI解析/JSON解析/JSON优先 | P0 | 已完成 |
| 拓扑数据验证: 节点完整性/边完整性/功率数据 | P0 | 已完成 |
| 设备库数据完整性: GPU服务器接口/交换机端口/分类 | P0 | 已完成 |

### 11.4 测试环境配置

```json
// vitest.config.ts (已集成到 vite.config.ts)
{
  "environment": "jsdom",
  "globals": true,
  "setupFiles": ["src/test/setup.ts"]
}
```

```ini
# pytest 配置 (pytest.ini / pyproject.toml)
[pytest]
testpaths = tests/backend
python_files = test_*.py
python_classes = Test*
python_functions = test_*
```

### 11.5 自动化测试执行流程

```
开发迭代流程:
  1. 编写/修改代码
  2. 运行 npm run test (前端 84 用例)
  3. 运行 npm run test:backend (后端 166 用例)
  4. 运行 npm run test:all (全量 250 用例)
  5. 全部通过 → 提交代码
  6. CI/CD (GitHub Actions) 自动运行全量测试

CI 流水线:
  - ci.yml: 前端 lint + typecheck + vitest
  - build.yml: 构建 + 打包 + 后端 pytest
```

### 11.6 测试用例编写规范

1. **命名规范**：`test_<模块>_<场景>.py` / `test_<场景>.ts`
2. **测试结构**：Arrange (准备) → Act (执行) → Assert (验证)
3. **边界条件**：每个函数至少覆盖正常值、零值、负值、极大值
4. **错误处理**：每个 IPC 操作至少覆盖成功和失败两种路径
5. **Mock 策略**：前端测试 mock IPC 调用，后端测试使用真实文件系统（tempfile）
6. **隔离性**：每个测试用例独立，不依赖其他用例的执行顺序

### 11.8 前后端一致性检查清单

核心原则：设备库 `categoryPathMap`、IPC 数据格式、拓扑数据结构必须在 Python 和 TypeScript 双端保持一致，否则会导致设备库加载失败、拓扑渲染异常等问题。

#### 11.8.1 设备库路径映射一致性

`library_index.json` 使用扁平分类 ID（如 `storage_servers_all_flash`），但实际目录结构是嵌套的（如 `storage_servers/all_flash/`）。Electron 和 Python 两端都必须使用相同的 `categoryPathMap` 进行映射：

```
categoryPathMap:
  gpu_servers          → gpu_servers
  compute_servers      → compute_servers
  storage_servers_all_flash   → storage_servers/all_flash
  storage_servers_hybrid_flash → storage_servers/hybrid_flash
  switches_param       → switches/param
  switches_storage     → switches/storage
  switches_biz         → switches/biz
  switches_oob         → switches/oob
  custom               → custom
```

**已修复**：Python `device_library.py` 的 `DeviceLibrary.load()` 方法已添加 `category_path_map`，与 Electron `handlers.ts` 的 `loadDeviceLibrary()` 保持一致。

#### 11.8.2 拓扑数据格式一致性

Python `engine.py` 返回的拓扑数据必须包含所有 `TopologyPanel.tsx` 需要的字段：

| 字段 | 节点类型 | 要求 |
|------|---------|------|
| `id` | 所有 | 必填 |
| `type` | 所有 | 必填（server/param_leaf/param_spine/storage_leaf/storage_spine等） |
| `group` | 所有 | 必填 |
| `podid` | 所有 | 必填（交换机节点之前缺失，已修复） |
| `cabinetId` | 服务器 | 可选 |
| `cabinetName` | 服务器 | 可选 |
| `startU` / `endU` | 服务器 | 可选 |
| `powerWatts` | 服务器 | 可选 |
| `uHeight` | 服务器 | 可选 |

**已修复**：`engine.py` 中交换机节点（param_leaves/spines/storage_leaves/spines）已添加 `podid` 字段。

#### 11.8.3 输出文件加载一致性

Excel 输出文件（XLSX）是二进制格式，不能通过 UTF-8 文本读取。Electron 端必须使用 `getFileBinary`（base64 编码）传输，前端 `ExcelPreview.tsx` 解码为 `ArrayBuffer` 后交给 `XLSX.read()`。

**已修复**：
- `handlers.ts` 添加 `project:getFileBinary` IPC 处理器
- `preload.ts` 暴露 `getFileBinary` 方法
- `ExcelPreview.tsx` 使用 `getFileBinary` + `atob` 解码

#### 11.8.4 Excel 多Sheet切换一致性

`ExcelPreview.tsx` 切换Sheet时需从缓存的 `WorkBook` 对象中重新提取数据，不能仅切换状态。

**已修复**：`ExcelPreview.tsx` 将 `XLSX.WorkBook` 存入 `workbook` state，`switchSheet` 函数从 `workbook.Sheets[name]` 重新提取数据。

#### 11.8.5 一致性验证方法

```bash
# 验证 Python 设备库加载
python -c "from backend.device_library import get_device_library; lib = get_device_library(); print(f'Loaded {len(lib.devices)} devices')"

# 验证 TypeScript 类型检查
npx tsc --noEmit

# 验证全量测试
npm run test:all
```

### 11.9 测试用例统计

| 测试文件 | 用例数 | 覆盖模块 |
|---------|--------|---------|
| `src/test/design.store.test.ts` | 11 | DesignStore |
| `src/test/device-library.store.test.ts` | 10 | DeviceLibraryStore |
| `src/test/project.store.test.ts` | 11 | ProjectStore |
| `src/test/rack.store.test.ts` | 27 | RackStore |
| `src/test/integration.test.ts` | 25 | 集成测试 |
| `tests/backend/test_designer_integration.py` | 16 | NetworkDesignerV2 |
| `tests/backend/test_device_library.py` | 15 | DeviceLibrary (含嵌套路径映射) |
| `tests/backend/test_engine.py` | 29 | Engine (含拓扑格式一致性) |
| `tests/backend/test_exporter.py` | 29 | Exporter (含二进制XLSX验证) |
| `tests/backend/test_migration.py` | 5 | 配置迁移 |
| `tests/backend/test_models.py` | 16 | NetworkObject, Connection |
| `tests/backend/test_models_comprehensive.py` | 22 | NetworkObject 边界 |
| `tests/backend/test_topology.py` | 12 | FatTree, AccessAgg |
| `tests/backend/test_topology_comprehensive.py` | 24 | 拓扑边界条件 |
| **总计** | **250** | |

---

## 十二、工作区页签系统 (Workspace Tab System)

### 12.1 问题背景

V2.0 架构中，所有功能面板（机柜规划、拓扑视图、输出结果、设备库）都在侧边栏（默认 280px，最大 500px）内渲染，而主编辑区完全空置。这导致：

- 42U/49U 机柜视图在 320px 宽度内无法清晰展示
- ECharts 拓扑图在大规模场景（500+节点）下完全不可用
- Excel/图片预览在狭窄侧边栏内体验极差
- 设备库列表+详情 50/50 分栏在 280px 内严重拥挤

### 12.2 设计理念

引入 VS Code 风格的**工作区页签系统**，将 ActivityBar 面板分为两类：

| 面板类型 | 面板 | 打开方式 | 说明 |
|---------|------|---------|------|
| **导航/配置型** | Explorer, Design, Settings | 侧边栏 | 文件树导航、表单配置，侧边栏宽度足够 |
| **内容/查看型** | Workbench, Rack, Topology, Output, DeviceLibrary | 工作区页签 | 需要全尺寸渲染的内容，在工作区以页签形式打开 |

### 12.3 页签系统数据结构

```typescript
interface WorkspaceTab {
  id: string                           // 唯一标识 (UUID)
  type: 'workbench' | 'rack' | 'topology' | 'output' | 'deviceLibrary'
  title: string                        // 页签标题
  icon?: string                        // 页签图标
  closable: boolean                    // 是否可关闭（设备库/工作台不可关闭，输出/机柜/拓扑可关闭）
  state?: Record<string, any>          // 页签特定状态
  // 示例: RackTab state = { cabinetId: "cab-1" }
  // 示例: OutputTab state = { fileName: "connections.xlsx", fileType: "xlsx" }
}

interface WorkspaceState {
  tabs: WorkspaceTab[]
  activeTabId: string | null
  openTab: (tab: Omit<WorkspaceTab, 'id'>) => string  // 返回 tabId
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  closeAllTabs: () => void
  closeOtherTabs: (id: string) => void
}
```

### 12.4 各类型页签行为

#### 12.4.1 工作台页签 (WorkbenchTab)
- **触发方式**：ActivityBar 点击 Workbench 图标
- **标题**：`工作台`
- **关闭**：不可关闭 (closable: false)
- **去重**：单例，重复点击切换到已有页签
- **内容**：项目范围概览 + 就绪检查 + 操作卡片 + 输出预览

#### 12.4.2 机柜规划页签 (RackTab)
- **触发方式**：ActivityBar 点击 Rack 图标，或侧边栏机柜列表点击特定机柜
- **标题**：`机柜规划` (列表视图) / `机柜 - ${cabinetName}` (单机柜视图)
- **关闭**：可关闭 (closable: true)
- **去重**：通用机柜规划页签去重；特定机柜页签按 cabinetId 去重
- **内容**：全尺寸 42U/49U 机柜视图、设备详情面板、放置表单、功率进度条

#### 12.4.3 拓扑视图页签 (TopologyTab)
- **触发方式**：ActivityBar 点击 Topology 图标
- **标题**：`拓扑视图 - ${projectName}`
- **关闭**：可关闭 (closable: true)
- **去重**：单例，重复点击切换到已有页签
- **内容**：全尺寸 ECharts 拓扑图、网络筛选、节点搜索、缩放控制、导出按钮

#### 12.4.4 输出结果页签 (OutputTab)
- **触发方式**：ActivityBar 点击 Output 图标，或侧边栏文件列表点击文件
- **标题**：`输出结果` (文件列表) / `${fileName}` (文件预览)
- **关闭**：可关闭 (closable: true)
- **去重**：文件列表页签去重；文件预览按 fileName 去重
- **多实例**：支持同时打开多个文件页签（多表格对比查看）
- **内容**：全尺寸 Excel 预览（多 Sheet 切换）/ 全尺寸图片预览

#### 12.4.5 设备库页签 (DeviceLibraryTab)
- **触发方式**：ActivityBar 点击 DeviceLib 图标
- **标题**：`设备库`
- **关闭**：不可关闭 (closable: false)
- **去重**：单例，重复点击切换到已有页签
- **内容**：全尺寸设备浏览（分类树 + 设备列表 + 详情三栏布局）、设备对比、搜索筛选

### 12.5 页签栏 UI 交互

- **位置**：工作区顶部，横向页签栏
- **滚动**：页签过多时支持水平滚动（鼠标滚轮）
- **切换**：点击切换活跃页签
- **关闭**：每个可关闭页签右侧显示 × 按钮
- **右键菜单**：关闭 / 关闭其他 / 关闭全部 / 关闭右侧
- **空状态**：所有页签关闭后显示 WorkspaceWelcome 欢迎页
- **快捷键**：
  - `Ctrl+W`：关闭当前活跃页签
  - `Ctrl+Shift+T`：重新打开最后关闭的页签

### 12.6 侧边栏与工作区的关系

内容型面板在侧边栏中保留**精简导航版**：

| 面板 | 侧边栏精简版内容 |
|------|----------------|
| RackPanel | 机柜列表 + 使用率统计，点击机柜 → 打开 RackTab |
| TopologyPanel | 网络筛选按钮 + 节点统计，提示"在工作区查看完整拓扑" |
| OutputPanel | 文件列表 + 文件图标，点击文件 → 打开 OutputTab |
| DeviceLibraryPanel | 分类标签 + 快速搜索，点击"打开设备库" → 打开 DeviceLibraryTab |

### 12.7 新增文件清单

```
src/
├── components/
│   └── workspace/                    # 新增：工作区页签系统
│       ├── WorkspaceTabBar.tsx       # 页签栏组件
│       ├── WorkspaceView.tsx         # 工作区视图容器
│       ├── WorkspaceWelcome.tsx      # 空状态欢迎页
│       └── tabs/
│           ├── WorkbenchTab.tsx      # 工作台页签
│           ├── RackTab.tsx           # 机柜规划页签
│           ├── TopologyTab.tsx       # 拓扑视图页签
│           ├── OutputTab.tsx         # 输出结果页签
│           └── DeviceLibraryTab.tsx  # 设备库页签
└── stores/
    └── workspace.store.ts            # 新增：工作区状态管理
```

---

## 十三、向导设备选择器筛选增强

### 13.1 问题背景

当前 `DeviceLibraryPicker.tsx` 仅提供搜索框，在 40 款内置设备中查找目标设备效率极低。用户需要：
- 按设备分类快速定位（GPU服务器、交换机等）
- 按厂商筛选（NVIDIA、华为、H3C 等）
- 按设备类型筛选（服务器 vs 交换机）

### 13.2 新增筛选控件

```
DeviceLibraryPicker 筛选栏：
┌──────────────────────────────────────────────────────────┐
│ [全部] [GPU服务器] [存储服务器] [通算服务器] [交换机]      │  ← 分类标签
│ [厂商: 全部 ▾]  [类型: 全部 ▾]  [🔍 搜索设备...        ] │  ← 厂商/类型下拉 + 搜索
├──────────────────────────────────────────────────────────┤
│ 设备列表 ...                                              │
└──────────────────────────────────────────────────────────┘
```

### 13.3 筛选条件

| 筛选项 | 类型 | 选项 | 说明 |
|--------|------|------|------|
| 分类标签 | Tabs | 全部, GPU服务器, 存储服务器, 通算服务器, 交换机 | 单选，AND 组合 |
| 厂商 | Dropdown | 全部, NVIDIA, 华为, H3C, 浪潮, 锐捷, 通甇 | 单选，AND 组合 |
| 设备类型 | Dropdown | 全部, 服务器, 交换机 | 单选，AND 组合 |
| 搜索 | Input | 自由文本 | 匹配厂商/型号/描述，AND 组合 |

**组合逻辑**：所有筛选条件为 AND 关系。例如：分类=GPU服务器 + 厂商=NVIDIA → 只显示 NVIDIA 的 GPU 服务器。

### 13.4 实现变更

- `DeviceLibraryPicker.tsx`：添加分类标签栏、厂商下拉、设备类型下拉
- `device-library.store.ts`：filter 增加 `vendor` 和 `deviceType` 字段（已部分支持）
- 筛选逻辑在 store 的 `applyFilter` 中计算 `filteredDevices`

---

## 十四、功能需求清单更新

在原有 28 项基础上新增：

| # | 需求 | 优先级 |
|---|------|--------|
| 29 | **工作区页签系统**：多页签管理框架，支持打开/关闭/切换/右键菜单 | P0 |
| 30 | **机柜规划页签**：全尺寸 42U/49U 机柜视图在工作区渲染 | P0 |
| 31 | **拓扑视图页签**：全尺寸 ECharts 拓扑图在工作区渲染 | P0 |
| 32 | **输出结果页签**：全尺寸 Excel/图片预览在工作区渲染，支持多文件同时打开 | P0 |
| 33 | **设备库页签**：全尺寸设备浏览（三栏布局：分类+列表+详情）在工作区渲染 | P0 |
| 34 | **向导设备筛选增强**：DeviceLibraryPicker 增加分类标签/厂商/设备类型筛选 | P0 |
| 35 | **侧边栏精简视图**：内容型面板保留精简导航版，提供"打开到工作区"入口 | P1 |

---

## 十五、目录结构变更

```
AutoLink/
├── src/
│   ├── components/
│   │   ├── sidebar/
│   │   │   ├── DesignPanel.tsx          # 改造：适配 DeviceProfile + 设备库引用
│   │   │   ├── RackPanel.tsx            # 改造：精简导航版（机柜列表 + 点击打开页签）
│   │   │   ├── TopologyPanel.tsx        # 改造：精简导航版（筛选 + 统计 + 打开页签）
│   │   │   ├── OutputPanel.tsx          # 改造：精简导航版（文件列表 + 点击打开页签）
│   │   │   ├── DeviceLibraryPanel.tsx   # 改造：精简导航版（分类 + 搜索 + 打开页签）
│   │   │   └── ...
│   │   ├── workspace/                   # 新增：工作区页签系统
│   │   │   ├── WorkspaceTabBar.tsx      # 页签栏
│   │   │   ├── WorkspaceView.tsx        # 工作区视图容器
│   │   │   ├── WorkspaceWelcome.tsx     # 空状态欢迎页
│   │   │   └── tabs/
│   │   │       ├── WorkbenchTab.tsx     # 工作台页签
│   │   │       ├── RackTab.tsx          # 机柜规划页签
│   │   │       ├── TopologyTab.tsx      # 拓扑视图页签
│   │   │       ├── OutputTab.tsx        # 输出结果页签
│   │   │       └── DeviceLibraryTab.tsx # 设备库页签
│   │   ├── wizard/                      # 新建项目向导
│   │   │   ├── ProjectWizard.tsx
│   │   │   ├── WizardStepBasic.tsx
│   │   │   ├── WizardStepNetworks.tsx
│   │   │   ├── WizardStepDevices.tsx
│   │   │   ├── WizardStepRack.tsx
│   │   │   └── WizardStepConfirm.tsx
│   │   ├── device/                      # 设备参数组件
│   │   │   ├── DeviceProfileCard.tsx
│   │   │   ├── DeviceProfileEditor.tsx
│   │   │   ├── InterfaceModelEditor.tsx
│   │   │   ├── DeviceLibraryPicker.tsx  # 改造：增加分类/厂商/类型筛选
│   │   │   ├── DeviceCompare.tsx
│   │   │   └── DeviceSearchFilter.tsx
│   │   ├── rack/
│   │   │   ├── RackPowerBar.tsx
│   │   │   └── ImportCabinetsModal.tsx
│   │   └── layout/
│   │       └── CabinetMatrixView.tsx
│   ├── stores/
│   │   ├── design.store.ts
│   │   ├── rack.store.ts
│   │   ├── topology-edit.store.ts
│   │   ├── device-library.store.ts
│   │   ├── workspace.store.ts           # 新增：工作区状态管理
│   │   └── device-template.store.ts     # 弃用/合并到 device-library.store
│   ├── types/
│   │   ├── device-profile.ts
│   │   └── project-config.ts
│   └── utils/
│       └── cabinet-import.ts
├── backend/
│   ├── engine.py
│   ├── designer.py
│   ├── models.py
│   ├── device_library.py
│   └── device_templates.py             # 弃用/合并到 device_library.py
└── template/
    └── device_library/
        ├── library_index.json
        ├── gpu_servers/
        ├── storage_servers/
        │   ├── all_flash/
        │   └── hybrid_flash/
        ├── compute_servers/
        ├── switches/
        │   ├── param/
        │   ├── storage/
        │   ├── biz/
        │   └── oob/
        └── custom/
```
