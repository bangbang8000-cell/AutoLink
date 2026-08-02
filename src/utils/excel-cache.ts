/**
 * v2.8.0-T4: 模块级 Excel 解析缓存
 * 同一文件重复打开(关闭再打开 / 多入口)时秒开,不重新解析
 * key 统一为 `${projectName}/${relPath}`(相对项目根)
 */
const CACHE_LIMIT = 50

const cache = new Map<string, Record<string, string[][]>>()

export function getCachedExcel(key: string): Record<string, string[][]> | undefined {
  return cache.get(key)
}

export function setCachedExcel(key: string, data: Record<string, string[][]>): void {
  // 简单容量控制:超出时删除最早插入的条目
  if (cache.size >= CACHE_LIMIT && !cache.has(key)) {
    const oldestKey = cache.keys().next().value
    if (oldestKey !== undefined) cache.delete(oldestKey)
  }
  cache.set(key, data)
}

export function clearCachedExcel(): void {
  cache.clear()
}
