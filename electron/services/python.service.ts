import { spawn } from 'child_process'
import * as path from 'path'
import { getBackendPath } from '../config'

interface PythonCallRequest {
  action: string
  params: Record<string, unknown>
}

interface PythonCallResponse {
  success: boolean
  data?: unknown
  error?: string
}

class PythonService {
  private pythonPath: string

  constructor() {
    this.pythonPath = 'python'
  }

  async call(action: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const request: PythonCallRequest = { action, params }
      const input = JSON.stringify(request)

      const enginePath = path.join(getBackendPath(), 'engine.py')
      const proc = spawn(this.pythonPath, [enginePath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      })

      let stdout = ''
      let stderr = ''

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      proc.on('close', (code: number | null) => {
        if (code !== 0) {
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
              return
            }
          }
          reject(new Error(`No valid JSON response from Python: ${stdout}`))
        } catch (err) {
          reject(new Error(`Failed to parse Python response: ${(err as Error).message}`))
        }
      })

      proc.on('error', (err: Error) => {
        reject(new Error(`Failed to start Python: ${err.message}`))
      })

      proc.stdin.write(input)
      proc.stdin.end()
    })
  }
}

export const pythonService = new PythonService()
