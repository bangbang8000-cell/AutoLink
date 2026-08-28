/**
 * M2（AL-UR1/UR2）：rack.store 编辑撤销/重做命令栈单测
 *
 * 覆盖：
 * - U-1 上架撤销回池 / 重做恢复
 * - U-3 删除（removeDevice / removeCabinet）撤销恢复
 * - U-2 批量机柜/设备属性撤销、重做
 * - applyCabinetTemplate / clearCabinets / setRacks 撤销
 * - U-4 连续多步（跨操作）撤销/重做
 * - U-5 栈深上限 50
 * - 新编辑清空 redo、校验拒绝不压栈、canUndo/canRedo 状态
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useRackStore, type RackCabinet, type RackDevice, type CabinetType } from '../stores/rack.store'

const cab = (id: number, name: string, over: Partial<RackCabinet> = {}): RackCabinet => ({
  id, name, totalU: 42, type: 'gpu' as CabinetType, power_limit: 6000, devices: [], ...over,
})
const dev = (id: string, startU = 1, endU = 8, power = 1000): RackDevice => ({
  id, name: id, type: 'GPU Server', cabinetId: 1, startU, endU, power_watts: power,
})

describe('RackStore undo/redo（AL-UR1/UR2）', () => {
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
    })
  })

  it('U-1 上架撤销 → 设备回到待上架池，重做恢复上架（canUndo/canRedo 正确）', () => {
    const device = { id: 'gpu-1', name: 'GPU服务器_1', type: 'GPU Server', height: 8, power_watts: 1000 }
    useRackStore.setState({ cabinets: [cab(1, '机柜 1')], unplacedDevices: [device] })
    expect(useRackStore.getState().canUndo).toBe(false)
    expect(useRackStore.getState().placeDevice(1, device, 1)).toBe(true)
    const after = useRackStore.getState()
    expect(after.cabinets[0].devices).toHaveLength(1)
    expect(after.unplacedDevices).toHaveLength(0)
    expect(after.canUndo).toBe(true)
    expect(after.canRedo).toBe(false)

    useRackStore.getState().undo()
    const s = useRackStore.getState()
    expect(s.cabinets[0].devices).toHaveLength(0)
    expect(s.unplacedDevices.map((d) => d.id)).toEqual(['gpu-1'])
    expect(s.canUndo).toBe(false)
    expect(s.canRedo).toBe(true)

    useRackStore.getState().redo()
    const r = useRackStore.getState()
    expect(r.cabinets[0].devices).toHaveLength(1)
    expect(r.unplacedDevices).toHaveLength(0)
    expect(r.canUndo).toBe(true)
    expect(r.canRedo).toBe(false)
  })

  it('U-3 删除设备撤销 → 恢复原 U 位/功率，重做再删除', () => {
    useRackStore.setState({ cabinets: [cab(1, '机柜 1', { devices: [dev('gpu-1', 1, 8, 5000)] })] })
    useRackStore.getState().removeDevice(1, 'gpu-1')
    expect(useRackStore.getState().cabinets[0].devices).toHaveLength(0)
    expect(useRackStore.getState().unplacedDevices).toHaveLength(1)

    useRackStore.getState().undo()
    const s = useRackStore.getState()
    expect(s.cabinets[0].devices).toEqual([
      expect.objectContaining({ id: 'gpu-1', cabinetId: 1, startU: 1, endU: 8, power_watts: 5000 }),
    ])
    expect(s.unplacedDevices).toHaveLength(0)

    useRackStore.getState().redo()
    expect(useRackStore.getState().cabinets[0].devices).toHaveLength(0)
  })

  it('removeCabinet 撤销恢复机柜与选中位', () => {
    useRackStore.setState({ cabinets: [cab(1, '机柜 1'), cab(2, '机柜 2')], selectedCabinetId: 2 })
    useRackStore.getState().removeCabinet(2)
    expect(useRackStore.getState().cabinets.map((c) => c.id)).toEqual([1])
    useRackStore.getState().undo()
    const s = useRackStore.getState()
    expect(s.cabinets.map((c) => c.id)).toEqual([1, 2])
    expect(s.selectedCabinetId).toBe(2)
  })

  it('moveDevice 撤销 → 还原源柜/目标柜', () => {
    useRackStore.setState({
      topReservedU: 2,
      cabinets: [
        cab(1, '机柜 1', { devices: [dev('gpu-1', 1, 8, 1000)] }),
        cab(2, '机柜 2'),
      ],
    })
    expect(useRackStore.getState().moveDevice('gpu-1', 1, 2, 1)).toBe(true)
    expect(useRackStore.getState().cabinets.find((c) => c.id === 2)!.devices).toHaveLength(1)

    useRackStore.getState().undo()
    const s = useRackStore.getState()
    expect(s.cabinets.find((c) => c.id === 1)!.devices.map((d) => d.id)).toEqual(['gpu-1'])
    expect(s.cabinets.find((c) => c.id === 2)!.devices).toHaveLength(0)

    useRackStore.getState().redo()
    expect(useRackStore.getState().cabinets.find((c) => c.id === 2)!.devices.map((d) => d.id)).toEqual(['gpu-1'])
  })

  it('U-2 批量机柜属性撤销/重做', () => {
    useRackStore.setState({ cabinets: [cab(1, '机柜 1'), cab(2, '机柜 2'), cab(3, '机柜 3')] })
    const r = useRackStore.getState().updateCabinetsBulk([1, 2], { type: 'storage' })
    expect(r.applied).toBe(2)
    useRackStore.getState().undo()
    expect(useRackStore.getState().cabinets.every((c) => c.type === 'gpu')).toBe(true)
    useRackStore.getState().redo()
    const s = useRackStore.getState()
    expect(s.cabinets.find((c) => c.id === 1)!.type).toBe('storage')
    expect(s.cabinets.find((c) => c.id === 2)!.type).toBe('storage')
    expect(s.cabinets.find((c) => c.id === 3)!.type).toBe('gpu')
  })

  it('U-2b 同柜设备批量属性撤销/重做', () => {
    useRackStore.setState({ cabinets: [cab(1, '机柜 1', { devices: [dev('a'), dev('b')] })] })
    useRackStore.getState().updateDevicesBulk(1, ['a', 'b'], { power_watts: 2000 })
    useRackStore.getState().undo()
    expect(useRackStore.getState().cabinets[0].devices.every((d) => d.power_watts === 1000)).toBe(true)
    useRackStore.getState().redo()
    expect(useRackStore.getState().cabinets[0].devices.every((d) => d.power_watts === 2000)).toBe(true)
  })

  it('shiftDevicesU 撤销/重做', () => {
    useRackStore.setState({
      topReservedU: 2,
      cabinets: [cab(1, '机柜 1', { devices: [dev('a', 1, 8), dev('b', 9, 16)] })],
    })
    useRackStore.getState().shiftDevicesU(1, ['a', 'b'], 2)
    expect(useRackStore.getState().cabinets[0].devices.find((d) => d.id === 'a')).toMatchObject({ startU: 3 })
    useRackStore.getState().undo()
    expect(useRackStore.getState().cabinets[0].devices.find((d) => d.id === 'a')).toMatchObject({ startU: 1 })
    useRackStore.getState().redo()
    expect(useRackStore.getState().cabinets[0].devices.find((d) => d.id === 'a')).toMatchObject({ startU: 3 })
  })

  it('applyCabinetTemplate 撤销 → 目标柜恢复（无复制设备）', () => {
    useRackStore.setState({
      topReservedU: 2,
      cabinets: [
        cab(1, '机柜 1', { devices: [dev('gpu-1', 2, 9, 1000)] }),
        cab(2, '机柜 2'),
      ],
    })
    useRackStore.getState().applyCabinetTemplate(1)
    expect(useRackStore.getState().cabinets.find((c) => c.id === 2)!.devices).toHaveLength(1)
    useRackStore.getState().undo()
    expect(useRackStore.getState().cabinets.find((c) => c.id === 2)!.devices).toHaveLength(0)
  })

  it('clearCabinets 撤销 → 柜与设备恢复', () => {
    useRackStore.setState({
      cabinets: [cab(1, '机柜 1', { devices: [dev('gpu-1', 1, 8, 1000)] })],
      unplacedDevices: [],
    })
    useRackStore.getState().clearCabinets()
    expect(useRackStore.getState().cabinets).toHaveLength(0)
    useRackStore.getState().undo()
    const s = useRackStore.getState()
    expect(s.cabinets).toHaveLength(1)
    expect(s.cabinets[0].devices.map((d) => d.id)).toEqual(['gpu-1'])
    expect(s.unplacedDevices).toHaveLength(0)
  })

  it('initFromTopology 类（setRacks）撤销 → 恢复旧布局', () => {
    useRackStore.setState({ cabinets: [cab(1, '机柜 1', { devices: [dev('gpu-1')] })], unplacedDevices: [] })
    useRackStore.getState().setRacks([cab(2, '机柜 2'), cab(3, '机柜 3')], [])
    expect(useRackStore.getState().cabinets).toHaveLength(2)
    useRackStore.getState().undo()
    const s = useRackStore.getState()
    expect(s.cabinets.map((c) => c.id)).toEqual([1])
    expect(s.cabinets[0].devices.map((d) => d.id)).toEqual(['gpu-1'])
  })

  it('U-4 连续多步撤销/重做（跨操作）', () => {
    const d1 = { id: 'gpu-1', name: 'GPU服务器_1', type: 'GPU Server', height: 8, power_watts: 1000 }
    const d2 = { id: 'gpu-2', name: 'GPU服务器_2', type: 'GPU Server', height: 8, power_watts: 1000 }
    useRackStore.setState({ cabinets: [cab(1, '机柜 1')], unplacedDevices: [d1, d2] })
    useRackStore.getState().placeDevice(1, d1, 1)
    useRackStore.getState().placeDevice(1, d2, 9)
    expect(useRackStore.getState().cabinets[0].devices).toHaveLength(2)

    useRackStore.getState().undo()
    expect(useRackStore.getState().cabinets[0].devices.map((d) => d.id)).toEqual(['gpu-1'])
    useRackStore.getState().undo()
    expect(useRackStore.getState().cabinets[0].devices).toHaveLength(0)
    expect(useRackStore.getState().unplacedDevices.map((d) => d.id).sort()).toEqual(['gpu-1', 'gpu-2'])

    useRackStore.getState().redo()
    expect(useRackStore.getState().cabinets[0].devices.map((d) => d.id)).toEqual(['gpu-1'])
    useRackStore.getState().redo()
    expect(useRackStore.getState().cabinets[0].devices).toHaveLength(2)
  })

  it('U-5 栈深上限 50：超出后旧快照被丢弃', () => {
    useRackStore.setState({ cabinets: [cab(1, '机柜 1')] })
    for (let i = 1; i <= 60; i++) {
      useRackStore.getState().updateCabinet(1, { power_limit: 6000 + i })
    }
    expect(useRackStore.getState().undoStack.length).toBe(50)
    for (let i = 0; i < 50; i++) useRackStore.getState().undo()
    expect(useRackStore.getState().canUndo).toBe(false)
    // 栈中最旧的保留快照是第 11 次编辑前（6000+10）
    expect(useRackStore.getState().cabinets[0].power_limit).toBe(6010)
  })

  it('新编辑清空 redo 栈（分支丢弃）', () => {
    const d1 = { id: 'gpu-1', name: 'GPU服务器_1', type: 'GPU Server', height: 8, power_watts: 1000 }
    useRackStore.setState({ cabinets: [cab(1, '机柜 1')], unplacedDevices: [d1] })
    useRackStore.getState().placeDevice(1, d1, 1)
    useRackStore.getState().undo()
    expect(useRackStore.getState().canRedo).toBe(true)
    useRackStore.getState().updateCabinet(1, { name: '新柜' })
    expect(useRackStore.getState().canRedo).toBe(false)
    expect(useRackStore.getState().redoStack).toHaveLength(0)
  })

  it('校验拒绝的操作不压栈（placeDevice 越界/冲突）', () => {
    const device = { id: 'gpu-1', name: 'GPU服务器_1', type: 'GPU Server', height: 50, power_watts: 1000 }
    useRackStore.setState({ cabinets: [cab(1, '机柜 1')], unplacedDevices: [device] })
    expect(useRackStore.getState().placeDevice(1, device, 40)).toBe(false)
    expect(useRackStore.getState().canUndo).toBe(false)
    expect(useRackStore.getState().undoStack).toHaveLength(0)
  })

  it('updateCabinetSafe 冲突阻塞不压栈，成功撤销', () => {
    useRackStore.setState({
      cabinets: [cab(1, '机柜 1', { devices: [{ id: 'd1', name: 'd1', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 8, power_watts: 5000 }] })],
    })
    const r = useRackStore.getState().updateCabinetSafe(1, { power_limit: 3000 })
    expect(r.applied).toBe(0)
    expect(useRackStore.getState().undoStack).toHaveLength(0)
    useRackStore.getState().updateCabinetSafe(1, { power_limit: 9000 })
    expect(useRackStore.getState().cabinets[0].power_limit).toBe(9000)
    useRackStore.getState().undo()
    expect(useRackStore.getState().cabinets[0].power_limit).toBe(6000)
  })
})
