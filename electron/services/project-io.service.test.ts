/**
 * 48-a（F8-1）：项目包往返强化——projectId 幂等导入 / 覆盖更新 / 身份一致
 *
 * 覆盖点：
 *  - 重复导入（同 projectId）不再产生副本：默认 overwrite → mode='updated'，目录数不变
 *  - skip 模式：命中既有身份时跳过，不写盘
 *  - 覆盖更新：保留项目身份（projectId 不变）+ 合并历史（既有 plan_history 不丢）
 *  - 未命中身份：新建（名称冲突后缀保留），包内 projectId 与落盘目录身份一致
 *  - 旧格式包（无 projectId）：导入时 mint 新身份并同步 plan/project_config
 */
// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import AdmZip from 'adm-zip'

// 延迟创建临时目录（fs 导入初始化后才可用；mock 工厂在 import config.js 时惰性求值）
let tmpBase = ''
function getTmpBase(): string {
  if (!tmpBase) {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'al-project-io-'))
  }
  return tmpBase
}

vi.mock('../config.js', () => ({
  getWorkspacePath: () => path.join(getTmpBase(), 'workspace'),
  getTemplatePath: () => path.join(getTmpBase(), 'template'),
  getUserTemplatePath: () => path.join(getTmpBase(), 'user-templates'),
}))
vi.mock('../utils/zip-crypto.js', () => ({ encryptZipFile: vi.fn() }))

import { projectIOService } from './project-io.service.js'

const workspace = () => path.join(getTmpBase(), 'workspace')

function listProjectDirs(): string[] {
  if (!fs.existsSync(workspace())) return []
  return fs.readdirSync(workspace()).filter((n) => fs.statSync(path.join(workspace(), n)).isDirectory())
}

function readJson(p: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(p, 'utf-8'))
}

interface PlanJson {
  meta: { projectId?: string; projectName?: string; planVersion?: number; planHash?: string }
  aidc_meta?: { projectId?: string; projectName?: string; planVersion?: number }
}
function readPlan(p: string): PlanJson {
  return readJson(p) as unknown as PlanJson
}

function projectMeta(name: string): Record<string, unknown> {
  return readJson(path.join(workspace(), name, 'project.json'))
}

function writeProject(name: string, projectId: string, opts?: { planVersion?: number }) {
  const dir = path.join(workspace(), name)
  fs.mkdirSync(path.join(dir, 'output'), { recursive: true })
  const ver = opts?.planVersion ?? 1
  fs.writeFileSync(path.join(dir, 'project.json'), JSON.stringify({
    name, projectId, projectName: name, projectType: 'aidc',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', version: 1,
  }, null, 2), 'utf-8')
  fs.writeFileSync(path.join(dir, 'plan.json'), JSON.stringify({
    meta: { projectId, projectName: name, planVersion: ver, planHash: `h${ver}` },
    macro: { gpuCount: 8 }, devices: [], links: [],
  }, null, 2), 'utf-8')
  fs.writeFileSync(path.join(dir, 'project_config.json'), JSON.stringify({
    meta: { name }, aidc_macro: { gpuCount: 8 },
    aidc_meta: { projectId, projectName: name, planVersion: ver },
  }, null, 2), 'utf-8')
  fs.mkdirSync(path.join(dir, 'plan_history'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'plan_history', `v${ver}.plan.json`), JSON.stringify({
    meta: { projectId, projectName: name, planVersion: ver, planHash: `h${ver}` },
  }, null, 2), 'utf-8')
}

