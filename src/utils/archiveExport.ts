/**
 * AL-R2：归档批次命名 + 归档产物清单（纯逻辑层）
 * - 版本号解析：优先 AIDC 规划 planVersion / plan.meta.planVersion，兜底模板 templateVersion，取不到回退无版本
 * - batchName：<项目名>[-v<版本>]-<YYYYMMDD-HHmm>（版本解析失败则无版本段）
 * - 归档目录：output/<batchName>/ 下含 机柜设计 Excel + 拓扑图 PNG + 机房平面图 PNG
 */
export interface ArchiveVersionInfo {
  planVersion?: number | null
  planMetaPlanVersion?: number | null
  templateVersion?: number | null
}

/** 解析项目设计版本号 → 'v3' / ''（解析失败回退无版本，不硬编码死值） */
export function resolveProjectVersion(info: ArchiveVersionInfo): string {
  const raw = info.planVersion ?? info.planMetaPlanVersion ?? info.templateVersion
  const v = typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : null
  return v == null ? '' : `v${v}`
}

/** 生成归档批次目录名：<项目名>[-v<版本>]-<YYYYMMDD-HHmm>（date 可注入便于测试） */
export function buildArchiveBatchName(projectName: string, versionTag: string, date?: Date): string {
  const d = date ?? new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const ts = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  const safeName = projectName.replace(/[\\/:*?"<>|]/g, '_')
  return versionTag ? `${safeName}-${versionTag}-${ts}` : `${safeName}-${ts}`
}

/** 归档产物文件名（固定契约，落盘与清单共用） */
export const ARCHIVE_RACK_DESIGN_FILE = '机柜设计.xlsx'
export const ARCHIVE_TOPOLOGY_FILE = '拓扑图.png'
export const ARCHIVE_ROOM_LAYOUT_FILE = '机房平面图.png'

export interface ArchiveOutputFile {
  key: 'rackDesign' | 'topology' | 'roomLayout'
  fileName: string
  relPath: string
}

/** 归档产物清单：output/<batchName>/ 下 机柜设计 + 拓扑图 + 机房平面图 */
export function buildArchiveOutputFiles(batchName: string): ArchiveOutputFile[] {
  const files: Array<{ key: ArchiveOutputFile['key']; fileName: string }> = [
    { key: 'rackDesign', fileName: ARCHIVE_RACK_DESIGN_FILE },
    { key: 'topology', fileName: ARCHIVE_TOPOLOGY_FILE },
    { key: 'roomLayout', fileName: ARCHIVE_ROOM_LAYOUT_FILE },
  ]
  return files.map((f) => ({ ...f, relPath: `output/${batchName}/${f.fileName}` }))
}