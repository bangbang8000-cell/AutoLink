/**
 * M3（AL-CP1/CP2）：机柜/设备 复制粘贴（应用内剪贴板）单测
 *
 * 覆盖（PRD v3.3 / 开发计划 M3 AL-CP1a/AL-CP2a/AL-CP1b）：
 * - C-1 机柜复制 → 粘贴到目标柜（名称保留/类型/功率/设备复制 + U 位映射 + 冲突明细）
 * - C-2 机柜粘贴冲突明细（occupied / top_reserved / overflow / power）
 * - C-3 粘贴到新柜（名称后缀「-副本」/「-副本2」+ 类型/功率/设备复制）
 * - C-4 设备复制 → 粘贴到指定 U 位（U 位冲突被拒）/ 自动找位
 * - C-5 空剪贴板 no-op（不压撤销栈）
 * - C-6 撤销可回退粘贴（机柜/设备/新柜）
 * - clipboard 态：hasClipboard / clearClipboard
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useRackStore, type RackCabinet, type RackDevice, type CabinetType } from '../stores/rack.store'

const cab = (id: number, name: string, over: Partial<RackCabinet> = {}): RackCabinet => ({
  id, name, totalU: 42, type: 'gpu' as CabinetType, power_limit: 6000, devices: [], ...over,
})
const dev = (id: string, name: string, startU: number, endU: number, power = 1000): RackDevice => ({
  id, name, type: 'GPU Server', cabinetId: 1, startU, endU, power_watts: power,
})

describe('RackStore 复制/粘贴（AL-CP1/CP2）', () => {
  beforeEach(() => {
    useRackStore.setState({
      cabinets: [],
      unplacedDevices: [],
      selectedCabinetId: null,
      selectedDevice: null,
      addDeviceMode: false,
      editingDevice: null,
      topReservedU: 2,
      gpuPerCabinet: 1,
      undoStack: [],
      redoStack: [],
      canUndo: false,
      canRedo: false,
      clipboard: null,
    })
  })

  describe('C-1 机柜复制 → 粘贴到目标柜', () => {
    it('复制机柜进剪贴板（深拷贝）→ hasClipboard 为真', () => {
      useRackStore.setState({ cabinets: [cab(1, '机柜 A1', { devices: [dev('gpu-1', 'GPU服务器_1', 2, 9, 5000)] })] })
      const ok = useRackStore.getState().copyCabinet(1)
      expect(ok).toBe(true)
      const s = useRackStore.getState()
      expect(s.hasClipboard('cabinet')).toBe(true)
      expect(s.hasClipboard('device')).toBe(false)
      expect(s.clipboard?.type).toBe('cabinet')
      expect(s.clipboard?.sourceCabinetId).toBe(1)
      // 深拷贝：修改源柜不影响剪贴板
      useRackStore.getState().updateCabinet(1, { name: '改名' })
      expect(s.clipboard?.type === 'cabinet' && s.clipboard.cabinet.name).toBe('机柜 A1')
    })

    it('粘贴到目标柜：设备/类型/功率复制 + U 位映射', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [
          cab(1, '机柜 A1', { devices: [dev('gpu-1', 'GPU服务器_1', 2, 9, 5000), dev('sw-1', '交换机_1', 30, 30, 300)] }),
          cab(2, '机柜 A2', { type: 'network' as CabinetType, totalU: 42 }),
        ],
      })
      useRackStore.getState().copyCabinet(1)
      const r = useRackStore.getState().pasteCabinet(2)
      expect(r.applied).toBe(2)
      expect(r.skipped).toBe(0)
      expect(r.conflicts).toEqual([])
      const target = useRackStore.getState().cabinets.find((c) => c.id === 2)!
      const gpu = target.devices.find((d) => d.name === 'GPU服务器_1')!
      expect(gpu).toBeDefined()
      expect(gpu.power_watts).toBe(5000)
      expect(gpu.type).toBe('GPU Server')
      expect(gpu.startU).toBe(2)
      expect(gpu.endU).toBe(9)
      expect(gpu.cabinetId).toBe(2)
      expect(target.devices.find((d) => d.name === '交换机_1')).toBeDefined()
      // 类型/功率同步到目标柜
      expect(target.type).toBe('gpu')
      expect(target.power_limit).toBe(6000)
      expect(target.totalU).toBe(42)
      // 源柜不受影响
      expect(useRackStore.getState().cabinets.find((c) => c.id === 1)!.devices).toHaveLength(2)
    })
  })

  describe('C-2 机柜粘贴冲突明细', () => {
    it('U 位被占 → occupied 冲突跳过，不冲突设备照常复制', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [
          cab(1, '机柜 A1', { devices: [dev('gpu-1', 'GPU服务器_1', 2, 9), dev('sw-1', '交换机_1', 30, 30)] }),
          cab(2, '机柜 A2', { devices: [dev('gpu-2', 'GPU服务器_2', 3, 10)] }),
        ],
      })
      useRackStore.getState().copyCabinet(1)
      const r = useRackStore.getState().pasteCabinet(2)
      expect(r.applied).toBe(1)
      expect(r.conflicts).toEqual([
        { cabinetId: 2, deviceName: 'GPU服务器_1', startU: 2, reason: 'occupied' },
      ])
      const target = useRackStore.getState().cabinets.find((c) => c.id === 2)!
      expect(target.devices.find((d) => d.name === '交换机_1')).toBeDefined()
      expect(target.devices.find((d) => d.name === 'GPU服务器_1')).toBeUndefined()
    })

    it('柜顶预留区 → top_reserved 冲突', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [
          cab(1, '机柜 A1', { devices: [dev('gpu-1', 'GPU服务器_1', 41, 42)] }),
          cab(2, '机柜 A2'),
        ],
      })
      useRackStore.getState().copyCabinet(1)
      const r = useRackStore.getState().pasteCabinet(2)
      expect(r.conflicts).toEqual([
        { cabinetId: 2, deviceName: 'GPU服务器_1', startU: 41, reason: 'top_reserved' },
      ])
      expect(r.applied).toBe(0)
    })

    it('U 位溢出柜高 → overflow 冲突', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [
          { id: 1, name: '机柜 A1', totalU: 42, type: 'gpu' as const, power_limit: 6000,
            devices: [dev('gpu-1', 'GPU服务器_1', 40, 43)] },
          cab(2, '机柜 A2', { totalU: 20 }),
        ],
      })
      useRackStore.getState().copyCabinet(1)
      const r = useRackStore.getState().pasteCabinet(2)
      expect(r.conflicts).toEqual([
        { cabinetId: 2, deviceName: 'GPU服务器_1', startU: 40, reason: 'overflow' },
      ])
      expect(r.applied).toBe(0)
    })

    it('功率超限 → power 冲突', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [
          cab(1, '机柜 A1', { devices: [dev('gpu-1', 'GPU服务器_1', 2, 9, 5000)] }),
          cab(2, '机柜 A2', { power_limit: 4000, devices: [dev('gpu-2', 'GPU服务器_2', 20, 27, 1000)] }),
        ],
      })
      useRackStore.getState().copyCabinet(1)
      const r = useRackStore.getState().pasteCabinet(2)
      expect(r.conflicts).toEqual([
        { cabinetId: 2, deviceName: 'GPU服务器_1', startU: 2, reason: 'power' },
      ])
      expect(r.applied).toBe(0)
      expect(r.skipped).toBe(1)
    })
  })

  describe('C-3 粘贴到新柜（名称后缀）', () => {
    it('新柜名称「源名-副本」，类型/功率/设备复制', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [cab(1, '机柜 A1', { devices: [dev('gpu-1', 'GPU服务器_1', 2, 9, 5000)] })],
      })
      useRackStore.getState().copyCabinet(1)
      const newId = useRackStore.getState().pasteCabinetToNew()
      expect(newId).not.toBeNull()
      const fresh = useRackStore.getState().cabinets.find((c) => c.id === newId)!
      expect(fresh.name).toBe('机柜 A1-副本')
      expect(fresh.type).toBe('gpu')
      expect(fresh.power_limit).toBe(6000)
      expect(fresh.totalU).toBe(42)
      expect(fresh.devices).toHaveLength(1)
      expect(fresh.devices[0]).toMatchObject({ name: 'GPU服务器_1', startU: 2, endU: 9, power_watts: 5000, cabinetId: newId })
      // 源柜保留
      expect(useRackStore.getState().cabinets.find((c) => c.id === 1)!.devices).toHaveLength(1)
    })

    it('连续粘贴 → 名称后缀递增（-副本 / -副本2）', () => {
      useRackStore.setState({ cabinets: [cab(1, '机柜 A1')] })
      useRackStore.getState().copyCabinet(1)
      const id1 = useRackStore.getState().pasteCabinetToNew()
      const id2 = useRackStore.getState().pasteCabinetToNew()
      const names = useRackStore.getState().cabinets.map((c) => c.name)
      expect(names).toContain('机柜 A1-副本')
      expect(names).toContain('机柜 A1-副本2')
      expect(id1).not.toBe(id2)
    })
  })

  describe('C-4 设备复制/粘贴', () => {
    it('复制设备进剪贴板 → hasClipboard(device) 为真', () => {
      useRackStore.setState({ cabinets: [cab(1, '机柜 A1', { devices: [dev('gpu-1', 'GPU服务器_1', 1, 8, 5000)] })] })
      const ok = useRackStore.getState().copyDevice(1, 'gpu-1')
      expect(ok).toBe(true)
      const s = useRackStore.getState()
      expect(s.clipboard?.type).toBe('device')
      expect(s.hasClipboard('device')).toBe(true)
      expect(s.clipboard?.type === 'device' && s.clipboard.device.name).toBe('GPU服务器_1')
      // 复制不存在的设备 → false，不改变剪贴板
      expect(useRackStore.getState().copyDevice(1, 'nope')).toBe(false)
    })

    it('粘贴设备到指定 U 位：成功放置（新 id，U 位映射）', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [cab(1, '机柜 A1', { devices: [dev('gpu-1', 'GPU服务器_1', 1, 8, 5000)] }), cab(2, '机柜 A2')],
      })
      useRackStore.getState().copyDevice(1, 'gpu-1')
      const r = useRackStore.getState().pasteDevice(2, 10)
      expect(r.ok).toBe(true)
      expect(r.startU).toBe(10)
      const target = useRackStore.getState().cabinets.find((c) => c.id === 2)!
      const pasted = target.devices.find((d) => d.name === 'GPU服务器_1')!
      expect(pasted).toBeDefined()
      expect(pasted.startU).toBe(10)
      expect(pasted.endU).toBe(17)
      expect(pasted.power_watts).toBe(5000)
      expect(pasted.cabinetId).toBe(2)
      // 复制出的设备是新 id（不与源设备冲突）
      expect(pasted.id).not.toBe('gpu-1')
      expect(useRackStore.getState().cabinets.find((c) => c.id === 1)!.devices).toHaveLength(1)
    })

    it('U 位冲突 → 被拒并返回 occupied reason', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [
          cab(1, '机柜 A1', { devices: [dev('gpu-1', 'GPU服务器_1', 1, 8, 1000)] }),
          cab(2, '机柜 A2', { devices: [dev('x', 'x', 10, 17)] }),
        ],
      })
      useRackStore.getState().copyDevice(1, 'gpu-1')
      const r = useRackStore.getState().pasteDevice(2, 10)
      expect(r.ok).toBe(false)
      expect(r.reason).toBe('occupied')
      expect(useRackStore.getState().cabinets.find((c) => c.id === 2)!.devices).toHaveLength(1)
    })

    it('顶部预留区 → top_reserved；越界 → overflow', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [cab(1, '机柜 A1', { devices: [dev('gpu-1', 'GPU服务器_1', 1, 8, 1000)] }), cab(2, '机柜 A2')],
      })
      useRackStore.getState().copyDevice(1, 'gpu-1')
      // 8U 设备：U35-42 进入柜顶预留区（top_reserved）；U36-43 越界（overflow）
      expect(useRackStore.getState().pasteDevice(2, 35).reason).toBe('top_reserved')
      expect(useRackStore.getState().pasteDevice(2, 0).reason).toBe('overflow')
      expect(useRackStore.getState().pasteDevice(2, 41).reason).toBe('overflow')
    })

    it('功率超限 → power 被拒', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [
          cab(1, '机柜 A1', { devices: [dev('gpu-1', 'GPU服务器_1', 1, 8, 5000)] }),
          cab(2, '机柜 A2', { power_limit: 4000, devices: [dev('x', 'x', 10, 17, 1000)] }),
        ],
      })
      useRackStore.getState().copyDevice(1, 'gpu-1')
      const r = useRackStore.getState().pasteDevice(2, 20)
      expect(r.ok).toBe(false)
      expect(r.reason).toBe('power')
    })

    it('pasteDeviceAuto 自动找首个可用 U 位', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [
          cab(1, '机柜 A1', { devices: [dev('gpu-1', 'GPU服务器_1', 1, 8, 1000)] }),
          cab(2, '机柜 A2', { devices: [dev('a', 'a', 1, 8), dev('b', 'b', 9, 16)] }),
        ],
      })
      useRackStore.getState().copyDevice(1, 'gpu-1')
      const r = useRackStore.getState().pasteDeviceAuto(2)
      expect(r.ok).toBe(true)
      expect(r.startU).toBe(17)
      const pasted = useRackStore.getState().cabinets.find((c) => c.id === 2)!.devices.find((d) => d.name === 'GPU服务器_1')!
      expect(pasted.startU).toBe(17)
      expect(pasted.endU).toBe(24)
    })

    it('pasteDeviceAuto 无可用位 → no_space 被拒', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [
          cab(1, '机柜 A1', { devices: [dev('gpu-1', 'GPU服务器_1', 1, 8, 1000)] }),
          cab(2, '机柜 A2', { devices: [dev('a', 'a', 1, 40)] }),
        ],
      })
      useRackStore.getState().copyDevice(1, 'gpu-1')
      const r = useRackStore.getState().pasteDeviceAuto(2)
      expect(r.ok).toBe(false)
      expect(r.reason).toBe('no_space')
    })
  })

  describe('C-5 空剪贴板 no-op', () => {
    it('空剪贴板：粘贴机柜/新柜/设备均为 no-op 且不压撤销栈', () => {
      useRackStore.setState({ cabinets: [cab(1, '机柜 A1')] })
      const s0 = useRackStore.getState()
      expect(s0.hasClipboard()).toBe(false)
      expect(s0.pasteCabinet(1)).toEqual({ applied: 0, skipped: 0, conflicts: [] })
      expect(s0.pasteCabinetToNew()).toBeNull()
      expect(s0.pasteDevice(1, 1)).toMatchObject({ ok: false, reason: 'no_clipboard' })
      expect(s0.pasteDeviceAuto(1)).toMatchObject({ ok: false, reason: 'no_clipboard' })
      expect(useRackStore.getState().undoStack).toHaveLength(0)
      expect(useRackStore.getState().cabinets).toHaveLength(1)
    })

    it('clearClipboard 清空剪贴板', () => {
      useRackStore.setState({ cabinets: [cab(1, '机柜 A1')] })
      useRackStore.getState().copyCabinet(1)
      expect(useRackStore.getState().hasClipboard('cabinet')).toBe(true)
      useRackStore.getState().clearClipboard()
      expect(useRackStore.getState().hasClipboard()).toBe(false)
      expect(useRackStore.getState().clipboard).toBeNull()
    })
  })

  describe('C-6 撤销可回退粘贴（M3 撤销联动）', () => {
    it('pasteCabinet 撤销 → 目标柜恢复原状，重做恢复', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [
          cab(1, '机柜 A1', { devices: [dev('gpu-1', 'GPU服务器_1', 2, 9, 5000)] }),
          cab(2, '机柜 A2'),
        ],
      })
      useRackStore.getState().copyCabinet(1)
      useRackStore.getState().pasteCabinet(2)
      expect(useRackStore.getState().cabinets.find((c) => c.id === 2)!.devices).toHaveLength(1)
      expect(useRackStore.getState().canUndo).toBe(true)
      useRackStore.getState().undo()
      expect(useRackStore.getState().cabinets.find((c) => c.id === 2)!.devices).toHaveLength(0)
      useRackStore.getState().redo()
      expect(useRackStore.getState().cabinets.find((c) => c.id === 2)!.devices).toHaveLength(1)
    })

    it('pasteCabinetToNew 撤销 → 新柜移除', () => {
      useRackStore.setState({ cabinets: [cab(1, '机柜 A1', { devices: [dev('gpu-1', 'GPU服务器_1', 1, 8, 1000)] })] })
      useRackStore.getState().copyCabinet(1)
      const newId = useRackStore.getState().pasteCabinetToNew()
      expect(useRackStore.getState().cabinets).toHaveLength(2)
      useRackStore.getState().undo()
      expect(useRackStore.getState().cabinets.map((c) => c.id)).toEqual([1])
      useRackStore.getState().redo()
      expect(useRackStore.getState().cabinets.map((c) => c.id)).toEqual([1, newId])
    })

    it('pasteDevice 撤销 → 设备移除，重做恢复', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [cab(1, '机柜 A1', { devices: [dev('gpu-1', 'GPU服务器_1', 1, 8, 1000)] }), cab(2, '机柜 A2')],
      })
      useRackStore.getState().copyDevice(1, 'gpu-1')
      useRackStore.getState().pasteDevice(2, 10)
      expect(useRackStore.getState().cabinets.find((c) => c.id === 2)!.devices).toHaveLength(1)
      useRackStore.getState().undo()
      expect(useRackStore.getState().cabinets.find((c) => c.id === 2)!.devices).toHaveLength(0)
      useRackStore.getState().redo()
      expect(useRackStore.getState().cabinets.find((c) => c.id === 2)!.devices).toHaveLength(1)
    })

    it('pasteDeviceAuto 撤销 → 目标柜恢复', () => {
      useRackStore.setState({
        topReservedU: 2,
        cabinets: [cab(1, '机柜 A1', { devices: [dev('gpu-1', 'GPU服务器_1', 1, 8, 1000)] }), cab(2, '机柜 A2')],
      })
      useRackStore.getState().copyDevice(1, 'gpu-1')
      useRackStore.getState().pasteDeviceAuto(2)
      expect(useRackStore.getState().cabinets.find((c) => c.id === 2)!.devices).toHaveLength(1)
      useRackStore.getState().undo()
      expect(useRackStore.getState().cabinets.find((c) => c.id === 2)!.devices).toHaveLength(0)
    })

    it('复制/清空剪贴板不压撤销栈', () => {
      useRackStore.setState({ cabinets: [cab(1, '机柜 A1', { devices: [dev('gpu-1', 'GPU服务器_1', 1, 8, 1000)] })] })
      useRackStore.getState().copyCabinet(1)
      useRackStore.getState().copyDevice(1, 'gpu-1')
      useRackStore.getState().clearClipboard()
      expect(useRackStore.getState().undoStack).toHaveLength(0)
      expect(useRackStore.getState().canUndo).toBe(false)
    })
  })
})