/** 构造一个项目 ZIP（等价于 exportProjectZip 白名单产物） */
function makeProjectZip(pkg: {
  projectId?: string
  projectName?: string
  planVersion?: number
  history?: number[]
  outputMarker?: string
}, zipPath: string) {
  const zip = new AdmZip()
  const pid = pkg.projectId ?? ''
  const name = pkg.projectName ?? 'pkg'
  const ver = pkg.planVersion ?? 1
  zip.addFile('project.json', Buffer.from(JSON.stringify({
    name, projectId: pid, projectName: name, updatedAt: '2026-02-02T00:00:00.000Z',
  }), 'utf-8'))
  zip.addFile('plan.json', Buffer.from(JSON.stringify({
    meta: { projectId: pid, projectName: name, planVersion: ver, planHash: `pkg-h${ver}` },
    macro: { gpuCount: 16 }, devices: [], links: [],
  }), 'utf-8'))
  zip.addFile('project_config.json', Buffer.from(JSON.stringify({
    meta: { name }, aidc_macro: { gpuCount: 16 },
    aidc_meta: { projectId: pid, projectName: name, planVersion: ver },
  }), 'utf-8'))
  for (const v of pkg.history ?? []) {
    zip.addFile(`plan_history/v${v}.plan.json`, Buffer.from(JSON.stringify({
      meta: { projectId: pid, projectName: name, planVersion: v, planHash: `pkg-h${v}` },
    }), 'utf-8'))
  }
  if (pkg.outputMarker) {
    zip.addFile(`output/${pkg.outputMarker}`, Buffer.from(pkg.outputMarker, 'utf-8'))
  }
  zip.writeZip(zipPath)
}

afterEach(() => {
  vi.restoreAllMocks()
})

beforeEach(() => {
  // 每个用例独立 workspace，避免串扰
  fs.rmSync(workspace(), { recursive: true, force: true })
  fs.mkdirSync(workspace(), { recursive: true })
})

