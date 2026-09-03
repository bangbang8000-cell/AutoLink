/**
 * 5.0.3-503-a：多步自主任务编排前端——进度标记解析 / 步骤确认卡片回灌 / workflow 透传
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  useChatStore,
  parseWorkflowMarker,
  parseStepConfirmMarker,
  sendStepConfirmationReply,
  sendMessage,
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

describe('多步任务编排前端（503-a）', () => {
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

  describe('任务进度标记解析', () => {
    it('parseWorkflowMarker 解析最新任务快照', () => {
      const content =
        '开始\n' +
        '---WORKFLOW:{"task_id":"abc123","status":"executing","current_step":0,"total_steps":2}---\n' +
        '执行中\n' +
        '---WORKFLOW:{"task_id":"abc123","status":"completed","current_step":2,"total_steps":2}---\n'
      const task = parseWorkflowMarker(content)
      expect(task).not.toBeNull()
      expect(task!.task_id).toBe('abc123')
      // 取最后一个（最新状态）
      expect(task!.status).toBe('completed')
      expect(task!.total_steps).toBe(2)
    })

    it('parseWorkflowMarker 无标记/非法 JSON 返回 null', () => {
      expect(parseWorkflowMarker('普通文本')).toBeNull()
      expect(parseWorkflowMarker('---WORKFLOW:not-json---')).toBeNull()
      expect(parseWorkflowMarker('---WORKFLOW:{"a":1}---')).toBeNull() // 缺 task_id
    })

    it('parseStepConfirmMarker 解析步骤审批标记并剥离展示内容', () => {
      const content = '计划已生成\n---STEP_CONFIRM:abc123:0---\n\n> ⚠️ 第 1 步需要确认。'
      const r = parseStepConfirmMarker(content)
      expect(r).not.toBeNull()
      expect(r!.taskId).toBe('abc123')
      expect(r!.step).toBe(0)
      expect(r!.displayContent).not.toContain('---STEP_CONFIRM:')
      expect(r!.displayContent).toContain('需要确认')
    })

    it('parseStepConfirmMarker 无标记返回 null', () => {
      expect(parseStepConfirmMarker('普通内容')).toBeNull()
    })
  })

  describe('步骤确认回灌', () => {
    it('sendStepConfirmationReply 以 workflow 模式发送「确认」', async () => {
      let resolveChat: (v: unknown) => void = () => {}
      const mock = makeAiHubMock(() => new Promise((r) => { resolveChat = r }))
      globalThis.window.electron = { aihub: mock } as never
      const id = useChatStore.getState().createSession()
      useChatStore.getState().addMessage({ role: 'user', content: '梳理配置项' })

      const started = sendStepConfirmationReply('确认')
      expect(started).toBe(true)
      await vi.waitFor(() => expect(mock.onStream).toHaveBeenCalled())
      const ses = useChatStore.getState().sessions.find((s) => s.id === id)!
      expect(ses.messages.some((m) => m.role === 'user' && m.content === '确认')).toBe(true)
      mock.emit('已确认', id)
      resolveChat({ sessionId: id, status: 'ok', messages: 2 })
      await new Promise((r) => setTimeout(r, 0))
      expect(useChatStore.getState().isSending).toBe(false)
    })

    it('sendStepConfirmationReply 发送中忽略', () => {
      useChatStore.getState().createSession()
      useChatStore.setState({ isSending: true })
      expect(sendStepConfirmationReply('确认')).toBe(false)
      useChatStore.setState({ isSending: false })
    })
  })

  describe('workflow 参数透传', () => {
    it('sendMessage workflow=true 时 aiHub.chat 载荷含 workflow', async () => {
      const mock = makeAiHubMock(async () => ({ sessionId: 's1', status: 'ok', reply: '完成' }))
      globalThis.window.electron = { aihub: mock } as never
      useChatStore.getState().createSession()
      const store = useChatStore.getState()

      await sendMessage(store, '帮我梳理配置项', 'general', [], undefined, true)
      const payload = mock.chat.mock.calls[0][0] as Record<string, unknown>
      expect(payload.workflow).toBe(true)
    })

    it('sendMessage 缺省 workflow=false', async () => {
      const mock = makeAiHubMock(async () => ({ sessionId: 's1', status: 'ok', reply: '完成' }))
      globalThis.window.electron = { aihub: mock } as never
      useChatStore.getState().createSession()
      const store = useChatStore.getState()

      await sendMessage(store, '普通消息', 'general', [])
      const payload = mock.chat.mock.calls[0][0] as Record<string, unknown>
      expect(payload.workflow).toBe(false)
    })
  })
})
