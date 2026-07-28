import { create } from 'zustand'

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
}

export interface TopologyNode {
  id: string
  type: string
  group: string
  podid: string
}

export interface TopologyEdge {
  source: string
  target: string
  speed: string
  cableType: string
  description: string
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
}

/* ---------- helpers ---------- */

function configToINI(config: DesignConfig): string {
  return `[DEFAULT]
downlink_mode = ${config.downlink_mode}

num_servers = ${config.num_servers}
additional_storage_servers = ${config.additional_storage_servers}
additional_compute_servers = ${config.additional_compute_servers}
param_ports_per_server = ${config.param_ports_per_server}
storage_ports_per_server = ${config.storage_ports_per_server}
param_switch_ports = ${config.param_switch_ports}
storage_switch_ports = ${config.storage_switch_ports}
param_speed = ${config.param_speed}
storage_speed = ${config.storage_speed}
param_downlink_limit = ${config.param_downlink_limit}
storage_downlink_limit = ${config.storage_downlink_limit}
biz_downlink_limit = ${config.biz_downlink_limit}
oob_downlink_limit = ${config.oob_downlink_limit}
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

interface DesignState {
  config: DesignConfig
  summary: DesignSummary | null
  valid: boolean | null
  topology: { nodes: TopologyNode[]; edges: TopologyEdge[] } | null
  generating: boolean
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
  clearResults: () => void
}

export const useDesignStore = create<DesignState>()((set, get) => ({
  config: { ...defaultDesignConfig },
  summary: null,
  valid: null,
  topology: null,
  generating: false,
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
      if (window.electron?.project?.getConfigFile) {
        const configStr = await window.electron.project.getConfigFile(projectName)
        if (configStr) {
          const config = parseINI(configStr)
          set({ config, configLoaded: true, projectName })
        } else {
          set({ config: { ...defaultDesignConfig }, configLoaded: true, projectName })
        }
      }
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
        const jsonStr = await window.electron.project.getFile(projectName, 'topology_result.json')
        if (jsonStr) {
          const data = JSON.parse(jsonStr)
          set({
            summary: data.summary ?? null,
            topology: data.topology ?? null,
            valid: data.valid ?? null,
            projectName,
          })
        }
      }
    } catch (err) {
      console.error('loadSavedTopology:', err)
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
    set({ generating: true, error: null, summary: null, topology: null, valid: null })
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
      }

      set({
        summary: result.summary ?? null,
        topology: result.topology ?? null,
        valid: result.valid ?? null,
        projectName,
      })
    } catch (err) {
      set({ error: (err as Error).message })
    } finally {
      set({ generating: false })
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
      }

      set({ valid: result.valid ?? null, projectName })
    } catch (err) {
      set({ error: (err as Error).message })
    } finally {
      set({ generating: false })
    }
  },

  clearResults: () => set({ summary: null, topology: null, valid: null, error: null }),
}))

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

  return {
    downlink_mode: (config['downlink_mode'] as 'full' | 'custom') || 'custom',
    num_servers: parseInt(config['num_servers']) || 100,
    additional_storage_servers: parseInt(config['additional_storage_servers']) || 0,
    additional_compute_servers: parseInt(config['additional_compute_servers']) || 0,
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
  }
}
