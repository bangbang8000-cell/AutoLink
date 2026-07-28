import { spawn, ChildProcess } from 'child_process'
import * as path from 'path'
import { getBackendPath } from '../config.js'

interface PythonCallRequest {
  action: string
  params: Record<string, unknown>
}

interface PythonCallResponse {
  success: boolean
  data?: unknown
  error?: string
}

const DEFAULT_TIMEOUT_MS = 60000 // 60秒超时

class PythonService {
  private pythonPath: string

  constructor() {
    this.pythonPath = 'python'
  }

  async call(action: string, params: Record<string, unknown>, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    let proc: ChildProcess | null = null

    const cleanup = () => {
      if (proc) {
        try {
          proc.stdout?.removeAllListeners()
          proc.stderr?.removeAllListeners()
          proc.removeAllListeners()
          if (proc.exitCode === null) {
            proc.kill('SIGTERM')
            // 强制清理：如果 5 秒后还没退出，发 SIGKILL
            setTimeout(() => {
              if (proc && proc.exitCode === null) {
                try { proc.kill('SIGKILL') } catch { /* ignore */ }
              }
            }, 5000)
          }
        } catch {
          // 进程可能已退出
        }
      }
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error(`Python 进程超时 (${timeoutMs / 1000}s): ${action}`))
      }, timeoutMs)

      const request: PythonCallRequest = { action, params }
      const input = JSON.stringify(request)

      const enginePath = path.join(getBackendPath(), 'engine.py')
      proc = spawn(this.pythonPath, [enginePath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      })

      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code: number | null) => {
        clearTimeout(timeout)

        if (code !== 0) {
          cleanup()
          reject(new Error(`Python process exited with code ${code}: ${stderr}`))
          return
        }

        try {
          const lines = stdout.trim().split('\n')
          for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i].trim()
            if (line.startsWith('{')) {
              const response: PythonCallResponse = JSON.parse(line)
              if (response.success) {
                resolve(response.data)
              } else {
                reject(new Error(response.error || 'Unknown Python error'))
              }
              cleanup()
              return
            }
          }
          reject(new Error(`No valid JSON response from Python: ${stdout}`))
        } catch (err) {
          reject(new Error(`Failed to parse Python response: ${(err as Error).message}`))
        }
        cleanup()
      })

      proc.on('error', (err: Error) => {
        clearTimeout(timeout)
        cleanup()
        reject(new Error(`Failed to start Python: ${err.message}`))
      })

      proc.stdin?.write(input)
      proc.stdin?.end()
    })
  }
}

export const pythonService = new PythonService()