/**
 * 4.5 数据准确性与校验体系（AL 4.5.0，F5-5 前端校验 util）
 *
 * 前端校验面板的一键校验逻辑（T1 一致性 / T2 导出核对 / T3 IP 规划），
 * 输入为当前项目可得的纯数据（plan:table / designSnapshot / 输出批次），
 * 输出结构化校验报告（按严重度/类别分组），与 backend/validation_engine 问题结构对齐。
 *
 * 覆盖维度：
 *  - C001/C002 规划↔设计（服务器数 / 网络设备数）
 *  - C010-C013 设计内部（机柜 U 位冲突/越界 / 功率超限 / 未上架设备）
 *  - C020-C023 渲染一致性（批次产物结构 / 文件命名模式）
 *  - E001-E006 导出核对（批次存在 / manifest / 模式漂移 / 命名漂移）
 *  - IP001-IP003 IP 规划（掩码合法性 / 子网重叠 / 网关冲突）
 */
import type { PlanSummary } from '@/components/aidc/aidcTypes'
import type { DesignSnapshot } from '@/utils/designSnapshot'
import type { OutputBatch } from '@/types/file-tree'

export type ValidationSeverity = 'error' | 'warning' | 'info'

export interface ValidationProblem {
  ruleId: string
  severity: ValidationSeverity
  category: string
  location: string
  message: string
  suggestion: string
  data?: Record<string, unknown>
}

export interface ValidationSummary {
  valid: boolean
  total: number
  bySeverity: Record<ValidationSeverity, number>
  byCategory: Record<string, number>
}

export interface ValidationReport {
  schemaVersion: number
  generatedAt: string
  scope: {
    projectName?: string
    planHash?: string
    batchName?: string
  }
  summary: ValidationSummary
  problems: ValidationProblem[]
}

export interface ProjectValidationInput {
  projectName?: string
  /** plan:table（可选：AIDC 项目 load 返回） */
  plan?: PlanSummary | null
  /** 设计快照（serializeDesignState 产出） */
  design?: DesignSnapshot | null
  /** 输出批次（project.listOutputBatches 返回） */
  batches?: OutputBatch[] | null
}

const SEVERITIES: ValidationSeverity[] = ['error', 'warning', 'info']

function problem(
  ruleId: string,
  severity: ValidationSeverity,
  category: string,
  location: string,
  message: string,
  suggestion: string,
  data?: Record<string, unknown>,
): ValidationProblem {
  return { ruleId, severity, category, location, message, suggestion, data }
}

const toInt = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(n) : 0
}

const asList = <T>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : [])

/* ================================================================
 * T3-前置：IP 规划校验（纯函数，复用后端规则）
 * ================================================================ */

/** IPv4 网段格式校验：返回 ok 或错误原因（无 '/' 前缀视为非法） */
export function validateSubnet(subnet: unknown): { ok: boolean; reason?: string } {
  if (subnet === null || subnet === undefined || subnet === '') return { ok: false, reason: '网段为空' }
  const s = String(subnet).trim()
  if (!s.includes('/')) return { ok: false, reason: `网段缺少掩码/前缀（应为 CIDR 如 10.1.0.0/20）: ${s}` }
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/)
  if (!m) return { ok: false, reason: `网段格式非法: ${s}` }
  const octets = [1, 2, 3, 4].map((i) => Number(m[i]))
  if (octets.some((o) => o > 255)) return { ok: false, reason: `网段格式非法: ${s}` }
  const prefix = Number(m[5])
  if (prefix > 32) return { ok: false, reason: `网段格式非法: ${s}` }
  return { ok: true }
}

interface IpNet {
  text: string
  prefix: number
  network: number
  broadcast: number
}

function ipToInt(ip: string): number | null {
  const parts = ip.split('.').map(Number)
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0 || p > 255)) return null
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0
}

function parseNet(cidr: string): IpNet | null {
  const m = cidr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/)
  if (!m) return null
  const ip = ipToInt(`${m[1]}.${m[2]}.${m[3]}.${m[4]}`)
  const prefix = Number(m[5])
  if (ip === null || prefix > 32) return null
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return {
    text: cidr,
    prefix,
    network: (ip & mask) >>> 0,
    broadcast: (ip | ~mask) >>> 0,
  }
}

function netsOverlap(a: IpNet, b: IpNet): boolean {
  return a.network <= b.broadcast && b.network <= a.broadcast
}

