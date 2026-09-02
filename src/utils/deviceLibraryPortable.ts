/**
 * 48-c（F8-3）：设备库跨端可移植格式（MC ↔ AL 设备库互灌）
 * - buildPortableLibrary：AL 设备列表 → 可移植 JSON（format/schemaVersion/exportedAt/devices 清单）
 * - parsePortableLibrary：解析校验 → 归一化 AL LibraryDevice 列表（失败返回友好 reason）
 * - normalizeMcDevice：MC 设备库可移植格式（backend/intent/device_library.json 结构，无 category）
 *   → AL LibraryDevice（按 applicable_networks 派生 category，source=custom）
 * - MC 输入兼容：扁平数组（MC device_library.json）或 {devices: [...]} 外壳均可解析
 */
import type { LibraryDevice, NetworkType } from '@/types/device-profile'

export const DEVICE_LIBRARY_PORTABLE_FORMAT = 'autolink-device-library'
export const DEVICE_LIBRARY_PORTABLE_VERSION = 1

export interface PortableLibraryPayload {
  format: string
  schemaVersion: number
  exportedAt: string
  devices: LibraryDevice[]
}

export interface BuildPortableLibraryOptions {
  exportedAt?: Date
}

/** AL 设备列表 → 可移植文件 JSON（含 schema/版本清单） */
export function buildPortableLibrary(devices: LibraryDevice[], opts?: BuildPortableLibraryOptions): string {
  const payload: PortableLibraryPayload = {
    format: DEVICE_LIBRARY_PORTABLE_FORMAT,
    schemaVersion: DEVICE_LIBRARY_PORTABLE_VERSION,
    exportedAt: (opts?.exportedAt ?? new Date()).toISOString(),
    devices,
  }
  return JSON.stringify(payload, null, 2)
}

export type ParsePortableLibraryResult =
  | { ok: true; devices: LibraryDevice[] }
  | { ok: false; reason: string }

/** 解析跨端设备库 → 归一化 AL 设备列表（兼容 AL 可移植格式 与 MC 扁平数组） */
export function parsePortableLibrary(jsonText: string): ParsePortableLibraryResult {
  let data: unknown
  try {
    data = JSON.parse(jsonText)
  } catch {
    return { ok: false, reason: '设备库文件不是合法 JSON' }
  }
  // MC 扁平数组（backend/intent/device_library.json 结构）
  if (Array.isArray(data)) {
    if (data.length > 500) return { ok: false, reason: '设备数量超限（>500）' }
    const devices = data.map(normalizeMcDevice)
    if (devices.length === 0) return { ok: false, reason: '设备库为空' }
    return { ok: true, devices }
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, reason: '设备库文件不是有效对象' }
  }
  const d = data as Record<string, unknown>
  if (d.format !== DEVICE_LIBRARY_PORTABLE_FORMAT) {
    // 兼容：直接 {devices: [...]}（无格式标识）
    if (Array.isArray(d.devices)) {
      if (d.devices.length > 500) return { ok: false, reason: '设备数量超限（>500）' }
      const devices = d.devices.map((x) => normalizePortableDevice(x))
      if (devices.length === 0) return { ok: false, reason: '设备库为空' }
      return { ok: true, devices }
    }
    return { ok: false, reason: '设备库文件格式标识缺失/不符' }
  }
  if (d.schemaVersion !== DEVICE_LIBRARY_PORTABLE_VERSION) {
    return { ok: false, reason: `设备库文件版本不兼容（当前 v${DEVICE_LIBRARY_PORTABLE_VERSION}，文件 v${String(d.schemaVersion)}）` }
  }
  if (!Array.isArray(d.devices)) {
    return { ok: false, reason: '设备库文件缺少 devices 清单' }
  }
  if (d.devices.length === 0) return { ok: false, reason: '设备库为空' }
  const devices = d.devices.map((x) => normalizePortableDevice(x))
  return { ok: true, devices }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 归一化单条 AL 可移植设备（校验 id/vendor/model，缺省字段兜底；MC 形状无 category 时派生） */
function normalizePortableDevice(raw: unknown): LibraryDevice {
  const d = (raw ?? {}) as Record<string, unknown>
  const device = d as unknown as LibraryDevice
  const networks = Array.isArray(d.applicable_networks)
    ? (d.applicable_networks.filter(isNetworkType) as NetworkType[])
    : []
  const category = typeof d.category === 'string' && d.category
    ? String(d.category)
    : deriveCategory(networks)
  return {
    ...device,
    id: String(d.id ?? `mc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    vendor: String(d.vendor ?? ''),
    model: String(d.model ?? ''),
    category,
    tags: Array.isArray(d.tags) ? d.tags.map(String) : [],
    applicable_networks: networks,
    source: 'custom',
    verified: Boolean(d.verified),
    added_at: String(d.added_at ?? todayISO()),
    updated_at: String(d.updated_at ?? todayISO()),
    power_watts: Number(d.power_watts ?? 0),
  }
}

function isNetworkType(v: unknown): v is NetworkType {
  return v === 'param' || v === 'storage' || v === 'biz' || v === 'oob'
}

/**
 * MC 设备（backend/intent/device_library.json 结构，无 category/interface_models）→ AL LibraryDevice
 * category 由 applicable_networks 派生（param→switches_param 等），source=custom 可编辑
 */
export function normalizeMcDevice(mcDevice: unknown): LibraryDevice {
  const d = (mcDevice ?? {}) as Record<string, unknown>
  const networks = Array.isArray(d.applicable_networks)
    ? (d.applicable_networks.filter(isNetworkType) as NetworkType[])
    : []
  const category = deriveCategory(networks)
  return {
    id: String(d.id ?? `mc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    vendor: String(d.vendor ?? ''),
    model: String(d.model ?? ''),
    description: String(d.description ?? ''),
    power_watts: Number(d.power_watts ?? 0),
    weight_kg: Number(d.weight_kg ?? 0),
    u_height: Number(d.u_height ?? 1),
    depth_mm: Number(d.depth_mm ?? 0),
    cooling: 'air',
    name_prefix: String(d.vendor ?? '').toLowerCase().replace(/\s+/g, '-') || 'dev',
    port_count: Number(d.port_count ?? 0) || undefined,
    port_speed: d.port_speed != null ? String(d.port_speed) : undefined,
    port_type: d.port_type != null ? String(d.port_type) : undefined,
    category,
    tags: [String(d.model ?? ''), String(d.vendor ?? '')].filter(Boolean),
    applicable_networks: networks,
    source: 'custom',
    verified: false,
    added_at: todayISO(),
    updated_at: todayISO(),
  }
}

/** 由 applicable_networks 派生设备库分类（MC 无 category 字段时兜底） */
export function deriveCategory(networks: NetworkType[]): string {
  if (networks.includes('param')) return 'switches_param'
  if (networks.includes('storage')) return 'switches_storage'
  if (networks.includes('biz')) return 'switches_biz'
  if (networks.includes('oob')) return 'switches_oob'
  return 'custom'
}
