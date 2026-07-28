import * as XLSX from 'xlsx'

export interface ImportedCabinet {
  /** 机柜编号 (e.g. "A01", "B02") */
  id: string
  /** 机柜名称 */
  name: string
  /** 机柜类型 */
  type: string
  /** 机柜总U数 */
  totalU: number
  /** 功率上限 (W) */
  powerLimit: number
  /** 已用U数 (可选, 默认0) */
  usedU?: number
  /** 可用U数 (可选) */
  availableU?: number
  /** 位置描述 */
  location?: string
  /** 备注 */
  notes?: string
}

export interface ParseResult {
  cabinets: ImportedCabinet[]
  errors: string[]
  warnings: string[]
}

/** Expected CSV/Excel column mappings (case-insensitive) */
const COLUMN_MAP: Record<string, string> = {
  '机柜编号': 'id',
  '机柜名称': 'name',
  '名称': 'name',
  '类型': 'type',
  '机柜类型': 'type',
  'u数': 'totalU',
  '柜位': 'totalU',
  '功率上限': 'powerLimit',
  '功率上限(w)': 'powerLimit',
  '功率上限（w）': 'powerLimit',
  '已用u': 'usedU',
  '已用u数': 'usedU',
  '可用u': 'availableU',
  '可用u数': 'availableU',
  '位置': 'location',
  '备注': 'notes',
}

const CABINET_TYPE_MAP: Record<string, string> = {
  'gpu': 'gpu',
  'gpu柜': 'gpu',
  'gpu服务器柜': 'gpu',
  '存储': 'storage',
  '存储柜': 'storage',
  '存储服务器柜': 'storage',
  '网络': 'network',
  '网络柜': 'network',
  '网络设备柜': 'network',
  '交换机柜': 'network',
  '通算': 'compute',
  '通算柜': 'compute',
  '通算服务器柜': 'compute',
  '安全': 'security',
  '安全柜': 'security',
  '安全设备柜': 'security',
  '混合': 'custom',
  '混合柜': 'custom',
  '自定义': 'custom',
}

function normalizeType(raw: string): string {
  const lower = raw.toLowerCase().trim()
  return CABINET_TYPE_MAP[lower] || 'custom'
}

function normalizeHeader(header: string): string {
  for (const [key, value] of Object.entries(COLUMN_MAP)) {
    if (header.trim().toLowerCase() === key.toLowerCase()) {
      return value
    }
  }
  return header.trim()
}

/**
 * Parse cabinet list from CSV text or Excel buffer.
 */
export function parseCabinetCSV(csvText: string): ParseResult {
  const result: ParseResult = { cabinets: [], errors: [], warnings: [] }
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0)

  if (lines.length < 2) {
    result.errors.push('文件至少需要包含标题行和一行数据')
    return result
  }

  // Parse header
  const headers = lines[0].split(',').map(normalizeHeader)
  const idIdx = headers.findIndex((h) => h === 'id')
  const nameIdx = headers.findIndex((h) => h === 'name')
  const typeIdx = headers.findIndex((h) => h === 'type')
  const totalUIdx = headers.findIndex((h) => h === 'totalU')
  const powerLimitIdx = headers.findIndex((h) => h === 'powerLimit')
  const locationIdx = headers.findIndex((h) => h === 'location')
  const notesIdx = headers.findIndex((h) => h === 'notes')

  if (idIdx === -1 && nameIdx === -1) {
    result.errors.push('缺少必填列：机柜编号 或 机柜名称')
    return result
  }

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    if (cols.length < 2 && cols[0] === '') continue

    try {
      const id = idIdx >= 0 ? cols[idIdx] || `cab-${i}` : `cab-${i}`
      const name = nameIdx >= 0 ? cols[nameIdx] || id : id
      const typeRaw = typeIdx >= 0 ? cols[typeIdx] || 'custom' : 'custom'
      const totalU = totalUIdx >= 0 ? parseInt(cols[totalUIdx]) || 42 : 42
      const powerLimit = powerLimitIdx >= 0 ? parseInt(cols[powerLimitIdx]) || 6000 : 6000
      const location = locationIdx >= 0 ? cols[locationIdx] || '' : ''
      const notes = notesIdx >= 0 ? cols[notesIdx] || '' : ''

      const cabinet: ImportedCabinet = {
        id, name,
        type: normalizeType(typeRaw),
        totalU: Math.max(1, totalU),
        powerLimit: Math.max(100, powerLimit),
        location,
        notes,
        usedU: 0,
        availableU: totalU,
      }

      result.cabinets.push(cabinet)
    } catch (err) {
      result.warnings.push(`第 ${i + 1} 行解析失败: ${err}`)
    }
  }

  return result
}

