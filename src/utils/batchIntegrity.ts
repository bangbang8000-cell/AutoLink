/**
 * 48-e（F8-5）：交付物批次完整性——manifest 逐文件清单（name/size/sha256）校验（纯逻辑层）
 * - buildBatchIntegrity：清单 vs 磁盘实际文件 → 逐文件状态（ok/missing/hash_mismatch/size_drift/extra）
 * - summarizeIntegrity：汇总批次完整性（ok=无问题 / issues=存在缺失/漂移/哈希不符）
 * 主进程只负责读 manifest + 计算实际 sha256（project:batchManifest），状态推导在本模块。
 */
export type BatchFileIntegrityStatus = 'ok' | 'missing' | 'hash_mismatch' | 'size_drift' | 'extra'

export interface BatchManifestFile {
  name: string
  size?: number
  sha256?: string
}

export interface BatchActualFile {
  name: string
  size: number
  sha256: string
}

export interface BatchFileIntegrity {
  name: string
  status: BatchFileIntegrityStatus
  message: string
}

export type BatchIntegrityStatus = 'ok' | 'issues'

export interface BatchIntegritySummary {
  integrity: BatchIntegrityStatus
  issues: number
  total: number
}

/** 清单 vs 磁盘实际文件 → 逐文件完整性状态（清单外文件标记 extra，manifest.json 自身忽略） */
export function buildBatchIntegrity(
  manifestFiles: BatchManifestFile[],
  actualFiles: BatchActualFile[],
): BatchFileIntegrity[] {
  const expected = new Map(manifestFiles.map((f) => [f.name, f]))
  const actualMap = new Map(actualFiles.map((f) => [f.name, f]))
  const result: BatchFileIntegrity[] = []

  for (const f of manifestFiles) {
    const a = actualMap.get(f.name)
    if (!a) {
      result.push({ name: f.name, status: 'missing', message: `清单文件缺失: ${f.name}` })
      continue
    }
    if (f.sha256 && a.sha256 !== f.sha256) {
      result.push({ name: f.name, status: 'hash_mismatch', message: `哈希不符: ${f.name}` })
      continue
    }
    if (f.size != null && a.size !== f.size) {
      result.push({ name: f.name, status: 'size_drift', message: `大小漂移: ${f.name}（清单 ${f.size} / 实际 ${a.size} 字节）` })
      continue
    }
    result.push({ name: f.name, status: 'ok', message: '' })
  }

  for (const a of actualFiles) {
    if (a.name === 'manifest.json') continue
    if (!expected.has(a.name)) {
      result.push({ name: a.name, status: 'extra', message: `清单外文件（漂移）: ${a.name}` })
    }
  }
  return result
}

/** 汇总批次完整性：issues>0 → 'issues'，否则 'ok' */
export function summarizeIntegrity(files: BatchFileIntegrity[]): BatchIntegritySummary {
  const issues = files.filter((f) => f.status !== 'ok').length
  return { integrity: issues > 0 ? 'issues' : 'ok', issues, total: files.length }
}

/** 从 IPC project:batchManifest 返回结构推导（manifest.files + actualFiles） */
export function deriveBatchIntegrity(
  manifest: { files?: BatchManifestFile[] } | null | undefined,
  actualFiles: BatchActualFile[],
): BatchIntegritySummary {
  const files = buildBatchIntegrity(manifest?.files ?? [], actualFiles ?? [])
  return summarizeIntegrity(files)
}
