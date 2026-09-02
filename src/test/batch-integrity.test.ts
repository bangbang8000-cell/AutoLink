/**
 * 48-e（F8-5）：交付物批次完整性——manifest 逐文件清单校验（纯逻辑层）
 * - buildBatchIntegrity：清单 vs 磁盘实际 → 逐文件状态（ok/missing/hash_mismatch/size_drift/extra）
 * - summarizeIntegrity / deriveBatchIntegrity：批次完整性汇总
 */
import { describe, it, expect } from 'vitest'
import {
  buildBatchIntegrity,
  summarizeIntegrity,
  deriveBatchIntegrity,
  type BatchManifestFile,
  type BatchActualFile,
} from '@/utils/batchIntegrity'

const manifestFiles: BatchManifestFile[] = [
  { name: 'a.xlsx', size: 300, sha256: 'a'.repeat(64) },
  { name: 'b.xlsx', size: 200, sha256: 'b'.repeat(64) },
]

describe('buildBatchIntegrity（逐文件校验）', () => {
  it('完整批次全部 ok', () => {
    const actual: BatchActualFile[] = [
      { name: 'a.xlsx', size: 300, sha256: 'a'.repeat(64) },
      { name: 'b.xlsx', size: 200, sha256: 'b'.repeat(64) },
    ]
    const files = buildBatchIntegrity(manifestFiles, actual)
    expect(files.every((f) => f.status === 'ok')).toBe(true)
  })

  it('缺失 / 哈希不符 / 大小漂移 / 清单外文件 分别标记', () => {
    const actual: BatchActualFile[] = [
      { name: 'a.xlsx', size: 999, sha256: 'a'.repeat(64) }, // size 漂移
      { name: 'b.xlsx', size: 200, sha256: 'z'.repeat(64) }, // 哈希不符
      { name: 'extra.txt', size: 10, sha256: 'e'.repeat(64) }, // 清单外
      // c.xlsx 缺失（不在清单中也实际不存在，此处模拟清单有但磁盘无）
    ]
    const files = buildBatchIntegrity([...manifestFiles, { name: 'c.xlsx', size: 1, sha256: 'c'.repeat(64) }], actual)
    const byName = (n: string) => files.find((f) => f.name === n)!
    expect(byName('a.xlsx').status).toBe('size_drift')
    expect(byName('b.xlsx').status).toBe('hash_mismatch')
    expect(byName('c.xlsx').status).toBe('missing')
    expect(byName('extra.txt').status).toBe('extra')
  })

  it('manifest.json 自身不计入清单外漂移', () => {
    const files = buildBatchIntegrity([], [{ name: 'manifest.json', size: 5, sha256: 'm'.repeat(64) }])
    expect(files.filter((f) => f.status === 'extra')).toHaveLength(0)
  })
})

describe('summarizeIntegrity / deriveBatchIntegrity', () => {
  it('无问题 → ok，有问题 → issues 并计数', () => {
    expect(summarizeIntegrity([{ name: 'a', status: 'ok', message: '' }]).integrity).toBe('ok')
    const withIssues = summarizeIntegrity([
      { name: 'a', status: 'ok', message: '' },
      { name: 'b', status: 'missing', message: 'x' },
    ])
    expect(withIssues.integrity).toBe('issues')
    expect(withIssues.issues).toBe(1)
  })

  it('deriveBatchIntegrity 从 IPC 返回结构推导', () => {
    const s = deriveBatchIntegrity({ files: manifestFiles }, [
      { name: 'a.xlsx', size: 300, sha256: 'a'.repeat(64) },
      { name: 'b.xlsx', size: 999, sha256: 'b'.repeat(64) },
    ])
    expect(s.integrity).toBe('issues')
    expect(s.issues).toBe(1)
    expect(deriveBatchIntegrity(null, []).integrity).toBe('ok')
  })
})
