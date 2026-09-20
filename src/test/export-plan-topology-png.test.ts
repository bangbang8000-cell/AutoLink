/**
 * V5.4.0-640-m（W3.3 / T-6S-D02）：交付包 plan 兜底路径携带分光（与 design 路径同约定）。
 *
 * exportPlanTopologyPng 由 plan.deviceList/connections → TopologyEdge → exportTopologyViewPng；
 * PNG 渲染依赖 DOM，故 mock exportTopologyView 校验「边构造」透出的 breakout。
 */
import { describe, it, expect, vi } from 'vitest'
import type { TopologyNode, TopologyEdge } from '@/stores/design.store'

const pngMock = vi.fn(async (_nodes: TopologyNode[], _edges: TopologyEdge[]) => 'data:image/png;base64,xxx')

vi.mock('@/utils/exportTopologyView', () => ({
  exportTopologyViewPng: (nodes: TopologyNode[], edges: TopologyEdge[]) => pngMock(nodes, edges),
}))

import { exportPlanTopologyPng } from '@/utils/exportPlanTopologyPng'

const plan = {
  deviceList: [
    { role: 'STO_LEAF', name: 'S-Leaf-01', rack: 1 },
    { role: 'STO_LEAF', name: 'S-Leaf-02', rack: 2 },
    { role: 'STO_SPINE', name: 'S-Spine-01', rack: 3 },
  ],
  connections: [
    // 存储分光：同一物理口 400G → 2×200G
    { src: 'S-Leaf-01', src_port: 'FourHundredGigE1/0/33', dst: 'S-Spine-01', rate: '400G', desc: '存储网络',
      breakout: { input_speed: '400G', output_speed: '200G', count: 2 } },
    // 无分光连接（1:1）
    { src: 'S-Leaf-02', src_port: 'TwoHundredGigE1/0/33', dst: 'S-Spine-01', rate: '200G', desc: '存储网络' },
  ],
} as never

describe('exportPlanTopologyPng 分光透出（W3.3 / T-6S-D02）', () => {
  it('plan.connections 带 breakout → 边透出同构分光对象（与 design 路径 TopologyEdge.breakout 一致）', async () => {
    pngMock.mockClear()
    await exportPlanTopologyPng(plan)
    const edges = pngMock.mock.calls[0]![1]
    const bySrc = Object.fromEntries(edges.map((e) => [e.source, e.breakout]))
    expect(bySrc['S-Leaf-01']).toEqual({ input_speed: '400G', output_speed: '200G', count: 2 })
    // 无 breakout 的连接恒为 1:1（null），不虚构分光
    expect(bySrc['S-Leaf-02']).toBeNull()
  })
})
