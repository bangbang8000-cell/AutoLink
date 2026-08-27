/**
 * AL-R2：归档批次命名 + 归档产物清单（纯逻辑层，落盘依赖 Electron IPC 不在本单测范围）
 * - 版本号解析：planVersion（AIDC 规划自增）> plan.meta.planVersion > templateVersion，取不到回退无版本
 * - batchName：<项目名>[-v<版本>]-<YYYYMMDD-HHmm>
 * - 归档清单：机柜设计 Excel + 拓扑 PNG + 机房平面图 PNG，置于 output/<batchName>/
 */
import { describe, it, expect } from 'vitest'
import {
  resolveProjectVersion,
  buildArchiveBatchName,
  buildArchiveOutputFiles,
  ARCHIVE_RACK_DESIGN_FILE,
  ARCHIVE_TOPOLOGY_FILE,
  ARCHIVE_ROOM_LAYOUT_FILE,
} from '@/utils/archiveExport'

describe('resolveProjectVersion（版本解析）', () => {
  it('优先 planVersion（AIDC 项目列表字段）', () => {
    expect(resolveProjectVersion({ planVersion: 3, planMetaPlanVersion: 1 })).toBe('v3')
  })

  it('其次 plan.meta.planVersion（AIDC 规划保存返回）', () => {
    expect(resolveProjectVersion({ planVersion: null, planMetaPlanVersion: 2 })).toBe('v2')
  })

  it('再兜底 templateVersion（模板版本）', () => {
    expect(resolveProjectVersion({ planVersion: null, planMetaPlanVersion: null, templateVersion: 5 })).toBe('v5')
  })

  it('解析失败（缺失/空/非正数/NaN）回退无版本', () => {
    expect(resolveProjectVersion({})).toBe('')
    expect(resolveProjectVersion({ planVersion: undefined, planMetaPlanVersion: null, templateVersion: undefined })).toBe('')
    expect(resolveProjectVersion({ planMetaPlanVersion: 0 })).toBe('')
    expect(resolveProjectVersion({ planMetaPlanVersion: -2 })).toBe('')
    expect(resolveProjectVersion({ planMetaPlanVersion: Number.NaN })).toBe('')
  })

  it('非整数版本向下取整', () => {
    expect(resolveProjectVersion({ planVersion: 2.9 })).toBe('v2')
  })
})

describe('buildArchiveBatchName（归档目录名含版本号）', () => {
  const d = new Date(2026, 7, 26, 15, 30) // 2026-08-26 15:30

  it('含版本：<项目名>-v<版本>-<YYYYMMDD-HHmm>', () => {
    expect(buildArchiveBatchName('H100-100台', 'v3', d)).toBe('H100-100台-v3-20260826-1530')
  })

  it('无版本：<项目名>-<YYYYMMDD-HHmm>', () => {
    expect(buildArchiveBatchName('H100-100台', '', d)).toBe('H100-100台-20260826-1530')
  })

  it('非法文件名字符替换为下划线', () => {
    expect(buildArchiveBatchName('a/b:c', 'v1', d)).toBe('a_b_c-v1-20260826-1530')
  })
})

describe('buildArchiveOutputFiles（归档含完整设计渲染）', () => {
  it('产出机柜设计/拓扑图/机房平面图三件清单于 output/<batchName>/', () => {
    const batch = 'H100-100台-v3-20260826-1530'
    const files = buildArchiveOutputFiles(batch)
    expect(files).toHaveLength(3)
    const rel = files.map((f) => f.relPath)
    expect(rel).toContain(`output/${batch}/机柜设计.xlsx`)
    expect(rel).toContain(`output/${batch}/拓扑图.png`)
    expect(rel).toContain(`output/${batch}/机房平面图.png`)
  })

  it('文件清单常量与 key 一致（供落盘与 UI 复用）', () => {
    const files = buildArchiveOutputFiles('b-1')
    expect(files.find((f) => f.key === 'rackDesign')?.fileName).toBe(ARCHIVE_RACK_DESIGN_FILE)
    expect(files.find((f) => f.key === 'topology')?.fileName).toBe(ARCHIVE_TOPOLOGY_FILE)
    expect(files.find((f) => f.key === 'roomLayout')?.fileName).toBe(ARCHIVE_ROOM_LAYOUT_FILE)
  })
})