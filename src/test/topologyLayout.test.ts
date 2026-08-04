/**
 * V2.4.5 — 服务器区中心化 + 四象限网络设备分区布局测试
 *
 * 验证：
 *   - calculateGrid 矩形排列
 *   - 四象限分区：OOB 左上 / 业务右上 / 参数左下 / 存储右下
 *   - 服务器区居中且左右无网络设备
 *   - 16:9 比例自适应
 *   - 纵向间距 ≥ 100px
 *   - 无节点重叠 ≥ 80px
 *   - E2E H100-100 台真实拓扑
 */
import { describe, it, expect } from 'vitest'
import {
  calculateGrid,
  computeTopologyLayout,
  countPods,
  calculateServerArea,
  calculateCanvasSize,
  normalizePodId,
} from '@/components/workspace/tabs/topology/topologyLayout'
import type { TopologyNode, TopologyEdge } from '@/stores/design.store'

/* ---------- 辅助函数 ---------- */

function makeServer(id: string, podid: string): TopologyNode {
  return { id, type: 'server', group: '', podid, layerHint: 'server' }
}

function makeSwitch(id: string, type: string, podid: string): TopologyNode {
  return { id, type, group: '', podid, layerHint: type.includes('core') ? 'core' : type.includes('spine') ? 'spine' : type.includes('leaf') ? 'leaf' : type.includes('access') ? 'access' : 'agg' }
}

/* ---------- normalizePodId（双平面 3-tier 超级 Pod 归一化）测试 ---------- */

describe('normalizePodId', () => {
  it('V3.0.1-T1-5: 平面 A/B Pod 归一化到逻辑超级 Pod', () => {
    expect(normalizePodId('plane-A-pod1')).toBe('plane-ab-pod1')
    expect(normalizePodId('plane-B-pod2')).toBe('plane-ab-pod2')
  })
  it('2-tier 平面标签与普通 Pod 保持不变', () => {
    expect(normalizePodId('plane-A')).toBe('plane-A')
    expect(normalizePodId('plane-B')).toBe('plane-B')
    expect(normalizePodId('pod-gpu-1')).toBe('pod-gpu-1')
    expect(normalizePodId('pod-storage-1')).toBe('pod-storage-1')
    expect(normalizePodId('')).toBe('')
  })
})

/* ---------- calculateGrid 测试 ---------- */

describe('calculateGrid', () => {
  it('0 台服务器返回 0×0', () => {
    expect(calculateGrid(0)).toEqual({ cols: 0, rows: 0 })
  })

  it('1 台服务器返回 1×1', () => {
    expect(calculateGrid(1)).toEqual({ cols: 1, rows: 1 })
  })

  it('100 台服务器网格容纳所有节点', () => {
    const { cols, rows } = calculateGrid(100)
    expect(cols * rows).toBeGreaterThanOrEqual(100)
    expect(cols).toBeGreaterThanOrEqual(rows)
  })

  it('V2.4.3: 传入 colsHint 时强制使用指定列数', () => {
    const { cols, rows } = calculateGrid(100, 8)
    expect(cols).toBe(8)
    expect(rows).toBe(13)
    expect(cols * rows).toBeGreaterThanOrEqual(100)
  })

  it('V2.4.3: colsHint=25 时 25 台服务器单行', () => {
    const { cols, rows } = calculateGrid(25, 25)
    expect(cols).toBe(25)
    expect(rows).toBe(1)
  })

  it('PRD AC1: 100台自适应 → 12×9 (108 ≥ 100)', () => {
    const { cols, rows } = calculateGrid(100)
    expect(cols).toBe(12)
    expect(rows).toBe(9)
    expect(cols * rows).toBeGreaterThanOrEqual(100)
  })

  it('PRD AC2: 128台自适应 → 14×10 (140 ≥ 128)', () => {
    const { cols, rows } = calculateGrid(128)
    expect(cols).toBe(14)
    expect(rows).toBe(10)
    expect(cols * rows).toBeGreaterThanOrEqual(128)
  })
})

/* ---------- countPods 测试 ---------- */

