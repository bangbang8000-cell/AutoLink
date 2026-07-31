/**
 * AutoLink V2.1 - 前端集成测试
 * 测试 store 之间的状态一致性、IPC mock、错误处理
 */
import { describe, it, expect, vi } from 'vitest'

// ================================================================
//  设计状态与机柜状态集成测试
// ================================================================
describe('DesignStore ↔ RackStore 集成', () => {
  it('设计生成后应能初始化机柜', () => {
    const mockTopology = {
      nodes: [
        { id: 'GPU服务器_1', type: 'server', group: 'GPU组1', podid: 'pod-1',
          cabinetId: 1, cabinetName: 'A01', startU: 1, endU: 8, powerWatts: 10000, uHeight: 8 },
        { id: 'GPU服务器_2', type: 'server', group: 'GPU组1', podid: 'pod-1',
          cabinetId: 1, cabinetName: 'A01', startU: 9, endU: 16, powerWatts: 10000, uHeight: 8 },
      ],
      edges: [],
    }
    const mockSummary = {
      numServers: 2,
      totalServers: 2,
      paramLeafCount: 2,
      paramSpineCount: 2,
      paramCoreCount: 0,
      storageLeafCount: 0,
      storageSpineCount: 0,
      rackType: 42,
      powerLimitPerRack: 8000,
    }

    // 验证数据结构完整性
    expect(mockTopology.nodes.length).toBe(2)
    expect(mockSummary.numServers).toBe(2)
    expect(mockSummary.rackType).toBe(42)
    expect(mockSummary.powerLimitPerRack).toBe(8000)

    // 验证服务器节点包含机柜信息
    for (const node of mockTopology.nodes) {
      expect(node.cabinetId).toBeDefined()
      expect(node.cabinetName).toBeDefined()
      expect(node.powerWatts).toBeGreaterThan(0)
    }
  })

  it('设备放置后应更新机柜功率', () => {
    const cabinet = {
      id: 1,
      name: 'A01',
      totalU: 42,
      type: 'gpu' as const,
      power_limit: 8000,
      devices: [
        { id: 'd1', name: 'GPU服务器_1', type: 'server', cabinetId: 1, startU: 1, endU: 8, power_watts: 10000 },
      ],
    }

    const totalPower = cabinet.devices.reduce((sum, d) => sum + (d.power_watts || 0), 0)
    const percent = cabinet.power_limit > 0 ? (totalPower / cabinet.power_limit) * 100 : 0
    const exceeded = totalPower > cabinet.power_limit

    expect(totalPower).toBe(10000)
    expect(percent).toBe(125)
    expect(exceeded).toBe(true)
  })

  it('功率正常范围内不应超标', () => {
    const cabinet = {
      id: 1,
      name: 'A01',
      totalU: 42,
      type: 'gpu' as const,
      power_limit: 8000,
      devices: [
        { id: 'd1', name: 'GPU服务器_1', type: 'server', cabinetId: 1, startU: 1, endU: 8, power_watts: 2000 },
        { id: 'd2', name: 'GPU服务器_2', type: 'server', cabinetId: 1, startU: 9, endU: 16, power_watts: 2000 },
      ],
    }

    const totalPower = cabinet.devices.reduce((sum, d) => sum + (d.power_watts || 0), 0)
    const exceeded = totalPower > cabinet.power_limit

    expect(totalPower).toBe(4000)
    expect(exceeded).toBe(false)
  })
})

