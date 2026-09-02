import * as fs from 'fs'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { ZipArchive } from 'archiver'
import AdmZip from 'adm-zip'
import { getWorkspacePath, getTemplatePath, getUserTemplatePath } from '../config.js'
import { encryptZipFile } from '../utils/zip-crypto.js'

// 允许的顶层文件白名单（防止打包系统文件或敏感数据）
const ALLOWED_TOP_LEVEL = new Set([
  'project.json',
  'network_config.ini',
  'project_config.json',
  'template.json',
  // T6.1: 拓扑/机柜数据按项目持久化,需纳入导入导出白名单
  'topology.json',
  'rack_layout.json',
  // P1（A-6）：AIDC 规划文件随项目导入/导出往返
  'plan.json',
  // M5：AIDC 规划版本历史快照目录随项目往返（导入后历史不丢失）
  'plan_history',
  'output',
])

// 危险文件名（不打包 / 不解压）
function isUnsafeName(name: string): boolean {
  if (!name) return true
  // 禁止绝对路径和路径遍历
  if (path.isAbsolute(name)) return true
  if (name.includes('..')) return true
  // 禁止系统隐藏文件
  const base = path.basename(name)
  if (base.startsWith('.') && base !== '.') return true
  // 禁止 Windows 保留设备名
  if (/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)/i.test(base)) return true
  return false
}

export interface ExportResult {
  zipPath: string
  fileCount: number
  totalBytes: number
}

export interface BatchExportResult {
  successes: { name: string; zipPath: string }[]
  failures: { name: string; error: string }[]
}

/** 48-a（F8-1）：项目导入模式——created=新建 / updated=覆盖更新 / skipped=已存在跳过 */
export type ProjectImportMode = 'created' | 'updated' | 'skipped'

/** 48-a（F8-1）：项目导入结果（幂等语义） */
export interface ProjectImportResult {
  /** 落盘项目名（created 时可能带 _导入 后缀） */
  projectName: string
  /** 落盘项目身份（与 project.json projectId 一致） */
  projectId: string
  /** 导入模式 */
  mode: ProjectImportMode
  /** 是否按 projectId 命中既有项目 */
  existed: boolean
}

/** 48-a（F8-1）：项目导入选项 */
export interface ProjectImportOptions {
  projectName?: string
  password?: string
  /** 命中既有身份（按 projectId）时的处理：skip=跳过 / overwrite=覆盖更新（默认） */
  ifExists?: 'skip' | 'overwrite'
}

/**
 * 通用打包函数：将 sourceDir 打包为 zipPath
 * - 顶层只允许白名单内的文件/目录
 */
function archiveDirectory(sourceDir: string, zipPath: string, allowOutputDir: boolean): Promise<ExportResult> {
  return new Promise<ExportResult>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath)
    const archive = new ZipArchive({
      zlib: { level: 6 },
    })

    let fileCount = 0

    output.on('close', () => {
      resolve({
        zipPath,
        fileCount,
        totalBytes: archive.pointer(),
      })
    })

    output.on('error', (err: Error) => {
      reject(new Error(`写入 ZIP 失败: ${err.message}`))
    })

    archive.on('error', (err: Error) => {
      reject(new Error(`打包失败: ${err.message}`))
    })

    archive.on('entry', (entry: { type: string }) => {
      if (entry.type === 'file') {
        fileCount++
      }
    })

    archive.pipe(output)

    // 遍历目录，过滤危险/无关文件后打包
    const walkAndAdd = (dir: string, relBase: string) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        const fullName = entry.name
        if (isUnsafeName(fullName)) continue

        // 顶层文件白名单校验
        if (relBase === '' && entry.isFile() && !ALLOWED_TOP_LEVEL.has(fullName)) {
          continue
        }

        const fullPath = path.join(dir, fullName)
        const relPath = relBase ? `${relBase}/${fullName}` : fullName

        if (entry.isDirectory()) {
          // 顶层目录只允许 output / plan_history（项目）或全部允许（模板场景由调用方控制）
          if (relBase === '' && allowOutputDir && fullName !== 'output' && fullName !== 'plan_history') continue
          archive.directory(fullPath, relPath)
        } else if (entry.isFile()) {
          archive.file(fullPath, { name: relPath })
        }
      }
    }

    walkAndAdd(sourceDir, '')
    archive.finalize()
  })
}

