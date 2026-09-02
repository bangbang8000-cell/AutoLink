/**
 * 48-c（F8-3）：技能库可移植格式（MC ↔ AL 技能互灌，与 backend 侧 manifest 契约一致）
 * - buildSkillsManifest：技能清单 → 可移植 manifest JSON（format/schemaVersion/exportedAt/skills）
 * - parseSkillsManifest：解析校验（name/content/enabled），失败返回友好 reason
 * - mergeSkills：安装/合并策略（默认补齐缺失技能；overwrite 覆盖同名内容）
 */
export const SKILLS_MANIFEST_FORMAT = 'autolink-skills'
export const SKILLS_MANIFEST_VERSION = 1

export interface PortableSkill {
  name: string
  content: string
  enabled: boolean
}

export interface SkillsManifestPayload {
  format: string
  schemaVersion: number
  exportedAt: string
  skills: PortableSkill[]
}

export interface BuildSkillsManifestOptions {
  exportedAt?: Date
}

/** 技能清单 → 可移植 manifest JSON（与 backend skills:export 的 manifest.json 契约一致） */
export function buildSkillsManifest(skills: PortableSkill[], opts?: BuildSkillsManifestOptions): string {
  const payload: SkillsManifestPayload = {
    format: SKILLS_MANIFEST_FORMAT,
    schemaVersion: SKILLS_MANIFEST_VERSION,
    exportedAt: (opts?.exportedAt ?? new Date()).toISOString(),
    skills: skills.map((s) => ({ name: String(s.name ?? ''), content: String(s.content ?? ''), enabled: Boolean(s.enabled) })),
  }
  return JSON.stringify(payload, null, 2)
}

export type ParseSkillsManifestResult =
  | { ok: true; skills: PortableSkill[] }
  | { ok: false; reason: string }

/** 解析技能 manifest → 归一化技能列表（校验 name/content，非法条目跳过） */
export function parseSkillsManifest(jsonText: string): ParseSkillsManifestResult {
  let data: unknown
  try {
    data = JSON.parse(jsonText)
  } catch {
    return { ok: false, reason: '技能清单不是合法 JSON' }
  }
  if (!data || typeof data !== 'object') {
    return { ok: false, reason: '技能清单不是有效对象' }
  }
  const d = data as Partial<SkillsManifestPayload>
  if (d.format !== SKILLS_MANIFEST_FORMAT) {
    return { ok: false, reason: '技能清单格式标识缺失/不符' }
  }
  if (d.schemaVersion !== SKILLS_MANIFEST_VERSION) {
    return { ok: false, reason: `技能清单版本不兼容（当前 v${SKILLS_MANIFEST_VERSION}，文件 v${String(d.schemaVersion)}）` }
  }
  if (!Array.isArray(d.skills)) {
    return { ok: false, reason: '技能清单缺少 skills 段' }
  }
  const skills: PortableSkill[] = []
  for (const raw of d.skills) {
    if (!raw || typeof raw !== 'object') continue
    const s = raw as unknown as Record<string, unknown>
    const name = String(s.name ?? '').trim()
    const content = String(s.content ?? '')
    if (!name || !content) continue
    skills.push({ name, content, enabled: s.enabled !== false })
  }
  if (skills.length === 0) {
    return { ok: false, reason: '技能清单为空（无合法技能）' }
  }
  return { ok: true, skills }
}

export interface MergeSkillsOptions {
  /** true=覆盖目标端同名技能；false（默认）=补齐缺失，保留目标端已有 */
  overwrite?: boolean
}

export interface MergeSkillsResult {
  merged: PortableSkill[]
  added: number
  skipped: number
}

/** 技能安装/合并：默认补齐缺失（保留目标端已有同名），overwrite 覆盖 */
export function mergeSkills(
  target: PortableSkill[],
  incoming: PortableSkill[],
  opts?: MergeSkillsOptions,
): MergeSkillsResult {
  const map = new Map<string, PortableSkill>()
  for (const s of target) {
    map.set(s.name, s)
  }
  let added = 0
  let skipped = 0
  for (const s of incoming) {
    if (!s.name || !s.content) continue
    if (map.has(s.name) && !opts?.overwrite) {
      skipped++
      continue
    }
    map.set(s.name, s)
    added++
  }
  return { merged: [...map.values()], added, skipped }
}
