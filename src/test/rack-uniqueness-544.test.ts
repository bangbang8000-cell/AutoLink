/**
 * F1（5.4.4 工作台可用性修复）：设备跨柜唯一性守卫 + 模板柜重新编号复制 专项测试
 *
 * 对应《AL工作台可用性评估与改进报告_v1.0》#4（用户实测：一个设备重复落到多个机柜）：
 * - T1 placeDevice 跨柜守卫：已在他柜的设备不可再次上架（旧实现只查本柜 U 冲突）
 * - T2 applyCabinetTemplate 重新编号复制（D1 拍板）：源柜设备复制到同类柜时 id 重新编号，
 *      全柜 id 唯一（旧实现原样复制 → 同一设备出现在 N 个柜）
 * - T3 initFromTopology 不再双入池：已落位设备不进待分配池（旧实现"同时入池便于调整"）
 * - T4 loadRackLayout 存量脏数据去重：跨柜同 id 自动去重（保留首个落位）
 * - T5 pasteDevice/pasteCabinet 编号池全柜化：跨柜粘贴不产生同号设备
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRackStore, type RackCabinet, type RackDevice, type CabinetType, type RackTopologyNode } from '../stores/rack.store'

const cab = (id: number, name: string, over: Partial<RackCabinet> = {}): RackCabinet => ({
  id, name, totalU: 42, type: 'gpu' as CabinetType, power_limit: 30000, devices: [], ...over,
})
const dev = (id: string, name: string, startU: number, endU: number, power = 1000): RackDevice => ({
  id, name, type: 'GPU Server', cabinetId: 1, startU, endU, power_watts: power,
})

function resetStore(over: Partial<ReturnType<typeof useRackStore.getState>> = {}) {
  localStorage.clear()
  useRackStore.setState({
    cabinets: [],
    unplacedDevices: [],
    selectedCabinetId: null,
    selectedDevice: null,
    addDeviceMode: false,
    editingDevice: null,
    topReservedU: 2,
    gpuPerCabinet: 1,
    defaultPowerLimit: 12000,
    undoStack: [],
    redoStack: [],
    clipboard: null,
    ...over,
  } as never)
}

describe('F1/T1 placeDevice 跨柜唯一性守卫', () => {
  beforeEach(() => resetStore())

  it('已在他柜的设备不可再次上架', () => {
    resetStore({
      cabinets: [
        cab(1, '机柜1', { devices: [dev('GPU-1', 'GPU-1', 1, 4)] }),
        cab(2, '机柜2'),
      ],
    })
    const ok = useRackStore.getState().placeDevice(2, {
      id: 'GPU-1', name: 'GPU-1', type: 'GPU Server', height: 4, power_watts: 1000,
    }, 1)
    expect(ok).toBe(false)
    expect(useRackStore.getState().cabinets[1].devices).toHaveLength(0)
  })

  it('不在任何柜的设备正常上架（不误伤）', () => {
    resetStore({ cabinets: [cab(1, '机柜1'), cab(2, '机柜2')] })
    const ok = useRackStore.getState().placeDevice(2, {
      id: 'GPU-9', name: 'GPU-9', type: 'GPU Server', height: 4, power_watts: 1000,
    }, 1)
    expect(ok).toBe(true)
    expect(useRackStore.getState().cabinets[1].devices).toHaveLength(1)
  })
})

describe('F1/T2 applyCabinetTemplate 重新编号复制（D1）', () => {
  beforeEach(() => resetStore())

  it('复制到同类柜后全柜 id 唯一（旧实现直接复现双落位）', () => {
    resetStore({
      cabinets: [
        cab(1, '源柜', { devices: [dev('GPU-A', 'GPU-A', 1, 4)] }),
        cab(2, '目标柜A'),
        cab(3, '目标柜B'),
      ],
    })
    const r = useRackStore.getState().applyCabinetTemplate(1)
    expect(r.applied).toBe(2)
    const all = useRackStore.getState().cabinets.flatMap((c) => c.devices.map((d) => d.id))
    expect(new Set(all).size).toBe(all.length)
    // 复制设备带「-柜N」后缀，可读可溯源
    expect(all).toContain('GPU-A-柜2')
    expect(all).toContain('GPU-A-柜3')
  })
})

describe('F1/T3 initFromTopology 不再双入池', () => {
  beforeEach(() => resetStore())

  it('已落位设备不进待分配池', () => {
    const nodes: RackTopologyNode[] = [
      { id: 'GPU-1', type: 'server', group: 'GPU服务器组', cabinetId: 1, cabinetName: '机柜1', startU: 1, endU: 4, powerWatts: 1000, uHeight: 4 },
      { id: 'GPU-2', type: 'server', group: 'GPU服务器组', cabinetId: 1, cabinetName: '机柜1', startU: 5, endU: 8, powerWatts: 1000, uHeight: 4 },
    ]
    useRackStore.getState().initFromTopology(nodes)
    const s = useRackStore.getState()
    expect(s.cabinets).toHaveLength(1)
    expect(s.cabinets[0].devices).toHaveLength(2)
    // F1 关键断言：待分配池为空（旧实现 2 个已落位设备同时入池）
    expect(s.unplacedDevices).toHaveLength(0)
  })

  it('无落位信息的设备仍进待分配池（旧数据兼容）', () => {
    const nodes: RackTopologyNode[] = [
      { id: 'GPU-x', type: 'server', group: 'GPU服务器组', powerWatts: 1000, uHeight: 4 },
    ]
    useRackStore.getState().initFromTopology(nodes)
    expect(useRackStore.getState().unplacedDevices).toHaveLength(1)
  })
})

describe('F1/T4 loadRackLayout 存量脏数据去重', () => {
  beforeEach(() => resetStore())

  it('跨柜同 id 设备自动去重（保留首个落位）', async () => {
    const dirty = {
      cabinets: [
        cab(1, '机柜1', { devices: [dev('GPU-DUP', 'GPU-DUP', 1, 4)] }),
        cab(2, '机柜2', { devices: [dev('GPU-DUP', 'GPU-DUP', 1, 4)] }),
      ],
    }
    const getFile = vi.fn().mockResolvedValue(JSON.stringify(dirty))
    ;(window as unknown as { electron?: unknown }).electron = { project: { getFile } }
    await useRackStore.getState().loadRackLayout('测试项目')
    const s = useRackStore.getState()
    const total = s.cabinets.reduce((n, c) => n + c.devices.length, 0)
    expect(total).toBe(1) // 只保留首个
    expect(s.cabinets[0].devices[0].id).toBe('GPU-DUP')
  })
})

describe('F1/T5 粘贴编号池全柜化', () => {
  beforeEach(() => resetStore())

  it('pasteCabinet 跨柜粘贴不产生同号设备', () => {
    resetStore({
      cabinets: [
        cab(1, '源柜', { devices: [dev('GPU-P', 'GPU-P', 1, 4)] }),
        cab(2, '目标柜'),
        cab(3, '他柜', { devices: [dev('GPU-P-1', 'GPU-P-1', 1, 4)] }),
      ],
    })
    useRackStore.getState().copyCabinet(1)
    const r = useRackStore.getState().pasteCabinet(2)
    expect(r.applied).toBe(1)
    const all = useRackStore.getState().cabinets.flatMap((c) => c.devices.map((d) => d.id))
    expect(new Set(all).size).toBe(all.length)
  })
})
