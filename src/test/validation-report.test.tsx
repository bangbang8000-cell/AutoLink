/**
 * 4.5 D-5 校验报告前端测试（F5-5）
 * - 校验 util：规划↔设计 / 设计内部 / 导出核对 / IP 规划 → 结构化报告
 * - 校验面板：一键校验、问题分组展示、导出报告 JSON
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { PlanSummary } from '@/components/aidc/aidcTypes'
import type { DesignSnapshot } from '@/utils/designSnapshot'
import type { OutputBatch } from '@/types/file-tree'
import {
  validateProject,
  checkIpPlan,
  validateSubnet,
  inferBatchMode,
  reportToJson,
} from '@/utils/validationReport'
import { useProjectStore } from '@/stores/project.store'
import { useRoomStore } from '@/stores/room.store'
import { useRackStore } from '@/stores/rack.store'
import { useValidationStore } from '@/stores/validation.store'
import { LogPanel } from '@/components/layout/LogPanel'
import { ValidationReportPanel } from '@/components/validation/ValidationReportPanel'

const plan = (gpu = 1, roles: Record<string, number> = { LEAF: 2, SPINE: 2 }): PlanSummary => ({
  meta: { project: 'aidc_8', site: 'BJ01', planHash: 'hash-1', planVersion: 1 },
  macro: { site: 'BJ01', gpuCount: gpu, ipSegments: { compute: '10.1.16.0/20', storage: '10.1.32.0/20' } },
  topology: { layers: 2, spines: roles.SPINE ?? 0, leaves: roles.LEAF ?? 0 },
  deviceList: Object.entries(roles).flatMap(([role, n]) =>
    Array.from({ length: n }, (_, i) => ({ role, name: `${role}_${i + 1}`, model: 'M' })),
  ),
  connections: [],
  terminals: [],
})

const design = (over: Partial<DesignSnapshot> = {}): DesignSnapshot => ({
  version: 1,
  meta: { format: 'autolink-design-snapshot', version: 1, savedAt: '2026-09-02T00:00:00.000Z' },
  matrix: null,
  cabinets: [
    {
      id: 1,
      name: 'C1',
      totalU: 42,
      type: 'gpu',
      power_limit: 6000,
      devices: [
        { id: 'g1', name: 'GPU_1', type: 'server', cabinetId: 1, startU: 1, endU: 4, power_watts: 1000 },
      ],
    },
    {
      id: 2,
      name: 'C2',
      totalU: 42,
      type: 'network',
      power_limit: 6000,
      devices: [
        { id: 's1', name: 'LEAF_1', type: 'network', cabinetId: 2, startU: 1, endU: 1, power_watts: 500 },
        { id: 's2', name: 'LEAF_2', type: 'network', cabinetId: 2, startU: 2, endU: 2, power_watts: 500 },
        { id: 's3', name: 'SPINE_1', type: 'network', cabinetId: 2, startU: 3, endU: 3, power_watts: 500 },
        { id: 's4', name: 'SPINE_2', type: 'network', cabinetId: 2, startU: 4, endU: 4, power_watts: 500 },
      ],
    },
  ],
  unplacedDevices: [],
  config: { topReservedU: 2, gpuPerCabinet: 1 },
  ...over,
})

const batches = (files: Array<{ name: string }>): OutputBatch[] => [
  {
    name: 'v1_ts',
    files: files.map((f) => ({ name: f.name, path: `output/v1_ts/${f.name}` })),
  },
]

describe('validateProject（T1-T3 纯函数）', () => {
  it('匹配的规划/设计/批次 → 报告通过、无问题', () => {
    const report = validateProject({
      plan: plan(),
      design: design(),
      batches: batches([
        { name: 'manifest.json' },
        { name: 'AI智算网络_full模式_1.xlsx' },
        { name: '设备清单_full模式_1.xlsx' },
      ]),
    })
    expect(report.summary.valid).toBe(true)
    expect(report.summary.total).toBe(0)
    expect(report.schemaVersion).toBe(1)
  })

  it('C001 规划 GPU 规模 vs 设计服务器数不一致 → error', () => {
    const report = validateProject({ plan: plan(8), design: design() })
    const p = report.problems.find((x) => x.ruleId === 'C001')
    expect(p?.severity).toBe('error')
    expect(p?.location).toContain('plan.macro.gpuCount')
  })

  it('C010 机柜 U 位冲突 → error', () => {
    const d = design()
    d.cabinets[1].devices = [
      { id: 'a', name: 'A', type: 'network', cabinetId: 2, startU: 1, endU: 10, power_watts: 100 },
      { id: 'b', name: 'B', type: 'network', cabinetId: 2, startU: 8, endU: 12, power_watts: 100 },
    ]
    const report = validateProject({ plan: plan(), design: d, batches: batches([{ name: 'AI智算网络_full模式_1.xlsx' }]) })
    expect(report.problems.some((x) => x.ruleId === 'C010')).toBe(true)
  })

  it('C011 U 位越界 / C012 功率超限 → error', () => {
    const d = design()
    d.cabinets[0].devices = [
      { id: 'g', name: 'GPU_1', type: 'server', cabinetId: 1, startU: 40, endU: 50, power_watts: 7000 },
    ]
    const report = validateProject({ plan: plan(8), design: d, batches: batches([{ name: 'AI智算网络_full模式_1.xlsx' }]) })
    expect(report.problems.some((x) => x.ruleId === 'C011')).toBe(true)
    expect(report.problems.some((x) => x.ruleId === 'C012')).toBe(true)
  })

  it('C013 未上架设备 → warning', () => {
    const d = design({ unplacedDevices: [{ id: 'u1', name: 'GPU_9', type: 'server', height: 4, power_watts: 1000 }] })
    const report = validateProject({ plan: plan(8), design: d, batches: batches([{ name: 'AI智算网络_full模式_1.xlsx' }]) })
    const p = report.problems.find((x) => x.ruleId === 'C013')
    expect(p?.severity).toBe('warning')
  })

  it('E001 无输出批次 → warning', () => {
    const report = validateProject({ plan: plan(), design: design(), batches: [] })
    expect(report.problems.some((x) => x.ruleId === 'E001')).toBe(true)
  })

  it('E006 多种模式文件名漂移 → warning', () => {
    const report = validateProject({
      plan: plan(),
      design: design(),
      batches: batches([{ name: 'AI智算网络_full模式_1.xlsx' }, { name: 'AI智算网络_custom模式_1.xlsx' }]),
    })
    expect(report.problems.some((x) => x.ruleId === 'E006')).toBe(true)
  })

  it('问题按严重度 error→warning→info 排序', () => {
    const d = design({
      unplacedDevices: [{ id: 'u1', name: 'GPU_9', type: 'server', height: 4, power_watts: 1000 }],
    })
    const report = validateProject({ plan: plan(16), design: d, batches: [] })
    const sevs = report.problems.map((p) => p.severity)
    const first = sevs.findIndex((s) => s === 'warning' || s === 'info')
    if (first >= 0) {
      expect(sevs.slice(0, first).every((s) => s === 'error')).toBe(true)
    }
  })
})

describe('IP 规划校验（前端）', () => {
  it('validateSubnet：合法 / 非法', () => {
    expect(validateSubnet('10.1.0.0/20').ok).toBe(true)
    expect(validateSubnet('10.1.0.0').ok).toBe(false)
    expect(validateSubnet('300.1.1.0/24').ok).toBe(false)
    expect(validateSubnet('10.1.0.0/40').ok).toBe(false)
  })

  it('IP002 子网重叠 → error', () => {
    const p = plan(8)
    p.macro.ipSegments = { compute: '10.1.0.0/16', storage: '10.1.16.0/20' }
    const problems = checkIpPlan(p)
    expect(problems.some((x) => x.ruleId === 'IP002')).toBe(true)
  })

  it('IP003 网关越界/重复 → error', () => {
    const p = plan(8)
    p.deviceList = [
      { role: 'LEAF', model: 'M', gateways: ['10.1.16.1'] },
      { role: 'LEAF', model: 'M', gateways: ['10.1.16.1'] },
      { role: 'LEAF', model: 'M', gateways: ['10.9.9.9'] },
    ]
    const problems = checkIpPlan(p)
    expect(problems.filter((x) => x.ruleId === 'IP003').length).toBeGreaterThanOrEqual(2)
  })
})

describe('工具函数', () => {
  it('inferBatchMode 从文件名推断模式', () => {
    expect(inferBatchMode([{ name: 'AI智算网络_full模式_1.xlsx' }])).toBe('full')
    expect(inferBatchMode([{ name: '设备清单_custom模式_1.xlsx' }])).toBe('custom')
    expect(inferBatchMode([{ name: 'manifest.json' }])).toBe('')
  })

  it('reportToJson 输出结构化 JSON', () => {
    const report = validateProject({ plan: plan(16), design: design(), batches: [] })
    const json = JSON.parse(reportToJson(report))
    expect(json.schemaVersion).toBe(1)
    expect(json.problems[0].location).toBeTruthy()
  })
})

describe('ValidationReportPanel（F5-5 面板）', () => {
  beforeEach(() => {
    useValidationStore.getState().reset()
    useProjectStore.setState({ projects: [], selectedProjectName: 'p1' })
    useRoomStore.setState({ matrix: null })
    useRackStore.setState({
      cabinets: design().cabinets,
      unplacedDevices: [],
      topReservedU: 2,
      gpuPerCabinet: 1,
    })
    // 补齐 window.electron 嵌套 mock（aidc.project.load / project.listOutputBatches / project.saveFile）
    const el = window.electron as unknown as Record<string, Record<string, unknown>>
    el.aidc = el.aidc ?? {}
    el.aidc.project = { load: vi.fn().mockResolvedValue({ plan: plan() }) }
    el.project = el.project ?? {}
    ;(el.project as { listOutputBatches: ReturnType<typeof vi.fn> }).listOutputBatches = vi.fn().mockResolvedValue([])
    ;(el.project as { saveFile: ReturnType<typeof vi.fn> }).saveFile = vi.fn().mockResolvedValue('/workspace/p1/output/report.json')
  })

  it('面板渲染一键校验按钮', () => {
    render(<ValidationReportPanel />)
    expect(screen.getByText('一键校验')).toBeInTheDocument()
  })

  it('LogPanel 含「校验」tab，点击切换到校验面板', () => {
    render(<LogPanel />)
    fireEvent.click(screen.getByText('校验'))
    expect(screen.getByText('一键校验')).toBeInTheDocument()
  })

  it('点击一键校验 → 展示报告汇总与问题（含导出按钮）', async () => {
    render(<ValidationReportPanel />)
    fireEvent.click(screen.getByText('一键校验'))
    await waitFor(() => {
      expect(screen.getByText(/问题/)).toBeInTheDocument()
    })
    // E001 无批次 warning 存在
    expect(screen.getByText(/无输出批次/)).toBeInTheDocument()
    // 导出按钮出现
    expect(document.querySelector('[title="导出校验报告 JSON"]')).toBeTruthy()
  })

  it('点击导出 → saveFile 写入 output/validation_report_*.json', async () => {
    render(<ValidationReportPanel />)
    fireEvent.click(screen.getByText('一键校验'))
    await waitFor(() => expect(screen.getByText(/问题/)).toBeInTheDocument())
    const exportBtn = document.querySelector('[title="导出校验报告 JSON"]') as HTMLButtonElement
    fireEvent.click(exportBtn)
    await waitFor(() =>
      expect(
        (window.electron as unknown as { project: { saveFile: ReturnType<typeof vi.fn> } }).project.saveFile,
      ).toHaveBeenCalledWith('p1', expect.stringMatching(/^output\/validation_report_.*\.json$/), expect.any(String)),
    )
  })
})
