/**
 * 5.0.3-503-a/503-c：IPC 载荷 schema 测试
 * - aiChatSchema 接受 workflow 标记（多步任务编排）
 * - AI_ACTION_WHITELIST 放行 mcp 管理通道（协议层工具接入）
 * - mcpAddSchema / mcpNameSchema 形状边界
 */
import { describe, it, expect } from 'vitest'
import {
  AI_ACTION_WHITELIST,
  aiChatSchema,
  mcpAddSchema,
  mcpNameSchema,
} from '../../electron/ipc/schemas'

describe('IPC 载荷 schema（503-a/503-c）', () => {
  it('AI_ACTION_WHITELIST 放行 workflow 与 mcp 管理通道', () => {
    const whitelist = AI_ACTION_WHITELIST as readonly string[]
    for (const action of ['ai:mcp-list', 'ai:mcp-add', 'ai:mcp-remove', 'ai:mcp-reload']) {
      expect(whitelist).toContain(action)
    }
  })

  it('aiChatSchema 接受 workflow 布尔字段', () => {
    const base = { sessionId: 's1', message: '梳理配置项' }
    expect(aiChatSchema.safeParse({ ...base, workflow: true }).success).toBe(true)
    expect(aiChatSchema.safeParse({ ...base, workflow: false }).success).toBe(true)
    // 缺省 workflow 合法（向后兼容）
    expect(aiChatSchema.safeParse(base).success).toBe(true)
  })

  it('mcpAddSchema 校验名称/命令形状', () => {
    expect(mcpAddSchema.safeParse({ name: 'fs', command: 'npx' }).success).toBe(true)
    expect(mcpAddSchema.safeParse({ name: 'bad name', command: 'npx' }).success).toBe(false)
    expect(mcpAddSchema.safeParse({ name: 'fs', command: '' }).success).toBe(false)
    expect(mcpAddSchema.safeParse({ name: 'fs', command: 'npx', args: ['-y'] }).success).toBe(true)
  })

  it('mcpNameSchema 校验删除名称', () => {
    expect(mcpNameSchema.safeParse({ name: 'fs' }).success).toBe(true)
    expect(mcpNameSchema.safeParse({ name: '' }).success).toBe(false)
  })
})
