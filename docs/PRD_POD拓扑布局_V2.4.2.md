# PRD: POD 中心化拓扑布局 V2.4.2

> **版本**: V2.4.2 | **日期**: 2026-07-29 | **状态**: 待评审

---

## 1. 需求描述

### 1.1 用户期望的布局

以 **POD 为视觉中心**，每个 POD 内部垂直分层：

```
     [业务Agg]  [OOB Agg]                    ← 全局居中（Leaf 上方）
     [业务Access] [OOB Access]                ← POD 上方
  ┌─────────────────────────────┐
  │  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐  │
  │  │S1│ │S2│ │S3│ │S4│ │S5│  │           ← 服务器矩形排列
  │  └──┘ └──┘ └──┘ └──┘ └──┘  │
  │  ┌──┐ ┌──┐ ┌──┐ ┌──┐ ┌──┐  │
  │  │S6│ │S7│ │S8│ │S9│ │S10│ │
  │  └──┘ └──┘ └──┘ └──┘ └──┘  │
  └─────────────────────────────┘
     [参数Leaf] [存储Leaf]                   ← POD 下方
     [参数Spine] [存储Spine]                 ← 全局居中（Leaf 下方）
     [参数Core] [存储Core]                   ← 全局居中（Leaf 下方）
```

### 1.2 布局规则

| 位置 | 设备 | 排列方式 |
|------|------|----------|
| **服务器矩形** | GPU/存储/通算服务器 | POD 内按网格（列×行）矩形排列 |
| **矩形上方** | 业务 Access + OOB Access | 水平排列于 POD 宽度内 |
| **矩形下方** | 参数 Leaf + 存储 Leaf | 水平排列于 POD 宽度内 |
| **Leaf 上方（全局居中）** | 业务 Agg + OOB Agg | 水平居中于所有 POD 总宽度 |
| **Leaf 下方（全局居中）** | 参数 Spine + 存储 Spine | 水平居中于所有 POD 总宽度 |
| **Leaf 下方（全局居中）** | 参数 Core + 存储 Core | 水平居中于所有 POD 总宽度 |

### 1.3 核心目标

1. **服务器矩形排列**：POD 内服务器按网格排列，单 POD ≥128 台不溢出
2. **POD 垂直分层**：业务/OOB 在服务器上方，参数/存储 Leaf 在服务器下方
3. **Spine/Core 居中**：全局交换机水平居中于所有 POD 总宽度
4. **POD 视觉边界**：半透明背景框 + 标题
5. **全节点可见**：后端输出全部 11 类节点

---

## 2. 现状问题

| # | 问题 | 严重度 |
|---|------|--------|
| P1 | 后端只输出 5 类节点，biz/oob/core 不可见 | **P0** |
| P2 | 服务器线性排列，≥64 台横向溢出重叠 | **P0** |
| P3 | Spine 共享 podid="superpod"，挤压在一组 | **P0** |
| P4 | 按网络域水平分区，同 POD 设备被拆散 | **P0** |
| P5 | adaptiveSpacing 恒返回 100，未自适应 | P1 |
| P6 | Core 与 Spine 共用 Y 坐标，水平重叠 | P1 |

**根因**：布局以网络域为分区单位，而非以 POD 为视觉中心。

---

## 3. 功能需求

### 3.1 后端：全节点输出（修复 P1）

**FR-B1**: `engine.py` 输出全部 11 类节点（server + param_leaf/spine/core + storage_leaf/spine/core + biz_access/agg + oob_access/agg）

**FR-B2**: `NetworkObject` 新增 `layer_hint` 字段，显式指定层级

**FR-B3**: 补全 biz/oob 拓扑生成（可选，不阻塞布局修复）

### 3.2 前端：POD 中心化布局算法

**FR-F1**: 重写 `topologyLayout.ts`，实现 POD 中心化垂直分层布局

```
Step 1: 按 podid 分组（superpod → 全局组）
Step 2: POD 内服务器矩形排列（cols = ceil(sqrt(count * 4/3))）
Step 3: Access 层排在服务器上方，Leaf 层排在服务器下方
Step 4: POD 水平排列
Step 5: 全局节点（Agg/Spine/Core）居中
Step 6: 生成 POD 背景框
```

**FR-F2**: 新增 `PodGroupNode` 组件（react-flow group node，半透明背景 + 标题）

**FR-F3**: 修复 `adaptiveSpacing` 自适应间距

### 3.3 交互

**FR-I1**: POD 折叠/展开（点击标题）
**FR-I2**: 布局版本号 v2，旧 localStorage 自动清除
**FR-I3**: 过滤联动（POD 背景框保持，空层压缩）

---

## 4. Y 轴分层定义

| 层级 | Y 坐标 | 设备类型 | 排列 |
|------|--------|----------|------|
| L0 | 40 | biz_agg, oob_agg | 全局居中 |
| L1 | 140 | biz_access, oob_access | POD 上方 |
| L2 | 260 | server | POD 内矩形 |
| L3 | 400 | param_leaf, storage_leaf | POD 下方 |
| L4 | 500 | param_spine, storage_spine | 全局居中 |
| L5 | 600 | param_core, storage_core | 全局居中 |

注：Y 坐标为基准值，实际根据矩形行数动态调整 L2 高度。

---

## 5. 验收标准

| 编号 | 场景 | 预期 |
|------|------|------|
| AC1 | H100-100 台（1 POD, 100 服务器） | 12×9 矩形（108 ≥ 100），无溢出 |
| AC2 | H100-128 台（1 POD, 128 服务器） | 14×10 矩形（140 ≥ 128），无溢出 |
| AC3 | SuperPOD-256（4 POD, 64/POD） | 4 POD 水平排列，各 8×8 |
| AC4 | L20-推理-64（2 POD, 32/POD） | 2 POD，各 8×4 |
| AC5 | 过滤"仅参数网" | POD 背景框保持，仅显示 param + server |
| AC6 | 重置布局 | 清除 localStorage，重新应用布局 |
| AC7 | 1000 节点渲染 | < 3 秒 |
| AC8 | 无节点重叠 | 任意两节点间距 ≥ 80px |
| AC9 | Spine/Core 居中 | 全局节点水平居中于 POD 总宽度 |
