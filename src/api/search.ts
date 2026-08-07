/**
 * V3.3.1: 全局搜索 API（本地 + 云端二合一）
 *
 * 本地搜索：主进程 search:local（项目文件 / 设备库 / 模板 文件名 + 内容检索）
 * 云端搜索：复用 cloud 域（登录态下生效），渲染层零网络由主进程统一转发。
 */

export type LocalSearchScope = 'project' | 'device' | 'template' | 'all'

export interface LocalSearchHit {
  type: 'project' | 'device' | 'template'
  /** 项目名 / 设备 id / 模板名 */
  name: string
  /** 设备类别 / 模板来源（内置 / 用户） */
  category?: string
  /** 相对路径（文件命中时） */
  path?: string
  kind?: 'filename' | 'content'
  line?: number
  excerpt?: string
}

export interface CloudSearchBundle {
  projects: import('@/api/cloud').RemoteProject[]
  templates: import('@/api/cloud').RemoteTemplate[]
  files: import('@/api/cloud').FileSearchResult[]
  contents: import('@/api/cloud').ContentSearchResult[]
}

export const searchApi = {
  /** 本地搜索（主进程文件 IO，渲染层零网络） */
  local: (params: { query: string; scope?: LocalSearchScope; maxResults?: number }): Promise<LocalSearchHit[]> =>
    window.electron.search.local(params),
}
