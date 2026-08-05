import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { useChatStore, sendMessage } from '@/stores/chat.store'
import { useUIStore } from '@/stores/ui.store'

/** 构造 aihub 桥接 mock（chat/onStream/config/configDefault） */
function makeAiHubMock(chatImpl?: (...args: unknown[]) => Promise<unknown>) {
  let streamCb: ((data: { sessionId: string; chunk: string }) => void) | null = null
  const chat = vi.fn(chatImpl || (async () => ({ sessionId: 's1', status: 'ok', messages: 1 })))
  const onStream = vi.fn((cb: (data: { sessionId: string; chunk: string }) => void) => {
    streamCb = cb
    return () => { streamCb = null }
  })
  const emit = (chunk: string, sid = 's1') => streamCb?.({ sessionId: sid, chunk })
  const config = vi.fn(async () => ({ status: 'ok' }))
  const configDefault = vi.fn(async () => ({ status: 'ok' }))
  return { chat, onStream, emit, config, configDefault }
}

const savedElectron = globalThis.window.electron

describe('ChatStore', () => {
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
        providers: { deepseek: { apiKey: 'sk-test', model: 'deepseek-chat', baseUrl: '' } },
      },
    } as never)
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    // 还原 electron 桥接（jsdom 中默认为 undefined）
    if (savedElectron === undefined) {
      delete (globalThis.window as { electron?: unknown }).electron
    } else {
      globalThis.window.electron = savedElectron
    }
  })

  describe('会话管理', () => {
    it('createSession 创建会话并设为激活', () => {
      const id = useChatStore.getState().createSession()
      const s = useChatStore.getState()
      expect(s.activeSessionId).toBe(id)
      expect(s.sessions).toHaveLength(1)
      expect(s.getActiveSession()?.mode).toBe('general')
    })

    it('createSession 支持指定模式', () => {
      useChatStore.getState().createSession('config')
      expect(useChatStore.getState().currentMode).toBe('config')
      expect(useChatStore.getState().getActiveSession()?.mode).toBe('config')
    })

    it('deleteSession 删除后切换激活会话', () => {
      useChatStore.getState().createSession()
      const id2 = useChatStore.getState().createSession()
      useChatStore.getState().deleteSession(id2)
      expect(useChatStore.getState().sessions).toHaveLength(1)
      expect(useChatStore.getState().activeSessionId).not.toBe(id2)
    })

    it('clearCurrentSession 清空当前会话消息', () => {
      useChatStore.getState().createSession()
      const store = useChatStore.getState()
      store.addMessage({ role: 'user', content: 'hi' })
      expect(useChatStore.getState().getActiveSession()?.messages).toHaveLength(1)
      useChatStore.getState().clearCurrentSession()
      expect(useChatStore.getState().getActiveSession()?.messages).toHaveLength(0)
    })
  })

  describe('消息管理', () => {
    it('addMessage 首条用户消息自动设置为会话标题', () => {
      useChatStore.getState().createSession()
      useChatStore.getState().addMessage({ role: 'user', content: '帮我设计一个 IB 网络拓扑' })
      const ses = useChatStore.getState().getActiveSession()!
      expect(ses.messages).toHaveLength(1)
      expect(ses.title).toBe('帮我设计一个 IB 网络拓扑')
    })

    it('addMessage 追加到当前会话', () => {
      useChatStore.getState().createSession()
      const store = useChatStore.getState()
      store.addMessage({ role: 'user', content: 'a' })
      store.addMessage({ role: 'assistant', content: 'b' })
      const ses = useChatStore.getState().getActiveSession()!
      expect(ses.messages.map((m) => m.content)).toEqual(['a', 'b'])
    })
  })

  describe('模式管理', () => {
    it('setMode / updateSessionMode 更新模式', () => {
      useChatStore.getState().setMode('template')
      expect(useChatStore.getState().currentMode).toBe('template')
      useChatStore.getState().createSession()
      useChatStore.getState().updateSessionMode('config')
      expect(useChatStore.getState().getActiveSession()?.mode).toBe('config')
      expect(useChatStore.getState().currentMode).toBe('config')
    })
  })

  describe('附件管理', () => {
    it('addAttachment 根据扩展名识别类型', async () => {
      const store = useChatStore.getState()
      await store.addAttachment({ name: 'project_config.json', size: 10 } as File)
      await store.addAttachment({ name: 'plan.xlsx', size: 10 } as File)
      await store.addAttachment({ name: 'readme.md', size: 10 } as File)
      const atts = useChatStore.getState().pendingAttachments
      expect(atts).toHaveLength(3)
      expect(atts[0].type).toBe('config')
      expect(atts[1].type).toBe('excel')
      expect(atts[2].type).toBe('document')
    })

    it('removeAttachment / clearAttachments', async () => {
      const store = useChatStore.getState()
      await store.addAttachment({ name: 'a.json', size: 1 } as File)
      const id = useChatStore.getState().pendingAttachments[0].id
      useChatStore.getState().removeAttachment(id)
      expect(useChatStore.getState().pendingAttachments).toHaveLength(0)
      await useChatStore.getState().addAttachment({ name: 'b.yaml', size: 1 } as File)
      useChatStore.getState().clearAttachments()
      expect(useChatStore.getState().pendingAttachments).toHaveLength(0)
    })
  })

  describe('sendMessage', () => {
    it('无 AI Hub 桥接时降级为 mock 回复', async () => {
      delete (globalThis.window as { electron?: unknown }).electron
      useChatStore.getState().createSession()
      const store = useChatStore.getState()
      await sendMessage(store, '你好', 'general', [])
      const ses = useChatStore.getState().getActiveSession()!
      const aiMsg = ses.messages.find((m) => m.role === 'assistant')
      expect(aiMsg).toBeDefined()
      expect(aiMsg!.content).not.toBe('')
      expect(useChatStore.getState().isSending).toBe(false)
    })

    it('有 AI Hub 时流式追加助手回复', async () => {
      let resolveChat: (v: unknown) => void = () => {}
      const mock = makeAiHubMock(
        () => new Promise((r) => { resolveChat = r }),
      )
      globalThis.window.electron = { aihub: mock } as never

      useChatStore.getState().createSession()
      const sessionId = useChatStore.getState().activeSessionId!
      const p = sendMessage(useChatStore.getState(), '列出配置 schema', 'general', [])

      await vi.waitFor(() => expect(mock.onStream).toHaveBeenCalled())
      mock.emit('配置', sessionId)
      mock.emit('schema', sessionId)
      resolveChat({ sessionId, status: 'ok', messages: 1 })
      await p

      const ses = useChatStore.getState().getActiveSession()!
      const aiMsg = ses.messages.find((m) => m.role === 'assistant')
      expect(aiMsg?.content).toBe('配置schema')
      expect(mock.config).toHaveBeenCalled()
      expect(mock.configDefault).toHaveBeenCalledWith('deepseek')
      expect(useChatStore.getState().isSending).toBe(false)
    })

    it('发送后清空输入与附件', async () => {
      const mock = makeAiHubMock()
      globalThis.window.electron = { aihub: mock } as never
      useChatStore.getState().createSession()
      useChatStore.getState().setInputValue('hello')
      await useChatStore.getState().addAttachment({ name: 'a.json', size: 1 } as File)
      await sendMessage(useChatStore.getState(), 'hello', 'general', useChatStore.getState().pendingAttachments)
      expect(useChatStore.getState().inputValue).toBe('')
      expect(useChatStore.getState().pendingAttachments).toHaveLength(0)
    })
  })
})
