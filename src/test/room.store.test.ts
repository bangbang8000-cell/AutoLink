import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRoomStore, checkMount, type RoomMatrixData } from '@/stores/room.store'
import { useRackStore, type RackCabinet } from '@/stores/rack.store'
import { useToastStore } from '@/stores/toast.store'

/** 构造 2 行 × 3 列的干净矩阵（全部 empty / 无占位 / 无机柜） */
const makeMatrix = (): RoomMatrixData => ({
  schemaVersion: 1,
  name: '机房 A',
  rows: ['A', 'B'],
  cols: [1, 2, 3],
  cells: [
    { row: 'A', col: 1, type: 'empty', placeholder: null, cabinetId: null },
    { row: 'A', col: 2, type: 'empty', placeholder: null, cabinetId: null },
    { row: 'A', col: 3, type: 'empty', placeholder: null, cabinetId: null },
    { row: 'B', col: 1, type: 'empty', placeholder: null, cabinetId: null },
    { row: 'B', col: 2, type: 'empty', placeholder: null, cabinetId: null },
    { row: 'B', col: 3, type: 'empty', placeholder: null, cabinetId: null },
  ],
})

/** 构造测试机柜（无设备默认） */
const makeCabinet = (overrides: Partial<RackCabinet> = {}): RackCabinet => ({
  id: 1,
  name: '机柜 1',
  totalU: 42,
  type: 'gpu',
  power_limit: 6000,
  devices: [],
  ...overrides,
})

