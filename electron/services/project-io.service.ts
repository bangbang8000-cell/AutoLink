import * as fs from 'fs'
import * as path from 'path'
import { ZipArchive } from 'archiver'
import AdmZip from 'adm-zip'
import { getWorkspacePath, getTemplatePath, getUserTemplatePath } from '../config.js'

// 允许的顶层文件白名单（防止打包系统文件或敏感数据）
const ALLOWED_TOP_LEVEL = new Set([
  'project.json',
  'network_config.ini',
  'project_config.json',
  'template.json',
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
          // 顶层目录只允许 output（项目）或全部允许（模板场景由调用方控制）
          if (relBase === '' && allowOutputDir && fullName !== 'output') continue
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
   */
  async exportProjectZip(projectName: string, zipPath: string): Promise<ExportResult> {
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
    return archiveDirectory(projectDir, zipPath, true)
  }

  /**
   * 批量导出多个项目为 ZIP
   */
  async batchExportProjects(projectNames: string[], targetDir: string): Promise<BatchExportResult> {
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true })
    }

    const successes: { name: string; zipPath: string }[] = []
    const failures: { name: string; error: string }[] = []

    for (const name of projectNames) {
      const zipPath = path.join(targetDir, `${name}.zip`)
      try {
        await this.exportProjectZip(name, zipPath)
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
   * 从 ZIP 导入项目
   * @returns 最终使用的项目名
   */
  async importProjectZip(zipPath: string, projectName?: string): Promise<string> {
    if (!fs.existsSync(zipPath)) {
      throw new Error(`ZIP 文件不存在: ${zipPath}`)
    }

    const zip = new AdmZip(zipPath)
    const entries = zip.getEntries()

    if (entries.length === 0) {
      throw new Error('ZIP 文件为空')
    }

    // 安全校验：检测路径遍历、绝对路径、危险文件名
    for (const entry of entries) {
      if (isUnsafeName(entry.entryName)) {
        throw new Error(`ZIP 包含不安全的路径: ${entry.entryName}`)
      }
    }

    // 校验 ZIP 中必须包含项目配置文件
    const hasConfig = entries.some(
      (e) => !e.isDirectory && (e.entryName === 'network_config.ini' || e.entryName === 'project_config.json'),
    )
    if (!hasConfig) {
      throw new Error('ZIP 中未找到 network_config.ini 或 project_config.json，不是有效的项目包')
    }

    const wsp = getWorkspacePath()
    let finalName = projectName?.trim() || path.basename(zipPath, '.zip')
    if (!finalName || finalName === '.' || finalName === '..') {
      throw new Error('无效的项目名')
    }
    // 名称冲突时自动追加 _导入 / _导入2 ...
    if (fs.existsSync(path.join(wsp, finalName))) {
      let suffix = 1
      let candidate = `${finalName}_导入`
      while (fs.existsSync(path.join(wsp, candidate))) {
        suffix++
        candidate = `${finalName}_导入${suffix}`
      }
      finalName = candidate
    }

    const projectDir = path.join(wsp, finalName)
    fs.mkdirSync(projectDir, { recursive: true })

    // 解压白名单文件
    const allowed = new Set(ALLOWED_TOP_LEVEL)
    for (const entry of entries) {
      if (entry.isDirectory) continue

      const top = entry.entryName.split('/')[0]
      if (!allowed.has(top)) continue

      // 防止解压到项目目录外
      const targetPath = path.resolve(projectDir, entry.entryName)
      if (!targetPath.startsWith(projectDir + path.sep) && targetPath !== projectDir) {
        continue
      }

      const parentDir = path.dirname(targetPath)
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true })
      }

      fs.writeFileSync(targetPath, entry.getData())
    }

    // 确保 output 目录存在
    const outputDir = path.join(projectDir, 'output')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    // 同步更新 project.json 的 name 字段
    const metaPath = path.join(projectDir, 'project.json')
    if (fs.existsSync(metaPath)) {
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'))
        meta.name = finalName
        meta.updatedAt = new Date().toISOString()
        meta.importedAt = new Date().toISOString()
        fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf-8')
      } catch {
        // 忽略元数据损坏，不阻断导入
      }
    }

    return finalName
  }

  /**
   * 导出模板为 ZIP
   */
  async exportTemplateZip(templateName: string, zipPath: string): Promise<ExportResult> {
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
    return archiveDirectory(tplDir, zipPath, false)
  }

  /**
   * 从 ZIP 导入模板
   * @returns 最终使用的模板名（目录名）
   */
  async importTemplateZip(zipPath: string, templateName?: string): Promise<string> {
    if (!fs.existsSync(zipPath)) {
      throw new Error(`ZIP 文件不存在: ${zipPath}`)
    }

    const zip = new AdmZip(zipPath)
    const entries = zip.getEntries()

    if (entries.length === 0) {
      throw new Error('ZIP 文件为空')
    }

    for (const entry of entries) {
      if (isUnsafeName(entry.entryName)) {
        throw new Error(`ZIP 包含不安全的路径: ${entry.entryName}`)
      }
    }

    // 校验 ZIP 中必须包含配置文件
    const hasConfig = entries.some(
      (e) => !e.isDirectory && (e.entryName === 'network_config.ini' || e.entryName === 'project_config.json'),
    )
    if (!hasConfig) {
      throw new Error('ZIP 中未找到 network_config.ini 或 project_config.json，不是有效的模板包')
    }

    // 导入模板写入用户模板目录（可读写），内置模板目录只读
    const tplPath = getUserTemplatePath()
    if (!fs.existsSync(tplPath)) {
      fs.mkdirSync(tplPath, { recursive: true })
    }

    let finalName = templateName?.trim() || path.basename(zipPath, '.zip')
    if (!finalName || finalName === '.' || finalName === '..') {
      throw new Error('无效的模板名')
    }
    // 名称冲突时自动追加后缀
    if (fs.existsSync(path.join(tplPath, finalName))) {
      let suffix = 1
      let candidate = `${finalName}_导入`
      while (fs.existsSync(path.join(tplPath, candidate))) {
        suffix++
        candidate = `${finalName}_导入${suffix}`
      }
      finalName = candidate
    }

    const destDir = path.join(tplPath, finalName)
    fs.mkdirSync(destDir, { recursive: true })

    const allowed = new Set(ALLOWED_TOP_LEVEL)
    for (const entry of entries) {
      if (entry.isDirectory) continue

      const top = entry.entryName.split('/')[0]
      if (!allowed.has(top)) continue

      const targetPath = path.resolve(destDir, entry.entryName)
      if (!targetPath.startsWith(destDir + path.sep) && targetPath !== destDir) {
        continue
      }

      const parentDir = path.dirname(targetPath)
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true })
      }

      fs.writeFileSync(targetPath, entry.getData())
    }

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

    return finalName
  }
}

export const projectIOService = new ProjectIOService()
