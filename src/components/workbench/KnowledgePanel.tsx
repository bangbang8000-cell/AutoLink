/**
 * 5.0.5-505-b：知识库面板（工作台子视图）
 *
 * 知识条目 = knowledge/*.md + 伴生 metadata（title/category/project/tags）。
 * 通过 ai:knowledge* IPC 通道访问后端 KnowledgeEngine：
 *  - 列表 + 分类筛选 + 关键词检索（Top-K）
 *  - 新增 / 编辑 / 删除条目
 *  - 详情查看（markdown 渲染）
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  RefreshCw, Loader2, Search, Plus, Trash2, Pencil, Eye, BookMarked, X,
} from 'lucide-react'
import { useToastStore } from '@/stores/toast.store'
import { Modal } from '@/components/ui/Modal'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

interface KnowledgeEntry {
  name: string
  title: string
  category: string
  project: string
  tags: string[]
  enabled: boolean
  updated_at: string
  file: string
  content?: string
  score?: number
}

interface EditorState {
  name: string
  title: string
  category: string
  project: string
  tags: string
  content: string
}

const EMPTY_EDITOR: EditorState = { name: '', title: '', category: '', project: '', tags: '', content: '' }

export function KnowledgePanel({ projectName }: { projectName: string }) {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const [entries, setEntries] = useState<KnowledgeEntry[]>([])
  const [categories, setCategories] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [viewing, setViewing] = useState<KnowledgeEntry | null>(null)
  const [editorOpen, setEditorOpen] = useState(false)
  const [editing, setEditing] = useState<KnowledgeEntry | null>(null)
  const [editor, setEditor] = useState<EditorState>(EMPTY_EDITOR)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<KnowledgeEntry | null>(null)

  const refresh = useCallback(async (keepQuery = true) => {
    setBusy(true)
    try {
      const q = keepQuery ? query.trim() : ''
      if (q) {
        const res = await window.electron.aihub.knowledge.search({ query: q, category: category || undefined })
        setEntries((res as unknown as { entries?: KnowledgeEntry[] }).entries ?? [])
      } else {
        const res = await window.electron.aihub.knowledge.list({ category: category || undefined })
        setEntries((res as { entries?: KnowledgeEntry[] }).entries ?? [])
        const cats = (res as { categories?: string[] }).categories ?? []
        setCategories(cats)
      }
    } catch {
      setEntries([])
    } finally {
      setBusy(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category])

  // eslint-disable-next-line react-hooks/set-state-in-effect -- 挂载时异步刷新知识条目列表并更新加载态
  useEffect(() => { refresh() }, [refresh])

  const handleSearch = useCallback((q: string) => {
    setQuery(q)
    setBusy(true)
    const run = async () => {
      try {
        if (q.trim()) {
          const res = await window.electron.aihub.knowledge.search({ query: q.trim(), category: category || undefined, topK: 50 })
          setEntries((res as unknown as { entries?: KnowledgeEntry[] }).entries ?? [])
        } else {
          const res = await window.electron.aihub.knowledge.list({ category: category || undefined })
          setEntries((res as { entries?: KnowledgeEntry[] }).entries ?? [])
        }
      } catch {
        setEntries([])
      } finally {
        setBusy(false)
      }
    }
    void run()
  }, [category])

  const openAdd = useCallback(() => {
    setEditing(null)
    setEditor({ ...EMPTY_EDITOR, project: projectName || '' })
    setEditorOpen(true)
  }, [projectName])

  const openEdit = useCallback(async (e: KnowledgeEntry) => {
    setEditing(e)
    setEditor({
      name: e.name,
      title: e.title || '',
      category: e.category === '通用' ? '' : e.category,
      project: e.project || '',
      tags: (e.tags ?? []).join(','),
      content: e.content ?? '',
    })
    setEditorOpen(true)
  }, [])

  const openView = useCallback(async (e: KnowledgeEntry) => {
    setBusy(true)
    try {
      const res = await window.electron.aihub.knowledge.get(e.name)
      setViewing((res as { entry?: KnowledgeEntry })?.entry ?? null)
    } catch (err) {
      addToast('error', (err as Error).message, 4000)
    } finally {
      setBusy(false)
    }
  }, [addToast])

  const save = useCallback(async () => {
    if (!editor.name.trim() || !editor.content.trim()) {
      addToast('error', t('knowledge.validation', '条目名与内容不能为空'), 3000)
      return
    }
    setSaving(true)
    try {
      const metadata: Record<string, unknown> = {
        title: editor.title.trim() || undefined,
        category: editor.category.trim() || undefined,
        project: editor.project.trim() || undefined,
        tags: editor.tags.split(/[,，]/).map((x) => x.trim()).filter(Boolean),
      }
      if (editing) {
        await window.electron.aihub.knowledge.update(editing.name, { content: editor.content, metadata })
        addToast('success', t('knowledge.updated', '知识条目已更新'), 3000)
      } else {
        await window.electron.aihub.knowledge.add({ name: editor.name, content: editor.content, metadata })
        addToast('success', t('knowledge.added', '知识条目已添加'), 3000)
      }
      setEditorOpen(false)
      refresh()
    } catch (err) {
      addToast('error', t('knowledge.saveFailed', '保存失败：{{reason}}', { reason: (err as Error).message }), 4000)
    } finally {
      setSaving(false)
    }
  }, [editor, editing, addToast, refresh, t])

  const confirmDelete = useCallback(async () => {
    if (!deleteTarget) return
    try {
      await window.electron.aihub.knowledge.delete(deleteTarget.name)
      addToast('success', t('knowledge.deleted', '知识条目已删除'), 3000)
      if (viewing?.name === deleteTarget.name) setViewing(null)
      setDeleteTarget(null)
      refresh()
    } catch (err) {
      addToast('error', t('knowledge.deleteFailed', '删除失败：{{reason}}', { reason: (err as Error).message }), 4000)
    }
  }, [deleteTarget, viewing, addToast, refresh, t])

  const sorted = useMemo(() => [...entries].sort((a, b) => ((b.updated_at || '') < (a.updated_at || '') ? -1 : 1)), [entries])

  return (
    <div className="h-full flex flex-col gap-3">
      {/* 顶部工具行 */}
      <div className="flex items-center gap-2 flex-wrap shrink-0">
        <BookMarked size={15} className="text-primary-500" />
        <span className="text-sm font-medium text-gray-700 dark:text-gray-200">{t('knowledge.title', '知识库')}</span>
        <span className="text-2xs text-gray-400">{t('knowledge.count', '{{count}} 条', { count: entries.length })}</span>
        <div className="flex items-center gap-1 border border-gray-200 dark:border-gray-600 rounded px-2 py-1">
          <Search size={11} className="text-gray-400 shrink-0" />
          <input
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder={t('knowledge.searchPlaceholder', '检索知识（关键词）…')}
            className="text-xs bg-transparent outline-none w-44 text-gray-700 dark:text-gray-200 placeholder:text-gray-400"
          />
        </div>
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); setQuery('') }}
          className="text-xs rounded border bg-white dark:bg-app px-1.5 py-1 max-w-[140px]"
          aria-label={t('knowledge.categoryLabel', '按分类筛选')}
        >
          <option value="">{t('knowledge.allCategories', '全部分类')}</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <button
          type="button"
          onClick={() => refresh(false)}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded border border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-app-hover"
        >
          {busy ? <Loader2 size={11} className="animate-spin" /> : <RefreshCw size={11} />} {t('knowledge.refresh', '刷新')}
        </button>
        <button
          type="button"
          onClick={openAdd}
          className="flex items-center gap-1 px-2 py-1 text-2xs rounded bg-primary-500 hover:bg-primary-600 text-white"
        >
          <Plus size={11} /> {t('knowledge.add', '新增条目')}
        </button>
      </div>

      {/* 条目列表 + 详情 */}
      <div className="flex-1 min-h-0 flex gap-3">
        <div className="w-[300px] shrink-0 rounded border overflow-hidden bg-white dark:bg-app flex flex-col">
          <div className="px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300 border-b bg-gray-50 dark:bg-app/50">
            {t('knowledge.listTitle', '知识条目')}
          </div>
          <div className="flex-1 overflow-auto p-2 space-y-1">
            {sorted.length === 0 && (
              <div className="text-xs text-gray-400 text-center py-6">{t('knowledge.empty', '暂无知识条目（点击「新增条目」或让 AI 沉淀）')}</div>
            )}
            {sorted.map((e) => (
              <div key={e.name}
                className={`group flex items-center gap-1.5 px-2 py-1.5 rounded cursor-pointer text-xs border ${viewing?.name === e.name ? 'bg-primary-50 dark:bg-primary-900/20 border-primary-200 dark:border-primary-800' : 'border-transparent hover:bg-gray-50 dark:hover:bg-app-hover'}`}
                onClick={() => openView(e)}
              >
                <BookMarked size={12} className="text-primary-500 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="truncate font-medium text-gray-700 dark:text-gray-200">{e.title || e.name}</div>
                  <div className="text-2xs text-gray-400 truncate">
                    {e.category}{e.project ? ` · ${e.project}` : ''}{e.score != null ? ` · ${e.score}` : ''}
                  </div>
                </div>
                <div className="flex items-center shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(ev) => { ev.stopPropagation(); openEdit(e) }}
                    className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                    title={t('knowledge.edit', '编辑')}
                  >
                    <Pencil size={11} />
                  </button>
                  <button
                    onClick={(ev) => { ev.stopPropagation(); setDeleteTarget(e) }}
                    className="p-0.5 rounded hover:bg-error-50 text-gray-400 hover:text-error-500"
                    title={t('knowledge.delete', '删除')}
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 详情 */}
        <div className="flex-1 min-w-0 rounded border overflow-hidden bg-white dark:bg-app flex flex-col">
          <div className="px-3 py-2 text-xs border-b bg-gray-50 dark:bg-app/50 flex items-center gap-2 shrink-0">
            <Eye size={12} className="text-gray-400" />
            <span className="text-gray-600 dark:text-gray-300 truncate flex-1">{viewing?.title || viewing?.name || t('knowledge.noSelection', '未选择条目')}</span>
            {viewing && (
              <>
                <button
                  onClick={() => openEdit(viewing)}
                  className="flex items-center gap-1 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                  title={t('knowledge.edit', '编辑')}
                >
                  <Pencil size={11} />
                </button>
                <button
                  onClick={() => setViewing(null)}
                  className="flex items-center gap-1 p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                  title={t('knowledge.close', '关闭')}
                >
                  <X size={11} />
                </button>
              </>
            )}
          </div>
          <div className="flex-1 overflow-auto p-4">
            {viewing ? (
              <article className="prose prose-sm dark:prose-invert max-w-none
                prose-headings:font-semibold prose-headings:text-gray-800 dark:prose-headings:text-gray-100
                prose-h1:text-xl prose-h2:text-lg
                prose-p:text-gray-600 dark:prose-p:text-gray-300
                prose-code:text-primary-600 dark:prose-code:text-primary-400 prose-code:bg-gray-100 dark:prose-code:bg-gray-700 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
                prose-pre:bg-gray-50 dark:prose-pre:bg-gray-900 prose-pre:border prose-pre:border-gray-200 dark:prose-pre:border-gray-700
                prose-li:text-gray-600 dark:prose-li:text-gray-300
                prose-table:text-xs
              ">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{viewing.content ?? ''}</ReactMarkdown>
              </article>
            ) : (
              <div className="text-xs text-gray-400 text-center py-10">{t('knowledge.selectHint', '选择左侧条目查看内容（markdown 渲染）')}</div>
            )}
          </div>
        </div>
      </div>

      {/* 新增/编辑 Modal */}
      <Modal
        open={editorOpen}
        onClose={() => setEditorOpen(false)}
        title={editing ? t('knowledge.editTitle', '编辑知识条目') : t('knowledge.addTitle', '新增知识条目')}
        width={560}
        footer={
          <div className="flex justify-end gap-2">
            <button
              onClick={() => setEditorOpen(false)}
              className="px-3 py-1.5 text-xs rounded-md border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-app-hover"
            >
              {t('cancel')}
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="flex items-center gap-1 px-3 py-1.5 text-xs rounded-md bg-primary-500 hover:bg-primary-600 text-white disabled:opacity-40"
            >
              {saving && <Loader2 size={11} className="animate-spin" />}
              {t('knowledge.save', '保存')}
            </button>
          </div>
        }
      >
        <div className="space-y-3">
          <Field label={t('knowledge.fieldName', '条目名（唯一）')}>
            <input
              value={editor.name}
              onChange={(e) => setEditor({ ...editor, name: e.target.value })}
              disabled={!!editing}
              className="w-full text-xs rounded border bg-white dark:bg-app px-2 py-1.5 disabled:opacity-50"
              placeholder="roc-convergence"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('knowledge.fieldTitle', '标题')}>
              <input value={editor.title} onChange={(e) => setEditor({ ...editor, title: e.target.value })} className="w-full text-xs rounded border bg-white dark:bg-app px-2 py-1.5" />
            </Field>
            <Field label={t('knowledge.fieldCategory', '分类')}>
              <input value={editor.category} onChange={(e) => setEditor({ ...editor, category: e.target.value })} className="w-full text-xs rounded border bg-white dark:bg-app px-2 py-1.5" placeholder={t('knowledge.categoryPlaceholder', '如 设计规范/设备选型')} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('knowledge.fieldProject', '所属项目')}>
              <input value={editor.project} onChange={(e) => setEditor({ ...editor, project: e.target.value })} className="w-full text-xs rounded border bg-white dark:bg-app px-2 py-1.5" placeholder={t('knowledge.projectPlaceholder', '留空为通用知识')} />
            </Field>
            <Field label={t('knowledge.fieldTags', '标签（逗号分隔）')}>
              <input value={editor.tags} onChange={(e) => setEditor({ ...editor, tags: e.target.value })} className="w-full text-xs rounded border bg-white dark:bg-app px-2 py-1.5" placeholder="roce, 收敛比" />
            </Field>
          </div>
          <Field label={t('knowledge.fieldContent', '内容（markdown）')}>
            <textarea
              value={editor.content}
              onChange={(e) => setEditor({ ...editor, content: e.target.value })}
              rows={8}
              className="w-full text-xs rounded border bg-white dark:bg-app px-2 py-1.5 font-mono"
            />
          </Field>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteTarget}
        message={t('knowledge.confirmDelete', '删除知识条目「{{name}}」？', { name: deleteTarget?.name ?? '' })}
        danger
        confirmText={t('knowledge.confirm', '确认')}
        cancelText={t('knowledge.cancel', '取消')}
        onConfirm={() => { confirmDelete() }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-2xs text-gray-500 dark:text-gray-400 mb-1">{label}</span>
      {children}
    </label>
  )
}

export default KnowledgePanel