describe('countPods', () => {
  it('正确统计 GPU/存储/通算 POD 数量', () => {
    // 模拟 PodGroup 数组
    const pods = [
      { podid: 'pod-gpu-1', servers: [makeServer('s', 'pod-gpu-1')], paramLeaves: [], storageLeaves: [], oobAccess: [], bizAccess: [] },
      { podid: 'pod-gpu-2', servers: [makeServer('s', 'pod-gpu-2')], paramLeaves: [], storageLeaves: [], oobAccess: [], bizAccess: [] },
      { podid: 'pod-storage-1', servers: [makeServer('s', 'pod-storage-1')], paramLeaves: [], storageLeaves: [], oobAccess: [], bizAccess: [] },
      { podid: 'pod-general-1', servers: [makeServer('s', 'pod-general-1')], paramLeaves: [], storageLeaves: [], oobAccess: [], bizAccess: [] },
    ] as any
    const stats = countPods(pods)
    expect(stats.total).toBe(4)
    expect(stats.gpu).toBe(2)
    expect(stats.storage).toBe(1)
    expect(stats.general).toBe(1)
  })
})

/* ---------- calculateServerArea 测试 ---------- */

describe('calculateServerArea', () => {
  it('正确计算服务器区尺寸', () => {
    const pods = [
      { podid: 'pod-gpu-1', servers: Array.from({ length: 25 }, (_, i) => makeServer(`s${i}`, 'pod-gpu-1')), paramLeaves: Array.from({ length: 8 }, (_, i) => makeSwitch(`l${i}`, 'param_leaf', 'pod-gpu-1')), storageLeaves: [], oobAccess: [], bizAccess: [] },
    ] as any
    const { pods: dims, totalWidth, maxHeight } = calculateServerArea(pods)
    expect(dims).toHaveLength(1)
    expect(dims[0].cols).toBe(8)  // colsHint = 8
    expect(dims[0].rows).toBe(4)  // ceil(25/8) = 4
    expect(totalWidth).toBe(8 * 90)  // 8 cols * 90px
    expect(maxHeight).toBe(4 * 80)  // 4 rows * 80px
  })
})

/* ---------- calculateCanvasSize 测试 ---------- */

describe('calculateCanvasSize', () => {
  it('16:9 比例自适应：太宽时增加顶部/底部留白', () => {
    // 极宽的服务器区
    const canvas = calculateCanvasSize(3000, 200, false, false, false)
    const ratio = canvas.width / canvas.height
    expect(ratio).toBeGreaterThan(1.5)
    expect(ratio).toBeLessThan(2.1)
  })

  it('16:9 比例自适应：太窄时增加左右 padding', () => {
    // 极窄的服务器区
    const canvas = calculateCanvasSize(200, 1000, false, false, false)
    const ratio = canvas.width / canvas.height
    expect(ratio).toBeGreaterThan(1.5)
    expect(ratio).toBeLessThan(2.1)
  })

  it('小规模时应用最小画布尺寸', () => {
    const canvas = calculateCanvasSize(100, 80, false, false, false)
    expect(canvas.width).toBeGreaterThanOrEqual(1200)
    expect(canvas.height).toBeGreaterThanOrEqual(675)
  })
})

/* ---------- 四象限分区测试 ---------- */

