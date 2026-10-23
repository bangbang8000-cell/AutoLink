/**
 * F3（5.5.x）：渲染续传指纹单测
 *
 * renderFingerprint 决定「单文件级续传」是否生效：
 * - 输入未变 → 指纹稳定（续传跳过已完成文件）
 * - 任一渲染输入变化（拓扑节点/边、机柜名/型号、机房矩阵、设计有效性）→ 指纹变化（强制全量重渲）
 */
import { describe, expect, it } from 'vitest'
import { renderFingerprint } from '@/components/workbench/WorkbenchActionCard'

describe('renderFingerprint（F3 渲染续传指纹）', () => {
  const baseTopology = { nodes: [{ id: 'a' }, { id: 'b' }], edges: [{ id: 'e1' }] }
  const baseCabinets = [
    { name: 'A01', model: 'NVIDIA-8GPU' },
    { name: 'A02', model: 'NVIDIA-8GPU' },
  ]
  const baseMatrix = { rows: ['A'], cols: [1] }

  it('相同输入 → 指纹稳定（续传可跳过）', () => {
    const fp1 = renderFingerprint(baseTopology, baseCabinets, baseMatrix, true)
    const fp2 = renderFingerprint(baseTopology, baseCabinets, baseMatrix, true)
    expect(fp1).toBe(fp2)
  })

  it('拓扑节点数变化 → 指纹变化（强制全量）', () => {
    const fp1 = renderFingerprint(baseTopology, baseCabinets, baseMatrix, true)
    const fp2 = renderFingerprint({ nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], edges: [{ id: 'e1' }] }, baseCabinets, baseMatrix, true)
    expect(fp2).not.toBe(fp1)
  })

  it('拓扑边数变化 → 指纹变化', () => {
    const fp1 = renderFingerprint(baseTopology, baseCabinets, baseMatrix, true)
    const fp2 = renderFingerprint({ nodes: baseTopology.nodes, edges: [{ id: 'e1' }, { id: 'e2' }] }, baseCabinets, baseMatrix, true)
    expect(fp2).not.toBe(fp1)
  })

  it('机柜数量/型号变化 → 指纹变化', () => {
    const fp1 = renderFingerprint(baseTopology, baseCabinets, baseMatrix, true)
    const fp2 = renderFingerprint(baseTopology, [...baseCabinets, { name: 'A03', model: 'NVIDIA-8GPU' }], baseMatrix, true)
    expect(fp2).not.toBe(fp1)
    const fp3 = renderFingerprint(baseTopology, [{ name: 'A01', model: 'NVIDIA-4GPU' }, { name: 'A02', model: 'NVIDIA-8GPU' }], baseMatrix, true)
    expect(fp3).not.toBe(fp1)
  })

  it('机房矩阵存在性变化 → 指纹变化', () => {
    const fp1 = renderFingerprint(baseTopology, baseCabinets, baseMatrix, true)
    const fp2 = renderFingerprint(baseTopology, baseCabinets, null, true)
    expect(fp2).not.toBe(fp1)
  })

  it('设计有效性变化 → 指纹变化', () => {
    const fp1 = renderFingerprint(baseTopology, baseCabinets, baseMatrix, true)
    const fp2 = renderFingerprint(baseTopology, baseCabinets, baseMatrix, false)
    expect(fp2).not.toBe(fp1)
  })

  it('空输入（无拓扑/无机柜/无矩阵）→ 指纹仍稳定', () => {
    const fp1 = renderFingerprint(null, [], null, false)
    const fp2 = renderFingerprint(null, [], null, false)
    expect(fp1).toBe(fp2)
  })
})