describe('48-a projectId 幂等导入', () => {
  it('重复导入（同 projectId）不再产生副本：默认 overwrite 更新原项目', async () => {
    const pid = '11111111-1111-4111-8111-111111111111'
    writeProject('A', pid, { planVersion: 1 })
    const zipPath = path.join(getTmpBase(), 'dup.zip')
    makeProjectZip({ projectId: pid, projectName: 'A', planVersion: 2, history: [1, 2] }, zipPath)

    const r1 = await projectIOService.importProjectZip(zipPath)
    expect(r1.mode).toBe('updated')
    expect(r1.existed).toBe(true)
    expect(r1.projectName).toBe('A')
    expect(r1.projectId).toBe(pid)

    const r2 = await projectIOService.importProjectZip(zipPath)
    expect(r2.mode).toBe('updated')

    // 目录数不变（未产生副本）
    expect(listProjectDirs()).toEqual(['A'])
    // 身份一致
    expect(projectMeta('A').projectId).toBe(pid)
    expect(readPlan(path.join(workspace(), 'A', 'plan.json')).meta.projectId).toBe(pid)
  })

  it('skip 模式：命中既有身份时跳过且不改写本地文件', async () => {
    const pid = '22222222-2222-4222-8222-222222222222'
    writeProject('B', pid, { planVersion: 1 })
    const before = fs.readFileSync(path.join(workspace(), 'B', 'project.json'), 'utf-8')
    const zipPath = path.join(getTmpBase(), 'skip.zip')
    makeProjectZip({ projectId: pid, projectName: 'B', planVersion: 9, history: [9] }, zipPath)

    const r = await projectIOService.importProjectZip(zipPath, { ifExists: 'skip' })
    expect(r.mode).toBe('skipped')
    expect(r.projectName).toBe('B')
    expect(fs.readFileSync(path.join(workspace(), 'B', 'project.json'), 'utf-8')).toBe(before)
    // plan 未被覆盖（仍是本地 v1）
    const plan = readPlan(path.join(workspace(), 'B', 'plan.json'))
    expect(plan.meta.planVersion).toBe(1)
    expect(listProjectDirs()).toEqual(['B'])
  })

  it('覆盖更新：保留项目身份 + 合并历史（既有 v1 不丢，新增 v2/v3）', async () => {
    const pid = '33333333-3333-4333-8333-333333333333'
    writeProject('C', pid, { planVersion: 1 })
    // 本地 v1 历史内容（稍后验证合并时不被覆盖）
    fs.writeFileSync(path.join(workspace(), 'C', 'plan_history', 'v1.plan.json'),
      JSON.stringify({ meta: { projectId: pid, projectName: 'C', planVersion: 1, planHash: 'local-v1' } }), 'utf-8')

    const zipPath = path.join(getTmpBase(), 'overwrite.zip')
    makeProjectZip({ projectId: pid, projectName: 'C', planVersion: 3, history: [1, 2, 3], outputMarker: 'report.pdf' }, zipPath)

    const r = await projectIOService.importProjectZip(zipPath, { ifExists: 'overwrite' })
    expect(r.mode).toBe('updated')
    expect(r.projectId).toBe(pid)

    const plan = readPlan(path.join(workspace(), 'C', 'plan.json'))
    expect(plan.meta.planVersion).toBe(3)
    // 历史合并：v1 保留本地（未覆盖），v2/v3 新增
    const hdir = path.join(workspace(), 'C', 'plan_history')
    const historyFiles = fs.readdirSync(hdir).sort()
    expect(historyFiles).toContain('v1.plan.json')
    expect(historyFiles).toContain('v2.plan.json')
    expect(historyFiles).toContain('v3.plan.json')
    expect(readPlan(path.join(hdir, 'v1.plan.json')).meta.planHash).toBe('local-v1')
    // 新产物落盘
    expect(fs.existsSync(path.join(workspace(), 'C', 'output', 'report.pdf'))).toBe(true)
    // 身份一致
    expect(projectMeta('C').projectId).toBe(pid)
  })

  it('未命中身份：新建项目（名称冲突后缀保留），包内 projectId 与落盘身份一致', async () => {
    writeProject('D', '44444444-4444-4444-8444-444444444444')
    const pkgId = '55555555-5555-4555-8555-555555555555'
    const zipPath = path.join(getTmpBase(), 'new.zip')
    // 包名与既有项目同名，但身份不同 → 新建带后缀
    makeProjectZip({ projectId: pkgId, projectName: 'D', planVersion: 1 }, zipPath)

    const r = await projectIOService.importProjectZip(zipPath, { projectName: 'D' })
    expect(r.mode).toBe('created')
    expect(r.existed).toBe(false)
    expect(r.projectName).toBe('D_导入')
    expect(r.projectId).toBe(pkgId)

    expect(listProjectDirs().sort()).toEqual(['D', 'D_导入'])
    // 落盘身份与包内一致
    expect(projectMeta('D_导入').projectId).toBe(pkgId)
    expect(readPlan(path.join(workspace(), 'D_导入', 'plan.json')).meta.projectId).toBe(pkgId)
  })

  it('旧格式包（无 projectId）：导入时 mint 新身份并同步 plan/project_config 一致', async () => {
    const zipPath = path.join(getTmpBase(), 'legacy.zip')
    makeProjectZip({ projectName: 'Legacy', planVersion: 1 }, zipPath)

    const r = await projectIOService.importProjectZip(zipPath, { projectName: 'Legacy' })
    expect(r.mode).toBe('created')
    expect(r.projectId).toBeTruthy()

    const meta = projectMeta('Legacy')
    expect(meta.projectId).toBe(r.projectId)
    expect(meta.projectName).toBe('Legacy')
    // 身份同步到 plan.json / project_config.json
    expect(readPlan(path.join(workspace(), 'Legacy', 'plan.json')).meta.projectId).toBe(r.projectId)
    expect(readPlan(path.join(workspace(), 'Legacy', 'project_config.json')).aidc_meta?.projectId).toBe(r.projectId)
  })

  it('往返：exportProjectZip → import 幂等（不产生副本）', async () => {
    const pid = '66666666-6666-4666-8666-666666666666'
    writeProject('RT', pid, { planVersion: 2 })
    const zipPath = path.join(getTmpBase(), 'roundtrip.zip')
    await projectIOService.exportProjectZip('RT', zipPath)

    const r = await projectIOService.importProjectZip(zipPath)
    expect(r.mode).toBe('updated')
    expect(r.projectName).toBe('RT')
    expect(listProjectDirs()).toEqual(['RT'])
    expect(projectMeta('RT').projectId).toBe(pid)
  })
})
