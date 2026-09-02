/**
 * 48-c（F8-3）：技能库可移植 manifest（MC ↔ AL 技能互灌）
 * - buildSkillsManifest：技能清单 → 可移植 manifest JSON
 * - parseSkillsManifest：解析校验（name/content/enabled）
 * - mergeSkills：安装/合并（默认补齐缺失；overwrite 覆盖同名）
 */
import { describe, it, expect } from 'vitest'
import {
  SKILLS_MANIFEST_FORMAT,
  SKILLS_MANIFEST_VERSION,
  buildSkillsManifest,
  parseSkillsManifest,
  mergeSkills,
  type PortableSkill,
} from '@/utils/skillsPortable'

const skills: PortableSkill[] = [
  { name: 'design-and-validate', content: '# 设计校验\n...', enabled: true },
  { name: 'export-outputs', content: '# 导出输出\n...', enabled: false },
]

describe('buildSkillsManifest', () => {
  it('生成含 schema/版本清单的可移植 manifest', () => {
    const json = buildSkillsManifest(skills)
    const parsed = JSON.parse(json)
    expect(parsed.format).toBe(SKILLS_MANIFEST_FORMAT)
    expect(parsed.schemaVersion).toBe(SKILLS_MANIFEST_VERSION)
    expect(parsed.skills).toHaveLength(2)
    expect(parsed.skills[1].enabled).toBe(false)
  })
})

describe('parseSkillsManifest', () => {
  it('解析合法 manifest → 技能列表', () => {
    const r = parseSkillsManifest(buildSkillsManifest(skills))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.skills).toHaveLength(2)
  })

  it('非法 JSON / 格式不符 / 版本不符 / 空 → 失败', () => {
    expect(parseSkillsManifest('x').ok).toBe(false)
    expect(parseSkillsManifest(JSON.stringify({ format: 'other', schemaVersion: 1, skills: [] })).ok).toBe(false)
    expect(parseSkillsManifest(JSON.stringify({ format: SKILLS_MANIFEST_FORMAT, schemaVersion: 9, skills })).ok).toBe(false)
    expect(parseSkillsManifest(JSON.stringify({ format: SKILLS_MANIFEST_FORMAT, schemaVersion: 1, skills: [{ name: '', content: '' }] })).ok).toBe(false)
  })

  it('非法条目（缺 name/content）被跳过，全非法 → 失败', () => {
    const r = parseSkillsManifest(JSON.stringify({ format: SKILLS_MANIFEST_FORMAT, schemaVersion: 1, skills: [{ name: '', content: '' }, { name: 'ok', content: 'x' }] }))
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.skills).toEqual([{ name: 'ok', content: 'x', enabled: true }])
  })
})

describe('mergeSkills', () => {
  it('默认合并补齐缺失（保留目标端已有同名）', () => {
    const target: PortableSkill[] = [{ name: 'a', content: 'local-a', enabled: true }]
    const incoming: PortableSkill[] = [
      { name: 'a', content: 'pkg-a', enabled: true },
      { name: 'b', content: 'pkg-b', enabled: false },
    ]
    const r = mergeSkills(target, incoming)
    expect(r.added).toBe(1)
    expect(r.skipped).toBe(1)
    expect(r.merged.map((s) => s.name)).toEqual(['a', 'b'])
    expect(r.merged[0].content).toBe('local-a')
  })

  it('overwrite 时覆盖同名内容', () => {
    const target: PortableSkill[] = [{ name: 'a', content: 'local', enabled: true }]
    const incoming: PortableSkill[] = [{ name: 'a', content: 'pkg', enabled: true }]
    const r = mergeSkills(target, incoming, { overwrite: true })
    expect(r.added).toBe(1)
    expect(r.merged[0].content).toBe('pkg')
  })
})
