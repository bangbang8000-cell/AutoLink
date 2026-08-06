/**
 * V3.2.2-R11.1: 日志脱敏工具
 * 主进程所有 console / 错误日志经 redactSensitive() 过滤后再输出，
 * 避免 apiKey / token / 密码等凭据落盘或进入 pythonService.stderrTail 泄漏。
 */

const KV_PATTERN =
  /(["']?(?:api[_-]?key|apikey|token|access[_-]?token|refresh[_-]?token|password|passwd|secret|authorization|credential)["']?\s*[:=]\s*["']?)[^\s"',}\]]+/gi

const AUTH_SCHEME_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi

/** OpenAI 风格密钥（sk- 前缀，至少 6 位） */
const OPENAI_KEY_PATTERN = /\bsk-[A-Za-z0-9_-]{6,}/g

/** 对任意字符串执行敏感信息脱敏（用于日志输出前） */
export function redactSensitive(input: string): string {
  if (!input) return input
  return input
    .replace(KV_PATTERN, '$1***')
    .replace(AUTH_SCHEME_PATTERN, '$1 ***')
    .replace(OPENAI_KEY_PATTERN, 'sk-***')
}

/**
 * 对任意未知值（Error / string / 对象）生成脱敏后的日志文本。
 * 对象会 JSON 序列化后整体脱敏；序列化失败时回退 String(value)。
 */
export function redactForLog(value: unknown): string {
  if (value instanceof Error) {
    return redactSensitive(value.message)
  }
  if (typeof value === 'string') {
    return redactSensitive(value)
  }
  try {
    return redactSensitive(JSON.stringify(value))
  } catch {
    return redactSensitive(String(value))
  }
}
