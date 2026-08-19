import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { useToastStore } from './toast.store'

/* ---------- types ---------- */

export interface DesignConfig {
  downlink_mode: 'full' | 'custom'
  num_servers: number
  additional_storage_servers: number
  additional_compute_servers: number
  param_ports_per_server: number
  storage_ports_per_server: number
  param_switch_ports: number
  storage_switch_ports: number
  param_speed: string
  storage_speed: string
  param_downlink_limit: number
  storage_downlink_limit: number
  biz_downlink_limit: number
  oob_downlink_limit: number
  oob_enabled: boolean
  biz_enabled: boolean
  /** V2.7.2: Rail-Optimized 模式 (standard | rail_optimized) */
  rail_mode: 'standard' | 'rail_optimized'
  /** V2.7.2: Rail 数量 (NVIDIA 标准 8) */
  rail_count: number
  /** V2.7.2: 参数网协议 (IB | RoCE),用于设备选型 */
  param_protocol: 'IB' | 'RoCE'
}

export interface DesignSummary {
  mode: string
  numServers: number
  totalServers: number
  paramLeafCount: number
  paramSpineCount: number
  paramCoreCount: number
  storageLeafCount: number
  storageSpineCount: number
  paramSpeed: string
  storageSpeed: string
  paramDownlink: number
  storageDownlink: number
  paramPortsPerServer?: number
}

export interface TopologyNode {
  id: string
  type: string
  group: string
  podid: string
  cabinetId?: number
  cabinetName?: string
  startU?: number
  endU?: number
  powerWatts?: number
  uHeight?: number
  /** V2.4.2: 布局层级提示 (core/spine/leaf/server/access/agg) */
  layerHint?: string
  /** V2.4.2: 最大端口数 */
  maxPorts?: number
}

export interface TopologyEdge {
  source: string
  target: string
  speed: string
  cableType: string
  description: string
  /** V2.4.2: 网络类型 (param/storage/oob/biz) */
  networkType?: string
}

/** v2.8.1-T1: 用户调整的拓扑布局(落盘到 topology.json 的 layout 字段) */
export interface TopologyLayout {
  version: number
  savedAt: string
  /** 节点 id → 画布坐标 */
  nodePositions: Record<string, { x: number; y: number }>
}

/**
 * v2.8.1-T7: 校验 layout 结构,非法/缺失返回 null(旧 schema v1 文件平滑兼容)
 */
function sanitizeLayout(raw: unknown): TopologyLayout | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (!r.nodePositions || typeof r.nodePositions !== 'object') return null
  const nodePositions: Record<string, { x: number; y: number }> = {}
  for (const [id, pos] of Object.entries(r.nodePositions as Record<string, unknown>)) {
    const p = pos as { x?: unknown; y?: unknown }
    if (p && typeof p.x === 'number' && typeof p.y === 'number') {
      nodePositions[id] = { x: p.x, y: p.y }
    }
  }
  return {
    version: typeof r.version === 'number' ? r.version : 1,
    savedAt: typeof r.savedAt === 'string' ? r.savedAt : new Date().toISOString(),
    nodePositions,
  }
}

/* ---------- V2.4 估算相关类型 ---------- */

export interface PUEEstimate {
  pue: number
  coolingPue: number
  powerDistributionPue: number
  otherPue: number
  totalPowerKw: number
  coolingPowerKw: number
  upsLossKw: number
  estimatedCoolingMethod: string
  meetsTarget: boolean
  recommendation: string
  itPowerKw: number
  serverPowerW: number
  switchPowerW: number
}

export interface ConvergenceEstimate {
  networkType: string
  downlinkBwGbps: number
  uplinkBwGbps: number
  convergenceRatio: number
  isBlocking: boolean
  targetRatio: number
  meetsTarget: boolean
  recommendation: string
}

export interface CabinetDensity {
  power_per_cabinet_w: number
  density_level: string
  recommended_cooling: string
  total_power_kw: number
  num_cabinets: number
  avg_u_height: number
}

export interface EstimateInputs {
  cooling_method: string
  outdoor_temp_c: number
  load_factor: number
  ups_efficiency: number
  has_free_cooling: boolean
}

export interface EstimationResult {
  pue: PUEEstimate
  convergence: Record<string, ConvergenceEstimate>
  cabinetDensity: CabinetDensity
  inputs: EstimateInputs
  error?: string
}