describe('V2.4.5: 四象限网络设备分区', () => {
  function buildTopology(): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
    const nodes: TopologyNode[] = []
    // 25 服务器 + 8 参数 Leaf
    for (let i = 1; i <= 25; i++) nodes.push(makeServer(`S_${i}`, 'pod-gpu-1'))
    for (let i = 1; i <= 8; i++) nodes.push(makeSwitch(`参数Leaf_${i}`, 'param_leaf', 'pod-gpu-1'))
    // OOB Access + Agg
    for (let i = 1; i <= 2; i++) nodes.push(makeSwitch(`OOB接入_${i}`, 'oob_access', 'pod-gpu-1'))
    nodes.push(makeSwitch('OOB汇聚_1', 'oob_agg', 'superpod'))
    // 业务 Access + Agg
    for (let i = 1; i <= 2; i++) nodes.push(makeSwitch(`业务接入_${i}`, 'biz_access', 'pod-gpu-1'))
    nodes.push(makeSwitch('业务汇聚_1', 'biz_agg', 'superpod'))
    // 存储 Leaf + Spine
    for (let i = 1; i <= 3; i++) nodes.push(makeSwitch(`存储Leaf_${i}`, 'storage_leaf', 'pod-gpu-1'))
    nodes.push(makeSwitch('存储Spine_1', 'storage_spine', 'superpod'))
    // 参数 Spine
    for (let i = 1; i <= 4; i++) nodes.push(makeSwitch(`参数Spine_${i}`, 'param_spine', 'superpod'))
    return { nodes, edges: [] }
  }

  it('AC2: OOB 在左上区域', () => {
    const { nodes } = buildTopology()
    const result = computeTopologyLayout(nodes, [])
    const centerX = result.totalWidth / 2
    const serverNodes = result.layoutNodes.filter((n) => n.layerHint === 'server')
    const serverTopY = Math.min(...serverNodes.map((n) => n.y))

    const oobNodes = result.layoutNodes.filter((n) => n.type.startsWith('oob_'))
    for (const n of oobNodes) {
      expect(n.x).toBeLessThan(centerX)   // 左半区
      expect(n.y).toBeLessThan(serverTopY) // 服务器上方
    }
  })

  it('AC2: 业务在右上区域', () => {
    const { nodes } = buildTopology()
    const result = computeTopologyLayout(nodes, [])
    const centerX = result.totalWidth / 2
    const serverNodes = result.layoutNodes.filter((n) => n.layerHint === 'server')
    const serverTopY = Math.min(...serverNodes.map((n) => n.y))

    const bizNodes = result.layoutNodes.filter((n) => n.type.startsWith('biz_'))
    for (const n of bizNodes) {
      expect(n.x).toBeGreaterThan(centerX)  // 右半区
      expect(n.y).toBeLessThan(serverTopY)  // 服务器上方
    }
  })

  it('AC2: 参数 Leaf/Spine 在左下区域', () => {
    const { nodes } = buildTopology()
    const result = computeTopologyLayout(nodes, [])
    const centerX = result.totalWidth / 2
    const serverNodes = result.layoutNodes.filter((n) => n.layerHint === 'server')
    const serverBottomY = Math.max(...serverNodes.map((n) => n.y))

    const paramNodes = result.layoutNodes.filter((n) => n.type.startsWith('param_'))
    for (const n of paramNodes) {
      expect(n.x).toBeLessThan(centerX)        // 左半区
      expect(n.y).toBeGreaterThan(serverBottomY) // 服务器下方
    }
  })

  it('AC2: 存储 Leaf/Spine 在右下区域', () => {
    const { nodes } = buildTopology()
    const result = computeTopologyLayout(nodes, [])
    const centerX = result.totalWidth / 2
    const serverNodes = result.layoutNodes.filter((n) => n.layerHint === 'server')
    const serverBottomY = Math.max(...serverNodes.map((n) => n.y))

    const storageNodes = result.layoutNodes.filter((n) => n.type.startsWith('storage_'))
    for (const n of storageNodes) {
      expect(n.x).toBeGreaterThan(centerX)     // 右半区
      expect(n.y).toBeGreaterThan(serverBottomY) // 服务器下方
    }
  })

  it('AC3: 服务器区与网络设备 Y 轴分离（左右无网络设备）', () => {
    const { nodes } = buildTopology()
    const result = computeTopologyLayout(nodes, [])
    const serverNodes = result.layoutNodes.filter((n) => n.layerHint === 'server')
    const serverTopY = Math.min(...serverNodes.map((n) => n.y))
    const serverBottomY = Math.max(...serverNodes.map((n) => n.y))
    const networkNodes = result.layoutNodes.filter((n) => n.layerHint !== 'server')

    for (const n of networkNodes) {
      // V2.4.5: 需求8「服务器左右无网络设备」= 网络设备与服务器 Y 轴分离
      // 网络设备不能在服务器区的 Y 范围内（必须在上方或下方）
      const inServerYRange = n.y >= serverTopY - 50 && n.y <= serverBottomY + 50
      expect(inServerYRange).toBe(false)
    }
  })

  it('AC4: 服务器与网络设备纵向间距 ≥ 100px', () => {
    const { nodes } = buildTopology()
    const result = computeTopologyLayout(nodes, [])
    const serverNodes = result.layoutNodes.filter((n) => n.layerHint === 'server')
    const serverTopY = Math.min(...serverNodes.map((n) => n.y))
    const serverBottomY = Math.max(...serverNodes.map((n) => n.y))
    const networkNodes = result.layoutNodes.filter((n) => n.layerHint !== 'server')

    for (const n of networkNodes) {
      if (n.y < serverTopY) {
        // 上方网络设备：与服务器顶部间距 ≥ 100px
        expect(serverTopY - n.y).toBeGreaterThanOrEqual(100)
      } else if (n.y > serverBottomY) {
        // 下方网络设备：与服务器底部间距 ≥ 100px
        expect(n.y - serverBottomY).toBeGreaterThanOrEqual(100)
      }
    }
  })

  it('AC6: 16:9 比例（1.5 ≤ ratio ≤ 2.1）', () => {
    const { nodes } = buildTopology()
    const result = computeTopologyLayout(nodes, [])
    const ratio = result.totalWidth / result.totalHeight
    expect(ratio).toBeGreaterThanOrEqual(1.5)
    expect(ratio).toBeLessThanOrEqual(2.1)
  })

  it('AC7: 无节点重叠（间距 ≥ 80px）', () => {
    const { nodes } = buildTopology()
    const result = computeTopologyLayout(nodes, [])
    const allNodes = result.layoutNodes
    // 抽样检查（全量 O(n²) 对 50 节点可接受）
    for (let i = 0; i < allNodes.length; i++) {
      for (let j = i + 1; j < allNodes.length; j++) {
        const dx = Math.abs(allNodes[i].x - allNodes[j].x)
        const dy = Math.abs(allNodes[i].y - allNodes[j].y)
        expect(dx >= 80 || dy >= 80).toBe(true)
      }
    }
  })

  it('AC9: 网络设备层间间距 ≥ 100px', () => {
    const { nodes } = buildTopology()
    const result = computeTopologyLayout(nodes, [])
    // 检查同类网络设备的层间间距
    // OOB Agg 与 OOB Access
    const oobAgg = result.layoutNodes.find((n) => n.type === 'oob_agg')
    const oobAccess = result.layoutNodes.find((n) => n.type === 'oob_access')
    if (oobAgg && oobAccess) {
      expect(Math.abs(oobAccess.y - oobAgg.y)).toBeGreaterThanOrEqual(100)
    }
    // 参数 Leaf 与参数 Spine
    const paramLeaf = result.layoutNodes.find((n) => n.type === 'param_leaf')
    const paramSpine = result.layoutNodes.find((n) => n.type === 'param_spine')
    if (paramLeaf && paramSpine) {
      expect(Math.abs(paramSpine.y - paramLeaf.y)).toBeGreaterThanOrEqual(100)
    }
  })

  it('AC10: 服务器组垂直居中（上方间距 ≈ 下方间距，差值 ≤ 20px）', () => {
    const { nodes } = buildTopology()
    const result = computeTopologyLayout(nodes, [])
    const serverNodes = result.layoutNodes.filter((n) => n.layerHint === 'server')
    const serverTopY = Math.min(...serverNodes.map((n) => n.y))
    const serverBottomY = Math.max(...serverNodes.map((n) => n.y))

    // 顶部网络设备最低 Y（最靠近服务器的层）
    const topNetNodes = result.layoutNodes.filter((n) => n.layerHint !== 'server' && n.y < serverTopY)
    const topNetBottomY = topNetNodes.length > 0 ? Math.max(...topNetNodes.map((n) => n.y)) : 0
    // 底部网络设备最高 Y（最靠近服务器的层）
    const bottomNetNodes = result.layoutNodes.filter((n) => n.layerHint !== 'server' && n.y > serverBottomY)
    const bottomNetTopY = bottomNetNodes.length > 0 ? Math.min(...bottomNetNodes.map((n) => n.y)) : result.totalHeight

    const topGap = serverTopY - topNetBottomY
    const bottomGap = bottomNetTopY - serverBottomY
    const diff = Math.abs(topGap - bottomGap)
    // V2.4.5: 服务器组垂直居中，上方间距与下方间距差值 ≤ 20px
    expect(diff).toBeLessThanOrEqual(20)
  })
})

