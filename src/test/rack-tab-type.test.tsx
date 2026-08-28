/**
 * PRD v3.2 / AL-N4：GPU 柜加载修复测试（G-1/G-2/G-4）
 * - G-2 纯函数：getTypeColorClass / getTypeLabel 对空/undefined type 容错
 *   （RackTab 全量渲染测试过重 → 对导出的纯函数直接测试；组件渲染另做轻量冒烟）
 * - G-1 组件冒烟：缺 totalU/device.type 的旧数据 GPU 柜渲染不崩
 * - G-4 组件冒烟：正常 GPU 柜渲染出设备名
 */
import '@/i18n'
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RackTab, getTypeColorClass, getTypeLabel } from '@/components/workspace/tabs/RackTab'
import { useRackStore } from '@/stores/rack.store'
import type { RackCabinet } from '@/stores/rack.store'

const makeCabinet = (overrides: Partial<RackCabinet> = {}): RackCabinet => ({
  id: 1,
  name: '机柜 1',
  totalU: 42,
  type: 'gpu',
  power_limit: 6000,
  devices: [],
  ...overrides,
})

beforeEach(() => {
  useRackStore.setState({ cabinets: [], unplacedDevices: [], selectedCabinetId: null })
})

describe('RackTab getTypeColorClass/getTypeLabel（AL-N4 type 容错纯函数）', () => {
  it('type 为空字符串 → 不抛错并返回 gpu 默认', () => {
    expect(() => getTypeColorClass('')).not.toThrow()
    expect(getTypeColorClass('')).toContain('bg-')
    expect(() => getTypeLabel('')).not.toThrow()
    expect(getTypeLabel('')).toBe('GPU')
  })

  it('type 为 undefined → 不抛错并返回 gpu 默认', () => {
    const empty = undefined as unknown as string
    expect(() => getTypeColorClass(empty)).not.toThrow()
    expect(getTypeColorClass(empty)).toContain('bg-')
    expect(() => getTypeLabel(empty)).not.toThrow()
    expect(getTypeLabel(empty)).toBe('GPU')
  })

  it('正常类型不回归（gpu/switch/自定义）', () => {
    expect(getTypeColorClass('GPU Server')).toContain('bg-info')
    expect(getTypeLabel('GPU Server')).toBe('GPU')
    expect(getTypeLabel('Switch')).toBe('交换机')
    expect(getTypeLabel('存储柜')).toBe('存储')
    expect(getTypeLabel('自定义类型')).toBe('自定义类型')
  })
})

describe('RackTab GPU 柜渲染（AL-N4 冒烟）', () => {
  it('G-1 缺 totalU/device.type 的旧数据 GPU 柜 → 渲染不崩', () => {
    // 缺 totalU、device.type（模拟 loadRackLayout 补默认前的旧数据，RackTab 自身需容错）
    const legacy = {
      id: 1,
      name: '机柜 1',
      type: 'gpu',
      power_limit: 6000,
      devices: [{ id: 'gpu-1', name: 'GPU服务器_1', startU: 1, endU: 8, power_watts: 10000 }],
    } as unknown as RackCabinet
    useRackStore.setState({ cabinets: [legacy], unplacedDevices: [], selectedCabinetId: 1 })
    expect(() => render(<RackTab cabinetId={1} />)).not.toThrow()
  })

  it('G-4 正常 GPU 柜 → 渲染出设备名', () => {
    useRackStore.setState({
      cabinets: [makeCabinet({ devices: [{ id: 'gpu-1', name: 'GPU服务器_1', type: 'GPU Server', cabinetId: 1, startU: 1, endU: 8, power_watts: 10000 }] })],
      unplacedDevices: [],
      selectedCabinetId: 1,
    })
    render(<RackTab cabinetId={1} />)
    expect(screen.getAllByText(/GPU服务器_1/).length).toBeGreaterThan(0)
  })
})
