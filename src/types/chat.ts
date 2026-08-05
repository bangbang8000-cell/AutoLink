/** V3.1.1-T5-5: AI 对话类型（移植 MC @/types/chat，autolink 化） */

export type ChatMode = 'general' | 'template' | 'config'

export type AttachmentType = 'excel' | 'yaml' | 'template' | 'config' | 'document' | 'other'

export interface ChatAttachment {
  id: string
  name: string
  type: AttachmentType
  path: string
  size: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  mode: ChatMode
  attachments?: ChatAttachment[]
  /** 工具调用元数据（PlanDisplay 等渲染用） */
  metadata?: { tools?: string[]; plan?: string }
  timestamp: number
}

export interface ChatSession {
  id: string
  title: string
  messages: ChatMessage[]
  mode: ChatMode
  createdAt: number
  updatedAt: number
}

let _id = 0
export function generateId(): string {
  _id++
  return `msg_${Date.now()}_${_id}`
}