/* ---------- E2E: H100-100 台真实拓扑 ---------- */

describe('E2E: H100-100 台真实拓扑布局', () => {
  function buildH100Topology(): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
    const nodes: TopologyNode[] = []
    // 4 GPU POD × 25 服务器
    for (let pod = 1; pod <= 4; pod++) {
      for (let i = 1; i <= 25; i++) {
        nodes.push(makeServer(`GPU服务器_P${pod}_${i}`, `pod-gpu-${pod}`))
      }
      for (let i = 1; i <= 8; i++) {
        nodes.push(makeSwitch(`参数Leaf_P${pod}_${i}`, 'param_leaf', `pod-gpu-${pod}`))
      }
      for (let i = 1; i <= 3; i++) {
        nodes.push(makeSwitch(`业务接入_P${pod}_${i}`, 'biz_access', `pod-gpu-${pod}`))
      }
      for (let i = 1; i <= 2; i++) {
        nodes.push(makeSwitch(`OOB接入_P${pod}_${i}`, 'oob_access', `pod-gpu-${pod}`))
      }
    }
    // 存储 POD (14 服务器 + 7 storage_leaf)
    for (let i = 1; i <= 14; i++) {
      nodes.push(makeServer(`存储服务器_${i}`, 'pod-storage'))
    }
    for (let i = 1; i <= 7; i++) {
      nodes.push(makeSwitch(`存储Leaf_${i}`, 'storage_leaf', 'pod-storage'))
    }
    // 通算 POD (20 服务器)
    for (let i = 1; i <= 20; i++) {
      nodes.push(makeServer(`通算服务器_${i}`, 'pod-general'))
    }
    // 全局节点
    for (let i = 1; i <= 16; i++) {
      nodes.push(makeSwitch(`参数Spine_${i}`, 'param_spine', 'superpod'))
    }
    for (let i = 1; i <= 3; i++) {
      nodes.push(makeSwitch(`存储Spine_${i}`, 'storage_spine', 'superpod'))
    }
    for (let i = 1; i <= 4; i++) {
      nodes.push(makeSwitch(`业务汇聚_${i}`, 'biz_agg', 'superpod'))
    }
    nodes.push(makeSwitch('OOB汇聚_1', 'oob_agg', 'superpod'))
    return { nodes, edges: [] }
  }

  it('E2E AC1: 6 POD 横向排列', () => {
    const { nodes } = buildH100Topology()
    const result = computeTopologyLayout(nodes, [])
    expect(result.pods).toHaveLength(6)
    // POD 水平排列（X 递增）
    for (let i = 1; i < result.pods.length; i++) {
      expect(result.pods[i].x).toBeGreaterThan(result.pods[i - 1].x)
    }
  })

  it('E2E AC2: 四象限分区正确', () => {
    const { nodes } = buildH100Topology()
    const result = computeTopologyLayout(nodes, [])
    const centerX = result.totalWidth / 2
    const serverNodes = result.layoutNodes.filter((n) => n.layerHint === 'server')
    const serverTopY = Math.min(...serverNodes.map((n) => n.y))
    const serverBottomY = Math.max(...serverNodes.map((n) => n.y))

    // OOB 左上
    const oobNodes = result.layoutNodes.filter((n) => n.type.startsWith('oob_'))
    for (const n of oobNodes) {
      expect(n.x).toBeLessThan(centerX)
      expect(n.y).toBeLessThan(serverTopY)
    }
    // 业务 右上
    const bizNodes = result.layoutNodes.filter((n) => n.type.startsWith('biz_'))
    for (const n of bizNodes) {
      expect(n.x).toBeGreaterThan(centerX)
      expect(n.y).toBeLessThan(serverTopY)
    }
    // 参数 左下
    const paramNodes = result.layoutNodes.filter((n) => n.type.startsWith('param_'))
    for (const n of paramNodes) {
      expect(n.x).toBeLessThan(centerX)
      expect(n.y).toBeGreaterThan(serverBottomY)
    }
    // 存储 右下
    const storageNodes = result.layoutNodes.filter((n) => n.type.startsWith('storage_'))
    for (const n of storageNodes) {
      expect(n.x).toBeGreaterThan(centerX)
      expect(n.y).toBeGreaterThan(serverBottomY)
    }
  })

  it('E2E AC6: 16:9 比例', () => {
    const { nodes } = buildH100Topology()
    const result = computeTopologyLayout(nodes, [])
    const ratio = result.totalWidth / result.totalHeight
    expect(ratio).toBeGreaterThanOrEqual(1.5)
    expect(ratio).toBeLessThanOrEqual(2.1)
  })

  it('E2E AC7: 217 节点布局计算 < 3 秒', () => {
    const { nodes } = buildH100Topology()
    expect(nodes.length).toBe(217)
    const start = performance.now()
    computeTopologyLayout(nodes, [])
    const elapsed = performance.now() - start
    expect(elapsed).toBeLessThan(3000)
  })

  it('E2E AC8: 服务器无重叠（间距 ≥ 80px）', () => {
    const { nodes } = buildH100Topology()
    const result = computeTopologyLayout(nodes, [])
    const serverNodes = result.layoutNodes.filter((n) => n.layerHint === 'server')
    expect(serverNodes).toHaveLength(134)
    for (let i = 0; i < serverNodes.length; i++) {
      for (let j = i + 1; j < serverNodes.length; j++) {
        const dx = Math.abs(serverNodes[i].x - serverNodes[j].x)
        const dy = Math.abs(serverNodes[i].y - serverNodes[j].y)
        expect(dx >= 80 || dy >= 80).toBe(true)
      }
    }
  })
})