/** IP 规划校验：掩码合法（IP001）、子网重叠（IP002）、网关冲突（IP003） */
export function checkIpPlan(plan: PlanSummary | null | undefined): ValidationProblem[] {
  const out: ValidationProblem[] = []
  if (!plan?.macro?.ipSegments) return out
  const segments = plan.macro.ipSegments
  const entries: Array<[string, IpNet | null]> = Object.entries(segments).map(([name, cidr]) => [
    name,
    parseNet(String(cidr)),
  ])

  // IP001 掩码合法性
  for (const [name, cidr] of Object.entries(segments)) {
    const check = validateSubnet(cidr)
    if (!check.ok) {
      out.push(
        problem(
          'IP001',
          'error',
          'IP规划',
          `macro.ipSegments.${name}`,
          `网段 ${name}=${cidr} 非法：${check.reason}`,
          '修正网段定义（IPv4 CIDR）',
          { segment: name, cidr: String(cidr) },
        ),
      )
    }
  }

  // IP002 子网重叠
  const validNets: Array<[string, IpNet]> = []
  for (const [name, net] of entries) {
    if (net) validNets.push([name, net])
  }
  for (let i = 0; i < validNets.length; i++) {
    for (let j = i + 1; j < validNets.length; j++) {
      const [na, a] = validNets[i]
      const [nb, b] = validNets[j]
      if (netsOverlap(a, b)) {
        out.push(
          problem(
            'IP002',
            'error',
            'IP规划',
            `ipSegments[${na}] ↔ ipSegments[${nb}]`,
            `子网重叠：${na}(${a.text}) 与 ${nb}(${b.text}) 地址区间相交`,
            '调整网段划分，避免地址冲突',
            { a: na, b: nb },
          ),
        )
      }
    }
  }

  // IP003 网关冲突（deviceList gateways → compute 段内 + 不重复）
  const gateways = asList(plan.deviceList).flatMap((d) => asList(d.gateways)).filter(Boolean)
  const seen = new Set<string>()
  for (const gw of gateways) {
    const ip = ipToInt(String(gw))
    if (ip === null) {
      out.push(
        problem('IP003', 'error', 'IP规划', `gateway.${gw}`, `网关 ${gw} 不是合法 IPv4 地址`, '修正网关地址格式', { gateway: gw }),
      )
      continue
    }
    if (seen.has(String(gw))) {
      out.push(
        problem('IP003', 'error', 'IP规划', `gateway.${gw}`, `网关重复：${gw}`, '同一网关地址应唯一', { gateway: gw }),
      )
    }
    seen.add(String(gw))
    const compute = segments.compute ?? Object.values(segments)[0]
    const net = compute ? parseNet(String(compute)) : null
    if (net && (ip < net.network || ip > net.broadcast)) {
      out.push(
        problem('IP003', 'error', 'IP规划', `gateway.${gw}`, `网关 ${gw} 不在所属网段 ${net.text} 内`, `将网关改为 ${net.text} 内地址`, { gateway: gw }),
      )
    }
  }
  return out
}

/* ================================================================
 * T1：规划 ↔ 设计 一致性
 * ================================================================ */

function designServerCount(design: DesignSnapshot): number {
  let n = 0
  for (const cab of design.cabinets) {
    n += cab.devices.filter((d) => d.type === 'server').length
  }
  n += design.unplacedDevices.filter((u) => u.type === 'server').length
  return n
}

function designNetworkCount(design: DesignSnapshot): number {
  let n = 0
  for (const cab of design.cabinets) {
    n += cab.devices.filter((d) => d.type !== 'server').length
  }
  n += design.unplacedDevices.filter((u) => u.type !== 'server').length
  return n
}

const NETWORK_ROLES = new Set([
  'SPINE', 'LEAF', 'CORE', 'STO_SPINE', 'STO_LEAF', 'BIZ_AGG', 'BIZ_ACCESS', 'OOB_AGG', 'OOB_ACCESS',
])

function planRoleCounts(plan: PlanSummary): Record<string, number> {
  const out: Record<string, number> = {}
  for (const d of asList(plan.deviceList)) {
    const role = d.role ?? d.scenario ?? ''
    if (role) out[role] = (out[role] ?? 0) + 1
  }
  return out
}

