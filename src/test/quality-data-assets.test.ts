/**
 * 4.6.0（F6-2）：测试数据资产可复用性（Q-2，前端侧）
 *
 * 前端 vitest 通过 node:fs 消费 tests/fixtures/ 资产：
 *  - manifest.json 结构合法（schemaVersion / projects 字段齐全）
 *  - 清单与磁盘样例目录一一对应（pytest 与 vitest 复用同一资产）
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import path from 'node:path'

const REPO_ROOT = process.cwd()
const FIXTURES = path.join(REPO_ROOT, 'tests', 'fixtures')

interface FixtureProject {
  id: string
  name: string
  path: string
  scenario: string
  consumed_by: string[]
}

function loadManifest() {
  return JSON.parse(readFileSync(path.join(FIXTURES, 'manifest.json'), 'utf-8'))
}

describe('测试数据资产清单（F6-2 / Q-2）', () => {
  it('manifest.json 可被前端消费且结构合法', () => {
    const manifest = loadManifest()
    expect(manifest.schemaVersion).toBe(1)
    expect(Array.isArray(manifest.projects)).toBe(true)
    expect(manifest.projects.length).toBeGreaterThanOrEqual(6)
    for (const p of manifest.projects as FixtureProject[]) {
      expect(p.id).toBeTruthy()
      expect(p.name).toBeTruthy()
      expect(p.scenario).toBeTruthy()
      expect(p.consumed_by.length).toBeGreaterThanOrEqual(1)
      // 每个样例配置文件真实存在于磁盘（双端复用同一资产）
      const cfg = path.join(FIXTURES, p.path)
      expect(existsSync(cfg), `${cfg} 不存在`).toBe(true)
      expect(() => JSON.parse(readFileSync(cfg, 'utf-8'))).not.toThrow()
    }
  })

  it('清单与磁盘样例目录一一对应', () => {
    const manifest = loadManifest()
    const listed = (manifest.projects as FixtureProject[]).map((p) => p.id).sort()
    const disk = readdirSync(path.join(FIXTURES, 'projects'))
      .filter((name) => existsSync(path.join(FIXTURES, 'projects', name, 'project_config.json')))
      .sort()
    expect(listed).toEqual(disk)
  })

  it('关键场景样例齐备（64台/多机柜/融合网/存储关闭/超节点/zcube）', () => {
    const manifest = loadManifest()
    const ids = new Set((manifest.projects as FixtureProject[]).map((p) => p.id))
    for (const required of [
      '64_h100',
      '128_h100_multi_rack',
      'combined_network_gb300',
      'storage_disabled',
      'supernode_384',
      'zcube_512',
    ]) {
      expect(ids.has(required), `缺少关键场景样例: ${required}`).toBe(true)
    }
  })
})