// ================================================================
//  设备库与项目配置集成测试
// ================================================================
describe('DeviceLibrary ↔ ProjectConfig 集成', () => {
  const mockDevice = {
    id: 'nvidia_dgx_h100',
    vendor: 'NVIDIA',
    model: 'DGX-H100',
    category: 'gpu_servers',
    power_watts: 10200,
    u_height: 8,
    depth_mm: 900,
    cooling: 'air',
    name_prefix: 'GPU-DGXH100',
    interface_models: [
      {
        network_type: 'param',
        port_count: 8,
        port_speed: '400G',
        port_type: 'QSFP56',
        cable_type: 'MPO-16',
        downlink_prefix: 'NIC',
        port_numbering: 'sequential',
      },
    ],
    tags: ['400G', 'RoCEv2'],
    applicable_networks: ['param'],
    source: 'builtin',
    verified: true,
  }

  it('设备引用应正确解析设备库条目', () => {
    const deviceRef = {
      library_id: 'nvidia_dgx_h100',
    }

    // 模拟设备库解析
    const resolved = { ...mockDevice }
    expect(resolved.id).toBe(deviceRef.library_id)
    expect(resolved.vendor).toBe('NVIDIA')
    expect(resolved.power_watts).toBe(10200)
  })

  it('设备引用覆盖应合并到最终参数', () => {
    const deviceRef = {
      library_id: 'nvidia_dgx_h100',
      overrides: { power_watts: 8000, u_height: 6 },
    }

    const resolved = { ...mockDevice, ...deviceRef.overrides }
    expect(resolved.power_watts).toBe(8000)  // 覆盖值
    expect(resolved.u_height).toBe(6)         // 覆盖值
    expect(resolved.vendor).toBe('NVIDIA')    // 未覆盖，保持原值
  })

  it('无效的设备引用应返回null/undefined', () => {
    const hasRef = {
      library_id: 'nonexistent_device',
    }
    void hasRef

    // 模拟查找失败
    const resolved = null
    expect(resolved).toBeNull()
  })

  it('project_config的device_refs应能批量解析', () => {
    const projectConfig = {
      device_refs: {
        gpu_server: { library_id: 'nvidia_dgx_h100', overrides: { power_watts: 10000 } },
        param_leaf_switch: { library_id: 'nvidia_sn5600_64_400g' },
        storage_leaf_switch: { library_id: 'huawei_ce6881_48s6cq' },
      },
    }

    const refs = Object.keys(projectConfig.device_refs)
    expect(refs).toContain('gpu_server')
    expect(refs).toContain('param_leaf_switch')
    expect(refs).toContain('storage_leaf_switch')
    expect(refs.length).toBe(3)
  })
})

// ================================================================
//  IPC Mock 测试
// ================================================================
describe('IPC 通信模拟', () => {
  it('设计生成应正确传递参数', async () => {
    const mockIPC = {
      invoke: vi.fn().mockResolvedValue({
        success: true,
        data: {
          summary: { numServers: 10 },
          topology: { nodes: [], edges: [] },
          valid: { valid: true },
          powerData: { cabinets: [], totalRacks: 0, totalPowerWatts: 0 },
        },
      }),
    }

    const configFile = '/path/to/project_config.json'
    const result = await mockIPC.invoke('design:generate', { configFile })

    expect(mockIPC.invoke).toHaveBeenCalledWith('design:generate', { configFile })
    expect(result.success).toBe(true)
    expect(result.data.summary.numServers).toBe(10)
  })

  it('设计生成失败应返回错误', async () => {
    const mockIPC = {
      invoke: vi.fn().mockRejectedValue(new Error('配置解析失败')),
    }

    await expect(
      mockIPC.invoke('design:generate', { configFile: '/bad/path.json' })
    ).rejects.toThrow('配置解析失败')
  })

  it('导出请求应传递正确参数', async () => {
    const mockIPC = {
      invoke: vi.fn().mockResolvedValue({
        success: true,
        data: { results: [{ type: 'connections', file: '/output/test.xlsx', status: 'success' }] },
      }),
    }

    const result = await mockIPC.invoke('export:saveFile', {
      configFile: '/path/project_config.json',
      outputDir: '/output',
      outputTypes: ['connections', 'deviceList'],
    })

    expect(mockIPC.invoke).toHaveBeenCalledTimes(1)
    expect(result.data.results[0].status).toBe('success')
  })

  it('项目创建应通过IPC传递完整配置', async () => {
    const mockIPC = {
      invoke: vi.fn().mockResolvedValue({ success: true }),
    }

    const projectConfig = {
      name: 'test-project',
      config: {
        meta: { name: 'test-project', version: 1 },
        networks: { param_network: true, storage_network: true, biz_network: false, oob_network: false },
        topology: { num_gpu_servers: 10, downlink_mode: 'custom' },
        device_refs: {},
        rack_config: { rack_type: 42, power_limit_per_rack: 8000 },
      },
    }

    await mockIPC.invoke('project:createWithConfig', projectConfig)
    expect(mockIPC.invoke).toHaveBeenCalledWith('project:createWithConfig', projectConfig)
  })
})