/** 规划↔设计：C001 服务器数 / C002 网络设备数 */
export function checkPlanDesignConsistency(
  plan: PlanSummary | null | undefined,
  design: DesignSnapshot | null | undefined,
): ValidationProblem[] {
  const out: ValidationProblem[] = []
  if (!plan || !design) return out

  const gpu = toInt(plan.macro.gpuCount)
  const servers = designServerCount(design)
  if (gpu > 0 && servers > 0 && gpu !== servers) {
    out.push(
      problem(
        'C001',
        'error',
        '一致性',
        'plan.macro.gpuCount ↔ design 服务器设备数',
        `规划 GPU 规模 ${gpu} 与设计服务器数 ${servers} 不一致`,
        '同步宏观参数或重新生成设计，使服务器数与规划规模一致',
        { planGpu: gpu, designServers: servers },
      ),
    )
  }

  const roles = planRoleCounts(plan)
  const planNet = Object.entries(roles)
    .filter(([r]) => NETWORK_ROLES.has(r))
    .reduce((sum, [, n]) => sum + n, 0)
  const designNet = designNetworkCount(design)
  if (planNet > 0 && designNet > 0 && planNet !== designNet) {
    out.push(
      problem(
        'C002',
        'error',
        '一致性',
        'plan.deviceList[网络角色] ↔ design 网络设备数',
        `规划网络设备数 ${planNet} 与设计网络设备数 ${designNet} 不一致`,
        '调整设计中的交换机/网络设备数量，与规划保持一致',
        { planned: planNet, designed: designNet },
      ),
    )
  }
  return out
}

/* ================================================================
 * T1：设计内部一致性
 * ================================================================ */

/** 设计内部：C010 U 位冲突 / C011 越界 / C012 功率超限 / C013 未上架 */
export function checkDesignInternalConsistency(
  design: DesignSnapshot | null | undefined,
): ValidationProblem[] {
  const out: ValidationProblem[] = []
  if (!design) return out

  // C010 U 位冲突
  for (const cab of design.cabinets) {
    const intervals = cab.devices
      .filter((d) => d.startU > 0 && d.endU >= d.startU)
      .map((d) => ({ name: d.name, s: d.startU, e: d.endU }))
    for (let i = 0; i < intervals.length; i++) {
      for (let j = i + 1; j < intervals.length; j++) {
        const a = intervals[i]
        const b = intervals[j]
        if (a.s <= b.e && b.s <= a.e) {
          out.push(
            problem(
              'C010',
              'error',
              '设计内部',
              `design.cabinets[${cab.name}].devices U位`,
              `机柜 ${cab.name} U 位冲突：${a.name}(U${a.s}-U${a.e}) 与 ${b.name}(U${b.s}-U${b.e})`,
              '调整设备 U 位分配，消除重叠',
              { cabinet: cab.name, a: a.name, b: b.name },
            ),
          )
        }
      }
    }
  }

  // C011 U 位越界
  for (const cab of design.cabinets) {
    const totalU = cab.totalU || 42
    for (const d of cab.devices) {
      if (d.endU > totalU) {
        out.push(
          problem(
            'C011',
            'error',
            '设计内部',
            `design.cabinets[${cab.name}].devices.${d.name}.endU`,
            `机柜 ${cab.name} 设备 ${d.name} U 位越界：U${d.endU} 超过机柜 ${totalU}U`,
            '降低设备安装高度或改用更大机柜',
            { cabinet: cab.name, device: d.name, endU: d.endU, totalU },
          ),
        )
      }
    }
  }

  // C012 机柜功率超限
  for (const cab of design.cabinets) {
    const totalPower = cab.devices.reduce((sum, d) => sum + (d.power_watts || 0), 0)
    if (cab.power_limit > 0 && totalPower > cab.power_limit) {
      out.push(
        problem(
          'C012',
          'error',
          '设计内部',
          `design.cabinets[${cab.name}].devices[].power_watts`,
          `机柜 ${cab.name} 功率 ${totalPower}W 超过上限 ${cab.power_limit}W`,
          '分散高功耗设备或提高机柜功率上限',
          { cabinet: cab.name, totalPower, powerLimit: cab.power_limit },
        ),
      )
    }
  }

  // C013 未上架设备
  if (design.unplacedDevices.length > 0) {
    out.push(
      problem(
        'C013',
        'warning',
        '设计内部',
        'design.unplaced_devices',
        `存在 ${design.unplacedDevices.length} 台未上架设备（如 ${design.unplacedDevices[0].name} 等）`,
        '将未上架设备分配到机柜，确保全部设备进入设计',
        { unplacedCount: design.unplacedDevices.length },
      ),
    )
  }
  return out
}

/* ================================================================
 * T2：导出核对 + 渲染一致性（批次产物）
 * ================================================================ */

/** 从批次文件名推断下行模式（AI智算网络_full模式_1.xlsx → full） */
export function inferBatchMode(files: Array<{ name: string }>): string {
  for (const f of files) {
    const m = f.name.match(/([a-z]+)模式/)
    if (m) return m[1]
  }
  return ''
}

