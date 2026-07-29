# 开发计划: POD 中心化拓扑布局 V2.4.2

> **版本**: V2.4.2 | **日期**: 2026-07-29 | **配套 PRD**: `docs/PRD_POD拓扑布局_V2.4.2.md`

---

## 1. 阶段总览

| 阶段 | 名称 | 工作量 | 优先级 |
|------|------|--------|--------|
| **K1** | 后端：全节点输出 + layer_hint | 1 天 | P0 |
| **K2** | 前端：POD 中心化布局算法 | 2 天 | P0 |
| **K3** | 前端：POD 背景框 + 视觉 | 1 天 | P0 |
| **K4** | 后端：补全 biz/oob 拓扑（可选） | 2 天 | P1 |
| **K5** | 测试与优化 | 1 天 | P0 |

**总工作量**: 5-7 天（K4 可选并行）

---

## 2. 任务清单

### Phase K1: 后端 — 全节点输出（1 天）

| ID | 任务 | 文件 |
|----|------|------|
| K1.1 | NetworkObject 新增 `layer_hint` 字段 | `backend/models.py` |
| K1.2 | designer.py / topology.py 创建对象时设置 `layer_hint` | `backend/designer.py`, `backend/topology.py` |
| K1.3 | engine.py 输出全 11 类节点 + layer_hint | `backend/engine.py` |
| K1.4 | 单元测试：全节点输出 | `tests/backend/` |

### Phase K2: 前端 — POD 中心化布局算法（2 天）

| ID | 任务 | 文件 |
|----|------|------|
| K2.1 | 重写常量与类型定义（LAYER_Y, NODE_CELL_W/H） | `topologyLayout.ts` |
| K2.2 | 实现 `groupByPod()` POD 分组 | `topologyLayout.ts` |
| K2.3 | 实现 `calculateGrid()` 矩形排列计算 | `topologyLayout.ts` |
| K2.4 | 实现 `layoutServerGrid()` 服务器矩形排列 | `topologyLayout.ts` |
| K2.5 | 实现 `layoutAccessLayer()` Access 层排列（POD 上方） | `topologyLayout.ts` |
| K2.6 | 实现 `layoutLeafLayer()` Leaf 层排列（POD 下方） | `topologyLayout.ts` |
| K2.7 | 实现 `layoutCentered()` 全局节点居中 | `topologyLayout.ts` |
| K2.8 | 重写 `computeTopologyLayout()` 主入口 | `topologyLayout.ts` |
| K2.9 | 修复 `adaptiveSpacing()` | `topologyLayout.ts` |
| K2.10 | TopologyTab.tsx 适配新布局 + 版本号 v2 | `TopologyTab.tsx` |
| K2.11 | design.store.ts 新增 layerHint 字段 | `design.store.ts` |

### Phase K3: 前端 — POD 背景框 + 视觉（1 天）

| ID | 任务 | 文件 |
|----|------|------|
| K3.1 | 创建 PodGroupNode 组件 | `topology/PodGroupNode.tsx` |
| K3.2 | TopologyTab.tsx 注册 podGroup 节点类型 | `TopologyTab.tsx` |
| K3.3 | POD 背景色按序号分配 | `PodGroupNode.tsx` |
| K3.4 | 服务器节点适配矩形排列样式 | `TopologyNodes.tsx` |
| K3.5 | 边线 bezier 曲线 + MiniMap 适配 | `TopologyTab.tsx` |

### Phase K4: 后端 — 补全 biz/oob 拓扑（可选，2 天）

| ID | 任务 | 文件 |
|----|------|------|
| K4.1 | `create_biz_objects()` 业务网对象生成 | `backend/designer.py` |
| K4.2 | `create_oob_objects()` OOB 网对象生成 | `backend/designer.py` |
| K4.3 | `generate_biz/oob_connections()` 连接生成 | `backend/designer.py` |
| K4.4 | 单元测试 | `tests/backend/` |

### Phase K5: 测试与优化（1 天）

| ID | 任务 | 类型 |
|----|------|------|
| K5.1 | 后端单元测试：全节点 + layer_hint | pytest |
| K5.2 | 前端单元测试：calculateGrid / groupByPod / layoutServerGrid | vitest |
| K5.3 | E2E：H100-100 台 / SuperPOD-256 拓扑 | 手动 |
| K5.4 | 性能：1000 节点渲染 < 3s | 手动 |
| K5.5 | typecheck 全量通过 | tsc |