export interface EstimateParams {
  cooling_method?: 'air' | 'cold_plate' | 'immersion'
  outdoor_temp_c?: number
  load_factor?: number
  ups_efficiency?: number
  has_free_cooling?: boolean
}

/* ---------- defaults ---------- */

export const defaultDesignConfig: DesignConfig = {
  downlink_mode: 'custom',
  num_servers: 100,
  additional_storage_servers: 14,
  additional_compute_servers: 20,
  param_ports_per_server: 8,
  storage_ports_per_server: 1,
  param_switch_ports: 64,
  storage_switch_ports: 40,
  param_speed: '400G',
  storage_speed: '200G',
  param_downlink_limit: 25,
  storage_downlink_limit: 20,
  biz_downlink_limit: 25,
  oob_downlink_limit: 25,
  oob_enabled: true,
  biz_enabled: true,
  rail_mode: 'standard',
  rail_count: 8,
  param_protocol: 'RoCE',
}

/* ---------- helpers ---------- */

function configToINI(config: DesignConfig): string {
  // 打磨轮（AL-B2）：对缺失字段给兜底默认值，避免输出 "xxx = undefined" 导致后端解析失败、生成拓扑失败
  const num = (v: unknown, fb: number) => (v == null || Number.isNaN(Number(v)) ? fb : Number(v))
  const str = (v: unknown, fb: string) => (v == null ? fb : String(v))
  return `[DEFAULT]
downlink_mode = ${str(config.downlink_mode, 'custom')}

num_servers = ${num(config.num_servers, 64)}
additional_storage_servers = ${num(config.additional_storage_servers, 0)}
additional_compute_servers = ${num(config.additional_compute_servers, 0)}
param_ports_per_server = ${num(config.param_ports_per_server, 8)}
storage_ports_per_server = ${num(config.storage_ports_per_server, 1)}
param_switch_ports = ${num(config.param_switch_ports, 64)}
storage_switch_ports = ${num(config.storage_switch_ports, 40)}
param_speed = ${str(config.param_speed, '400G')}
storage_speed = ${str(config.storage_speed, '200G')}
param_downlink_limit = ${num(config.param_downlink_limit, 25)}
storage_downlink_limit = ${num(config.storage_downlink_limit, 20)}
biz_downlink_limit = ${num(config.biz_downlink_limit, 25)}
oob_downlink_limit = ${num(config.oob_downlink_limit, 25)}
rail_mode = ${str(config.rail_mode, 'none')}
rail_count = ${num(config.rail_count, 0)}
param_protocol = ${str(config.param_protocol, 'RoCE')}
cable_param_server_leaf = MPO
cable_param_leaf_spine = MPO
cable_param_spine_core = MPO
cable_storage_server_leaf = AOC
cable_storage_leaf_spine = AOC
cable_storage_spine_core = MPO
oob_enabled = ${config.oob_enabled ? 'true' : 'false'}
oob_access_ports = 48
oob_access_uplinks = 2
oob_agg_ports = 48
oob_speed = 1G
oob_uplink_speed = 10G
cable_oob_server_access = 网线
cable_oob_access_agg = 光纤
biz_enabled = ${config.biz_enabled ? 'true' : 'false'}
biz_port_speed = 25G
biz_access_ports = 48
biz_access_uplinks = 8
biz_uplink_speed = 100G
biz_agg_box_ports = 32
biz_agg_chassis_ports = 32
cable_biz_server_access = 光纤
cable_biz_access_agg = 光纤
`
}

/* ---------- store ---------- */

/** V2.4.6: 结构化校验问题 */
export interface ValidationIssue {
  rule_id: string
  severity: 'error' | 'warning' | 'info'
  category: string
  message: string
  affected_items: string[]
  recommendation: string
}

interface DesignState {
  config: DesignConfig
  summary: DesignSummary | null
  valid: boolean | null
  validationIssues: ValidationIssue[]
  topology: { nodes: TopologyNode[]; edges: TopologyEdge[] } | null
  estimation: EstimationResult | null
  // v2.8.1-T1: 已落盘到项目文件的布局(来自 topology.json 的 layout 字段)
  layout: TopologyLayout | null
  layoutSaved: boolean
  generating: boolean
  estimating: boolean
  error: string | null
  configLoaded: boolean
  projectName: string | null

