/**
 * M-F1（PRD v3.6）：AL 版本历史与评审 —— 版本差异纯函数
 * - diffPlans(a, b)：字段级 diff（changed/added/removed/unchanged），嵌套对象/数组扁平化递归
 * - buildVersionList(files)：由 plan_history 目录文件清单解析版本列表（排序升序）
 * - planRollback(current, target)：回滚数据变换（先存档当前版本再以目标覆盖）——与 electron handlers.ts 语义一致
 * - getFeatureBridge()：版本历史 / 评审 PDF 的 electron 桥接类型访问（避免改 electron.d.ts）
 */
export interface PlanVersionEntry {
  version: number
  planHash: string
  generatedAt: string
  fileName: string
  plan: Record<string, unknown>
  macro: Record<string, unknown>
}

export interface VersionFileInput {
  name: string
  content: string | null
}

export type DiffStatus = 'changed' | 'added' | 'removed' | 'unchanged'

export interface DiffEntry {
  path: string
  status: DiffStatus
  oldValue?: unknown
  newValue?: unknown
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function flattenValue(prefix: string, value: unknown, out: Map<string, unknown>): void {
  if (isPlainObject(value)) {
    const keys = Object.keys(value)
    if (keys.length === 0) {
      out.set(prefix, value)
      return
    }
    for (const key of keys) {
      flattenValue(prefix ? `${prefix}.${key}` : key, value[key], out)
    }
  } else if (Array.isArray(value)) {
    if (value.length === 0) {
      out.set(prefix, value)
      return
    }
    value.forEach((item, i) => {
      flattenValue(`${prefix}[${i}]`, item, out)
    })
  } else {
    out.set(prefix, value)
  }
}

function isEqualValue(x: unknown, y: unknown): boolean {
  if (Object.is(x, y)) return true
  if (typeof x === 'number' && typeof y === 'number') return x === y
  return JSON.stringify(x) === JSON.stringify(y)
}

export function diffPlans(a: unknown, b: unknown): DiffEntry[] {
  const fa = new Map<string, unknown>()
  const fb = new Map<string, unknown>()
  flattenValue('', a, fa)
  flattenValue('', b, fb)
  const paths = new Set([...fa.keys(), ...fb.keys()])
  const entries: DiffEntry[] = []
  for (const path of paths) {
    if (!path) continue
    const hasA = fa.has(path)
    const hasB = fb.has(path)
    if (hasA && hasB) {
      const oldValue = fa.get(path)
      const newValue = fb.get(path)
      if (isEqualValue(oldValue, newValue)) {
        entries.push({ path, status: 'unchanged', oldValue, newValue })
      } else {
        entries.push({ path, status: 'changed', oldValue, newValue })
      }
    } else if (hasA) {
      entries.push({ path, status: 'removed', oldValue: fa.get(path) })
    } else {
      entries.push({ path, status: 'added', newValue: fb.get(path) })
    }
  }
  entries.sort((x, y) => x.path.localeCompare(y.path))
  return entries
}

export function buildVersionList(files: VersionFileInput[]): PlanVersionEntry[] {
  const entries: PlanVersionEntry[] = []
  for (const f of files) {
    const m = /^v(\d+)\.plan\.json$/.exec(f.name)
    if (!m) continue
    if (!f.content) continue
    let plan: unknown
    try {
      plan = JSON.parse(f.content)
    } catch {
      continue
    }
    if (!isPlainObject(plan)) continue
    const meta = isPlainObject(plan.meta) ? plan.meta : {}
    const version = Number(meta.planVersion ?? Number(m[1]))
    entries.push({
      version,
      planHash: String(meta.planHash ?? ''),
      generatedAt: String(meta.generatedAt ?? ''),
      fileName: f.name,
      plan,
      macro: isPlainObject(plan.macro) ? plan.macro : {},
    })
  }
  entries.sort((x, y) => x.version - y.version)
  return entries
}

export interface RollbackResult {
  archived: PlanVersionEntry
  restored: Record<string, unknown>
  archivedVersion: number
  newVersion: number
}

export function planRollback(current: Record<string, unknown>, target: Record<string, unknown>): RollbackResult {
  const curVersion = Number(isPlainObject(current.meta) ? (current.meta.planVersion as number) : 0) || 0
  const archivedVersion = curVersion + 1
  const archivedPlan: Record<string, unknown> = {
    ...current,
    meta: {
      ...(isPlainObject(current.meta) ? current.meta : {}),
      planVersion: archivedVersion,
      archivedAt: new Date().toISOString(),
    },
  }
  const newVersion = archivedVersion + 1
  const restored: Record<string, unknown> = {
    ...target,
    meta: {
      ...(isPlainObject(target.meta) ? target.meta : {}),
      planVersion: newVersion,
      generatedAt: new Date().toISOString(),
    },
  }
  return {
    archived: {
      version: archivedVersion,
      planHash: String(isPlainObject(archivedPlan.meta) ? (archivedPlan.meta.planHash ?? '') : ''),
      generatedAt: String(isPlainObject(archivedPlan.meta) ? (archivedPlan.meta.generatedAt ?? '') : ''),
      fileName: `v${archivedVersion}.plan.json`,
      plan: archivedPlan,
      macro: isPlainObject(archivedPlan.macro) ? archivedPlan.macro : {},
    },
    restored,
    archivedVersion,
    newVersion,
  }
}

export interface ReviewPdfResult {
  ok?: boolean
  path?: string
  fileName?: string
  error?: string
}

export interface VersionHistoryListResult {
  ok?: boolean
  projectName?: string
  current?: Record<string, unknown> | null
  files?: VersionFileInput[]
}

export interface VersionRollbackResult {
  ok?: boolean
  projectName?: string
  archivedVersion?: number
  newVersion?: number
  error?: string
}

// 48-b（F8-2）：版本历史 / 快照 文件级导出与回导
export interface VersionHistoryFileResult {
  canceled?: boolean
  path?: string
  count?: number
  imported?: number
  skipped?: number
  error?: string
}

export interface SnapshotFileResult {
  canceled?: boolean
  path?: string
  content?: string
  error?: string
}

export interface FeatureBridge {
  versionHistory: {
    list: (projectName: string) => Promise<VersionHistoryListResult>
    rollback: (projectName: string, targetVersion: number) => Promise<VersionRollbackResult>
    exportFile: (projectName: string) => Promise<VersionHistoryFileResult>
    importFile: (projectName: string, opts?: { overwrite?: boolean }) => Promise<VersionHistoryFileResult>
  }
  reviewPdf: (projectName: string) => Promise<ReviewPdfResult>
  snapshot: {
    exportFile: (defaultName: string, jsonText: string) => Promise<SnapshotFileResult>
    importFile: () => Promise<SnapshotFileResult>
  }
}

export function getFeatureBridge(): FeatureBridge {
  return (window.electron as unknown as { feature: FeatureBridge }).feature
}

export const MACRO_FIELD_LABELS: Record<string, string> = {
  site: '站点',
  gpuCount: 'GPU 数量',
  pfcQueue: 'PFC 队列',
  cnpQueue: 'CNP 队列',
  bgpMaxPaths: 'BGP 等价路径数',
  convergence: '收敛比',
  rails: '多轨数',
  naming: '命名规则',
  'naming.format': '命名格式',
  'naming.abbr': '场景缩写',
  ipSegments: 'IP 段',
  'ipSegments.loopback': 'Loopback 段',
  'ipSegments.compute': '计算网段',
  'ipSegments.storage': '存储网段',
  'ipSegments.biz': '业务网段',
  'ipSegments.oob': '带外网段',
  'ipSegments.interconnect': '互联网段',
  vlanRanges: 'VLAN 段',
  'vlanRanges.compute': '计算 VLAN',
  'vlanRanges.storage': '存储 VLAN',
  'vlanRanges.biz': '业务 VLAN',
  'vlanRanges.oob': '带外 VLAN',
  asRange: 'AS 段',
  ospf: 'OSPF',
  'ospf.process': 'OSPF 进程',
  'ospf.area': 'OSPF 区域',
  deviceModels: '设备型号',
}

export function macroFieldLabel(path: string): string {
  return MACRO_FIELD_LABELS[path] ?? path
}
