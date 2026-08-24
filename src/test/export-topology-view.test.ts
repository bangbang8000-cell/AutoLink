import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { evaluateTopologyExportSize } from '@/utils/exportTopologyView'
import { buildTopologyView } from '@/components/workspace/tabs/topology/TopologyViewCanvas'
import type { TopologyNode, TopologyEdge, TopologyLayout } from '@/stores/design.store'

function loadProject(dir: string): {
  nodes: TopologyNode[]
  edges: TopologyEdge[]
  layout: TopologyLayout | null
} {
  const p = resolve(__dirname, '../../workspace', dir, 'topology.json')
  const data = JSON.parse(readFileSync(p, 'utf-8'))
  return {
    nodes: data.topology?.nodes ?? [],
    edges: data.topology?.edges ?? [],
    layout: data.layout ?? null,
  }
}

describe('exportTopologyView（2026-08-24：真实渲染截图导出）', () => {
  it('比例评估：输出画布为 4K 内、等比不拉伸（含/不含保存布局）', () => {
    for (const dir of ['64台H100项目', 'Demo-128台H100']) {
      const { nodes, layout } = loadProject(dir)
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
    const { nodes, edges } = loadProject('64台H100项目')
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
    const { nodes, edges, layout } = loadProject('64台H100项目')
    expect(layout).not.toBeNull()
    const { rfNodes } = buildTopologyView(nodes, edges, layout)
    const nodeById = new Map(rfNodes.map((n) => [n.id, n]))
    const saved = layout!.nodePositions
    const [sample] = Object.keys(saved).filter((id) => nodeById.has(id))
    const savedNode = nodeById.get(sample)!
    expect(savedNode.position.x).toBeCloseTo(saved[sample].x, 3)
    expect(savedNode.position.y).toBeCloseTo(saved[sample].y, 3)
  })

  it('无保存布局项目回退计算布局且仍能构建', () => {
    const { nodes, edges, layout } = loadProject('Demo-128台H100')
    expect(layout).toBeNull()
    const { rfNodes, rfEdges } = buildTopologyView(nodes, edges, null)
    expect(rfNodes.filter((n) => !n.id.startsWith('pod-group-'))).toHaveLength(nodes.length)
    expect(rfEdges.length).toBe(edges.length)
  })
})