  updateConfig: (partial: Partial<DesignConfig>) => void
  resetConfig: () => void
  loadConfig: (projectName: string) => Promise<void>
  loadSavedTopology: (projectName: string) => Promise<void>
  saveConfig: (projectName: string) => Promise<void>
  generate: (projectName: string) => Promise<void>
  validate: (projectName: string) => Promise<void>
  estimate: (projectName: string, params?: EstimateParams) => Promise<void>
  // v2.8.1-T2/T6: 布局落盘/清除
  saveLayout: (projectName: string, nodePositions: Record<string, { x: number; y: number }>) => Promise<void>
  clearLayout: (projectName: string) => Promise<void>
  // v2.8.2-T5/T6: 节点/链路增删与恢复(供 Delete 与撤销/重做使用)
  removeTopologyNodes: (nodeIds: string[]) => void
  restoreTopology: (nodes: TopologyNode[], edges: TopologyEdge[]) => void
  clearResults: () => void
}

export const useDesignStore = create<DesignState>()(
  persist(
    (set, get) => ({
  config: { ...defaultDesignConfig },
  summary: null,
  valid: null,
  validationIssues: [] as ValidationIssue[],
  topology: null,
  estimation: null,
  layout: null,
  layoutSaved: false,
  generating: false,
  estimating: false,
  error: null,
  configLoaded: false,
  projectName: null,

  updateConfig: (partial) =>
    set((s) => ({ config: { ...s.config, ...partial }, error: null })),

  resetConfig: () =>
    set({ config: { ...defaultDesignConfig }, error: null, configLoaded: false }),

  loadConfig: async (projectName) => {
    set({ generating: true, error: null })
    try {
      // V3.0.2-T2-2: 配置来源与后端一致 —— 优先 project_config.json(v2 完整配置,
      // 含 param_protocol/param_planes 等扩展字段),network_config.ini 仅补漏。
      // 修复:旧流程只读 INI,导致 v2 INI 的 num_gpu_servers 被 parseINI 忽略,
      // config 回落默认值(100 台/RoCE),渲染时覆盖 JSON 的正确配置。
      let iniStr = ''
      if (window.electron?.project?.getConfigFile) {
        // getConfigFile 内置 V2.7.2-T10 自动迁移(INI→JSON),先调用确保 JSON 存在
        iniStr = (await window.electron.project.getConfigFile(projectName)) ?? ''
      }
      let jsonStr = ''
      if (window.electron?.project?.getFile) {
        jsonStr = (await window.electron.project.getFile(projectName, 'project_config.json')) ?? ''
      }
      const config = buildConfigFromSources(iniStr, jsonStr)
      set({ config, configLoaded: true, projectName })
    } catch (err) {
      set({ error: `加载配置失败: ${(err as Error).message}` })
    } finally {
      set({ generating: false })
    }
  },

  loadSavedTopology: async (projectName) => {
    set({ generating: true, error: null })
    try {
      if (window.electron?.project?.getFile) {
        // T6.2: 改读 topology.json(由 generate 保存);不再读 topology_result.json
        const jsonStr = await window.electron.project.getFile(projectName, 'topology.json')
        if (jsonStr) {
          const data = JSON.parse(jsonStr)
          // v2.8.1-T7: layout 缺失/非法时回退 null(旧 schema v1 平滑兼容)
          const layout = sanitizeLayout(data.layout)
          set({
            summary: data.summary ?? null,
            topology: data.topology ?? null,
            valid: data.valid ?? null,
            validationIssues: data.validationIssues ?? [],
            estimation: data.estimation ?? null,
            layout,
            layoutSaved: layout !== null,
            projectName,
          })
        } else {
          // T6.2: 无保存的拓扑时清空 store,避免残留上一个项目的数据
          set({
            summary: null,
            topology: null,
            valid: null,
            validationIssues: [],
            estimation: null,
            layout: null,
            layoutSaved: false,
            projectName,
          })
        }
      }
    } catch (err) {
      console.error('loadSavedTopology:', err)
      // T6.2: 失败时也清空,避免残留
      set({
        summary: null,
        topology: null,
        valid: null,
        validationIssues: [],
        estimation: null,
        layout: null,
        layoutSaved: false,
      })
    } finally {
      set({ generating: false })
    }
  },

  saveConfig: async (projectName) => {
    const { config } = get()
    const ini = configToINI(config)
    if (window.electron?.project?.saveConfigFile) {
      await window.electron.project.saveConfigFile(projectName, ini)
    }
  },

  generate: async (projectName) => {
    set({ generating: true, error: null, summary: null, topology: null, valid: null, validationIssues: [], estimation: null })
    try {
      const { config } = get()
      const ini = configToINI(config)

      if (!window.electron?.design?.generate) {
        throw new Error('IPC 桥接未就绪')
      }
      const result = (await window.electron.design.generate(projectName, ini)) as {
        summary: DesignSummary
        topology: { nodes: TopologyNode[]; edges: TopologyEdge[] }
        valid: boolean
        validationIssues?: ValidationIssue[]
        estimation?: EstimationResult
      }

      // v2.8.1-T4: 重新生成时保留已保存的 layout(仅保留仍存在的节点 id,失效 id 丢弃)
      let preservedLayout = get().layout
      if (!preservedLayout) {
        try {
          const existingStr = await window.electron.project.getFile(projectName, 'topology.json')
          if (existingStr) {
            preservedLayout = sanitizeLayout(JSON.parse(existingStr).layout)
          }
        } catch { /* ignore */ }
      }
      if (preservedLayout) {
        const nodeIds = new Set((result.topology?.nodes ?? []).map((n) => n.id))
        const filtered: Record<string, { x: number; y: number }> = {}
        for (const [id, pos] of Object.entries(preservedLayout.nodePositions)) {
          if (nodeIds.has(id)) filtered[id] = pos
        }
        preservedLayout = { ...preservedLayout, nodePositions: filtered }
      }

      set({
        summary: result.summary ?? null,
        topology: result.topology ?? null,
        valid: result.valid ?? null,
        validationIssues: result.validationIssues ?? [],
        estimation: result.estimation ?? null,
        layout: preservedLayout,
        layoutSaved: preservedLayout !== null,
        projectName,
      })

      // T6.2: 生成成功后持久化到项目根目录 topology.json
      // 失败不阻塞 UI(仅 console 报错),用户已看到生成结果
      try {
        if (window.electron?.project?.saveFile) {
          const payload = {
            schema_version: 2,
            project_name: projectName,
            generated_at: new Date().toISOString(),
            config_snapshot: config,
            summary: result.summary ?? null,
            topology: result.topology ?? null,
            valid: result.valid ?? null,
            validationIssues: result.validationIssues ?? [],
            estimation: result.estimation ?? null,
            // v2.8.1-T1: 布局落盘(与 topology 一起持久化)
            layout: preservedLayout ?? null,
          }
          await window.electron.project.saveFile(projectName, 'topology.json', JSON.stringify(payload, null, 2))
        }
      } catch (saveErr) {
        console.error('[design.store] save topology.json failed:', saveErr)
        useToastStore.getState().addToast('error', '拓扑数据保存失败，请检查磁盘写入权限', 5000)
      }
    } catch (err) {
      set({ error: (err as Error).message })
    } finally {
      set({ generating: false })
    }
  },

  // v2.8.1-T2: 保存布局到项目 topology.json(localStorage 由 TopologyTab 保留为快速缓存)
  saveLayout: async (projectName, nodePositions) => {
    try {
      const existingStr = await window.electron.project.getFile(projectName, 'topology.json')
      let payload: Record<string, unknown> = {}
      if (existingStr) {
        try { payload = JSON.parse(existingStr) as Record<string, unknown> } catch { payload = {} }
      }
      const layout: TopologyLayout = { version: 1, savedAt: new Date().toISOString(), nodePositions }
      payload.schema_version = 2
      payload.layout = layout
      // v2.8.2-T10: 保存时一并持久化当前拓扑(覆盖删除节点后的 topology)
      const { topology } = get()
      if (topology) payload.topology = topology
      await window.electron.project.saveFile(projectName, 'topology.json', JSON.stringify(payload, null, 2))
      set({ layout, layoutSaved: true })
    } catch (err) {
      console.error('[design.store] saveLayout failed:', err)
      useToastStore.getState().addToast('error', '拓扑布局保存失败', 5000)
      throw err
    }
  },

  // v2.8.1-T6: 清除布局(重置为自动布局),落盘移除 layout 字段
  clearLayout: async (projectName) => {
    try {
      const existingStr = await window.electron.project.getFile(projectName, 'topology.json')
      if (existingStr) {
        const payload = JSON.parse(existingStr) as Record<string, unknown>
        payload.layout = null
        await window.electron.project.saveFile(projectName, 'topology.json', JSON.stringify(payload, null, 2))
      }
      set({ layout: null, layoutSaved: false })
    } catch (err) {
      console.error('[design.store] clearLayout failed:', err)
      useToastStore.getState().addToast('error', '拓扑布局重置失败', 5000)
      throw err
    }
  },

  // v2.8.2-T5: 删除节点及其关联链路(同步清理 edges,保持数据一致)
  removeTopologyNodes: (nodeIds) => {
    const { topology } = get()
    if (!topology || nodeIds.length === 0) return
    const idSet = new Set(nodeIds)
    const nodes = topology.nodes.filter((n) => !idSet.has(n.id))
    const edges = topology.edges.filter((e) => !idSet.has(e.source) && !idSet.has(e.target))
    set({ topology: { nodes, edges } })
  },

  // v2.8.2-T6: 恢复拓扑数据(撤销删除)
  restoreTopology: (nodes, edges) => {
    set({ topology: { nodes, edges } })
  },

  estimate: async (projectName, params) => {
    set({ estimating: true, error: null })
    try {
      if (!window.electron?.design?.estimate) {
        throw new Error('IPC 桥接未就绪')
      }
      const result = (await window.electron.design.estimate(projectName, (params || {}) as Record<string, unknown>)) as EstimationResult
      set({ estimation: result, projectName })
    } catch (err) {
      set({ error: (err as Error).message })
    } finally {
      set({ estimating: false })
    }
  },

  validate: async (projectName) => {
    set({ generating: true, error: null })
    try {
      const { config } = get()
      const ini = configToINI(config)

      if (!window.electron?.design?.validate) {
        throw new Error('IPC 桥接未就绪')
      }
      const result = (await window.electron.design.validate(projectName, ini)) as {
        valid: boolean
        validationIssues?: ValidationIssue[]
      }

      set({
        valid: result.valid ?? null,
        validationIssues: result.validationIssues ?? [],
        projectName,
      })
    } catch (err) {
      set({ error: (err as Error).message })
    } finally {
      set({ generating: false })
    }
  },

  clearResults: () => set({ summary: null, topology: null, valid: null, validationIssues: [], estimation: null, error: null }),
  }),
  {
    name: 'autolink-design-state',
    // T6.4: 移除 config/projectName 的 localStorage 持久化
    // config 由项目文件 network_config.ini 持久化;topology 由 topology.json 持久化
    // localStorage 全局持久化会导致跨项目数据污染(切换项目后看到上一个项目的配置)
    partialize: () => ({}),
  },
),
)

