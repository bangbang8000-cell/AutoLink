/**
 * B4-06 / FR-A25：柜内一键紧凑重排门禁（T-B4-18 紧凑重排 / T-B4-19 重排可回退）
 *
 * 判据：拖出 3 处空洞 → 重排后 U 位连续无空洞；设备顺序不变；预留仍满足 FR-A23；可撤销。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useRackStore, compactCabinetDevices } from '../stores/rack.store'
import type { RackCabinet, RackDevice, CabinetType } from '../stores/rack.store'
import { resolveRackReserve } from '../shared/roomTaxonomy'

const dev = (id: string, startU: number, endU: number): RackDevice => ({
  id,
  name: id,
  type: 'GPU Server',
  cabinetId: 1,
  startU,
  endU,
  power_watts: 1000,
})

const cab = (id: number, type: CabinetType, devices: RackDevice[], over: Partial<RackCabinet> = {}): RackCabinet => ({
  id,
  name: `机柜${id}`,
  totalU: 42,
  type,
  power_limit: 60000,
  devices: devices.map((d) => ({ ...d, cabinetId: id })),
  ...over,
})

describe('B4-06 compactCabinetDevices（纯函数）', () => {
  it('GPU 柜：三处空洞重排后连续，顺序不变，底部 4U 预留仍留空', () => {
    const cabinet = cab(1, 'gpu', [dev('a', 21, 24), dev('b', 13, 14), dev('c', 30, 31)])
    const { devices, moved, reason } = compactCabinetDevices(cabinet, resolveRackReserve('gpu', 2))

    expect(reason).toBeNull()
    expect(moved).toBe(3)
    expect(devices.map((d) => d.id)).toEqual(['b', 'a', 'c'])
    expect(devices.map((d) => [d.startU, d.endU])).toEqual([
      [5, 6],
      [7, 10],
      [11, 12],
    ])
    // 底部预留 4U（U1–U4）不被占用
    expect(Math.min(...devices.map((d) => d.startU))).toBe(5)
    // 无空洞：按顺序首尾相接
    for (let i = 1; i < devices.length; i++) {
      expect(devices[i].startU).toBe(devices[i - 1].endU + 1)
    }
  })

  it('网络柜：顶部 2U 预留保留，设备从 U1 起向上紧贴', () => {
    const cabinet = cab(2, 'network', [dev('n1', 1, 10), dev('n2', 25, 34)])
    const { devices, moved, reason } = compactCabinetDevices(cabinet, resolveRackReserve('network', 2))

    expect(reason).toBeNull()
    expect(moved).toBe(1)
    expect(devices.map((d) => [d.startU, d.endU])).toEqual([
      [1, 10],
      [11, 20],
    ])
    expect(Math.max(...devices.map((d) => d.endU))).toBeLessThanOrEqual(42 - 2)
  })

  it('已紧凑时 moved = 0（无位移不产生撤销记录）', () => {
    const cabinet = cab(3, 'storage', [dev('s1', 5, 8), dev('s2', 9, 12)])
    const { moved, reason } = compactCabinetDevices(cabinet, resolveRackReserve('storage', 2))
    expect(reason).toBeNull()
    expect(moved).toBe(0)
  })

  it('可用区容不下 → no_space 且返回原列表', () => {
    // 10U 柜 + gpu 底留 4U → 可用 6U，设备总高 8U
    const cabinet = cab(4, 'gpu', [dev('x', 1, 4), dev('y', 5, 8)], { totalU: 10 })
    const { devices, moved, reason } = compactCabinetDevices(cabinet, resolveRackReserve('gpu', 2))
    expect(reason).toBe('no_space')
    expect(moved).toBe(0)
    expect(devices).toEqual(cabinet.devices)
  })
})

describe('B4-06 rack store compactCabinet 动作', () => {
  beforeEach(() => {
    useRackStore.setState({
      cabinets: [],
      unplacedDevices: [],
      selectedCabinetId: null,
      selectedDevice: null,
      addDeviceMode: false,
      editingDevice: null,
      topReservedU: 2,
      undoStack: [],
      redoStack: [],
      canUndo: false,
      canRedo: false,
    })
  })

  it('重排后 U 位连续、顺序不变、不跨柜；可撤销回原 U 位', () => {
    const target = cab(1, 'gpu', [dev('a', 10, 18), dev('b', 20, 27), dev('c', 30, 37)])
    const other = cab(2, 'gpu', [dev('z', 10, 18)])
    useRackStore.setState({ cabinets: [target, other] })

    const r = useRackStore.getState().compactCabinet(1)
    expect(r).toEqual({ ok: true, moved: 3, reason: null })

    const after = useRackStore.getState().cabinets
    expect(after[0].devices.map((d) => [d.id, d.startU, d.endU])).toEqual([
      ['a', 5, 13],
      ['b', 14, 21],
      ['c', 22, 29],
    ])
    // 不跨柜
    expect(after[1].devices.map((d) => [d.id, d.startU, d.endU])).toEqual([['z', 10, 18]])

    // 可撤销
    expect(useRackStore.getState().canUndo).toBe(true)
    useRackStore.getState().undo()
    expect(
      useRackStore.getState().cabinets[0].devices.map((d) => [d.id, d.startU, d.endU]),
    ).toEqual([
      ['a', 10, 18],
      ['b', 20, 27],
      ['c', 30, 37],
    ])
  })

  it('已紧凑时不压撤销栈', () => {
    const target = cab(1, 'compute', [dev('a', 5, 8), dev('b', 9, 12)])
    useRackStore.setState({ cabinets: [target] })

    const r = useRackStore.getState().compactCabinet(1)
    expect(r).toEqual({ ok: true, moved: 0, reason: null })
    expect(useRackStore.getState().canUndo).toBe(false)
    expect(useRackStore.getState().cabinets[0].devices.map((d) => d.startU)).toEqual([5, 9])
  })

  it('机柜不存在 → not_found', () => {
    expect(useRackStore.getState().compactCabinet(999)).toEqual({
      ok: false,
      moved: 0,
      reason: 'not_found',
    })
  })

  it('超出可用区 → no_space 且不改柜内设备、不压撤销栈', () => {
    const target = cab(1, 'gpu', [dev('a', 1, 4), dev('b', 5, 8)], { totalU: 10 })
    useRackStore.setState({ cabinets: [target] })

    const r = useRackStore.getState().compactCabinet(1)
    expect(r).toEqual({ ok: false, moved: 0, reason: 'no_space' })
    expect(useRackStore.getState().cabinets[0].devices.map((d) => [d.startU, d.endU])).toEqual([
      [1, 4],
      [5, 8],
    ])
    expect(useRackStore.getState().canUndo).toBe(false)
  })
})