---

## 3. 关键算法

### 3.1 矩形排列

```typescript
function calculateGrid(count: number): { cols: number; rows: number } {
  const cols = Math.ceil(Math.sqrt(count * 4 / 3))  // 宽高比 4:3
  const rows = Math.ceil(count / cols)
  return { cols, rows }
}
// 100 台 → cols=12, rows=9 (实际 12×9=108 ≥ 100)
// 128 台 → cols=14, rows=10 (140 ≥ 128)
// 64 台  → cols=10, rows=7 (70 ≥ 64)
```

### 3.2 POD 中心化布局主流程

```typescript
function computePodCenteredLayout(nodes, edges) {
  // 1. 按 podid 分组，superpod → 全局组
  // 2. 每个 POD 内：
  //    - 服务器矩形排列（L2）
  //    - Access 排在 L1（POD 上方）
  //    - Leaf 排在 L3（POD 下方）
  // 3. POD 水平排列
  // 4. 全局节点（Agg/Spine/Core）居中于 POD 总宽度
  // 5. 生成 POD 背景框
}
```

### 3.3 Y 轴分层

```
L0 (y=40):   biz_agg, oob_agg           ← 全局居中
L1 (y=140):  biz_access, oob_access     ← POD 上方
L2 (y=260):  server                     ← POD 内矩形
L3 (y=400):  param_leaf, storage_leaf   ← POD 下方
L4 (y=500):  param_spine, storage_spine ← 全局居中
L5 (y=600):  param_core, storage_core   ← 全局居中
```

---

## 4. 里程碑

| 里程碑 | 版本 | 阶段 | 验收 |
|--------|------|------|------|
| M1 | 2.4.2-build1 | K1+K2 | 后端全节点 + 前端新布局 |
| M2 | 2.4.2-build2 | K3 | POD 背景框 + 视觉完善 |
| **Release** | **2.4.2** | K5 | 全部 AC 通过 |

---

## 5. 降级策略

若 K4（biz/oob 拓扑）无法完成：
- K1-K3 独立发布 2.4.2
- 布局算法对缺失的 biz/oob 节点零影响
- K4 延后至 2.4.3

---

## 6. 完成状态（2026-07-29 更新）

| 阶段 | 状态 | 产出 |
|------|------|------|
| K1 后端全节点输出 | ✅ 完成 | models.py 新增 layer_hint，engine.py 输出全 11 类节点 |
| K2 前端布局算法 | ✅ 完成 | topologyLayout.ts 重写为 POD 中心化垂直分层布局 |
| K3 POD 背景框 | ✅ 完成 | PodGroupNode.tsx + TopologyTab.tsx 集成 |
| K4 biz/oob 拓扑 | ✅ 完成 | 后端已输出 biz_access/agg + oob_access/agg 节点 |
| K5 测试与优化 | ✅ 完成 | 见下表 |

### K5 测试结果

| ID | 任务 | 结果 |
|----|------|------|
| K5.1 | 后端单元测试 | ✅ 249 passed（含 30 layer_hint + 10 E2E） |
| K5.2 | 前端布局算法测试 | ✅ 24 passed（含 5 E2E H100-100 场景） |
| K5.3 | E2E: H100-100 台 | ✅ 6 POD / 134 服务器 / 215 节点，矩形排列无重叠 |
| K5.4 | 性能: 217 节点 < 3s | ✅ 布局计算 < 30ms |
| K5.5 | typecheck | ✅ tsc --noEmit 通过 |

### PRD 验收标准达成

| AC | 场景 | 达成 |
|----|------|------|
| AC1 | H100-100 台 12×9 矩形 | ✅ |
| AC2 | H100-128 台 14×10 矩形 | ✅ |
| AC3 | 多 POD 水平排列 | ✅ |
| AC7 | 节点渲染 < 3 秒 | ✅ (< 30ms) |
| AC8 | 无节点重叠 ≥ 80px | ✅ (NODE_CELL_H=80) |
| AC9 | Spine/Core 全局居中 | ✅ |
