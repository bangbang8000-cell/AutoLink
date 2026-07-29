import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'

export const isDev = !app.isPackaged

export function getAppPath(...segments: string[]): string {
  if (isDev) {
    return path.join(process.cwd(), ...segments)
  }
  return path.join(process.resourcesPath, ...segments)
}

export function initializeAppDirs(): void {
  const userData = app.getPath('userData')
  // 打包后模板从 resourcesPath/template 只读访问，仅需创建 workspace 目录
  const dirs = [
    path.join(userData, 'workspace'),
  ]
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }
}

export function getWorkspacePath(): string {
  if (isDev) {
    return path.join(process.cwd(), 'workspace')
  }
  return path.join(app.getPath('userData'), 'workspace')
}

export function getTemplatePath(): string {
  if (isDev) {
    return path.join(process.cwd(), 'template')
  }
  // 打包后模板（含设备库）随 extraResources 复制到 resourcesPath/template
  return path.join(process.resourcesPath, 'template')
}

export function getBackendPath(): string {
  return getAppPath('backend')
}

export function getDemoDataPath(): string {
  return getAppPath('demo_data')
}

export function ensureDemoProjects(): void {
  const wsp = getWorkspacePath()
  if (!fs.existsSync(wsp)) {
    fs.mkdirSync(wsp, { recursive: true })
  }

  // 若 workspace 已有项目，不重复创建
  const existing = fs.readdirSync(wsp, { withFileTypes: true })
    .filter((d) => d.isDirectory())
  if (existing.length > 0) return

  // 内置示例项目：从 template 复制 network_config.ini 即可，
  // 用户打开项目后点击"生成拓扑"即可查看完整效果
  const demoProjects = [
    { name: '示例-H100-100台', tpl: 'H100-100台', desc: '100台H100 GPU + 14存储 + 20通算 — 入门示例' },
    { name: '示例-H100-128台', tpl: 'H100-128台', desc: '128台H100 GPU (4组Rail) + 14存储 + 20通算 — Rail-Optimized 示例' },
    { name: '示例-L20-推理-64', tpl: 'L20-推理-64', desc: '64台L20推理集群 — 推理场景示例' },
  ]

  const tplPath = getTemplatePath()
  for (const dp of demoProjects) {
    const projectDir = path.join(wsp, dp.name)
    fs.mkdirSync(projectDir, { recursive: true })
    fs.mkdirSync(path.join(projectDir, 'output'), { recursive: true })

    // 从模板复制配置
    const tplConfig = path.join(tplPath, dp.tpl, 'network_config.ini')
    if (fs.existsSync(tplConfig)) {
      fs.copyFileSync(tplConfig, path.join(projectDir, 'network_config.ini'))
    }

    // 创建 project.json
    const meta = {
      name: dp.name,
      description: dp.desc,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      demo: true,
    }
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(meta, null, 2), 'utf-8')

    console.log(`[AutoLink] Demo project created: ${dp.name}`)
  }
}