function expectedRenderFiles(mode: string): Array<{ prefix: string; label: string }> {
  return [
    { prefix: `AI智算网络_${mode}模式`, label: '连接表' },
    { prefix: `设备清单_${mode}模式`, label: '设备清单' },
  ]
}

/** 导出核对 + 渲染一致性：E001 批次存在 / E002 manifest / C023 命名模式 / E006 命名漂移 */
export function checkRenderAndExport(
  _design: DesignSnapshot | null | undefined,
  batches: OutputBatch[] | null | undefined,
): ValidationProblem[] {
  const out: ValidationProblem[] = []
  const list = asList(batches)
  if (list.length === 0) {
    out.push(
      problem(
        'E001',
        'warning',
        '导出核对',
        'output/<batch>',
        '当前项目无输出批次，无法核对渲染产物',
        '先渲染导出，再执行导出数据核对',
      ),
    )
    return out
  }

  const batchName = list[0].name
  const files = list[0].files ?? []
  const mode = inferBatchMode(files)

  // E002 manifest 缺失提示
  if (!files.some((f) => f.name === 'manifest.json')) {
    out.push(
      problem(
        'E002',
        'warning',
        '导出核对',
        'output/<batch>/manifest.json',
        '批次缺少 manifest.json，无法核对版本/配置哈希/统计',
        '重新渲染生成带 manifest.json 的批次',
        { batch: batchName },
      ),
    )
  }

  // C023 渲染模式 vs 设计模式（design.mode 来自 config downlink_mode，此处用批次文件推断）
  if (mode) {
    for (const { prefix, label } of expectedRenderFiles(mode)) {
      const found = files.some((f) => f.name.startsWith(prefix))
      if (!found) {
        out.push(
          problem(
            'C023',
            'warning',
            '渲染',
            `output/${batchName} 文件名`,
            `批次缺少预期的${label}产物（${prefix}*.xlsx）`,
            '检查该产物是否导出成功',
            { batch: batchName, prefix },
          ),
        )
      }
    }
  }

  // E006 命名漂移：存在多个不同模式的文件（旧模式残留）
  const modes = new Set<string>()
  for (const f of files) {
    const m = f.name.match(/([a-z]+)模式/)
    if (m) modes.add(m[1])
  }
  if (modes.size > 1) {
    out.push(
      problem(
        'E006',
        'warning',
        '导出核对',
        'output/<batch> 文件名',
        `批次包含多种模式产物：${[...modes].join(', ')}`,
        '清理过期产物或重新渲染统一命名',
        { batch: batchName, modes: [...modes] },
      ),
    )
  }
  return out
}

/* ================================================================
 * 汇总与报告
 * ================================================================ */

export function summarizeProblems(problems: ValidationProblem[]): ValidationSummary {
  const bySeverity: Record<ValidationSeverity, number> = { error: 0, warning: 0, info: 0 }
  const byCategory: Record<string, number> = {}
  for (const p of problems) {
    bySeverity[p.severity] = (bySeverity[p.severity] ?? 0) + 1
    byCategory[p.category] = (byCategory[p.category] ?? 0) + 1
  }
  return {
    valid: bySeverity.error === 0,
    total: problems.length,
    bySeverity,
    byCategory,
  }
}

const sortSeverity = (a: ValidationProblem, b: ValidationProblem): number => {
  const rank: Record<ValidationSeverity, number> = { error: 0, warning: 1, info: 2 }
  return rank[a.severity] - rank[b.severity] || a.ruleId.localeCompare(b.ruleId)
}

/** 一键校验当前项目（T1-T3），返回结构化报告 */
export function validateProject(input: ProjectValidationInput): ValidationReport {
  const problems: ValidationProblem[] = [
    ...checkIpPlan(input.plan),
    ...checkPlanDesignConsistency(input.plan, input.design),
    ...checkDesignInternalConsistency(input.design),
    ...checkRenderAndExport(input.design, input.batches),
  ].sort(sortSeverity)

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: {
      projectName: input.projectName,
      planHash: input.plan?.meta?.planHash,
      batchName: asList(input.batches)[0]?.name,
    },
    summary: summarizeProblems(problems),
    problems,
  }
}

/** 校验报告序列化为 JSON 文本（供导出文件） */
export function reportToJson(report: ValidationReport): string {
  return JSON.stringify(report, null, 2)
}

/** 供 UI 分组展示的严重度/类别排序 */
export const SEVERITY_ORDER: ValidationSeverity[] = SEVERITIES
