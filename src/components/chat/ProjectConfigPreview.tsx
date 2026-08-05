/**
 * V3.1.3-T7-2: 需求生成预览卡片
 *
 * 从 AI 回复中解析「项目配置预览」块（```project-config fence 或工具执行结果 json 块），
 * 渲染可编辑的 ProjectConfig 表单：规模/协议/速率/机柜 + 置信度/缺失字段标注 + 校验问题，
 * 用户确认后经 project:createWithConfig 落盘。
 */
import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardCheck, Loader2, Sparkles } from 'lucide-react'
import clsx from 'clsx'
import type { ProjectConfig } from '@/types/project-config'
import { useProjectStore } from '@/stores/project.store'
import { useToastStore } from '@/stores/toast.store'

export interface GeneratedProjectPreview {
  config: ProjectConfig
  annotations?: { confidence?: number; missingFields?: string[]; derivedFields?: string[] }
  validationIssues?: { severity: string; message: string }[]
}

/** 从 assistant 消息内容提取项目配置预览块 */
export function parseProjectConfigBlock(content: string): GeneratedProjectPreview | null {
  // 1. 优先解析 📋 项目配置预览 后的 ```project-config 代码块（最后一个）
  const fenceRe = /```project-config\s*\n([\s\S]*?)```/g
  let m: RegExpExecArray | null
  let block: string | null = null
  while ((m = fenceRe.exec(content))) block = m[1]
  if (block) {
    try {
      const cfg = JSON.parse(block)
      if (cfg && typeof cfg === 'object' && cfg.meta) return { config: cfg }
    } catch {
      /* 跳过非法块 */
    }
  }
  // 2. 兜底：工具执行结果 json 块（含 config + annotations + validationIssues）
  const jsonRe = /```json\s*\n([\s\S]*?)```/g
  let best: GeneratedProjectPreview | null = null
  while ((m = jsonRe.exec(content))) {
    try {
      const obj = JSON.parse(m[1])
      if (obj && typeof obj === 'object' && obj.config?.meta && 'annotations' in obj) {
        best = { config: obj.config, annotations: obj.annotations, validationIssues: obj.validationIssues }
      }
    } catch {
      /* 跳过非法块 */
    }
  }
  return best
}

const PROTOCOLS = ['IB', 'RoCE', 'UEC']
const SPEEDS = ['800G', '400G', '200G', '100G']
const RACK_TYPES = [42, 49]

interface FieldProps {
  label: string
  children: React.ReactNode
  derived?: boolean
}

function Field({ label, children, derived }: FieldProps) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] text-gray-500 dark:text-gray-400">
        {label}
        {derived && <Sparkles size={10} className="ml-1 inline text-amber-500" />}
      </span>
      {children}
    </label>
  )
}

const inputCls = 'w-full text-xs px-1.5 py-1 rounded border border-edge-subtle bg-white dark:bg-app-hover text-gray-800 dark:text-gray-200 focus:outline-none focus:border-primary-500'