/* ---------- INI parser ---------- */

function parseINI(ini: string): DesignConfig {
  const config: Record<string, string> = {}
  for (const line of ini.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const val = trimmed.slice(eq + 1).trim()
    config[key] = val
  }

  // V3.0.2-T2-2: 兼容 v2 INI 字段名(createWithConfig 生成 num_gpu_servers/num_storage_servers/num_compute_servers)
  return {
    downlink_mode: (config['downlink_mode'] as 'full' | 'custom') || 'custom',
    num_servers: parseInt(config['num_servers']) || parseInt(config['num_gpu_servers']) || 100,
    additional_storage_servers: parseInt(config['additional_storage_servers']) || parseInt(config['num_storage_servers']) || 0,
    additional_compute_servers: parseInt(config['additional_compute_servers']) || parseInt(config['num_compute_servers']) || 0,
    param_ports_per_server: parseInt(config['param_ports_per_server']) || 8,
    storage_ports_per_server: parseInt(config['storage_ports_per_server']) || 1,
    param_switch_ports: parseInt(config['param_switch_ports']) || 64,
    storage_switch_ports: parseInt(config['storage_switch_ports']) || 40,
    param_speed: config['param_speed'] || '400G',
    storage_speed: config['storage_speed'] || '200G',
    param_downlink_limit: parseInt(config['param_downlink_limit']) || 25,
    storage_downlink_limit: parseInt(config['storage_downlink_limit']) || 20,
    biz_downlink_limit: parseInt(config['biz_downlink_limit']) || 25,
    oob_downlink_limit: parseInt(config['oob_downlink_limit']) || 25,
    oob_enabled: config['oob_enabled'] !== 'false',
    biz_enabled: config['biz_enabled'] !== 'false',
    rail_mode: (config['rail_mode'] as 'standard' | 'rail_optimized') || 'standard',
    rail_count: parseInt(config['rail_count']) || 8,
    param_protocol: (config['param_protocol'] as 'IB' | 'RoCE') || 'RoCE',
  }
}

