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
  const dirs = [
    path.join(userData, 'workspace'),
    path.join(userData, 'templates'),
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
  return path.join(app.getPath('userData'), 'templates')
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

  // Check if workspace already has projects
  const existing = fs.readdirSync(wsp, { withFileTypes: true })
    .filter((d) => d.isDirectory())
  if (existing.length > 0) return

  const demoData = getDemoDataPath()
  if (!fs.existsSync(demoData)) return

  const demoProjects = [
    { name: 'Demo-128台H100', topology: '128H100_topology.json', rack: '128H100_rack_layout.json', output: '128H100_output' },
    { name: 'Demo-100台H100', topology: '100H100_topology.json', rack: '100H100_rack_layout.json', output: '100H100_output' },
  ]

  for (const dp of demoProjects) {
    const projectDir = path.join(wsp, dp.name)
    fs.mkdirSync(projectDir, { recursive: true })
    fs.mkdirSync(path.join(projectDir, 'output'), { recursive: true })

    // Copy topology result
    const topoFile = path.join(demoData, dp.topology)
    if (fs.existsSync(topoFile)) {
      fs.copyFileSync(topoFile, path.join(projectDir, 'topology_result.json'))
    }

    // Copy rack layout
    const rackFile = path.join(demoData, dp.rack)
    if (fs.existsSync(rackFile)) {
      fs.copyFileSync(rackFile, path.join(projectDir, 'rack_layout.json'))
    }

    // Copy config from template
    const tplName = dp.name.includes('128') ? 'H100-128台' : 'H100-100台'
    const tplConfig = path.join(getTemplatePath(), tplName, 'network_config.ini')
    if (fs.existsSync(tplConfig)) {
      fs.copyFileSync(tplConfig, path.join(projectDir, 'network_config.ini'))
    }

    // Copy Excel output
    const outputSrc = path.join(demoData, dp.output)
    if (fs.existsSync(outputSrc)) {
      const files = fs.readdirSync(outputSrc)
      for (const f of files) {
        fs.copyFileSync(path.join(outputSrc, f), path.join(projectDir, 'output', f))
      }
    }

    // Create project.json
    const meta = {
      name: dp.name,
      description: `${dp.name.includes('128') ? '128' : '100'}台H100 GPU (4组) + 14存储 + 20通算 — 内置Demo项目`,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      demo: true,
    }
    fs.writeFileSync(path.join(projectDir, 'project.json'), JSON.stringify(meta, null, 2), 'utf-8')

    console.log(`[AutoLink] Demo project created: ${dp.name}`)
  }
}