class ProjectIOService {
  /**
   * 导出单个项目为 ZIP
   * @param password 提供时使用 ZipCrypto 加密导出（T15-2 分享 ZIP 加密）
   */
  async exportProjectZip(projectName: string, zipPath: string, password?: string): Promise<ExportResult> {
    const wsp = getWorkspacePath()
    const projectDir = path.join(wsp, projectName)
    if (!fs.existsSync(projectDir) || !fs.statSync(projectDir).isDirectory()) {
      throw new Error(`项目不存在: ${projectName}`)
    }

    const targetDir = path.dirname(zipPath)
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    // 项目场景：顶层只允许 output 子目录
    const result = await archiveDirectory(projectDir, zipPath, true)
    if (password) {
      encryptZipFile(zipPath, password)
    }
    return result
  }

  /**
   * 批量导出多个项目为 ZIP
   * @param password 提供时对所有 ZIP 加密（T15-2）
   */
  async batchExportProjects(projectNames: string[], targetDir: string, password?: string): Promise<BatchExportResult> {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    const successes: { name: string; zipPath: string }[] = []
    const failures: { name: string; error: string }[] = []

    for (const name of projectNames) {
      const zipPath = path.join(targetDir, `${name}.zip`)
      try {
        await this.exportProjectZip(name, zipPath, password)
        successes.push({ name, zipPath })
      } catch (err) {
        failures.push({
          name,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return { successes, failures }
  }

  /**
   * V2.9.1-T2: ZIP 解压公共流程（项目/模板导入共用）
   * 校验 → 命名冲突后缀 → 白名单解压 → 元数据同步
   * 48-a（F8-1）：支持 overwriteInto（覆盖更新到既有目录）+ mergeHistory（历史合并）+ 返回 projectId
   */
  private extractZipCommon(
    zipPath: string,
    destBaseDir: string,
    baseName: string | undefined,
    kind: string,
    syncMeta: (destDir: string, finalName: string) => void,
    password?: string,
    opts?: { overwriteInto?: string; mergeHistory?: boolean },
  ): { finalName: string; projectId: string } {
    if (!fs.existsSync(zipPath)) {
      throw new Error(`ZIP 文件不存在: ${zipPath}`)
    }

    const zip = new AdmZip(zipPath)
    // T15-2: 加密 ZIP 需提供密码
    const entries = zip.getEntries(password)

    if (entries.length === 0) {
      throw new Error('ZIP 文件为空')
    }

    // 安全校验：检测路径遍历、绝对路径、危险文件名
    for (const entry of entries) {
      if (isUnsafeName(entry.entryName)) {
        throw new Error(`ZIP 包含不安全的路径: ${entry.entryName}`)
      }
    }

    // 校验 ZIP 中必须包含配置文件（M5: 兼容仅含 plan.json 的 MC 交付包，导入为 AIDC 项目）
    const hasConfig = entries.some(
      (e) =>
        !e.isDirectory &&
        (e.entryName === 'network_config.ini' || e.entryName === 'project_config.json' || e.entryName === 'plan.json'),
    )
    if (!hasConfig) {
      throw new Error(`ZIP 中未找到 network_config.ini / project_config.json / plan.json，不是有效的${kind}包`)
    }

    let finalName = baseName?.trim() || path.basename(zipPath, '.zip')
    if (!finalName || finalName === '.' || finalName === '..') {
      throw new Error(`无效的${kind}名`)
    }

    // 48-a：overwriteInto 直接覆盖更新到既有目录（不再追加后缀）；否则名称冲突自动追加 _导入 / _导入2 ...
    let destDir: string
    if (opts?.overwriteInto) {
      destDir = path.join(destBaseDir, opts.overwriteInto)
    } else {
      if (fs.existsSync(path.join(destBaseDir, finalName))) {
        let suffix = 1
        let candidate = `${finalName}_导入`
        while (fs.existsSync(path.join(destBaseDir, candidate))) {
          suffix++
          candidate = `${finalName}_导入${suffix}`
        }
        finalName = candidate
      }
      destDir = path.join(destBaseDir, finalName)
      fs.mkdirSync(destDir, { recursive: true })
    }
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true })
    }

    // 解压白名单文件
    const allowed = new Set(ALLOWED_TOP_LEVEL)
    for (const entry of entries) {
      if (entry.isDirectory) continue

      const top = entry.entryName.split('/')[0]
      if (!allowed.has(top)) continue

      // 防止解压到目标目录外
      const targetPath = path.resolve(destDir, entry.entryName)
      if (!targetPath.startsWith(destDir + path.sep) && targetPath !== destDir) {
        continue
      }

      // 48-a：覆盖更新时合并历史（既有快照文件不覆盖，仅补充缺失版本）
      if (opts?.mergeHistory && top === 'plan_history' && fs.existsSync(targetPath)) {
        continue
      }

      const parentDir = path.dirname(targetPath)
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true })
      }

