/**
 * AL-N2（PRD v3.2）：中栏步骤状态纯函数单测 —— deriveSubviewStatus 映射规则
 * - 已完成（done）：数据就绪（design 就绪 / 机柜就绪 / 输出批次非空）→ 绿
 * - 待操作（pending）：数据未就绪 → 灰
 * - 进行中（active）：当前 active 子视图或读取中 → 蓝（active 优先于就绪态）
 * 纯函数测试（不依赖 store 实例 / jsdom）；组件级行为另见 file-explorer-subview-status.test.tsx。
 */
import { describe, it, expect } from 'vitest'
import { deriveSubviewStatus } from '@/utils/subviewStatus'
import type { SubviewStatusDeps } from '@/utils/subviewStatus'

const baseDeps: SubviewStatusDeps = {
  designValid: null,
  rackReady: false,
  rackHasCabinets: false,
  roomMatrixFinalized: false,
  hasOutputBatches: false,
  hasSelectedOutputTypes: false,
  activeSubview: null,
}

describe('deriveSubviewStatus 中栏步骤状态映射', () => {
  it('roomdesign（机房设计）：矩阵已定稿 → 已完成，否则待操作', () => {
    expect(deriveSubviewStatus('roomdesign', { ...baseDeps, roomMatrixFinalized: true })).toEqual({ label: '已完成', tone: 'done' })
    expect(deriveSubviewStatus('roomdesign', { ...baseDeps, roomMatrixFinalized: false })).toEqual({ label: '待操作', tone: 'pending' })
  })

  it('rackdesign（机柜设计）：已定稿且有柜 → 已完成，否则待操作', () => {
    expect(deriveSubviewStatus('rackdesign', { ...baseDeps, roomMatrixFinalized: true, rackHasCabinets: true })).toEqual({ label: '已完成', tone: 'done' })
    expect(deriveSubviewStatus('rackdesign', { ...baseDeps, roomMatrixFinalized: true, rackHasCabinets: false })).toEqual({ label: '待操作', tone: 'pending' })
    expect(deriveSubviewStatus('rackdesign', { ...baseDeps, roomMatrixFinalized: false, rackHasCabinets: true })).toEqual({ label: '待操作', tone: 'pending' })
  })

  it('design（组网设计）：designValid 通过 → 已完成，否则待操作', () => {
    expect(deriveSubviewStatus('design', { ...baseDeps, designValid: true })).toEqual({ label: '已完成', tone: 'done' })
    expect(deriveSubviewStatus('design', { ...baseDeps, designValid: false })).toEqual({ label: '待操作', tone: 'pending' })
    expect(deriveSubviewStatus('design', { ...baseDeps, designValid: null })).toEqual({ label: '待操作', tone: 'pending' })
  })

  it('main（组网渲染）：designValid 通过且有已勾选输出类型 → 已完成，否则待操作', () => {
    expect(deriveSubviewStatus('main', { ...baseDeps, designValid: true, hasSelectedOutputTypes: true })).toEqual({ label: '已完成', tone: 'done' })
    expect(deriveSubviewStatus('main', { ...baseDeps, designValid: true, hasSelectedOutputTypes: false })).toEqual({ label: '待操作', tone: 'pending' })
    expect(deriveSubviewStatus('main', { ...baseDeps, designValid: false, hasSelectedOutputTypes: true })).toEqual({ label: '待操作', tone: 'pending' })
  })

  it('visualization（拓扑）：designValid 通过 → 已完成，否则待操作', () => {
    expect(deriveSubviewStatus('visualization', { ...baseDeps, designValid: true })).toEqual({ label: '已完成', tone: 'done' })
    expect(deriveSubviewStatus('visualization', { ...baseDeps, designValid: false })).toEqual({ label: '待操作', tone: 'pending' })
  })

  it('results（本项目输出）/ export（导出）：存在输出批次 → 已完成，否则待操作', () => {
    expect(deriveSubviewStatus('results', { ...baseDeps, hasOutputBatches: true })).toEqual({ label: '已完成', tone: 'done' })
    expect(deriveSubviewStatus('results', { ...baseDeps, hasOutputBatches: false })).toEqual({ label: '待操作', tone: 'pending' })
    expect(deriveSubviewStatus('export', { ...baseDeps, hasOutputBatches: true })).toEqual({ label: '已完成', tone: 'done' })
    expect(deriveSubviewStatus('export', { ...baseDeps, hasOutputBatches: false })).toEqual({ label: '待操作', tone: 'pending' })
  })

  it('aidc（AIDC 规划）：无规划就绪信号，恒定待操作', () => {
    expect(deriveSubviewStatus('aidc', baseDeps)).toEqual({ label: '待操作', tone: 'pending' })
  })

  it('当前 active 子视图 → 进行中（active 优先于就绪态）', () => {
    expect(deriveSubviewStatus('design', { ...baseDeps, designValid: true, activeSubview: 'design' })).toEqual({ label: '进行中', tone: 'active' })
    expect(deriveSubviewStatus('results', { ...baseDeps, hasOutputBatches: true, activeSubview: 'results' })).toEqual({ label: '进行中', tone: 'active' })
  })

  it('读取中（reading）→ 进行中，优先于就绪态', () => {
    expect(deriveSubviewStatus('design', { ...baseDeps, designValid: true, reading: true })).toEqual({ label: '进行中', tone: 'active' })
  })
})
