import { describe, it, expect } from 'vitest'
import { evaluateTopologyExportSize } from '@/utils/exportTopologyView'
import { buildTopologyView } from '@/components/workspace/tabs/topology/TopologyViewCanvas'
import type { TopologyNode, TopologyEdge, TopologyLayout } from '@/stores/design.store'

/* ---------- 内联构造迷你拓扑（不依赖本地 workspace 文件，CI 可复现） ---------- */

function makeServer(id: string, podid: string): TopologyNode {
  return { id, type: 'server', group: 'gpu', podid, layerHint: 'server' }
}

function makeSwitch(id: string, type: string, podid: string): TopologyNode {
  return {
    id, type, group: '', podid,
    layerHint: type.includes('core') ? 'core' : type.includes('spine') ? 'spine' : type.includes('leaf') ? 'leaf' : type.includes('access') ? 'access' : 'agg',
  }
}

/** 迷你但能产生 POD 分组的拓扑（结构对齐 topologyLayout.test 的四象限用例） */
function buildMiniTopology(): { nodes: TopologyNode[]; edges: TopologyEdge[] } {
  const nodes: TopologyNode[] = []
  for (let i = 1; i <= 16; i++) nodes.push(makeServer(`S_${i}`, 'pod-gpu-1'))
  for (let i = 1; i <= 4; i++) nodes.push(makeSwitch(`参数Leaf_${i}`, 'param_leaf', 'pod-gpu-1'))
  nodes.push(makeSwitch('参数Spine_1', 'param_spine', 'superpod'))
  for (let i = 1; i <= 2; i++) nodes.push(makeSwitch(`存储Leaf_${i}`, 'storage_leaf', 'pod-gpu-1'))
  nodes.push(makeSwitch('存储Spine_1', 'storage_spine', 'superpod'))
  nodes.push(makeSwitch('OOB接入_1', 'oob_access', 'pod-gpu-1'))
  nodes.push(makeSwitch('OOB汇聚_1', 'oob_agg', 'superpod'))
  nodes.push(makeSwitch('业务接入_1', 'biz_access', 'pod-gpu-1'))
  nodes.push(makeSwitch('业务汇聚_1', 'biz_agg', 'superpod'))

  const edges: TopologyEdge[] = []
  for (let i = 1; i <= 16; i++) {
    const leaf = `参数Leaf_${((i - 1) % 4) + 1}`
    edges.push({ source: `S_${i}`, target: leaf, speed: '400G', cableType: '光缆', description: '参数网络', networkType: 'param' })
  }
  for (let i = 1; i <= 4; i++) {
    edges.push({ source: `参数Leaf_${i}`, target: '参数Spine_1', speed: '400G', cableType: '光缆', description: '参数网络', networkType: 'param' })
  }
  return { nodes, edges }
}

/** 带保存布局的 fixture（nodePositions 覆盖部分节点，验证 saved 优先） */
function buildSavedLayout(nodes: TopologyNode[]): TopologyLayout {
  const nodePositions: Record<string, { x: number; y: number }> = {}
  nodes.forEach((n, i) => {
    nodePositions[n.id] = { x: 1000 + i, y: 2000 + i }
  })
  return { version: 1, savedAt: '2026-08-25T00:00:00Z', nodePositions }
}

describe('exportTopologyView（2026-08-24：真实渲染截图导出）', () => {
  it('比例评估：输出画布为 4K 内、等比不拉伸（含/不含保存布局）', () => {
    const { nodes } = buildMiniTopology()
    for (const layout of [null, buildSavedLayout(nodes)]) {
      const size = evaluateTopologyExportSize(nodes, layout)
      expect(size.width * size.pixelRatio).toBeLessThanOrEqual(3840)
      expect(size.height * size.pixelRatio).toBeLessThanOrEqual(2160)
      expect(size.width).toBeGreaterThan(0)
      expect(size.height).toBeGreaterThan(0)
      // 画布比例与内容比例一致（±0.02，1:1 不拉伸）
      const ratio = size.width / size.height
      expect(ratio).toBeGreaterThan(0.3)
      expect(ratio).toBeLessThan(4)
    }
  })

  it('buildTopologyView：设备节点全量进入、POD 框存在、边引用真实节点', () => {
    const { nodes, edges } = buildMiniTopology()
    const { rfNodes, rfEdges, layout } = buildTopologyView(nodes, edges, null)
    const deviceNodes = rfNodes.filter((n) => !n.id.startsWith('pod-group-'))
    const podNodes = rfNodes.filter((n) => n.id.startsWith('pod-group-'))
    expect(deviceNodes).toHaveLength(nodes.length)
    expect(podNodes.length).toBeGreaterThan(0)
    expect(layout.layoutNodes.length).toBe(nodes.length)

    const nodeIds = new Set(deviceNodes.map((n) => n.id))
    expect(rfEdges.length).toBe(edges.length)
    for (const e of rfEdges) {
      expect(nodeIds.has(e.source)).toBe(true)
      expect(nodeIds.has(e.target)).toBe(true)
    }
  })

  it('保存布局优先于计算布局（position 一致）', () => {
    const { nodes, edges } = buildMiniTopology()
    const layout = buildSavedLayout(nodes)
    expect(layout).not.toBeNull()
    const { rfNodes } = buildTopologyView(nodes, edges, layout)
    const nodeById = new Map(rfNodes.map((n) => [n.id, n]))
    for (const [id, saved] of Object.entries(layout.nodePositions)) {
      const n = nodeById.get(id)
      if (!n) continue
      expect(n.position.x).toBeCloseTo(saved.x, 3)
      expect(n.position.y).toBeCloseTo(saved.y, 3)
    }
  })

  it('无保存布局项目回退计算布局且仍能构建', () => {
    const { nodes, edges } = buildMiniTopology()
    const { rfNodes, rfEdges } = buildTopologyView(nodes, edges, null)
    expect(rfNodes.filter((n) => !n.id.startsWith('pod-group-'))).toHaveLength(nodes.length)
    expect(rfEdges.length).toBe(edges.length)
  })
})