describe('RoomStore', () => {
  beforeEach(() => {
    useRoomStore.setState({
      matrix: null,
      markTool: 'select',
      selectedPosition: null,
      multiSelected: [],
    })
    useToastStore.setState({ toasts: [] })
    vi.clearAllMocks()
    window.electron.project.getFile = vi.fn().mockResolvedValue(null)
    window.electron.project.saveFile = vi.fn().mockResolvedValue(true)
    window.electron.room.createMatrix = vi.fn().mockResolvedValue(makeMatrix())
    window.electron.room.validateLayout = vi.fn().mockResolvedValue({ valid: true, errors: [] })
    window.electron.room.optimize = vi.fn().mockResolvedValue({
      success: true,
      placements: [],
      scores: { power_balance: 1, thermal_zones: 1, network_locality: 1, shortest_cable: 1, total: 1 },
      issues: [],
      stats: { total_items: 0, placed: 0, unplaced: 0, elapsed_ms: 10 },
    })
  })

  describe('loadMatrix', () => {
    it('V3.0.4-T3-2: 成功解析 room_layout.json', async () => {
      window.electron.project.getFile = vi.fn().mockResolvedValue(JSON.stringify(makeMatrix()))
      await useRoomStore.getState().loadMatrix('P')
      expect(useRoomStore.getState().matrix).toEqual(makeMatrix())
      expect(window.electron.project.getFile).toHaveBeenCalledWith('P', 'room_layout.json')
    })

    it('无文件时矩阵为 null', async () => {
      await useRoomStore.getState().loadMatrix('P')
      expect(useRoomStore.getState().matrix).toBeNull()
    })

    it('结构非法（缺 cells）时矩阵为 null', async () => {
      window.electron.project.getFile = vi.fn().mockResolvedValue(JSON.stringify({ schemaVersion: 1, name: 'x' }))
      await useRoomStore.getState().loadMatrix('P')
      expect(useRoomStore.getState().matrix).toBeNull()
    })

    it('JSON 解析异常时提示并重置', async () => {
      window.electron.project.getFile = vi.fn().mockResolvedValue('{bad json')
      await useRoomStore.getState().loadMatrix('P')
      expect(useRoomStore.getState().matrix).toBeNull()
      expect(useToastStore.getState().toasts.some((t) => t.type === 'error')).toBe(true)
    })
  })

  describe('createMatrix', () => {
    it('行列为空时拒绝', async () => {
      const ok = await useRoomStore.getState().createMatrix('P', [], [1, 2])
      expect(ok).toBe(false)
      expect(useToastStore.getState().toasts.some((t) => t.type === 'error')).toBe(true)
    })

    it('Electron 桥接缺失时拒绝', async () => {
      delete (window.electron.room as { createMatrix?: unknown }).createMatrix
      const ok = await useRoomStore.getState().createMatrix('P', ['A'], [1])
      expect(ok).toBe(false)
    })

    it('后端返回 error 时拒绝并提示', async () => {
      window.electron.room.createMatrix = vi.fn().mockResolvedValue({ error: '矩阵规模超限' })
      const ok = await useRoomStore.getState().createMatrix('P', ['A'], [1])
      expect(ok).toBe(false)
      expect(useToastStore.getState().toasts.some((t) => t.message === '矩阵规模超限')).toBe(true)
    })

    it('创建成功并持久化', async () => {
      const ok = await useRoomStore.getState().createMatrix('P', ['A', 'B'], [1, 2, 3], '机房 A')
      expect(ok).toBe(true)
      expect(useRoomStore.getState().matrix).toEqual(makeMatrix())
      expect(window.electron.room.createMatrix).toHaveBeenCalledWith(['A', 'B'], [1, 2, 3], '机房 A')
      expect(window.electron.project.saveFile).toHaveBeenCalledWith(
        'P',
        'room_layout.json',
        expect.stringContaining('schemaVersion'),
      )
    })
  })

  describe('saveMatrix', () => {
    it('无矩阵时返回 false', async () => {
      const ok = await useRoomStore.getState().saveMatrix('P')
      expect(ok).toBe(false)
    })

    it('后端校验失败时拦截保存', async () => {
      useRoomStore.setState({ matrix: makeMatrix() })
      window.electron.room.validateLayout = vi
        .fn()
        .mockResolvedValue({ valid: false, errors: ['A1 超出设备域'] })
      const ok = await useRoomStore.getState().saveMatrix('P')
      expect(ok).toBe(false)
      expect(window.electron.project.saveFile).not.toHaveBeenCalled()
      expect(useToastStore.getState().toasts.some((t) => t.type === 'error')).toBe(true)
    })

    it('校验通过后写入文件并提示成功', async () => {
      useRoomStore.setState({ matrix: makeMatrix() })
      const ok = await useRoomStore.getState().saveMatrix('P')
      expect(ok).toBe(true)
      expect(window.electron.room.validateLayout).toHaveBeenCalled()
      expect(window.electron.project.saveFile).toHaveBeenCalledWith('P', 'room_layout.json', expect.any(String))
      expect(useToastStore.getState().toasts.some((t) => t.type === 'success')).toBe(true)
    })
  })

  describe('markTool', () => {
    it('setMarkTool 切换标记工具', () => {
      useRoomStore.getState().setMarkTool('pillar')
      expect(useRoomStore.getState().markTool).toBe('pillar')
    })
  })

  describe('markCell', () => {
    it('占位标记: ac 点击切换（再点清除）', () => {
      useRoomStore.setState({ matrix: makeMatrix(), markTool: 'ac' })
      useRoomStore.getState().markCell('A1')
      expect(useRoomStore.getState().matrix!.cells[0].placeholder).toBe('ac')
      useRoomStore.getState().markCell('A1')
      expect(useRoomStore.getState().matrix!.cells[0].placeholder).toBeNull()
    })

    it('占位标记: 标记时清除已挂载机柜', () => {
      const m = makeMatrix()
      m.cells[0].cabinetId = 7
      useRoomStore.setState({ matrix: m, markTool: 'pillar' })
      useRoomStore.getState().markCell('A1')
      const cell = useRoomStore.getState().matrix!.cells[0]
      expect(cell.placeholder).toBe('pillar')
      expect(cell.cabinetId).toBeNull()
    })

    it('类型标记: gpu 点击切换（再点变 empty）', () => {
      useRoomStore.setState({ matrix: makeMatrix(), markTool: 'gpu' })
      useRoomStore.getState().markCell('A1')
      expect(useRoomStore.getState().matrix!.cells[0].type).toBe('gpu')
      useRoomStore.getState().markCell('A1')
      expect(useRoomStore.getState().matrix!.cells[0].type).toBe('empty')
    })

    it('类型标记: 不覆盖占位格子', () => {
      const m = makeMatrix()
      m.cells[1].placeholder = 'ac'
      useRoomStore.setState({ matrix: m, markTool: 'storage' })
      useRoomStore.getState().markCell('A2')
      const cell = useRoomStore.getState().matrix!.cells[1]
      expect(cell.type).toBe('storage')
      expect(cell.placeholder).toBe('ac')
    })

    it('clear 清除标记与机柜', () => {
      const m = makeMatrix()
      m.cells[0] = { ...m.cells[0], type: 'gpu', placeholder: 'ac', cabinetId: 3 }
      useRoomStore.setState({ matrix: m, markTool: 'clear' })
      useRoomStore.getState().markCell('A1')
      const cell = useRoomStore.getState().matrix!.cells[0]
      expect(cell.type).toBe('empty')
      expect(cell.placeholder).toBeNull()
      expect(cell.cabinetId).toBeNull()
    })

    it('select 工具不修改格子', () => {
      const m = makeMatrix()
      useRoomStore.setState({ matrix: m, markTool: 'select' })
      useRoomStore.getState().markCell('A1')
      expect(useRoomStore.getState().matrix!.cells[0]).toEqual(m.cells[0])
    })

    it('未知位置不修改任何格子', () => {
      const m = makeMatrix()
      useRoomStore.setState({ matrix: m, markTool: 'gpu' })
      useRoomStore.getState().markCell('Z99')
      expect(useRoomStore.getState().matrix!.cells[0].type).toBe('empty')
    })

    it('标记后同步选中该位置', () => {
      useRoomStore.setState({ matrix: makeMatrix(), markTool: 'gpu' })
      useRoomStore.getState().markCell('B3')
      expect(useRoomStore.getState().selectedPosition).toBe('B3')
    })
  })

  describe('selectPosition / reset', () => {
    it('selectPosition 记录选中位置', () => {
      useRoomStore.getState().selectPosition('A2')
      expect(useRoomStore.getState().selectedPosition).toBe('A2')
    })

    it('reset 清空矩阵与选中', () => {
      useRoomStore.setState({ matrix: makeMatrix(), selectedPosition: 'A1' })
      useRoomStore.getState().reset()
      expect(useRoomStore.getState().matrix).toBeNull()
      expect(useRoomStore.getState().selectedPosition).toBeNull()
    })
  })

  describe('checkMount（T3-3 落位即时校验）', () => {
    it('占位格子阻止放置', () => {
      const m = makeMatrix()
      m.cells[0].placeholder = 'ac'
      const r = checkMount(makeCabinet(), m.cells[0])
      expect(r.ok).toBe(false)
      expect(r.errors[0]).toContain('占位')
    })

    it('机柜类型与格子类型域不匹配时阻止', () => {
      const m = makeMatrix()
      m.cells[0].type = 'gpu'
      const r = checkMount(makeCabinet({ type: 'storage' }), m.cells[0])
      expect(r.ok).toBe(false)
      expect(r.errors[0]).toContain('storage')
    })

    it('类型匹配时允许', () => {
      const m = makeMatrix()
      m.cells[0].type = 'gpu'
      const r = checkMount(makeCabinet({ type: 'gpu' }), m.cells[0])
      expect(r.ok).toBe(true)
      expect(r.errors).toHaveLength(0)
    })

    it('域外机柜类型（security/scaleup）任意格子可放', () => {
      const m = makeMatrix()
      m.cells[0].type = 'network'
      const r = checkMount(makeCabinet({ type: 'scaleup' }), m.cells[0])
      expect(r.ok).toBe(true)
    })

    it('combined/empty 格子任意机柜类型可放', () => {
      const m = makeMatrix()
      m.cells[0].type = 'combined'
      const r = checkMount(makeCabinet({ type: 'network' }), m.cells[0])
      expect(r.ok).toBe(true)
    })

    it('U 位溢出阻止', () => {
      const m = makeMatrix()
      const r = checkMount(
        makeCabinet({ devices: [{ id: 'd', name: 'd', type: 'x', cabinetId: 1, startU: 1, endU: 50, power_watts: 100 }] }),
        m.cells[0],
      )
      expect(r.ok).toBe(false)
      expect(r.errors[0]).toContain('U 位溢出')
    })

    it('功率超限阻止', () => {
      const m = makeMatrix()
      const r = checkMount(
        makeCabinet({ power_limit: 6000, devices: [{ id: 'd', name: 'd', type: 'x', cabinetId: 1, startU: 1, endU: 8, power_watts: 9000 }] }),
        m.cells[0],
      )
      expect(r.ok).toBe(false)
      expect(r.errors[0]).toContain('功率超限')
    })

    it('高功率密度产生散热警告但不阻塞', () => {
      const m = makeMatrix()
      const r = checkMount(
        makeCabinet({ power_limit: 50000, devices: [{ id: 'd', name: 'd', type: 'x', cabinetId: 1, startU: 1, endU: 8, power_watts: 20000 }] }),
        m.cells[0],
      )
      expect(r.ok).toBe(true)
      expect(r.warnings.some((w) => w.includes('散热'))).toBe(true)
    })
  })

  describe('mountCabinet（T3-3 拖拽上架/移动）', () => {
    beforeEach(() => {
      useRackStore.setState({ cabinets: [makeCabinet()] })
    })

    it('成功上架并选中', () => {
      useRoomStore.setState({ matrix: makeMatrix() })
      const r = useRoomStore.getState().mountCabinet('A1', 1)
      expect(r.ok).toBe(true)
      expect(useRoomStore.getState().matrix!.cells[0].cabinetId).toBe(1)
      expect(useRoomStore.getState().selectedPosition).toBe('A1')
    })

    it('占位格子拒绝上架并提示', () => {
      const m = makeMatrix()
      m.cells[0].placeholder = 'pillar'
      useRoomStore.setState({ matrix: m })
      const r = useRoomStore.getState().mountCabinet('A1', 1)
      expect(r.ok).toBe(false)
      expect(useRoomStore.getState().matrix!.cells[0].cabinetId).toBeNull()
      expect(useToastStore.getState().toasts.some((t) => t.type === 'error')).toBe(true)
    })

    it('目标格子已被其他机柜占用时拒绝', () => {
      const m = makeMatrix()
      m.cells[0].cabinetId = 2
      useRackStore.setState({ cabinets: [makeCabinet(), makeCabinet({ id: 2, name: '机柜 2' })] })
      useRoomStore.setState({ matrix: m })
      const r = useRoomStore.getState().mountCabinet('A1', 1)
      expect(r.ok).toBe(false)
      expect(useRoomStore.getState().matrix!.cells[0].cabinetId).toBe(2)
    })

    it('移动到新位置时自动清除原位置', () => {
      const m = makeMatrix()
      m.cells[0].cabinetId = 1
      useRoomStore.setState({ matrix: m })
      const r = useRoomStore.getState().mountCabinet('B2', 1)
      expect(r.ok).toBe(true)
      expect(useRoomStore.getState().matrix!.cells[0].cabinetId).toBeNull()
      expect(useRoomStore.getState().matrix!.cells[4].cabinetId).toBe(1)
    })

    it('矩阵未加载时拒绝', () => {
      const r = useRoomStore.getState().mountCabinet('A1', 1)
      expect(r.ok).toBe(false)
      expect(r.errors[0]).toContain('未加载')
    })

    it('机柜不存在时拒绝', () => {
      useRoomStore.setState({ matrix: makeMatrix() })
      const r = useRoomStore.getState().mountCabinet('A1', 99)
      expect(r.ok).toBe(false)
      expect(r.errors[0]).toContain('机柜不存在')
    })
  })

  describe('unmountCabinet（T3-3 卸载）', () => {
    it('清除已上架机柜', () => {
      const m = makeMatrix()
      m.cells[0].cabinetId = 1
      useRoomStore.setState({ matrix: m })
      const r = useRoomStore.getState().unmountCabinet('A1')
      expect(r.ok).toBe(true)
      expect(useRoomStore.getState().matrix!.cells[0].cabinetId).toBeNull()
    })

    it('空格子卸载为幂等成功', () => {
      useRoomStore.setState({ matrix: makeMatrix() })
      const r = useRoomStore.getState().unmountCabinet('A1')
      expect(r.ok).toBe(true)
      expect(useRoomStore.getState().matrix!.cells[0].cabinetId).toBeNull()
    })

    it('未知位置拒绝', () => {
      useRoomStore.setState({ matrix: makeMatrix() })
      const r = useRoomStore.getState().unmountCabinet('Z99')
      expect(r.ok).toBe(false)
    })
  })

  // ===== V3.1.4-T8-2: 机房智能落位 =====

  describe('runOptimize', () => {
    it('矩阵未加载时返回 null 并提示', async () => {
      const res = await useRoomStore.getState().runOptimize({ counts: { gpu: 2 } })
      expect(res).toBeNull()
      expect(useToastStore.getState().toasts.some((t) => t.type === 'error')).toBe(true)
    })

    it('缺 counts/cabinets 时拒绝', async () => {
      useRoomStore.setState({ matrix: makeMatrix() })
      const res = await useRoomStore.getState().runOptimize({})
      expect(res).toBeNull()
    })

    it('后端 success=false 时返回 null 并提示后端错误', async () => {
      useRoomStore.setState({ matrix: makeMatrix() })
      window.electron.room.optimize = vi.fn().mockResolvedValue({
        success: false, error: '矩阵解析失败', placements: [], scores: {}, issues: ['矩阵解析失败'],
        stats: { total_items: 0, placed: 0, unplaced: 0, elapsed_ms: null },
      })
      const res = await useRoomStore.getState().runOptimize({ counts: { gpu: 2 } })
      expect(res).toBeNull()
      expect(useToastStore.getState().toasts.some((t) => t.message === '矩阵解析失败')).toBe(true)
    })

    it('成功返回结果并携带当前矩阵', async () => {
      useRoomStore.setState({ matrix: makeMatrix() })
      const res = await useRoomStore.getState().runOptimize({ counts: { gpu: 2 } })
      expect(res).not.toBeNull()
      expect(window.electron.room.optimize).toHaveBeenCalledWith({
        matrix: makeMatrix(),
        counts: { gpu: 2 },
      })
    })
  })

  describe('optimizeCabinets', () => {
    const mockResult = () => ({
      success: true,
      placements: [{ position: 'A1', type: 'gpu', cabinetId: 1, powerWatts: 1000 }],
      scores: { power_balance: 0.9, thermal_zones: 0.8, network_locality: 0.7, shortest_cable: 0.6, total: 0.75 },
      issues: [],
      stats: { total_items: 1, placed: 1, unplaced: 0, elapsed_ms: 12 },
    })

    beforeEach(() => {
      window.electron.room.optimize = vi.fn().mockResolvedValue(mockResult())
    })

    it('默认仅提交未上架机柜（已上架保持不动）', async () => {
      useRackStore.setState({ cabinets: [
        makeCabinet(),                                  // id=1 未上架
        makeCabinet({ id: 2, name: '机柜 2' }),          // id=2 已上架
      ] })
      const m = makeMatrix()
      m.cells[0].cabinetId = 2
      useRoomStore.setState({ matrix: m })
      const res = await useRoomStore.getState().optimizeCabinets()
      expect(res).not.toBeNull()
      expect(window.electron.room.optimize).toHaveBeenCalledWith({
        matrix: m,
        cabinets: [{ id: 1, type: 'gpu', power_watts: 0 }],
        resetExisting: false,
      })
    })

    it('resetExisting=true 提交全部机柜', async () => {
      useRackStore.setState({ cabinets: [makeCabinet(), makeCabinet({ id: 2, name: '机柜 2' })] })
      const m = makeMatrix()
      m.cells[0].cabinetId = 1
      useRoomStore.setState({ matrix: m })
      const res = await useRoomStore.getState().optimizeCabinets({ resetExisting: true })
      expect(res).not.toBeNull()
      const called = (window.electron.room.optimize as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(called.cabinets).toHaveLength(2)
      expect(called.resetExisting).toBe(true)
    })

    it('未上架机柜为空时返回 null 并警告', async () => {
      useRackStore.setState({ cabinets: [makeCabinet()] })
      const m = makeMatrix()
      m.cells[0].cabinetId = 1
      useRoomStore.setState({ matrix: m })
      const res = await useRoomStore.getState().optimizeCabinets()
      expect(res).toBeNull()
      expect(useToastStore.getState().toasts.some((t) => t.type === 'warning')).toBe(true)
    })

    it('功率按设备累加', async () => {
      useRackStore.setState({ cabinets: [makeCabinet({
        devices: [
          { id: 'd1', name: 'd1', type: 'x', cabinetId: 1, startU: 1, endU: 4, power_watts: 3000 },
          { id: 'd2', name: 'd2', type: 'x', cabinetId: 1, startU: 5, endU: 8, power_watts: 2000 },
        ],
      })] })
      useRoomStore.setState({ matrix: makeMatrix() })
      const res = await useRoomStore.getState().optimizeCabinets()
      expect(res).not.toBeNull()
      const called = (window.electron.room.optimize as ReturnType<typeof vi.fn>).mock.calls[0][0]
      expect(called.cabinets[0].power_watts).toBe(5000)
    })
  })

  describe('optimizeCounts', () => {
    it('过滤零值数量并提交', async () => {
      useRoomStore.setState({ matrix: makeMatrix() })
      const res = await useRoomStore.getState().optimizeCounts({ gpu: 2, network: 0, storage: 3 })
      expect(res).not.toBeNull()
      expect(window.electron.room.optimize).toHaveBeenCalledWith({
        matrix: makeMatrix(),
        counts: { gpu: 2, storage: 3 },
      })
    })

    it('全零时返回 null 并提示', async () => {
      useRoomStore.setState({ matrix: makeMatrix() })
      const res = await useRoomStore.getState().optimizeCounts({ gpu: 0, network: 0 })
      expect(res).toBeNull()
      expect(useToastStore.getState().toasts.some((t) => t.type === 'error')).toBe(true)
    })
  })

  describe('applyOptimize（V3.1.4-T8-2）', () => {
    it('cabinets 模式：写入 cabinetId 并清除机柜旧位置', () => {
      const m = makeMatrix()
      m.cells[0].cabinetId = 1   // 机柜 1 原在 A1
      m.cells[2].type = 'gpu'    // A3 预标记 gpu（保持不动）
      useRoomStore.setState({ matrix: m })
      const r = useRoomStore.getState().applyOptimize({
        success: true,
        placements: [
          { position: 'B1', type: 'gpu', cabinetId: 1, powerWatts: 1000 },
          { position: 'B2', type: 'network', cabinetId: 2, powerWatts: 800 },
        ],
        scores: {}, issues: [],
        stats: { total_items: 2, placed: 2, unplaced: 0, elapsed_ms: 10 },
      })
      expect(r.ok).toBe(true)
      const cells = useRoomStore.getState().matrix!.cells
      expect(cells[0].cabinetId).toBeNull()         // A1 旧位置清除
      expect(cells[3].cabinetId).toBe(1)            // B1 新位置
      expect(cells[4].cabinetId).toBe(2)            // B2
      expect(cells[4].type).toBe('network')         // empty → 类型标记
      expect(cells[2].type).toBe('gpu')             // 预标记不覆盖
    })

    it('counts 模式（cabinetId=null）：类型标记可视化，不写 cabinetId', () => {
      useRoomStore.setState({ matrix: makeMatrix() })
      const r = useRoomStore.getState().applyOptimize({
        success: true,
        placements: [
          { position: 'A1', type: 'gpu', cabinetId: null, powerWatts: 0 },
          { position: 'A2', type: 'storage', cabinetId: null, powerWatts: 0 },
        ],
        scores: {}, issues: [],
        stats: { total_items: 2, placed: 2, unplaced: 0, elapsed_ms: 10 },
      })
      expect(r.ok).toBe(true)
      const cells = useRoomStore.getState().matrix!.cells
      expect(cells[0].type).toBe('gpu')
      expect(cells[0].cabinetId).toBeNull()
      expect(cells[1].type).toBe('storage')
    })

    it('counts 模式落在原有机柜格（清空重排）→ 移除旧机柜', () => {
      const m = makeMatrix()
      m.cells[0].cabinetId = 7
      useRoomStore.setState({ matrix: m })
      const r = useRoomStore.getState().applyOptimize({
        success: true,
        placements: [{ position: 'A1', type: 'gpu', cabinetId: null, powerWatts: 0 }],
        scores: {}, issues: [],
        stats: { total_items: 1, placed: 1, unplaced: 0, elapsed_ms: 10 },
      })
      expect(r.ok).toBe(true)
      const cell = useRoomStore.getState().matrix!.cells[0]
      expect(cell.cabinetId).toBeNull()
      expect(cell.type).toBe('gpu')
    })

    it('保留未参与方案的机柜（手动放置）', () => {
      const m = makeMatrix()
      m.cells[5].cabinetId = 9   // B3 机柜 9 未在方案中 → 保留
      useRoomStore.setState({ matrix: m })
      const r = useRoomStore.getState().applyOptimize({
        success: true,
        placements: [{ position: 'A1', type: 'gpu', cabinetId: 1, powerWatts: 0 }],
        scores: {}, issues: [],
        stats: { total_items: 1, placed: 1, unplaced: 0, elapsed_ms: 10 },
      })
      expect(r.ok).toBe(true)
      expect(useRoomStore.getState().matrix!.cells[5].cabinetId).toBe(9)
    })

    it('占位格被方案命中时跳过并报错', () => {
      const m = makeMatrix()
      m.cells[0].placeholder = 'ac'
      useRoomStore.setState({ matrix: m })
      const r = useRoomStore.getState().applyOptimize({
        success: true,
        placements: [{ position: 'A1', type: 'gpu', cabinetId: 1, powerWatts: 0 }],
        scores: {}, issues: [],
        stats: { total_items: 1, placed: 1, unplaced: 0, elapsed_ms: 10 },
      })
      expect(r.ok).toBe(false)
      expect(r.errors.some((e) => e.includes('占位'))).toBe(true)
      const cell = useRoomStore.getState().matrix!.cells[0]
      expect(cell.cabinetId).toBeNull()
      expect(cell.placeholder).toBe('ac')
    })

    it('无矩阵/无方案时拒绝', () => {
      expect(useRoomStore.getState().applyOptimize({ success: true, placements: [], scores: {}, issues: [], stats: { total_items: 0, placed: 0, unplaced: 0, elapsed_ms: null } }).ok).toBe(false)
      useRoomStore.setState({ matrix: makeMatrix() })
      expect(useRoomStore.getState().applyOptimize({ success: true, placements: [], scores: {}, issues: [], stats: { total_items: 0, placed: 0, unplaced: 0, elapsed_ms: null } }).ok).toBe(false)
    })
  })

  // ===== 打磨轮（v1.4 / AL-R2b）: 机柜类型微调 → 回写矩阵格子类型 =====

  describe('syncCabinetToCell', () => {
    it('已上架 gpu 柜改 storage → 格子类型回写', () => {
      const m = makeMatrix()
      m.cells[0].type = 'gpu'
      m.cells[0].cabinetId = 1
      useRoomStore.setState({ matrix: m })
      useRackStore.setState({ cabinets: [makeCabinet({ id: 1, type: 'storage' })] })
      useRoomStore.getState().syncCabinetToCell(1)
      expect(useRoomStore.getState().matrix!.cells[0].type).toBe('storage')
    })

    it('域外类型（security）不写回', () => {
      const m = makeMatrix()
      m.cells[0].type = 'gpu'
      m.cells[0].cabinetId = 1
      useRoomStore.setState({ matrix: m })
      useRackStore.setState({ cabinets: [makeCabinet({ id: 1, type: 'security' })] })
      useRoomStore.getState().syncCabinetToCell(1)
      expect(useRoomStore.getState().matrix!.cells[0].type).toBe('gpu')
    })

    it('未上架机柜为 no-op', () => {
      const m = makeMatrix()
      m.cells[0].type = 'gpu'
      useRoomStore.setState({ matrix: m })
      useRackStore.setState({ cabinets: [makeCabinet({ id: 1, type: 'storage' })] })
      useRoomStore.getState().syncCabinetToCell(1)
      expect(useRoomStore.getState().matrix!.cells[0].type).toBe('gpu')
    })

    it('combined 格不覆盖', () => {
      const m = makeMatrix()
      m.cells[0].type = 'combined'
      m.cells[0].cabinetId = 1
      useRoomStore.setState({ matrix: m })
      useRackStore.setState({ cabinets: [makeCabinet({ id: 1, type: 'network' })] })
      useRoomStore.getState().syncCabinetToCell(1)
      expect(useRoomStore.getState().matrix!.cells[0].type).toBe('combined')
    })

    it('等值时 matrix 引用不变（防死循环）', () => {
      const m = makeMatrix()
      m.cells[0].type = 'gpu'
      m.cells[0].cabinetId = 1
      useRoomStore.setState({ matrix: m })
      useRackStore.setState({ cabinets: [makeCabinet({ id: 1, type: 'gpu' })] })
      const before = useRoomStore.getState().matrix
      useRoomStore.getState().syncCabinetToCell(1)
      expect(useRoomStore.getState().matrix).toBe(before)
    })
  })

  // ===== 打磨轮（v1.4 / AL-R2c）: AIDC 机柜 = 矩阵（GPU 1柜1台） =====

  describe('applyMatrixRackLayout', () => {
    const gpuMatrix = (): RoomMatrixData => {
      const m = makeMatrix()
      m.cells[0].type = 'gpu' // A1 → gpu 格
      return m
    }
    const nodes = () => [
      { id: 'GPU服务器_1', type: 'server', group: 'GPU服务器组1', podid: 'pod-1', uHeight: 8, powerWatts: 1000 },
    ]

    beforeEach(() => {
      useRackStore.setState({ cabinets: [], unplacedDevices: [], selectedCabinetId: null })
    })

    it('有矩阵 → 建柜 + 写格子 + 双文件持久化', async () => {
      useRoomStore.setState({ matrix: gpuMatrix() })
      const saveFile = window.electron.project.saveFile as unknown as ReturnType<typeof vi.fn>
      const res = await useRoomStore.getState().applyMatrixRackLayout('P', nodes())
      expect(res.ok).toBe(true)
      expect(useRackStore.getState().cabinets.length).toBeGreaterThan(0)
      expect(useRackStore.getState().cabinets[0].type).toBe('gpu')
      expect(useRoomStore.getState().matrix!.cells.some((c) => c.cabinetId != null)).toBe(true)
      const saved = saveFile.mock.calls.map((c) => c[1] as string)
      expect(saved).toContain('rack_layout.json')
      expect(saved).toContain('room_layout.json')
    })

    it('无矩阵 → ok:false + warning 提示', async () => {
      const res = await useRoomStore.getState().applyMatrixRackLayout('P', nodes())
      expect(res.ok).toBe(false)
      expect(res.errors).toContain('机房矩阵未加载')
      expect(useToastStore.getState().toasts.some((t) => t.type === 'warning')).toBe(true)
    })

    it('空拓扑 → 无副作用返回', async () => {
      const m = makeMatrix()
      useRoomStore.setState({ matrix: m })
      const res = await useRoomStore.getState().applyMatrixRackLayout('P', [])
      expect(res.ok).toBe(true)
      expect(res.stats).toEqual({ gpu: 0, network: 0, storage: 0, compute: 0, mounted: 0, overflow: 0 })
      expect(useRackStore.getState().cabinets).toHaveLength(0)
      expect(useRoomStore.getState().matrix!.cells.every((c) => c.cabinetId == null)).toBe(true)
    })

    it('store 无矩阵但文件有 → loadMatrix 兜底后仍落位', async () => {
      window.electron.project.getFile = vi.fn().mockImplementation(
        async (_proj: string, file: string) => (file === 'room_layout.json' ? JSON.stringify(gpuMatrix()) : null),
      )
      const res = await useRoomStore.getState().applyMatrixRackLayout('P', nodes())
      expect(res.ok).toBe(true)
      expect(useRackStore.getState().cabinets.length).toBeGreaterThan(0)
    })
  })

  // ===== M4（AL-ED1/ED2/ED3）：机房编辑能力 store action =====

  describe('多选态（toggleMultiSelect / setMultiSelect / clearMultiSelect）', () => {
    beforeEach(() => {
      useRoomStore.setState({ matrix: makeMatrix(), multiSelected: [] })
    })

    it('toggle 选择/取消位置', () => {
      useRoomStore.getState().toggleMultiSelect('A1')
      expect(useRoomStore.getState().multiSelected).toEqual(['A1'])
      useRoomStore.getState().toggleMultiSelect('A1')
      expect(useRoomStore.getState().multiSelected).toEqual([])
    })

    it('setMultiSelect 覆盖 / clearMultiSelect 清空', () => {
      useRoomStore.getState().setMultiSelect(['A1', 'B2'])
      expect(useRoomStore.getState().multiSelected).toEqual(['A1', 'B2'])
      useRoomStore.getState().clearMultiSelect()
      expect(useRoomStore.getState().multiSelected).toEqual([])
    })
  })

  describe('selectSameType（M4/AL-ED2 全选同类）', () => {
    beforeEach(() => {
      useRackStore.setState({
        cabinets: [
          makeCabinet(),
          makeCabinet({ id: 2, name: '机柜 2' }),
          makeCabinet({ id: 3, name: '机柜 3', type: 'network' }),
        ],
      })
      const m = makeMatrix()
      m.cells[0].cabinetId = 1 // A1 → 柜1(gpu)
      m.cells[1].cabinetId = 2 // A2 → 柜2(gpu)
      m.cells[2].cabinetId = 3 // A3 → 柜3(network)
      useRoomStore.setState({ matrix: m, multiSelected: [] })
    })

    it('以格子对应机柜类型全选同类柜位置', () => {
      useRoomStore.getState().selectSameType('A1')
      const sel = useRoomStore.getState().multiSelected
      expect(sel).toContain('A1')
      expect(sel).toContain('A2')
      expect(sel).not.toContain('A3')
    })

    it('无对应机柜时按格子类型匹配', () => {
      const m = useRoomStore.getState().matrix!
      m.cells[0].cabinetId = null // A1 移除机柜（避免混入柜类型）
      m.cells[1].cabinetId = null // A2 移除机柜
      m.cells[3].type = 'gpu' // B1 类型标记 gpu（无柜）
      m.cells[4].type = 'gpu' // B2 类型标记 gpu
      useRoomStore.setState({ matrix: m })
      useRoomStore.getState().selectSameType('B1')
      expect(useRoomStore.getState().multiSelected).toEqual(['B1', 'B2'])
    })
  })

  describe('updateCellsBulk（M4/AL-ED3 框选批量改格子）', () => {
    it('批量改类型', () => {
      useRoomStore.setState({ matrix: makeMatrix() })
      const r = useRoomStore.getState().updateCellsBulk(['A1', 'B1'], { type: 'gpu' })
      expect(r.applied).toBe(2)
      const cells = useRoomStore.getState().matrix!.cells
      expect(cells[0].type).toBe('gpu')
      expect(cells[3].type).toBe('gpu')
    })

    it('带机柜的格子改类型 → 联动更新机柜类型', () => {
      const m = makeMatrix()
      m.cells[0].cabinetId = 1
      m.cells[0].type = 'gpu'
      useRoomStore.setState({ matrix: m })
      useRackStore.setState({ cabinets: [makeCabinet({ id: 1, type: 'gpu' })] })
      useRoomStore.getState().updateCellsBulk(['A1'], { type: 'storage' })
      expect(useRoomStore.getState().matrix!.cells[0].type).toBe('storage')
      expect(useRackStore.getState().cabinets.find((c) => c.id === 1)!.type).toBe('storage')
    })

    it('域外格子类型（combined/empty）不联动机柜', () => {
      const m = makeMatrix()
      m.cells[0].cabinetId = 1
      m.cells[0].type = 'gpu'
      useRoomStore.setState({ matrix: m })
      useRackStore.setState({ cabinets: [makeCabinet({ id: 1, type: 'gpu' })] })
      useRoomStore.getState().updateCellsBulk(['A1'], { type: 'empty' })
      expect(useRoomStore.getState().matrix!.cells[0].type).toBe('empty')
      expect(useRackStore.getState().cabinets.find((c) => c.id === 1)!.type).toBe('gpu')
    })

    it('设置占位时清除已挂载机柜', () => {
      const m = makeMatrix()
      m.cells[0].cabinetId = 1
      useRoomStore.setState({ matrix: m })
      useRackStore.setState({ cabinets: [makeCabinet({ id: 1 })] })
      useRoomStore.getState().updateCellsBulk(['A1'], { placeholder: 'ac' })
      const cell = useRoomStore.getState().matrix!.cells[0]
      expect(cell.placeholder).toBe('ac')
      expect(cell.cabinetId).toBeNull()
    })

    it('未知位置被忽略', () => {
      useRoomStore.setState({ matrix: makeMatrix() })
      const r = useRoomStore.getState().updateCellsBulk(['Z99'], { type: 'gpu' })
      expect(r.applied).toBe(0)
      expect(useRoomStore.getState().matrix!.cells.every((c) => c.type === 'empty')).toBe(true)
    })
  })

  describe('clearCellsBulk / deleteCellsBulk（M4/AL-ED3 清空/删除）', () => {
    it('clearCellsBulk 清空标记/占位/机柜（机柜保留未上架）', () => {
      const m = makeMatrix()
      m.cells[0] = { ...m.cells[0], type: 'gpu', placeholder: 'ac', cabinetId: 1 }
      m.cells[1] = { ...m.cells[1], type: 'network', cabinetId: 2 }
      useRoomStore.setState({ matrix: m })
      useRackStore.setState({ cabinets: [makeCabinet({ id: 1 }), makeCabinet({ id: 2, name: '机柜 2' })] })
      const r = useRoomStore.getState().clearCellsBulk(['A1', 'A2'])
      expect(r.applied).toBe(2)
      const cells = useRoomStore.getState().matrix!.cells
      expect(cells[0]).toMatchObject({ type: 'empty', placeholder: null, cabinetId: null })
      expect(cells[1].cabinetId).toBeNull()
      expect(useRackStore.getState().cabinets.map((c) => c.id)).toEqual([1, 2])
    })

    it('deleteCellsBulk 清空并删除机柜', () => {
      const m = makeMatrix()
      m.cells[0].cabinetId = 1
      useRoomStore.setState({ matrix: m })
      useRackStore.setState({ cabinets: [makeCabinet({ id: 1 })] })
      const r = useRoomStore.getState().deleteCellsBulk(['A1'])
      expect(r.applied).toBe(1)
      expect(useRoomStore.getState().matrix!.cells[0].cabinetId).toBeNull()
      expect(useRackStore.getState().cabinets).toHaveLength(0)
    })
  })
})