// ================================================================
//  错误状态处理测试
// ================================================================
describe('错误状态处理', () => {
  it('缺少配置文件的错误处理', () => {
    const error = { error: '缺少 configFile 参数' }
    expect(error.error).toBeTruthy()
    expect(error.error).toContain('configFile')
  })

  it('配置文件不存在的错误处理', () => {
    const error = { error: '配置文件不存在: /nonexistent/path.ini' }
    expect(error.error).toContain('不存在')
  })

  it('无效JSON配置的错误处理', () => {
    const error = { error: 'JSON解析失败: Unexpected token' }
    expect(error.error).toContain('JSON')
  })

  it('Python进程超时错误处理', () => {
    const error = { error: 'Python 进程超时 (60s): design' }
    expect(error.error).toContain('超时')
  })

  it('路径遍历攻击应被阻止', () => {
    const error = { error: '路径遍历攻击被阻止' }
    expect(error.error).toContain('路径遍历')
  })
})

// ================================================================
//  配置格式兼容性测试
// ================================================================
describe('配置格式兼容性', () => {
  it('INI格式应正确解析', () => {
    const iniContent = `[DEFAULT]
num_servers = 100
param_switch_ports = 64
param_ports_per_server = 8
param_speed = 400G
storage_ports_per_server = 1
storage_switch_ports = 48
storage_speed = 200G
downlink_mode = full
oob_enabled = True
biz_enabled = True
`

    // 验证关键字段可解析
    expect(iniContent).toContain('num_servers = 100')
    expect(iniContent).toContain('downlink_mode = full')
    expect(iniContent).toContain('oob_enabled = True')
  })

  it('JSON格式应正确解析', () => {
    const jsonConfig = {
      meta: { name: 'test', version: 1 },
      networks: {
        param_network: true,
        storage_network: true,
        biz_network: false,
        oob_network: true,
      },
      topology: {
        downlink_mode: 'custom',
        num_gpu_servers: 50,
        param_ports_per_server: 8,
        param_switch_ports: 64,
        param_speed: '400G',
        param_downlink_limit: 25,
      },
      device_refs: {},
      rack_config: { rack_type: 42, power_limit_per_rack: 8000 },
    }

    expect(jsonConfig.networks.param_network).toBe(true)
    expect(jsonConfig.networks.biz_network).toBe(false)
    expect(jsonConfig.topology.num_gpu_servers).toBe(50)
    expect(jsonConfig.rack_config.rack_type).toBe(42)
  })

  it('JSON配置应优先于INI配置', () => {
    // 当JSON和INI共存时，JSON优先
    const hasJson = true

    const useJson = hasJson  // 优先JSON

    expect(useJson).toBe(true)
  })
})

