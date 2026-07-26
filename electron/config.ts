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