      fs.writeFileSync(targetPath, entry.getData())
    }

    syncMeta(destDir, finalName)

    // 读回落盘身份（syncMeta 已写入/保留 projectId）
    let projectId = ''
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(destDir, 'project.json'), 'utf-8'))
      projectId = String(meta?.projectId ?? '')
    } catch {
      // 忽略：非项目包无 projectId
    }
    return { finalName: path.basename(destDir), projectId }
  }

  /** 48-a：读取 ZIP 包内项目身份（project.json → plan.json → project_config.json 依次兜底） */
  private readPackageIdentity(zipPath: string, password?: string): { projectId: string } {
    const zip = new AdmZip(zipPath)
    const entries = zip.getEntries(password)
    const readJson = (name: string): Record<string, unknown> | null => {
      const entry = entries.find((e) => !e.isDirectory && e.entryName === name)
      if (!entry) return null
      try {
        return JSON.parse(entry.getData().toString('utf-8')) as Record<string, unknown>
      } catch {
        return null
      }
    }
    const meta = readJson('project.json')
    if (typeof meta?.projectId === 'string' && meta.projectId) return { projectId: meta.projectId }
    const plan = readJson('plan.json')
    const pmeta = plan?.meta as Record<string, unknown> | undefined
    if (pmeta && typeof pmeta.projectId === 'string' && pmeta.projectId) return { projectId: pmeta.projectId }
    const cfg = readJson('project_config.json')
    const aidcMeta = cfg?.aidc_meta as Record<string, unknown> | undefined
    if (aidcMeta && typeof aidcMeta.projectId === 'string' && aidcMeta.projectId) return { projectId: aidcMeta.projectId }
    return { projectId: '' }
  }

  /** 48-a：按 projectId 在 workspace 下匹配既有项目目录（返回目录名；未命中返回 null） */
  private findProjectByProjectId(workspace: string, projectId: string): string | null {
    if (!projectId) return null
    if (!fs.existsSync(workspace)) return null
    for (const name of fs.readdirSync(workspace)) {
      const dir = path.join(workspace, name)
      if (!fs.statSync(dir).isDirectory()) continue
      try {
        const meta = JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf-8'))
        if (String(meta?.projectId ?? '') === projectId) return name
      } catch {
        // 跳过损坏项目
      }
      try {
        const plan = JSON.parse(fs.readFileSync(path.join(dir, 'plan.json'), 'utf-8'))
        if (String(plan?.meta?.projectId ?? '') === projectId) return name
      } catch {
        // 跳过损坏项目
      }
    }
    return null
  }

  /** 48-a：同步项目元数据（保留/写入 projectId，刷新 name/updatedAt/importedAt），并保证 plan/config 身份一致 */
  private syncProjectMeta(destDir: string, finalName: string, projectId: string): void {
    const outputDir = path.join(destDir, 'output')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }
    const now = new Date().toISOString()
    const metaPath = path.join(destDir, 'project.json')
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        meta.name = finalName
        meta.projectId = projectId
        meta.projectName = meta.projectName || finalName
        meta.updatedAt = now
        meta.importedAt = now
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
      } catch {
        // 忽略元数据损坏，不阻断导入
      }
    } else {
      fs.writeFileSync(metaPath, JSON.stringify({
        name: finalName,
        projectId,
        projectName: finalName,
        createdAt: now,
        updatedAt: now,
        importedAt: now,
      }, null, 2), 'utf-8')
    }
    this.ensureIdentityConsistent(destDir, projectId, finalName)
  }

  /** 48-a：保证 plan.json / project_config.json 与落盘目录身份一致 */
  private ensureIdentityConsistent(destDir: string, projectId: string, name: string): void {
    const planPath = path.join(destDir, 'plan.json')
    if (fs.existsSync(planPath)) {
      try {
        const plan = JSON.parse(fs.readFileSync(planPath, 'utf-8'))
        if (plan?.meta) {
          plan.meta.projectId = projectId
          plan.meta.projectName = plan.meta.projectName || name
          fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf-8')
        }
      } catch {
        // 忽略损坏 plan
      }
    }
    const cfgPath = path.join(destDir, 'project_config.json')
    if (fs.existsSync(cfgPath)) {
      try {
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'))
        cfg.aidc_meta = { ...(cfg.aidc_meta || {}), projectId }
        if (!cfg.aidc_meta.projectName) cfg.aidc_meta.projectName = name
        fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf-8')
      } catch {
        // 忽略损坏 config
      }
    }
  }

  /**
   * 从 ZIP 导入项目（48-a：projectId 幂等）
   * - 读取包内 projectId → 与本地项目比对：命中 → skip/覆盖更新（保留身份，合并历史），返回「已存在」语义；
   *   未命中 → 新建（名称冲突后缀保留，包内身份与落盘一致）。
   * @returns 导入结果（项目名 / 身份 / 模式）
   */
  async importProjectZip(zipPath: string, options?: ProjectImportOptions): Promise<ProjectImportResult> {
    if (!fs.existsSync(zipPath)) {
      throw new Error(`ZIP 文件不存在: ${zipPath}`)
    }
    const workspace = getWorkspacePath()
    const password = options?.password
    const ifExists = options?.ifExists ?? 'overwrite'

    const { projectId: pkgId } = this.readPackageIdentity(zipPath, password)
    const existingName = pkgId ? this.findProjectByProjectId(workspace, pkgId) : null

    // 已存在（按身份匹配）→ skip / 覆盖更新
    if (existingName && ifExists === 'skip') {
      return { projectName: existingName, projectId: pkgId, mode: 'skipped', existed: true }
    }
    if (existingName) {
      this.extractZipCommon(zipPath, workspace, existingName, '项目', (destDir, finalName) => {
        this.syncProjectMeta(destDir, finalName, pkgId)
      }, password, { overwriteInto: existingName, mergeHistory: true })
      return { projectName: existingName, projectId: pkgId, mode: 'updated', existed: true }
    }

    // 未命中身份 → 新建（名称冲突后缀保留）
    const createdPid = pkgId || randomUUID()
    const result = this.extractZipCommon(zipPath, workspace, options?.projectName, '项目', (destDir, finalName) => {
      this.syncProjectMeta(destDir, finalName, createdPid)
    }, password)
    return {
      projectName: result.finalName,
      projectId: result.projectId || createdPid,
      mode: 'created',
      existed: false,
    }
  }

  /**
   * 导出模板为 ZIP
   * @param password 提供时使用 ZipCrypto 加密导出（T15-2）
   */
  async exportTemplateZip(templateName: string, zipPath: string, password?: string): Promise<ExportResult> {
    // 优先查用户模板目录，再查内置模板目录
    const userTplDir = path.join(getUserTemplatePath(), templateName)
    const builtinTplDir = path.join(getTemplatePath(), templateName)
    const tplDir = fs.existsSync(userTplDir)
      ? userTplDir
      : builtinTplDir
    if (!fs.existsSync(tplDir) || !fs.statSync(tplDir).isDirectory()) {
      throw new Error(`模板不存在: ${templateName}`)
    }

    const targetDir = path.dirname(zipPath)
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    // 模板场景：不允许 output 子目录（模板没有该目录）
    const result = await archiveDirectory(tplDir, zipPath, false)
    if (password) {
      encryptZipFile(zipPath, password)
    }
    return result
  }

  /**
   * 从 ZIP 导入模板
   * @param password 加密 ZIP 的解密密码（T15-2）
   * @returns 最终使用的模板名（目录名）
   */
  async importTemplateZip(zipPath: string, templateName?: string, password?: string): Promise<string> {
    // 导入模板写入用户模板目录（可读写），内置模板目录只读
    const tplPath = getUserTemplatePath()
    if (!fs.existsSync(tplPath)) {
      fs.mkdirSync(tplPath, { recursive: true })
    }
    return (await this.extractZipCommon(zipPath, tplPath, templateName, '模板', (destDir, finalName) => {
      // 同步 template.json：更新 name 为目录名，标记为非内置
      const metaPath = path.join(destDir, 'template.json')
      let meta: Record<string, unknown> = {}
      if (fs.existsSync(metaPath)) {
        try {
          meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        } catch {
          meta = {}
        }
      }
      meta.name = finalName
      meta.isBuiltin = false
      meta.importedAt = new Date().toISOString()
      if (!meta.createdAt) {
        meta.createdAt = new Date().toISOString()
      }
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
    }, password)).finalName
  }
}

export const projectIOService = new ProjectIOService()
