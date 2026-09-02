/**
 * 48-b（F8-2）：设计快照文件导出/回导（纯逻辑层）
 * - buildSnapshotFile：DesignSnapshot → 可移植文件 JSON（含 format/schemaVersion/exportedAt/project）
 * - parseSnapshotFile：解析校验 → 回导（复用 validateSnapshot），兼容直接传 DesignSnapshot 的旧格式
 */
import { describe, it, expect } from 'vitest'
import type { DesignSnapshot } from '@/utils/designSnapshot'
import {
  SNAPSHOT_FILE_FORMAT,
  SNAPSHOT_FILE_VERSION,
  buildSnapshotFile,
  parseSnapshotFile,
} from '@/utils/snapshotFile'

function makeSnapshot(name = 'snap1'): DesignSnapshot {
  return {
    version: 1,
    meta: { format: 'autolink-design-snapshot', version: 1, savedAt: '2026-01-01T00:00:00.000Z', name },
    matrix: {
      schemaVersion: 1,
      name: '机房 A',
      rows: ['A'],
      cols: [1],
      cells: [{ row: 'A', col: 1, type: 'gpu', placeholder: null, cabinetId: 1 }],
    },
    cabinets: [{ id: 1, name: '机柜 A1', totalU: 42, type: 'gpu', power_limit: 6000, devices: [] }],
    unplacedDevices: [],
    config: { topReservedU: 2, gpuPerCabinet: 8 },
  }
}

describe('buildSnapshotFile（快照导出为文件）', () => {
  it('生成含外壳标识的可移植 JSON', () => {
    const json = buildSnapshotFile(makeSnapshot(), { projectName: 'H100-100台', projectId: 'P1' })
    const parsed = JSON.parse(json)
    expect(parsed.format).toBe(SNAPSHOT_FILE_FORMAT)
    expect(parsed.schemaVersion).toBe(SNAPSHOT_FILE_VERSION)
    expect(parsed.exportedAt).toBeTruthy()
    expect(parsed.project).toEqual({ projectName: 'H100-100台', projectId: 'P1' })
    expect(parsed.snapshot.meta.format).toBe('autolink-design-snapshot')
    expect(parsed.snapshot.cabinets).toHaveLength(1)
  })

  it('外壳校验失败（快照不合法）时抛错', () => {
    expect(() => buildSnapshotFile({ version: 99, meta: {} } as unknown as DesignSnapshot)).toThrow()
  })
})

describe('parseSnapshotFile（快照文件回导）', () => {
  it('解析合法文件并还原快照与项目名', () => {
    const json = buildSnapshotFile(makeSnapshot('snap-a'), { projectName: 'ProjX' })
    const r = parseSnapshotFile(json)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.snapshot?.cabinets).toHaveLength(1)
      expect(r.projectName).toBe('ProjX')
    }
  })

  it('兼容直接传入 DesignSnapshot 的旧格式', () => {
    const r = parseSnapshotFile(JSON.stringify(makeSnapshot()))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.snapshot?.matrix?.rows).toEqual(['A'])
  })

  it('非法 JSON / 非对象 / 格式不符 / 版本不符 → 友好失败', () => {
    expect(parseSnapshotFile('not-json').ok).toBe(false)
    expect(parseSnapshotFile('"str"').ok).toBe(false)
    expect(parseSnapshotFile(JSON.stringify({ format: 'other' })).ok).toBe(false)
    expect(parseSnapshotFile(JSON.stringify({ format: SNAPSHOT_FILE_FORMAT, schemaVersion: 99, snapshot: makeSnapshot() })).ok).toBe(false)
  })

  it('内层快照损坏（缺 cabinets）→ 失败', () => {
    const bad = {
      format: SNAPSHOT_FILE_FORMAT,
      schemaVersion: SNAPSHOT_FILE_VERSION,
      exportedAt: '2026-01-01T00:00:00.000Z',
      snapshot: { version: 1, meta: { format: 'autolink-design-snapshot', version: 1, savedAt: '' }, matrix: null, config: {} },
    }
    expect(parseSnapshotFile(JSON.stringify(bad)).ok).toBe(false)
  })
})
