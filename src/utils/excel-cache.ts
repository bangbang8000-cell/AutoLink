/**
 * v2.8.0-T4: 模块级 Excel 解析缓存
 * 同一文件重复打开(关闭再打开 / 多入口)时秒开,不重新解析
 * key 统一为 `${projectName}/${relPath}`(相对项目根)
 */
import * as XLSX from 'xlsx'

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

/**
 * V2.9.2-T5: 分片解析工作簿为 { sheetName: rows[][] }
 * 按行分片转换(每片让出主线程), 避免大文件一次性阻塞 UI;
 * 通过 onProgress 汇报整体进度(0-100)。
 */
export async function parseWorkbookChunked(
  wb: XLSX.WorkBook,
  onProgress?: (percent: number) => void,
): Promise<Record<string, string[][]>> {
  const CHUNK = 500
  const dataMap: Record<string, string[][]> = {}
  const sheetCount = wb.SheetNames.length
  let doneRows = 0
  let totalRows = 0

  // 先统计总行数用于进度计算
  const ranges = wb.SheetNames.map((name) => {
    const ref = wb.Sheets[name]['!ref']
    const range = ref ? XLSX.utils.decode_range(ref) : null
    const count = range ? range.e.r - range.s.r + 1 : 0
    totalRows += count
    return range
  })

  for (let si = 0; si < sheetCount; si++) {
    const name = wb.SheetNames[si]
    const ws = wb.Sheets[name]
    const range = ranges[si]
    const rows: string[][] = []

    if (range && range.e.r >= range.s.r) {
      for (let r = range.s.r; r <= range.e.r; r += CHUNK) {
        const end = Math.min(r + CHUNK - 1, range.e.r)
        const part = XLSX.utils.sheet_to_json<string[]>(ws, {
          header: 1,
          range: { s: { r, c: range.s.c }, e: { r: end, c: range.e.c } },
        })
        rows.push(...part)
        doneRows += end - r + 1
        onProgress?.(totalRows > 0 ? Math.min(100, Math.round((doneRows / totalRows) * 100)) : 100)
        // 让出主线程, 使进度条得以渲染
        await new Promise((resolve) => setTimeout(resolve, 0))
      }
    }

    dataMap[name] = rows
  }

  onProgress?.(100)
  return dataMap
}