/**
 * Parse cabinet list from an XLSX ArrayBuffer.
 */
export function parseCabinetXLSX(buffer: ArrayBuffer): ParseResult {
  const result: ParseResult = { cabinets: [], errors: [], warnings: [] }

  try {
    const wb = XLSX.read(buffer, { type: 'array' })
    const sheetName = wb.SheetNames[0]
    if (!sheetName) {
      result.errors.push('Excel 文件中没有工作表')
      return result
    }

    const sheet = wb.Sheets[sheetName]
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 })

    if (rows.length < 2) {
      result.errors.push('文件至少需要包含标题行和一行数据')
      return result
    }

    // Normalize headers
    const headers = (rows[0] as string[]).map(normalizeHeader)
    const idIdx = headers.findIndex((h) => h === 'id')
    const nameIdx = headers.findIndex((h) => h === 'name')
    const typeIdx = headers.findIndex((h) => h === 'type')
    const totalUIdx = headers.findIndex((h) => h === 'totalU')
    const powerLimitIdx = headers.findIndex((h) => h === 'powerLimit')
    const locationIdx = headers.findIndex((h) => h === 'location')
    const notesIdx = headers.findIndex((h) => h === 'notes')

    if (idIdx === -1 && nameIdx === -1) {
      result.errors.push('缺少必填列：机柜编号 或 机柜名称')
      return result
    }

    for (let i = 1; i < rows.length; i++) {
      const cols = rows[i] as string[]
      if (!cols || cols.every((c) => !c)) continue

      try {
        const id = idIdx >= 0 ? String(cols[idIdx] || `cab-${i}`) : `cab-${i}`
        const name = nameIdx >= 0 ? String(cols[nameIdx] || id) : id
        const typeRaw = typeIdx >= 0 ? String(cols[typeIdx] || 'custom') : 'custom'
        const totalU = totalUIdx >= 0 ? parseInt(String(cols[totalUIdx])) || 42 : 42
        const powerLimit = powerLimitIdx >= 0 ? parseInt(String(cols[powerLimitIdx])) || 6000 : 6000
        const location = locationIdx >= 0 ? String(cols[locationIdx] || '') : ''
        const notes = notesIdx >= 0 ? String(cols[notesIdx] || '') : ''

        result.cabinets.push({
          id, name,
          type: normalizeType(typeRaw),
          totalU: Math.max(1, totalU),
          powerLimit: Math.max(100, powerLimit),
          location,
          notes,
          usedU: 0,
          availableU: totalU,
        })
      } catch (err) {
        result.warnings.push(`第 ${i + 1} 行解析失败: ${err}`)
      }
    }
  } catch (err) {
    result.errors.push(`Excel 解析失败: ${err}`)
  }

  return result
}

/** Generate a CSV template string for download */
export function generateCabinetTemplateCSV(): string {
  const headers = '机柜编号,机柜名称,类型,U数,功率上限(W),位置,备注'
  const examples = [
    'A01,A01,GPU柜,49,12000,1F-A区-1排-1号,',
    'A02,A02,GPU柜,49,12000,1F-A区-1排-2号,',
    'B01,B01,存储柜,42,8000,1F-B区-1排-1号,',
    'C01,C01,网络柜,42,6000,1F-C区-1排-1号,放置Leaf/Spine',
    'D01,D01,通算柜,42,8000,1F-D区-1排-1号,',
    'E01,E01,安全柜,42,6000,1F-E区-1排-1号,防火墙等',
  ]
  return [headers, ...examples].join('\n')
}