export function ProjectConfigPreview({ preview }: { preview: GeneratedProjectPreview }) {
  const [config, setConfig] = useState<ProjectConfig>(() => JSON.parse(JSON.stringify(preview.config)))
  const [creating, setCreating] = useState(false)
  const createProjectWithConfig = useProjectStore((s) => s.createProjectWithConfig)
  const addToast = useToastStore((s) => s.addToast)

  const annotations = preview.annotations
  const missing = useMemo(
    () => new Set(annotations?.missingFields || annotations?.derivedFields || []),
    [annotations],
  )
  const issues = preview.validationIssues || []
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')

  const patch = (section: keyof ProjectConfig, key: string, value: unknown) => {
    setConfig((c) => ({
      ...c,
      [section]: { ...(c[section] as Record<string, unknown>), [key]: value },
    }))
  }

  const handleConfirm = async () => {
    setCreating(true)
    try {
      await createProjectWithConfig(config)
      addToast('success', `项目「${config.meta.name}」已创建`, 4000)
    } catch (err: any) {
      addToast('error', err?.message || '项目创建失败', 5000)
    } finally {
      setCreating(false)
    }
  }

  const topo = config.topology
  const rack = config.rack_config

  return (
    <div className="mt-2 w-full max-w-md rounded-lg border border-edge-subtle bg-white dark:bg-app-hover overflow-hidden">
      {/* 头部：项目名 + 置信度 */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-edge-subtle bg-gray-50 dark:bg-app">
        <ClipboardCheck size={14} className="text-primary-500" />
        <input
          className="flex-1 text-sm font-medium bg-transparent focus:outline-none focus:border-b focus:border-primary-400 text-gray-800 dark:text-gray-200"
          value={config.meta.name || ''}
          onChange={(e) => patch('meta', 'name', e.target.value)}
        />
        {annotations?.confidence !== undefined && (
          <span
            className={clsx(
              'shrink-0 text-[11px] px-1.5 py-0.5 rounded-full',
              annotations.confidence >= 0.8
                ? 'bg-success-100 text-success-700 dark:bg-success-900/40 dark:text-success-400'
                : annotations.confidence >= 0.6
                  ? 'bg-warning-100 text-warning-700 dark:bg-warning-900/40 dark:text-warning-400'
                  : 'bg-danger-100 text-danger-700 dark:bg-danger-900/40 dark:text-danger-400',
            )}
          >
            完整度 {Math.round(annotations.confidence * 100)}%
          </span>
        )}
      </div>

      {/* 校验问题 */}
      {issues.length > 0 && (
        <div className="px-3 py-2 border-b border-edge-subtle space-y-1">
          {errors.map((i, idx) => (
            <div key={idx} className="flex items-start gap-1.5 text-[11px] text-danger-600 dark:text-danger-400">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>{i.message}</span>
            </div>
          ))}
          {warnings.map((i, idx) => (
            <div key={`w${idx}`} className="flex items-start gap-1.5 text-[11px] text-warning-600 dark:text-warning-400">
              <Sparkles size={12} className="shrink-0 mt-0.5" />
              <span>{i.message}</span>
            </div>
          ))}
        </div>
      )}

      {/* 缺失字段 */}
      {missing.size > 0 && (
        <div className="px-3 py-2 border-b border-edge-subtle">
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mb-1">
            默认推导字段（AI 未提供，已用默认值补全）
          </p>
          <div className="flex flex-wrap gap-1">
            {[...missing].map((f) => (
              <span
                key={f}
                className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-400"
              >
                {f}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 可编辑表单 */}
      <div className="px-3 py-2 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <Field label="GPU 服务器" derived={missing.has('topology.num_gpu_servers')}>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={topo.num_gpu_servers}
              onChange={(e) => patch('topology', 'num_gpu_servers', Number(e.target.value))}
            />
          </Field>
          <Field label="计算服务器" derived={missing.has('topology.num_compute_servers')}>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={topo.num_compute_servers}
              onChange={(e) => patch('topology', 'num_compute_servers', Number(e.target.value))}
            />
          </Field>
          <Field label="全闪存储" derived={missing.has('topology.num_all_flash_storage')}>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={topo.num_all_flash_storage}
              onChange={(e) => patch('topology', 'num_all_flash_storage', Number(e.target.value))}
            />
          </Field>
          <Field label="混闪存储" derived={missing.has('topology.num_hybrid_flash_storage')}>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={topo.num_hybrid_flash_storage}
              onChange={(e) => patch('topology', 'num_hybrid_flash_storage', Number(e.target.value))}
            />
          </Field>
          <Field label="参数网协议" derived={missing.has('topology.param_protocol')}>
            <select
              className={inputCls}
              value={topo.param_protocol}
              onChange={(e) => patch('topology', 'param_protocol', e.target.value)}
            >
              {PROTOCOLS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </Field>
          <Field label="参数网速率" derived={missing.has('topology.param_speed')}>
            <select
              className={inputCls}
              value={topo.param_speed}
              onChange={(e) => patch('topology', 'param_speed', e.target.value)}
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          <Field label="机柜类型 (U)" derived={missing.has('rack_config.rack_type')}>
            <select
              className={inputCls}
              value={rack.rack_type}
              onChange={(e) => patch('rack_config', 'rack_type', Number(e.target.value))}
            >
              {RACK_TYPES.map((r) => (
                <option key={r} value={r}>{r}U</option>
              ))}
            </select>
          </Field>
          <Field label="机柜功率上限 (W)" derived={missing.has('rack_config.power_limit_per_rack')}>
            <input
              type="number"
              min={0}
              className={inputCls}
              value={rack.power_limit_per_rack}
              onChange={(e) => patch('rack_config', 'power_limit_per_rack', Number(e.target.value))}
            />
          </Field>
        </div>
      </div>

      {/* 确认落盘 */}
      <div className="px-3 py-2 border-t border-edge-subtle bg-gray-50 dark:bg-app">
        <button
          onClick={handleConfirm}
          disabled={creating || !config.meta.name}
          className="w-full inline-flex items-center justify-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded bg-primary-500 text-white hover:bg-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {creating ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
          {creating ? '创建中...' : `创建项目「${config.meta.name || '未命名'}」`}
        </button>
      </div>
    </div>
  )
}