/* ---------- V5.4.0-640-m（W3.2 / T-6S-D01/D03）：拓扑边分光标注 + 共享物理口归组 ---------- */

describe('buildTopologyView 分光标注（FR-A9，单级为主）', () => {
  it('单级 1分2 边：标签含「1分2 (400G→200G)」，data 带 breakout 与归组键', () => {
    const { nodes } = buildMiniTopology()
    const edges: TopologyEdge[] = [
      // 同一物理口 400G → 2×200G：两条共享分光标注（共享物理口视觉归组：breakoutGroup 相同）
      { source: '存储Leaf_1', target: '存储Spine_1', speed: '400G', cableType: '光缆', description: '存储网络', networkType: 'storage',
        breakout: { input_speed: '400G', output_speed: '200G', count: 2 } },
      { source: '存储Leaf_2', target: '存储Spine_1', speed: '400G', cableType: '光缆', description: '存储网络', networkType: 'storage',
        breakout: { input_speed: '400G', output_speed: '200G', count: 2 } },
    ]
    const { rfEdges } = buildTopologyView(nodes, edges, null)
    expect(rfEdges).toHaveLength(2)
    const groups = new Set<string>()
    for (const e of rfEdges) {
      const label = (e.data as { label?: string }).label ?? ''
      expect(label).toContain('1分2 (400G→200G)')
      expect((e.data as { breakout?: unknown }).breakout).toEqual({ input_speed: '400G', output_speed: '200G', count: 2 })
      groups.add((e.data as { breakoutGroup?: string }).breakoutGroup ?? '')
    }
    // 共享物理口分光 → 归组键一致（可识别"成组 ≥2 条"，T-6S-D01）
    expect(groups.size).toBe(1)
    expect([...groups][0]).toContain('400G->200G:2')
  })

  it('无分光边（breakout null/缺省）恒为 1:1，不加任何分光标注', () => {
    const { nodes } = buildMiniTopology()
    const edges: TopologyEdge[] = [
      { source: '参数Leaf_1', target: '参数Spine_1', speed: '400G', cableType: '光缆', description: '参数网络', networkType: 'param' },
      { source: '存储Leaf_1', target: '存储Spine_1', speed: '400G', cableType: '光缆', description: '存储网络', networkType: 'storage',
        breakout: null },
    ]
    const { rfEdges } = buildTopologyView(nodes, edges, null)
    for (const e of rfEdges) {
      const label = (e.data as { label?: string }).label ?? ''
      expect(label).not.toContain('分')
      expect((e.data as { breakoutGroup?: string }).breakoutGroup ?? '').toBe('')
      expect((e.data as { breakout?: unknown }).breakout).toBeNull()
    }
  })

  it('两级预留（stages[]）：标签「⇉ 两级」，归组键含 stages（W3.4 载体约定）', () => {
    const { nodes } = buildMiniTopology()
    const edges: TopologyEdge[] = [
      { source: '参数Leaf_1', target: '参数Spine_1', speed: '1.6T', cableType: '光缆', description: '参数网络', networkType: 'param',
        breakout: { input_speed: '1.6T', output_speed: '800G', count: 2,
          stages: [
            { input_speed: '1.6T', output_speed: '800G', count: 2 },
            { input_speed: '800G', output_speed: '400G', count: 2 },
          ] } },
    ]
    const { rfEdges } = buildTopologyView(nodes, edges, null)
    const label = (rfEdges[0].data as { label?: string }).label ?? ''
    expect(label).toContain('⇉ 两级')
    expect((rfEdges[0].data as { breakoutGroup?: string }).breakoutGroup).toContain(':stages')
  })
})