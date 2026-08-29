/**
 * M-F2（F2-2）：撤销/重做栈跨会话持久化单测（rack.store）
 *
 * 覆盖（PRD v3.6 F2-2 验收）：
 * - R-1 写盘：编辑后 persistRackUndoHistory → render.saveOutputFile 落盘到项目目录（base64 解码含 undoStack）
 * - R-2 重启模拟：写盘 → 重新 hydrate（清空撤销栈）→ restoreRackUndoHistory → undo 可回退到重启前
 * - R-3 容量受控：栈深只持久化最近 RACK_UNDO_PERSIST_LIMIT 条（超限丢弃最旧）
 * - R-3b 容量受控：字节阈值截断纯函数（truncateRackUndoByBytes）
 * - R-4 节流：scheduleRackUndoPersist 防抖 800ms 后写盘（fake timers）
 * - R-5 落盘受阻 → 退化 localStorage 兜底（方案B）
 * - R-6 结构损坏/旧格式 → 恢复忽略（不污染撤销栈）
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useRackStore, type RackCabinet, type CabinetType } from '../stores/rack.store'
import {
  RACK_UNDO_PERSIST_LIMIT,
  RACK_UNDO_PERSIST_DEBOUNCE_MS,
  RACK_UNDO_PERSIST_FILE,
  persistRackUndoHistory,
  restoreRackUndoHistory,
  scheduleRackUndoPersist,
  buildRackUndoPersistFile,
  truncateRackUndoByBytes,
} from '../stores/rack.store'

const mockElectron = {
  project: { getFile: vi.fn(), saveFile: vi.fn() },
  render: { saveOutputFile: vi.fn(), readOutputFile: vi.fn() },
  export: { saveFile: vi.fn() },
}

// @ts-expect-error - mock window.electron
window.electron = mockElectron

const cab = (id: number, name: string, over: Partial<RackCabinet> = {}): RackCabinet => ({
  id, name, totalU: 42, type: 'gpu' as CabinetType, power_limit: 6000, devices: [], ...over,
})

const decodeBase64 = (b64: string): string => Buffer.from(b64, 'base64').toString('utf-8')

const lastWrittenFile = (): string => {
  const calls = mockElectron.render.saveOutputFile.mock.calls
  expect(calls.length).toBeGreaterThan(0)
  return decodeBase64(calls[calls.length - 1][2] as string)
}

describe('M-F2 F2-2 撤销跨会话持久化（rack）', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.useRealTimers()
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
    useRackStore.getState().setCurrentProjectName(null)
    vi.clearAllMocks()
    mockElectron.project.getFile.mockResolvedValue(null)
  })

  it('R-1 写盘：编辑后 persistRackUndoHistory → 落盘到项目目录 output/undo_history.json', async () => {
    useRackStore.getState().setCurrentProjectName('projA')
    useRackStore.setState({ cabinets: [cab(1, '机柜 1')] })
    useRackStore.getState().updateCabinet(1, { power_limit: 7000 })
    await persistRackUndoHistory('projA')

    expect(mockElectron.render.saveOutputFile).toHaveBeenCalledWith(
      'projA',
      RACK_UNDO_PERSIST_FILE,
      expect.any(String),
    )
    const file = JSON.parse(lastWrittenFile())
    expect(file.store).toBe('rack')
    expect(Array.isArray(file.undoStack)).toBe(true)
    expect(file.undoStack.length).toBeGreaterThan(0)
  })

  it('R-2 重启模拟：写盘 → 清空撤销栈（重新 hydrate）→ restore 恢复 → undo 可回退到重启前', async () => {
    // 会话1：projA 连续两次编辑并落盘（undoStack = [6000 快照, 7000 快照]，当前 8000）
    useRackStore.getState().setCurrentProjectName('projA')
    useRackStore.setState({ cabinets: [cab(1, '机柜 1')] })
    useRackStore.getState().updateCabinet(1, { power_limit: 7000 })
    useRackStore.getState().updateCabinet(1, { power_limit: 8000 })
    await persistRackUndoHistory('projA')
    const persisted = lastWrittenFile()

    // 会话2：模拟重启——布局已加载到最新（9000），撤销栈清空
    useRackStore.getState().setCurrentProjectName('projA')
    useRackStore.setState({
      cabinets: [cab(1, '机柜 1', { power_limit: 9000 })],
      undoStack: [],
      redoStack: [],
      canUndo: false,
      canRedo: false,
    })
    mockElectron.project.getFile.mockImplementation(async (_name: string, filePath: string) =>
      filePath === `output/${RACK_UNDO_PERSIST_FILE}` ? persisted : null,
    )
    await restoreRackUndoHistory('projA')

    expect(useRackStore.getState().canUndo).toBe(true)
    // 重启后 Ctrl+Z 回退到重启前的上一步（8000 的前一步 = 7000）
    useRackStore.getState().undo()
    expect(useRackStore.getState().cabinets[0].power_limit).toBe(7000)
  })

  it('R-3 容量受控：只持久化最近 RACK_UNDO_PERSIST_LIMIT 条（超限丢弃最旧）', async () => {
    useRackStore.getState().setCurrentProjectName('projA')
    useRackStore.setState({ cabinets: [cab(1, '机柜 1')] })
    for (let i = 0; i < 25; i++) useRackStore.getState().updateCabinet(1, { power_limit: 6000 + i })
    expect(useRackStore.getState().undoStack.length).toBe(25)
    await persistRackUndoHistory('projA')

    const file = JSON.parse(lastWrittenFile())
    expect(file.undoStack.length).toBe(RACK_UNDO_PERSIST_LIMIT)
    // 最旧的 5 条被丢弃：栈中最旧保留快照 power_limit = 6004（初始 6000 + 丢弃数 - 1）
    expect(file.undoStack[0].cabinets[0].power_limit).toBe(6000 + (25 - RACK_UNDO_PERSIST_LIMIT) - 1)
  })

  it('R-3b 容量受控：字节阈值截断纯函数（truncateRackUndoByBytes）', () => {
    const snap = (p: number) => ({
      cabinets: [{ id: 1, name: 'c', totalU: 42, type: 'gpu' as const, power_limit: p, devices: [] }],
      unplacedDevices: [],
      selectedCabinetId: null,
      selectedDevice: null,
      addDeviceMode: false,
      editingDevice: null,
    })
    const stack = Array.from({ length: 8 }, (_, i) => snap(6000 + i))
    // 小阈值：只能容纳部分快照 → 丢弃最旧直至达标
    const capped = truncateRackUndoByBytes(stack, [], 400)
    expect(capped).not.toBeNull()
    expect(capped!.undoStack.length).toBeGreaterThan(0)
    expect(capped!.undoStack.length).toBeLessThan(stack.length)
    expect(capped!.undoStack[0].cabinets[0].power_limit).toBe(6000 + (stack.length - capped!.undoStack.length))
    // 极低阈值：单条也超限 → null（放弃本次）
    expect(truncateRackUndoByBytes(stack, [], 10)).toBeNull()
  })

  it('R-4 节流：scheduleRackUndoPersist 防抖 800ms 后写盘', async () => {
    vi.useFakeTimers()
    useRackStore.getState().setCurrentProjectName('projA')
    useRackStore.setState({ cabinets: [cab(1, '机柜 1')] })
    useRackStore.getState().updateCabinet(1, { power_limit: 7000 })
    scheduleRackUndoPersist('projA')
    // 未到防抖时长 → 未写盘
    vi.advanceTimersByTime(RACK_UNDO_PERSIST_DEBOUNCE_MS - 100)
    expect(mockElectron.render.saveOutputFile).not.toHaveBeenCalled()
    // 到达防抖时长 → 写盘
    await vi.advanceTimersByTimeAsync(100)
    expect(mockElectron.render.saveOutputFile).toHaveBeenCalledWith(
      'projA',
      RACK_UNDO_PERSIST_FILE,
      expect.any(String),
    )
    vi.useRealTimers()
  })

  it('R-5 落盘受阻 → 退化 localStorage（方案B）且可恢复', async () => {
    // 移除 render.saveOutputFile → persist 退化为 localStorage
    const saveSpy = mockElectron.render.saveOutputFile
    // @ts-expect-error - 模拟 render 通道不可用
    delete mockElectron.render.saveOutputFile
    useRackStore.getState().setCurrentProjectName('projA')
    useRackStore.setState({ cabinets: [cab(1, '机柜 1')] })
    useRackStore.getState().updateCabinet(1, { power_limit: 7000 })
    await persistRackUndoHistory('projA')
    expect(localStorage.getItem('autolink-rack-undo:projA')).toContain('"store":"rack"')
    // 恢复（无 project.getFile 内容）→ 从 localStorage 读到并还原撤销栈
    useRackStore.setState({ undoStack: [], redoStack: [], canUndo: false, canRedo: false })
    await restoreRackUndoHistory('projA')
    expect(useRackStore.getState().canUndo).toBe(true)
    // 还原
    mockElectron.render.saveOutputFile = saveSpy
  })

  it('R-6 结构损坏/旧格式 → 恢复忽略（不污染撤销栈）', async () => {
    mockElectron.project.getFile.mockImplementation(async (_name: string, filePath: string) => {
      if (filePath === `output/${RACK_UNDO_PERSIST_FILE}`) return '{"store":"rack","undoStack":"oops"}'
      return null
    })
    useRackStore.getState().setCurrentProjectName('projA')
    await restoreRackUndoHistory('projA')
    expect(useRackStore.getState().undoStack).toHaveLength(0)
    expect(useRackStore.getState().canUndo).toBe(false)
  })

  it('R-7 buildRackUndoPersistFile 栈深截断到最近 N 条', () => {
    const snap = (p: number) => ({
      cabinets: [cab(1, '机柜 1', { power_limit: p })],
      unplacedDevices: [],
      selectedCabinetId: null,
      selectedDevice: null,
      addDeviceMode: false,
      editingDevice: null,
    })
    const stack = Array.from({ length: 30 }, (_, i) => snap(6000 + i))
    const file = buildRackUndoPersistFile(stack, [])
    expect(file.undoStack.length).toBe(RACK_UNDO_PERSIST_LIMIT)
    expect(file.undoStack[0].cabinets[0].power_limit).toBe(6000 + (30 - RACK_UNDO_PERSIST_LIMIT))
  })
})
