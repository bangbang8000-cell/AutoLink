/**
 * 5.2.1-521-b/c：AIDC 规划「标记完成」+ 级联失效接线
 * - 绑定项目且生成规划后出现「标记完成」，点击 → workbench.store aidcDone 置位
 * - 未绑定项目不显示标记按钮（无法按项目标记）
 * - 重新生成规划 → aidcDone 撤销 + 下游（design 等）置"待调整"（级联失效）
 */
import '@/i18n'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { AidcPlannerPanel } from '@/components/aidc/AidcPlannerPanel'
import { useWorkbenchStore } from '@/stores/workbench.store'

const samplePlan = {
  meta: {
    project: 'aidc_64', site: 'BJ01', version: '1.1', schema: 'plan:table/1.1',
    generatedAt: '2026-08-14T00:00:00+00:00',
    source: 'autolink', projectType: 'aidc', bridgeVersion: '1.0',
  },
  macro: {
    site: 'BJ01', gpuCount: 64, pfcQueue: 3, cnpQueue: 6, bgpMaxPaths: 16,
    convergence: 1, rails: 8, asRange: [65001, 65500],
    naming: { format: '{site}-R{rack:02d}-AIDC-{vendor}-{abbr}-{seq:02d}', abbr: {} },
    deviceModels: { SPINE: 'H3C S9827', LEAF: 'H3C S9827' },
  },
  topology: { layers: 2, spines: 2, leaves: 8, pods: null, scale: { gpuCount: 64, spine: 2, leaf: 8 } },
  deviceList: [
    { role: 'SPINE', model: 'H3C S9827', name: 'BJ01-R01-AIDC-H3C-P-Spine-01', rack: 1, asn: 65111 },
    { role: 'LEAF', model: 'H3C S9827', name: 'BJ01-R03-AIDC-H3C-P-Leaf-01', rack: 3, asn: 65101 },
  ],
  connections: [
    { src: 'BJ01-R03-AIDC-H3C-P-Leaf-01', src_port: 'FourHundredGigE1/0/33', dst: 'SPINE', rate: '400G' },
  ],
  terminals: [{ src: 'BJ01-R03-AIDC-H3C-P-Leaf-01', src_port: 'TwoHundredGigE1/0/1:1', vlan: 100 }],
  protocols: { ospf: { process: 10, area: '0.0.0.0' }, bgp: { asRange: [65001, 65500], ecmp: 16 } },
  convergence: { compute: 1, storage: 1, biz: 1 },
}

function mockAidcPlan(resolved: unknown) {
  const plan = vi.fn().mockResolvedValue(resolved)
  ;(window as unknown as { electron: { aidc: { plan: typeof plan } } }).electron.aidc = { plan }
  return plan
}

describe('5.2.1-521-b AIDC 标记完成 + 级联失效', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    useWorkbenchStore.setState({ aidcDone: {}, stale: {}, configFingerprint: {}, planHash: {} })
  })

  it('绑定项目且生成规划后出现「标记完成」，点击 → aidcDone 置位并切换为「撤销完成」', async () => {
    mockAidcPlan(samplePlan)
    render(<AidcPlannerPanel boundProjectName="projA" />)
    fireEvent.click(screen.getByRole('button', { name: '生成规划' }))
    const markBtn = await screen.findByRole('button', { name: '标记完成' })
    fireEvent.click(markBtn)
    expect(useWorkbenchStore.getState().aidcDone['projA']).toBe(true)
    expect(screen.getByRole('button', { name: '撤销完成' })).toBeInTheDocument()
  })

  it('未绑定项目不显示标记按钮', async () => {
    mockAidcPlan(samplePlan)
    render(<AidcPlannerPanel />)
    fireEvent.click(screen.getByRole('button', { name: '生成规划' }))
    await screen.findByText(/aidc_64/)
    expect(screen.queryByRole('button', { name: '标记完成' })).not.toBeInTheDocument()
  })

  it('重新生成规划 → aidcDone 撤销 + 下游（design 等）置待调整', async () => {
    mockAidcPlan(samplePlan)
    render(<AidcPlannerPanel boundProjectName="projA" />)
    fireEvent.click(screen.getByRole('button', { name: '生成规划' }))
    fireEvent.click(await screen.findByRole('button', { name: '标记完成' }))
    expect(useWorkbenchStore.getState().aidcDone['projA']).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: '生成规划' }))
    await screen.findByText(/aidc_64/)
    expect(useWorkbenchStore.getState().aidcDone['projA']).toBeUndefined()
    expect(useWorkbenchStore.getState().getStale('projA')).toContain('design')
  })
})
