/**
 * 4.3 F3-2（测试计划 A-3）：对话深化——摘要衔接 / 会话管理增强（重命名/清理）/ 确认流完善
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  useChatStore,
  parseConfirmationMarker,
  sendConfirmationReply,
  resetSyncedProviderConfigs,
} from '@/stores/chat.store'
import { useUIStore } from '@/stores/ui.store'

function makeAiHubMock(chatImpl?: (...args: unknown[]) => Promise<unknown>) {
  let streamCb: ((data: { sessionId: string; chunk: string }) => void) | null = null
  const chat = vi.fn(chatImpl || (async () => ({ sessionId: 's1', status: 'ok', reply: 'ok' })))
  const onStream = vi.fn((cb: (data: { sessionId: string; chunk: string }) => void) => {
    streamCb = cb
    return () => { streamCb = null }
  })
  const emit = (chunk: string, sid = 's1') => streamCb?.({ sessionId: sid, chunk })
  const config = vi.fn(async () => ({ status: 'ok' }))
  const configDefault = vi.fn(async () => ({ status: 'ok' }))
  const clear = vi.fn(async () => ({ status: 'ok' }))
  return { chat, onStream, emit, config, configDefault, clear }
}

const savedElectron = globalThis.window.electron

describe('对话深化（A-3）', () => {
  beforeEach(() => {
    localStorage.clear()
    useChatStore.setState({
      sessions: [],
      activeSessionId: null,
      currentMode: 'general',
      pendingAttachments: [],
      inputValue: '',
      isSending: false,
      aiHubStatus: 'no_provider',
    })
    useUIStore.setState({
      aiConfig: {
        defaultProvider: 'deepseek',
        autonomyMode: 'semi_auto',
        aiEngine: 'own',
        providers: { deepseek: { apiKey: 'sk-test', model: 'deepseek-chat', baseUrl: '' } },
      },
    } as never)
    resetSyncedProviderConfigs()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    if (savedElectron === undefined) {
      delete (globalThis.window as { electron?: unknown }).electron
    } else {
      globalThis.window.electron = savedElectron
    }
  })

  describe('会话管理增强（重命名/清理）', () => {
    it('renameSession 重命名会话', () => {
      const id = useChatStore.getState().createSession()
      useChatStore.getState().renameSession(id, '我的 IB 网络设计')
      expect(useChatStore.getState().sessions.find((s) => s.id === id)?.title).toBe('我的 IB 网络设计')
    })

    it('renameSession 空标题忽略', () => {
      const id = useChatStore.getState().createSession()
      useChatStore.getState().renameSession(id, '   ')
      expect(useChatStore.getState().sessions.find((s) => s.id === id)?.title).not.toBe('')
    })

    it('clearSessionContext 清空前端并联动后端 clear', async () => {
      const mock = makeAiHubMock()
      globalThis.window.electron = { aihub: mock } as never
      const id = useChatStore.getState().createSession()
      useChatStore.getState().addMessage({ role: 'user', content: 'hi' })
      await useChatStore.getState().clearSessionContext(id)
      expect(useChatStore.getState().sessions.find((s) => s.id === id)?.messages).toHaveLength(0)
      // 5.0.2-502-b: 按当前 AI 引擎命名空间清除后端会话
      expect(mock.clear).toHaveBeenCalledWith(id, 'own')
    })

    it('clearSessionContext 后端不可用时仅前端清空', async () => {
      delete (globalThis.window as { electron?: unknown }).electron
      const id = useChatStore.getState().createSession()
      useChatStore.getState().addMessage({ role: 'user', content: 'hi' })
      await useChatStore.getState().clearSessionContext(id)
      expect(useChatStore.getState().sessions.find((s) => s.id === id)?.messages).toHaveLength(0)
    })
  })

  describe('上下文摘要衔接（摘要后继续）', () => {
    it('summarizeSession 生成摘要并替换历史（摘要后继续）', async () => {
      const mock = makeAiHubMock(async () => ({ sessionId: 'tmp', status: 'ok', reply: '用户询问 IB 网络设计要点。' }))
      globalThis.window.electron = { aihub: mock } as never
      const id = useChatStore.getState().createSession()
      useChatStore.getState().addMessage({ role: 'user', content: '帮我设计 IB 网络' })
      useChatStore.getState().addMessage({ role: 'assistant', content: '好的，建议 800G IB。' })

      const r = await useChatStore.getState().summarizeSession(id)
      expect(r.ok).toBe(true)
      expect(r.summary).toContain('IB')
      const ses = useChatStore.getState().sessions.find((s) => s.id === id)!
      // 默认替换历史：仅剩 1 条 system 摘要标记
      expect(ses.messages).toHaveLength(1)
      expect(ses.messages[0].role).toBe('system')
      expect(ses.messages[0].content).toContain('会话摘要')
      expect(mock.chat).toHaveBeenCalled()
      expect(mock.clear).toHaveBeenCalled()  // 清理临时会话
    })

    it('summarizeSession keepFull 保留完整历史，仅在顶部标记摘要', async () => {
      const mock = makeAiHubMock(async () => ({ sessionId: 'tmp', status: 'ok', reply: '摘要A' }))
      globalThis.window.electron = { aihub: mock } as never
      const id = useChatStore.getState().createSession()
      useChatStore.getState().addMessage({ role: 'user', content: 'hi' })
      const r = await useChatStore.getState().summarizeSession(id, { keepFull: true })
      expect(r.ok).toBe(true)
      const ses = useChatStore.getState().sessions.find((s) => s.id === id)!
      expect(ses.messages[0].role).toBe('system')
      expect(ses.messages).toHaveLength(2)  // 摘要标记 + 原历史
      expect(ses.messages[0].content).toContain('历史保留')
    })

    it('summarizeSession 无会话/空会话返回错误', async () => {
      const r = await useChatStore.getState().summarizeSession(undefined)
      expect(r.ok).toBe(false)
    })

    it('summarizeSession AI 返回空/错误时保持原历史', async () => {
      const mock = makeAiHubMock(async () => ({ sessionId: 'tmp', status: 'ok', reply: 'Error: fail' }))
      globalThis.window.electron = { aihub: mock } as never
      const id = useChatStore.getState().createSession()
      useChatStore.getState().addMessage({ role: 'user', content: 'hi' })
      const before = useChatStore.getState().sessions.find((s) => s.id === id)!.messages.length
      const r = await useChatStore.getState().summarizeSession(id)
      expect(r.ok).toBe(false)
      expect(useChatStore.getState().sessions.find((s) => s.id === id)!.messages).toHaveLength(before)
    })
  })

  describe('确认流完善（确认标记解析 / 按钮回灌）', () => {
    it('parseConfirmationMarker 解析标记并剥离展示内容', () => {
      const content = '处理中\n---CONFIRM:delete_project---\n\n> ⚠️ 操作需要确认。'
      const r = parseConfirmationMarker(content)
      expect(r).not.toBeNull()
      expect(r!.tool).toBe('delete_project')
      expect(r!.displayContent).not.toContain('---CONFIRM:')
      expect(r!.displayContent).toContain('操作需要确认')
    })

    it('parseConfirmationMarker 无标记返回 null', () => {
      expect(parseConfirmationMarker('普通内容')).toBeNull()
    })

    it('sendConfirmationReply 以用户身份发送「确认」', async () => {
      let resolveChat: (v: unknown) => void = () => {}
      const mock = makeAiHubMock(() => new Promise((r) => { resolveChat = r }))
      globalThis.window.electron = { aihub: mock } as never
      const id = useChatStore.getState().createSession()
      useChatStore.getState().addMessage({ role: 'user', content: '删除项目 p' })

      const started = sendConfirmationReply('确认')
      expect(started).toBe(true)

      // 等待流式注册并触发发送
      await vi.waitFor(() => expect(mock.onStream).toHaveBeenCalled())
      // 用户消息「确认」已入队
      const ses = useChatStore.getState().sessions.find((s) => s.id === id)!
      expect(ses.messages.some((m) => m.role === 'user' && m.content === '确认')).toBe(true)
      mock.emit('已确认，正在执行…', id)
      resolveChat({ sessionId: id, status: 'ok', messages: 2 })
      // 等待异步完成
      await new Promise((r) => setTimeout(r, 0))
      expect(useChatStore.getState().isSending).toBe(false)
    })

    it('sendConfirmationReply 发送中忽略（isSending 返回 false）', () => {
      useChatStore.getState().createSession()
      useChatStore.setState({ isSending: true })
      expect(sendConfirmationReply('确认')).toBe(false)
      useChatStore.setState({ isSending: false })
    })
  })
})
