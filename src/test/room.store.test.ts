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
    })
    useToastStore.setState({ toasts: [] })
    vi.clearAllMocks()
    window.electron.project.getFile = vi.fn().mockResolvedValue(null)
    window.electron.project.saveFile = vi.fn().mockResolvedValue(true)
    window.electron.room.createMatrix = vi.fn().mockResolvedValue(makeMatrix())
    window.electron.room.validateLayout = vi.fn().mockResolvedValue({ valid: true, errors: [] })
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
})
