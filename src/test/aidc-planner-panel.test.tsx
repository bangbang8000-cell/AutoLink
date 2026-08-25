/**
 * AidcPlannerPanel 组件测试（G1：REQ-A1/A2）。
 * - 生成规划后展示 v1.1 摘要 + 桥接标识 chip + 设备/接线/终端计数
 * - 高级宏观参数可编辑并随请求下发
 * - 视图 tab（设备/接线/终端/宏观；v1.3 起拓扑/机柜由工作台设计子视图提供）
 */
import '@/i18n'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AidcPlannerPanel } from '@/components/aidc/AidcPlannerPanel'
import { exportDeliveryZip } from '@/utils/aidcDelivery'

// exportDeliveryZip 附带拓扑 PNG：mock 避免 jsdom 无 ResizeObserver 触发 react-flow 渲染
vi.mock('@/utils/exportPlanTopologyPng', () => ({
  exportPlanTopologyPng: vi.fn().mockResolvedValue('data:image/png;base64,mock'),
}))

const samplePlan = {
  meta: {
    project: 'aidc_64', site: 'BJ01', version: '1.1', schema: 'plan:table/1.1',
    generatedAt: '2026-08-14T00:00:00+00:00',
    source: 'autolink', projectType: 'aidc', bridgeVersion: '1.0',
  },
  macro: {
    site: 'BJ01', gpuCount: 64, pfcQueue: 3, cnpQueue: 6, bgpMaxPaths: 16,
    convergence: 1, rails: 8, asRange: [65001, 65500],
    vlanRanges: { compute: [100, 199], storage: [200, 299], biz: [300, 399], oob: [400, 499] },
    naming: { format: '{site}-R{rack:02d}-AIDC-{vendor}-{abbr}-{seq:02d}', abbr: {} },
    ipSegments: { loopback: '10.1.0.0/20' },
    ospf: { process: 10, area: '0.0.0.0' },
    deviceModels: { SPINE: 'H3C S9827', LEAF: 'H3C S9827' },
  },
  topology: { layers: 2, spines: 2, leaves: 8, pods: null, scale: { gpuCount: 64, spine: 2, leaf: 8 } },
  deviceList: [
    { role: 'SPINE', model: 'H3C S9827', name: 'BJ01-R01-AIDC-H3C-P-Spine-01', rack: 1, asn: 65111 },
    { role: 'LEAF', model: 'H3C S9827', name: 'BJ01-R03-AIDC-H3C-P-Leaf-01', rack: 3, asn: 65101, gateways: ['10.1.16.1'] },
    { role: 'LEAF', model: 'H3C S9827', name: 'BJ01-R04-AIDC-H3C-P-Leaf-02', rack: 4, asn: 65102 },
  ],
  connections: [
    { src: 'BJ01-R03-AIDC-H3C-P-Leaf-01', src_port: 'FourHundredGigE1/0/33', dst: 'SPINE', dst_ip: '10.1.72.2', rate: '400G', desc: 'to-P-Spine-1' },
  ],
  terminals: [
    { src: 'BJ01-R03-AIDC-H3C-P-Leaf-01', src_port: 'TwoHundredGigE1/0/1:1', vlan: 100, desc: 'GPU-1-0' },
  ],
  protocols: { ospf: { process: 10, area: '0.0.0.0' }, bgp: { asRange: [65001, 65500], ecmp: 16 } },
  convergence: { compute: 1, storage: 1, biz: 1 },
}

function mockAidcPlan(resolved: unknown) {
  const plan = vi.fn().mockResolvedValue(resolved)
  ;(window as unknown as { electron: { aidc: { plan: typeof plan } } }).electron.aidc = { plan }
  return plan
}

describe('AidcPlannerPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('生成规划后展示 v1.1 摘要、桥接标识与计数', async () => {
    mockAidcPlan(samplePlan)
    render(<AidcPlannerPanel />)
    fireEvent.click(screen.getByRole('button', { name: '生成规划' }))

    expect(await screen.findByText(/aidc_64/)).toBeInTheDocument()
    expect(screen.getByText(/PFC=3/)).toBeInTheDocument()
    expect(screen.getByText(/桥接 autolink\/aidc\/v1.0/)).toBeInTheDocument()
    expect(screen.getByText(/3 台/)).toBeInTheDocument()
    expect(screen.getByText(/接线 1/)).toBeInTheDocument()
    // v1.3：独立拓扑/机柜 Tab 移除（统一由工作台设计子视图提供）
    for (const label of ['设备清单', '接线', '终端', '宏观参数']) {
      expect(screen.getByRole('tab', { name: label })).toBeInTheDocument()
    }
  })

  it('高级宏观参数编辑后随请求下发（camelCase/snake_case 转换）', async () => {
    const plan = mockAidcPlan(samplePlan)
    render(<AidcPlannerPanel />)
    // 展开高级参数
    fireEvent.click(screen.getByRole('button', { name: /高级宏观参数/ }))
    fireEvent.change(screen.getByLabelText('收敛比'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('AS 起始'), { target: { value: '65100' } })
    fireEvent.click(screen.getByRole('button', { name: '生成规划' }))

    await screen.findByText(/aidc_64/)
    expect(plan).toHaveBeenCalledTimes(1)
    const args = plan.mock.calls[0][0]
    expect(args.convergence).toBe(2)
    expect(args.as_range).toEqual([65100, 65500])
    expect(args.vlan_ranges.compute).toEqual([100, 199])
    expect(args.gpu_count).toBe(64)
  })

  it('后端报错时显示错误信息', async () => {
    mockAidcPlan({ error: 'GPU 规模 96 不在支持档位（[32, 64, 128, 256, 512, 1024]）' })
    render(<AidcPlannerPanel />)
    fireEvent.click(screen.getByRole('button', { name: '生成规划' }))
    expect(await screen.findByText(/GPU 规模 96 不在支持档位/)).toBeInTheDocument()
  })

  it('exportDeliveryZip：读项目 plan → exportPlan zip 交付包（导出收敛 T1）', async () => {
    const exportPlan = vi.fn().mockResolvedValue({ ok: true, path: 'C:/delivery.zip' })
    const load = vi.fn().mockResolvedValue({ ok: true, name: 'aidc_64', plan: samplePlan })
    const win = window as unknown as { electron: { aidc: { plan: unknown; exportPlan: typeof exportPlan; project: { load: typeof load } } } }
    win.electron.aidc.exportPlan = exportPlan
    win.electron.aidc.project = { load }

    const res = await exportDeliveryZip('aidc_64')
    expect(res.path).toBe('C:/delivery.zip')
    expect(exportPlan).toHaveBeenCalledTimes(1)
    expect(exportPlan.mock.calls[0][1]).toBe('zip')
    expect(exportPlan.mock.calls[0][0]).toEqual(expect.objectContaining({ gpu_count: 64 }))
  })

  it('exportDeliveryZip：项目无 AIDC 规划时返回 noPlan', async () => {
    const exportPlan = vi.fn()
    const load = vi.fn().mockResolvedValue({ ok: true, name: 'aidc_64', plan: null })
    const win = window as unknown as { electron: { aidc: { plan: unknown; exportPlan: typeof exportPlan; project: { load: typeof load } } } }
    win.electron.aidc.exportPlan = exportPlan
    win.electron.aidc.project = { load }

    const res = await exportDeliveryZip('aidc_64')
    expect(res.noPlan).toBe(true)
    expect(exportPlan).not.toHaveBeenCalled()
  })
})
