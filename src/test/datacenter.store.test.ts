/**
 * AutoLink V2.4.7 — 机房平面布局 Store 单元测试
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { useDataCenterStore, getPowerColor } from '../stores/datacenter.store'
import { useRackStore, type RackCabinet } from '../stores/rack.store'

function makeCabinet(overrides: Partial<RackCabinet> = {}): RackCabinet {
  return {
    id: 1,
    name: '机柜 A',
    totalU: 42,
    type: 'gpu',
    power_limit: 6000,
    devices: [],
    ...overrides,
  }
}

describe('DataCenterStore', () => {
  beforeEach(() => {
    useDataCenterStore.setState({
      placements: [],
      rows: [],
      stats: null,
      params: {
        cabinetsPerRow: 8,
        cabinetWidth: 60,
        cabinetHeight: 100,
        rowGap: 60,
        sidePadding: 40,
        topPadding: 40,
      },
      selectedCabinetId: null,
    })
    useRackStore.setState({ cabinets: [] })
  })

  describe('computeLayout', () => {
    it('空机柜列表应产出空 placements', () => {
      useDataCenterStore.getState().computeLayout([])
      const s = useDataCenterStore.getState()
      expect(s.placements).toHaveLength(0)
      expect(s.rows).toHaveLength(0)
      expect(s.stats).not.toBeNull()
      expect(s.stats!.totalCabinets).toBe(0)
    })

    it('单排机柜应正确计算位置', () => {
      const cabs: RackCabinet[] = Array.from({ length: 5 }, (_, i) =>
        makeCabinet({ id: i + 1, name: `C${i + 1}` }),
      )
      useDataCenterStore.getState().computeLayout(cabs)
      const s = useDataCenterStore.getState()
      expect(s.placements).toHaveLength(5)
      expect(s.rows).toHaveLength(1)
      // 第一个机柜 x = sidePadding
      expect(s.placements[0].x).toBe(40)
      // 第二个机柜 x = sidePadding + cabinetWidth
      expect(s.placements[1].x).toBe(100)
      // 所有机柜都在 row 0
      s.placements.forEach((p) => expect(p.row).toBe(0))
    })

    it('多排机柜应正确换行', () => {
      const cabs: RackCabinet[] = Array.from({ length: 10 }, (_, i) =>
        makeCabinet({ id: i + 1, name: `C${i + 1}` }),
      )
      useDataCenterStore.getState().computeLayout(cabs)
      const s = useDataCenterStore.getState()
      // 默认每排 8 个，10 个机柜应分 2 排
      expect(s.rows).toHaveLength(2)
      expect(s.placements[0].row).toBe(0)
      expect(s.placements[8].row).toBe(1)
      // 第二排第一个机柜 y 应大于第一排
      expect(s.placements[8].y).toBeGreaterThan(s.placements[0].y)
    })

    it('应正确计算功率使用率和超限标记', () => {
      const cabs: RackCabinet[] = [
        makeCabinet({
          id: 1,
          power_limit: 10000,
          devices: [
            { id: 'd1', name: 'D1', type: 'server', cabinetId: 1, startU: 1, endU: 4, power_watts: 5000 },
          ],
        }),
        makeCabinet({
          id: 2,
          power_limit: 5000,
          devices: [
            { id: 'd2', name: 'D2', type: 'server', cabinetId: 2, startU: 1, endU: 4, power_watts: 6000 },
          ],
        }),
      ]
      useDataCenterStore.getState().computeLayout(cabs)
      const s = useDataCenterStore.getState()
      expect(s.placements[0].powerUsage.percent).toBe(50)
      expect(s.placements[0].powerUsage.exceeded).toBe(false)
      expect(s.placements[1].powerUsage.percent).toBe(120)
      expect(s.placements[1].powerUsage.exceeded).toBe(true)
      expect(s.stats!.exceededCabinets).toBe(1)
    })

    it('应正确计算总功率和制冷负荷', () => {
      const cabs: RackCabinet[] = [
        makeCabinet({
          id: 1,
          devices: [
            { id: 'd1', name: 'D1', type: 'server', cabinetId: 1, startU: 1, endU: 4, power_watts: 2000 },
          ],
        }),
        makeCabinet({
          id: 2,
          devices: [
            { id: 'd2', name: 'D2', type: 'server', cabinetId: 2, startU: 1, endU: 4, power_watts: 3000 },
          ],
        }),
      ]
      useDataCenterStore.getState().computeLayout(cabs)
      const stats = useDataCenterStore.getState().stats!
      expect(stats.totalPowerKW).toBe(5)
      // PUE 1.4 → 制冷 = totalPower * 0.4 = 2.0
      expect(stats.coolingLoadKW).toBe(2)
      expect(stats.totalDevices).toBe(2)
    })

    it('冷热通道应交替排列', () => {
      const cabs: RackCabinet[] = Array.from({ length: 16 }, (_, i) =>
        makeCabinet({ id: i + 1, name: `C${i + 1}` }),
      )
      useDataCenterStore.getState().computeLayout(cabs)
      const s = useDataCenterStore.getState()
      expect(s.rows).toHaveLength(2)
      // 第一排与第二排之间应为冷通道
      expect(s.rows[0].aisleType).toBe('cold')
      // 通道 Y 应等于该排 Y + 机柜高度
      expect(s.rows[0].y + s.rows[0].height).toBeLessThan(s.rows[1].y)
    })

    it('机柜朝向应交替（偶数排朝南，奇数排朝北）', () => {
      const cabs: RackCabinet[] = Array.from({ length: 16 }, (_, i) =>
        makeCabinet({ id: i + 1, name: `C${i + 1}` }),
      )
      useDataCenterStore.getState().computeLayout(cabs)
      const s = useDataCenterStore.getState()
      expect(s.placements[0].facing).toBe('south')
      expect(s.placements[8].facing).toBe('north')
    })
  })

  describe('setParams', () => {
    it('应更新参数并重新计算布局', () => {
      const cabs: RackCabinet[] = Array.from({ length: 4 }, (_, i) =>
        makeCabinet({ id: i + 1, name: `C${i + 1}` }),
      )
      useRackStore.setState({ cabinets: cabs })
      useDataCenterStore.getState().computeLayout(cabs)

      // 修改每排机柜数为 2
      useDataCenterStore.getState().setParams({ cabinetsPerRow: 2 })
      const s = useDataCenterStore.getState()
      expect(s.params.cabinetsPerRow).toBe(2)
      expect(s.rows).toHaveLength(2)
      // 第二排第一个机柜 x 应为 sidePadding（因为每排只有 2 个）
      expect(s.placements[2].x).toBe(40)
      expect(s.placements[2].row).toBe(1)
    })
  })

  describe('selectCabinet', () => {
    it('应正确设置选中机柜', () => {
      useDataCenterStore.getState().selectCabinet(5)
      expect(useDataCenterStore.getState().selectedCabinetId).toBe(5)
    })

    it('应支持取消选中', () => {
      useDataCenterStore.getState().selectCabinet(5)
      useDataCenterStore.getState().selectCabinet(null)
      expect(useDataCenterStore.getState().selectedCabinetId).toBeNull()
    })
  })

  describe('getPowerColor', () => {
    it('< 60% 应返回绿色', () => {
      const c = getPowerColor(50)
      expect(c.fill).toBe('#dcfce7')
      expect(c.stroke).toBe('#16a34a')
    })

    it('60-79% 应返回黄色', () => {
      const c = getPowerColor(70)
      expect(c.fill).toBe('#fef3c7')
      expect(c.stroke).toBe('#d97706')
    })

    it('≥ 80% 应返回红色', () => {
      const c = getPowerColor(85)
      expect(c.fill).toBe('#fee2e2')
      expect(c.stroke).toBe('#dc2626')
    })

    it('边界值 60% 应返回黄色', () => {
      expect(getPowerColor(60).stroke).toBe('#d97706')
    })

    it('边界值 80% 应返回红色', () => {
      expect(getPowerColor(80).stroke).toBe('#dc2626')
    })
  })
})
