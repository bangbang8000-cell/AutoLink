/**
 * B1-10（FR-A08）：规划阶段「机房容量建议」卡片测试
 * - T-B1-21 人工调整偏离标注
 * - T-B1-22 采用建议门槛（矩阵空直接采用 / 非空二次确认）
 * - T-B1-23 清单翻倍只提示漂移，不改编矩阵
 * - T-B1-26 三处同源（规划卡 / 差额条 / 预检总柜位同一口径）
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { WorkbenchCapacityCard } from '@/components/workbench/WorkbenchCapacityCard'
import { RoomDesignTab } from '@/components/workspace/tabs/RoomDesignTab'
import { ProjectProvider } from '@/stores/ProjectContext'
import { useDesignStore, type TopologyNode } from '@/stores/design.store'
import { useRoomStore, type RoomMatrixData } from '@/stores/room.store'
import { useToastStore } from '@/stores/toast.store'
import { estimateCabinetDemand } from '@/utils/cabinetDemand'
import { checkRackFeasibility } from '@/utils/rackFeasibility'

const makeGpuNodes = (n: number): TopologyNode[] =>
  Array.from({ length: n }, (_, i) => ({
    id: `gpu-${i + 1}`,
    type: 'server',
    group: 'GPU服务器',
    domain: 'gpu',
    podid: 'p1',
    uHeight: 8,
    powerWatts: 6000,
  }))

const makeTypedMatrix = (
  rowCount: number,
  colCount: number,
  type: RoomMatrixData['cells'][number]['type'],
): RoomMatrixData => {
  const rows = Array.from({ length: rowCount }, (_, i) => `R${i + 1}`)
  const cols = Array.from({ length: colCount }, (_, i) => i + 1)
  const cells = rows.flatMap((row) =>
    cols.map((col) => ({ row, col, type, placeholder: null, cabinetId: null })),
  )
  return { schemaVersion: 1, name: '机房 A', rows, cols, cells, finalized: false }
}

type ElectronMock = {
  electron: {
    room: { createMatrix: ReturnType<typeof vi.fn>; validateLayout: ReturnType<typeof vi.fn> }
    project: { getFile: ReturnType<typeof vi.fn>; saveFile: ReturnType<typeof vi.fn> }
  }
}

const bridge = () => window as unknown as ElectronMock

const setTopology = (n: number) => {
  useDesignStore.setState({ topology: { nodes: makeGpuNodes(n), edges: [] } })
}

beforeEach(() => {
  useRoomStore.setState({ matrix: null, selectedPosition: null })
  useDesignStore.setState({ topology: null })
  useToastStore.setState({ toasts: [] })
  bridge().electron.room.createMatrix = vi.fn(async (rows: string[], cols: number[], name?: string) => ({
    schemaVersion: 1,
    name: name ?? '机房 A',
    rows,
    cols,
    cells: rows.flatMap((row) => cols.map((col) => ({ row, col, type: 'empty', placeholder: null, cabinetId: null }))),
    finalized: false,
  }))
  bridge().electron.room.validateLayout = vi.fn().mockResolvedValue({ valid: true, errors: [] })
  bridge().electron.project.saveFile = vi.fn().mockResolvedValue(true)
  bridge().electron.project.getFile = vi.fn().mockResolvedValue(null)
  // ProjectProvider 挂载需要 workspace 路径
  ;(window as unknown as { electron: { app: { getPath: ReturnType<typeof vi.fn> } } }).electron.app.getPath =
    vi.fn().mockResolvedValue('/workspace')
})

describe('B1-10 规划阶段容量建议卡（FR-A08）', () => {
  it('T-B1-21 手改每排柜数 → 显示人工调整与偏离量，计算值仍可见', async () => {
    setTopology(168)
    render(<WorkbenchCapacityCard projectName="p1" />)

    expect(await screen.findByText(/需 168 柜（GPU 168 \/ 网络 0 \/ 存储 0 \/ 通算 0）/)).toBeInTheDocument()
    expect(screen.getByText(/建议 8 排 × 24 列/)).toBeInTheDocument()
    expect(screen.getByText(/估算 面积 504 m² · 总功率 1008 kW · 制冷 1008 kW/)).toBeInTheDocument()

    // 每排 20 → 行数自动 = ceil(185 / 20) = 10 → 人工 200 柜，偏离 +15
    fireEvent.change(screen.getByLabelText('每排柜数'), { target: { value: '20' } })
    expect(await screen.findByText('人工调整（偏离计算值 +15 柜）')).toBeInTheDocument()
    // 计算值保持可见（不可被人工值覆盖）
    expect(screen.getByText(/需 168 柜（GPU 168/)).toBeInTheDocument()
    expect(screen.getByText(/建议 8 排 × 24 列/)).toBeInTheDocument()

    // 每排 30 → 行数 ceil(185/30)=7 → 210 柜，偏离 +25
    fireEvent.change(screen.getByLabelText('每排柜数'), { target: { value: '30' } })
    expect(await screen.findByText('人工调整（偏离计算值 +25 柜）')).toBeInTheDocument()
  })

  it('T-B1-22 矩阵为空 → 点「采用建议」直接写回建议行列', async () => {
    setTopology(168)
    render(<WorkbenchCapacityCard projectName="p1" />)
    fireEvent.click(await screen.findByRole('button', { name: '采用建议' }))

    await waitFor(() => expect(bridge().electron.room.createMatrix).toHaveBeenCalledTimes(1))
    const [rows, cols, name] = bridge().electron.room.createMatrix.mock.calls[0] as [string[], number[], string]
    expect(rows).toEqual(['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8'])
    expect(cols).toEqual(Array.from({ length: 24 }, (_, i) => i + 1))
    expect(name).toBe('机房 A')
  })

  it('T-B1-22 矩阵非空 → 首次点击只弹二次确认，确认后才写回', async () => {
    setTopology(168)
    useRoomStore.setState({ matrix: makeTypedMatrix(6, 10, 'gpu') })
    render(<WorkbenchCapacityCard projectName="p1" />)

    fireEvent.click(await screen.findByRole('button', { name: '采用建议' }))
    expect(bridge().electron.room.createMatrix).not.toHaveBeenCalled()
    expect(screen.getByText(/矩阵已有柜位，采用建议将重建为 8 排 × 24 列/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '确认重建' }))
    await waitFor(() => expect(bridge().electron.room.createMatrix).toHaveBeenCalledTimes(1))
  })

  it('T-B1-23 清单翻倍 → 只提示需求已变，矩阵结构逐字段不变', async () => {
    setTopology(168)
    const matrix = makeTypedMatrix(6, 10, 'gpu')
    useRoomStore.setState({ matrix })

    render(<WorkbenchCapacityCard projectName="p1" />)
    expect(await screen.findByText(/需 168 柜/)).toBeInTheDocument()
    expect(screen.queryByText(/需求已变/)).not.toBeInTheDocument()

    // 清单翻倍：168 → 336（计算值 185 → 370）
    act(() => setTopology(336))
    expect(
      await screen.findByText(/需求已变（原 185 柜 → 现 370 柜），当前矩阵 60 柜位/),
    ).toBeInTheDocument()

    // 不自动覆盖：矩阵行/列/格保持原样，且从未写回
    const after = useRoomStore.getState().matrix
    expect(after).toEqual(matrix)
    expect(bridge().electron.room.createMatrix).not.toHaveBeenCalled()

    // 重算只重置基线，不动矩阵
    fireEvent.click(screen.getByRole('button', { name: '重算' }))
    expect(screen.queryByText(/需求已变/)).not.toBeInTheDocument()
    expect(useRoomStore.getState().matrix).toEqual(matrix)
  })

  it('T-B1-26 三处同源：规划卡需求数 = 差额条需求数 = 预检总柜位', async () => {
    const matrix = makeTypedMatrix(14, 12, 'gpu')
    const nodes = makeGpuNodes(168)
    useRoomStore.setState({ matrix })
    useDesignStore.setState({ topology: { nodes, edges: [] } })
    bridge().electron.project.getFile = vi.fn(async (_p: string, file: string) =>
      file === 'room_layout.json' ? JSON.stringify(matrix) : null,
    )

    render(
      <ProjectProvider>
        <WorkbenchCapacityCard projectName="p1" />
        <RoomDesignTab projectName="p1" />
      </ProjectProvider>,
    )

    // 规划卡：需 168 柜（A07 精确需求）
    expect(await screen.findByText(/需 168 柜（GPU 168/)).toBeInTheDocument()
    // 差额条：柜位 168 / 需求 168
    expect(await screen.findByText('柜位 168 / 需求 168')).toBeInTheDocument()

    // 三处同源：独立重算结果必须一致（任何一处另起口径即失败）
    const estimate = estimateCabinetDemand(nodes)
    const feasibility = checkRackFeasibility(matrix, nodes)
    expect(estimate.totalCabinets).toBe(168)
    expect(feasibility.requiredCabinets).toBe(estimate.totalCabinets)
    expect(feasibility.capacity.slots).toBe(168)
  })
})