/**
 * V3.0.2-T2-2: 从 project_config.json(v2,优先) + network_config.ini(v1/v2,补漏)
 * 重建前端 design config。JSON 是后端权威来源(engine._get_config_file 优先 JSON),
 * 前端 config 需与之一致,避免渲染时 INI 覆盖 JSON 的正确配置。
 */
function buildConfigFromSources(ini: string, jsonStr: string): DesignConfig {
  const iniConfig = ini ? parseINI(ini) : null
  if (!jsonStr) {
    return iniConfig ?? { ...defaultDesignConfig }
  }
  let parsed: Record<string, unknown> | null = null
  try {
    parsed = JSON.parse(jsonStr) as Record<string, unknown>
  } catch {
    return iniConfig ?? { ...defaultDesignConfig }
  }
  const topo = (parsed.topology ?? {}) as Record<string, unknown>
  const networks = (parsed.networks ?? {}) as Record<string, unknown>

  const num = (v: unknown, fallback: number): number => {
    const n = parseInt(String(v ?? ''))
    return Number.isNaN(n) ? fallback : n
  }
  // 存储: v1 拆分字段(全闪+混闪) 或 v2 单字段
  const storageCount =
    topo.num_all_flash_storage != null || topo.num_hybrid_flash_storage != null
      ? num(topo.num_all_flash_storage, 0) + num(topo.num_hybrid_flash_storage, 0)
      : num(topo.num_storage_servers, iniConfig?.additional_storage_servers ?? 0)

  const fromJson: DesignConfig = {
    downlink_mode: (topo.downlink_mode as 'full' | 'custom') || iniConfig?.downlink_mode || 'custom',
    num_servers: num(topo.num_gpu_servers, iniConfig?.num_servers ?? 100),
    additional_storage_servers: storageCount,
    additional_compute_servers: num(topo.num_compute_servers, iniConfig?.additional_compute_servers ?? 0),
    param_ports_per_server: num(topo.param_ports_per_server, iniConfig?.param_ports_per_server ?? 8),
    storage_ports_per_server: num(topo.storage_ports_per_server, iniConfig?.storage_ports_per_server ?? 1),
    param_switch_ports: num(topo.param_switch_ports, iniConfig?.param_switch_ports ?? 64),
    storage_switch_ports: num(topo.storage_switch_ports, iniConfig?.storage_switch_ports ?? 40),
    param_speed: (topo.param_speed as string) || iniConfig?.param_speed || '400G',
    storage_speed: (topo.storage_speed as string) || iniConfig?.storage_speed || '200G',
    param_downlink_limit: num(topo.param_downlink_limit, iniConfig?.param_downlink_limit ?? 25),
    storage_downlink_limit: num(topo.storage_downlink_limit, iniConfig?.storage_downlink_limit ?? 20),
    biz_downlink_limit: num(topo.biz_downlink_limit, iniConfig?.biz_downlink_limit ?? 25),
    oob_downlink_limit: num(topo.oob_downlink_limit, iniConfig?.oob_downlink_limit ?? 25),
    oob_enabled: networks.oob_network != null ? networks.oob_network !== false : (iniConfig?.oob_enabled ?? true),
    biz_enabled: networks.biz_network != null ? networks.biz_network !== false : (iniConfig?.biz_enabled ?? true),
    rail_mode: (topo.rail_mode as 'standard' | 'rail_optimized') || iniConfig?.rail_mode || 'standard',
    rail_count: num(topo.rail_count, iniConfig?.rail_count ?? 8),
    param_protocol: (topo.param_protocol as 'IB' | 'RoCE') || iniConfig?.param_protocol || 'RoCE',
  }
  return fromJson
}
