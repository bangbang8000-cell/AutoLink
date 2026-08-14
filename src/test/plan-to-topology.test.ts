/**
 * D-9（H3）：plan → 整网拓扑图 适配器测试（准确性参照：设备/接线数与 plan 一致）。
 */
import { describe, it, expect } from 'vitest'
import { planToTopology } from '@/utils/planToTopology'

const samplePlan = {
  meta: { project: 'mini', site: 'BJ01', source: 'autolink', projectType: 'aidc', bridgeVersion: '1.0' },
  macro: { site: 'BJ01' },
  deviceList: [
    { role: 'SPINE', model: 'H3C S9827', name: 'BJ01-R01-AIDC-H3C-P-Spine-01', rack: 1, asn: 65111 },
    { role: 'LEAF', model: 'H3C S9827', name: 'BJ01-R02-AIDC-H3C-P-Leaf-01', rack: 2, asn: 65101, gateways: ['10.1.16.1'] },
    { role: 'LEAF', model: 'H3C S9827', name: 'BJ01-R03-AIDC-H3C-P-Leaf-02', rack: 3, asn: 65102 },
  ],
  connections: [
    { src: 'BJ01-R02-AIDC-H3C-P-Leaf-01', src_port: 'FourHundredGigE1/0/33', dst: 'SPINE', dst_ip: '10.1.72.2', rate: '400G' },
    { src: 'BJ01-R03-AIDC-H3C-P-Leaf-02', src_port: 'FourHundredGigE1/0/33', dst: 'SPINE', dst_ip: '10.1.72.3', rate: '400G' },
  ],
  terminals: [],
  protocols: {},
  convergence: {},
}

describe('planToTopology (D-9)', () => {
  it('设备数/接线数与 plan 一致（逐设备、每链路）', () => {
    const { nodes, edges } = planToTopology(samplePlan as never)
    expect(nodes.length).toBe(3)
    expect(edges.length).toBe(2)
    expect(edges[0].target).toContain('P-Spine-01') // dst 角色 → 真实设备
  })

  it('节点为独立设备（非聚合），带网络域分组', () => {
    const { nodes } = planToTopology(samplePlan as never)
    const ids = nodes.map((n) => n.id)
    expect(ids).toContain('BJ01-R02-AIDC-H3C-P-Leaf-01')
    expect(nodes.every((n) => (n.data?.group as string) === '参数网')).toBe(true)
  })
})
