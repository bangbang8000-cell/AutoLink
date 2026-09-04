/**
 * 5.0.3-503-a/503-c + 5.0.5-505-b/c：IPC 载荷 schema 测试
 * - aiChatSchema 接受 workflow 标记（多步任务编排）与 knowledge 检索 query（505-c）
 * - AI_ACTION_WHITELIST 放行 mcp 管理通道（协议层工具接入）与知识库通道（505-b）
 * - mcpAddSchema / mcpNameSchema 形状边界
 * - knowledgeEntrySchema / knowledgeUpdateSchema / knowledgeSearchSchema 形状边界
 */
import { describe, it, expect } from 'vitest'
import {
  AI_ACTION_WHITELIST,
  aiChatSchema,
  mcpAddSchema,
  mcpNameSchema,
  knowledgeEntrySchema,
  knowledgeUpdateSchema,
  knowledgeSearchSchema,
} from '../../electron/ipc/schemas'

describe('IPC 载荷 schema（503-a/503-c + 505-b/505-c）', () => {
  it('AI_ACTION_WHITELIST 放行 workflow 与 mcp 管理通道', () => {
    const whitelist = AI_ACTION_WHITELIST as readonly string[]
    for (const action of ['ai:mcp-list', 'ai:mcp-add', 'ai:mcp-remove', 'ai:mcp-reload']) {
      expect(whitelist).toContain(action)
    }
  })

  it('AI_ACTION_WHITELIST 放行知识库通道（505-b）', () => {
    const whitelist = AI_ACTION_WHITELIST as readonly string[]
    for (const action of [
      'ai:knowledge-list', 'ai:knowledge-get', 'ai:knowledge-add',
      'ai:knowledge-update', 'ai:knowledge-delete', 'ai:knowledge-search',
    ]) {
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

  it('aiChatSchema 接受 knowledge 检索 query（505-c，可选）', () => {
    const base = { sessionId: 's1', message: '收敛比怎么配' }
    expect(aiChatSchema.safeParse({ ...base, knowledge: 'RoCE 收敛比' }).success).toBe(true)
    // 缺省 knowledge 合法（向后兼容）
    expect(aiChatSchema.safeParse(base).success).toBe(true)
    // 超长拒绝
    expect(aiChatSchema.safeParse({ ...base, knowledge: 'x'.repeat(2001) }).success).toBe(false)
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

  it('knowledgeEntrySchema 校验条目载荷', () => {
    expect(knowledgeEntrySchema.safeParse({ name: 'roc-conv', content: '知识内容' }).success).toBe(true)
    expect(knowledgeEntrySchema.safeParse({ name: 'roc-conv', content: 'x', metadata: { title: 'T' } }).success).toBe(true)
    // 空名 / 路径分隔符 / 空内容拒绝
    expect(knowledgeEntrySchema.safeParse({ name: '', content: 'x' }).success).toBe(false)
    expect(knowledgeEntrySchema.safeParse({ name: 'a/b', content: 'x' }).success).toBe(false)
    expect(knowledgeEntrySchema.safeParse({ name: 'n', content: '' }).success).toBe(false)
  })

  it('knowledgeUpdateSchema 至少提供 content 或 metadata', () => {
    expect(knowledgeUpdateSchema.safeParse({ content: '新内容' }).success).toBe(true)
    expect(knowledgeUpdateSchema.safeParse({ metadata: { title: 'T' } }).success).toBe(true)
    expect(knowledgeUpdateSchema.safeParse({}).success).toBe(false)
  })

  it('knowledgeSearchSchema 校验检索载荷', () => {
    expect(knowledgeSearchSchema.safeParse({ query: 'roce', topK: 5 }).success).toBe(true)
    expect(knowledgeSearchSchema.safeParse({ topK: 0 }).success).toBe(false)
    expect(knowledgeSearchSchema.safeParse({ topK: 51 }).success).toBe(false)
  })
})