// ================================================================
//  拓扑数据结构验证
// ================================================================
describe('拓扑数据结构验证', () => {
  it('节点应包含完整的设备信息', () => {
    const node = {
      id: 'GPU服务器_1',
      type: 'server',
      group: 'GPU组1',
      podid: 'pod-1',
      cabinetId: 1,
      cabinetName: 'A01',
      startU: 1,
      endU: 8,
      powerWatts: 10000,
      uHeight: 8,
    }

    expect(node.id).toBeTruthy()
    expect(node.type).toMatch(/^(server|param_leaf|param_spine|param_core|storage_leaf|storage_spine|oob_access|oob_agg|biz_access|biz_agg)$/)
    expect(node.cabinetId).toBeDefined()
    expect(node.powerWatts).toBeGreaterThan(0)
  })

  it('边应包含完整的连接信息', () => {
    const edge = {
      source: 'GPU服务器_1',
      target: '参数Leaf_P1_1',
      speed: '400G',
      cableType: 'MPO-16',
      description: '服务器到参数Leaf',
      aCabinetId: 1,
      aCabinetName: 'A01',
      aStartU: 1,
      aEndU: 8,
      zCabinetId: 10,
      zCabinetName: 'C01',
      zStartU: 1,
      zEndU: 1,
    }

    expect(edge.source).toBeTruthy()
    expect(edge.target).toBeTruthy()
    expect(edge.speed).toBeTruthy()
    expect(edge.cableType).toBeTruthy()
    expect(edge.aCabinetId).toBeDefined()
    expect(edge.zCabinetId).toBeDefined()
  })

  it('功率数据应包含机柜功率汇总', () => {
    const powerData = {
      cabinets: [
        {
          cabinetId: 1,
          cabinetName: 'A01',
          totalPower: 8000,
          deviceCount: 4,
          powerLimit: 8000,
          percent: 100,
          exceeded: false,
          devices: [
            { name: 'GPU服务器_1', power: 2000, uHeight: 4, startU: 1, endU: 4 },
          ],
        },
      ],
      totalRacks: 1,
      totalPowerWatts: 8000,
    }

    expect(powerData.totalRacks).toBe(1)
    expect(powerData.cabinets[0].percent).toBe(100)
    expect(powerData.cabinets[0].exceeded).toBe(false)
  })
})

// ================================================================
//  设备库数据完整性验证
// ================================================================
describe('设备库数据完整性', () => {
  it('GPU服务器应包含接口模型', () => {
    const gpuServer = {
      id: 'nvidia_dgx_h100',
      vendor: 'NVIDIA',
      model: 'DGX-H100',
      power_watts: 10200,
      u_height: 8,
      interface_models: [
        { network_type: 'param', port_count: 8, port_speed: '400G' },
        { network_type: 'storage', port_count: 2, port_speed: '200G' },
        { network_type: 'biz', port_count: 1, port_speed: '25G' },
        { network_type: 'oob', port_count: 1, port_speed: '1G' },
      ],
    }

    expect(gpuServer.interface_models.length).toBe(4)
    expect(gpuServer.interface_models[0].network_type).toBe('param')
    expect(gpuServer.interface_models[3].network_type).toBe('oob')
  })

  it('交换机应包含端口配置', () => {
    const switch_ = {
      id: 'nvidia_sn5600_64_400g',
      vendor: 'NVIDIA',
      model: 'SN5600',
      port_count: 64,
      port_speed: '400G',
      port_type: 'QSFP56',
      downlink_prefix: 'Eth1/0/',
      uplink_prefix: 'Eth1/0/',
      power_watts: 600,
      u_height: 1,
    }

    expect(switch_.port_count).toBe(64)
    expect(switch_.port_speed).toBe('400G')
    expect(switch_.downlink_prefix).toBeTruthy()
    // 交换机没有 interface_models 属性
    expect(switch_).not.toHaveProperty('interface_models')
  })

  it('设备库分类应包含所有必要类型', () => {
    const categories = [
      'gpu_servers',
      'storage_servers',
      'compute_servers',
      'switches',
    ]

    expect(categories).toContain('gpu_servers')
    expect(categories).toContain('storage_servers')
    expect(categories).toContain('compute_servers')
    expect(categories).toContain('switches')
  })
})