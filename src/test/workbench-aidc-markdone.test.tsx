/**
 * 5.2.1-521-b/c + 5.5.2 / A10/A12：AIDC 规划完成标记 + 级联失效接线
 * - 完成动作已收敛到工作台右上角统一动作条（SubviewActionBar），面板内不再提供按钮
 * - 重新生成规划 → 撤销 aidc 完成标记 + 下游（design 等）置"待调整"（级联失效）
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

describe('5.2.1-521-b AIDC 完成标记 + 级联失效（5.5.2 A10 收敛后）', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.clearAllMocks()
    useWorkbenchStore.setState({ stepDone: {}, stale: {}, configFingerprint: {}, planHash: {} })
  })

  it('面板内不提供「标记完成/撤销完成」（统一由右上角动作条承担）', async () => {
    mockAidcPlan(samplePlan)
    render(<AidcPlannerPanel boundProjectName="projA" />)
    fireEvent.click(screen.getByRole('button', { name: '生成规划' }))
    await screen.findByText(/aidc_64/)
    expect(screen.queryByRole('button', { name: '标记完成' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '撤销完成' })).not.toBeInTheDocument()
  })

  it('重新生成规划 → aidc 完成标记撤销 + 下游（design 等）置待调整', async () => {
    mockAidcPlan(samplePlan)
    useWorkbenchStore.getState().markStepDone('projA', 'aidc')
    render(<AidcPlannerPanel boundProjectName="projA" />)
    fireEvent.click(screen.getByRole('button', { name: '生成规划' }))
    await screen.findByText(/aidc_64/)
    expect(useWorkbenchStore.getState().getStepDone('projA', 'aidc')).toBeUndefined()
    expect(useWorkbenchStore.getState().getStale('projA')).toContain('design')
  })

  it('未绑定项目生成规划正常出图，不写完成状态', async () => {
    mockAidcPlan(samplePlan)
    render(<AidcPlannerPanel />)
    fireEvent.click(screen.getByRole('button', { name: '生成规划' }))
    await screen.findByText(/aidc_64/)
    expect(useWorkbenchStore.getState().stepDone).toEqual({})
  })
})
