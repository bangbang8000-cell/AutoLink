/**
 * 5.0.4-504-c: 设备库云同步（拉取合并 / 发布 bundle）
 * - pullCloudLibrary：GET /device-library → parsePortableLibrary 归一化 → 与本地合并（同 id 云端优先）→ 导入
 * - pushCloudLibrary：buildPortableLibrary → POST bundle（autolink-device-library v1）
 * - 状态：cloudCount / lastSyncAt / cloudSyncError / cloudSyncing
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useDeviceLibraryStore } from '@/stores/device-library.store'
import type { LibraryDevice } from '@/types/device-profile'

const dlMock = (window as any).electron.deviceLibrary
const cloudMock = (window as any).electron.cloud

function makeDevice(id: string, over: Record<string, unknown> = {}): LibraryDevice {
  return {
    id,
    vendor: 'H3C',
    model: `Model-${id}`,
    description: 'desc',
    power_watts: 800,
    weight_kg: 20,
    u_height: 2,
    depth_mm: 800,
    cooling: 'air',
    name_prefix: 'h3c',
    category: 'switches_param',
    tags: [],
    applicable_networks: ['param'],
    source: 'custom',
    verified: false,
    added_at: '2026-09-01',
    updated_at: '2026-09-01',
    ...over,
  }
}

describe('504-c 设备库云同步 store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    dlMock.list.mockResolvedValue({
      categories: [
        { id: 'switches_param', name: '参数网交换机', devices: [makeDevice('local_only')] },
      ],
    })
    dlMock.import.mockResolvedValue(undefined)
    useDeviceLibraryStore.setState({
      allDevices: [makeDevice('local_only'), makeDevice('conflict', { model: 'Local-Model' })],
      filteredDevices: [],
      cloudCount: 0,
      lastSyncAt: null,
      cloudSyncing: false,
      cloudSyncError: null,
    } as never)
  })

  it('pullCloudLibrary：云端 bundle 解析并合并（同 id 云端优先、新增补充）', async () => {
    cloudMock.deviceLibraryGet.mockResolvedValue({
      format: 'autolink-device-library',
      schemaVersion: 1,
      exportedAt: '2026-09-04T00:00:00Z',
      devices: [
        makeDevice('conflict', { model: 'Cloud-Model' }),
        makeDevice('cloud_only'),
      ],
    })
    await useDeviceLibraryStore.getState().pullCloudLibrary()
    const st = useDeviceLibraryStore.getState()
    // 合并后：local_only + conflict(云端覆盖) + cloud_only
    const byId = new Map(st.allDevices.map((d) => [d.id, d]))
    expect(byId.size).toBe(3)
    expect(byId.get('conflict')?.model).toBe('Cloud-Model')
    expect(byId.get('cloud_only')?.model).toBe('Model-cloud_only')
    expect(dlMock.import).toHaveBeenCalledTimes(1)
    expect(st.cloudCount).toBe(2)
    expect(st.lastSyncAt).toBeTruthy()
    expect(st.cloudSyncing).toBe(false)
  })

  it('pullCloudLibrary：兼容 MC 扁平数组', async () => {
    cloudMock.deviceLibraryGet.mockResolvedValue([
      { id: 'mc_dev_1', vendor: 'MC', model: 'MC-Switch', power_watts: 300, applicable_networks: ['param'], port_count: 64, port_speed: '400G' },
    ])
    await useDeviceLibraryStore.getState().pullCloudLibrary()
    const st = useDeviceLibraryStore.getState()
    const byId = new Map(st.allDevices.map((d) => [d.id, d]))
    expect(byId.get('mc_dev_1')?.vendor).toBe('MC')
    expect(st.cloudCount).toBe(1)
  })

  it('pullCloudLibrary：云端数据非法 → 设置 cloudSyncError', async () => {
    cloudMock.deviceLibraryGet.mockResolvedValue({ format: 'unknown', devices: [] })
    await useDeviceLibraryStore.getState().pullCloudLibrary()
    const st = useDeviceLibraryStore.getState()
    expect(st.cloudSyncError).toBeTruthy()
    expect(st.cloudSyncing).toBe(false)
  })

  it('pushCloudLibrary：发布 autolink-device-library v1 bundle 并更新状态', async () => {
    cloudMock.deviceLibraryPush.mockResolvedValue({ status: 'ok', count: 2 })
    await useDeviceLibraryStore.getState().pushCloudLibrary()
    expect(cloudMock.deviceLibraryPush).toHaveBeenCalledTimes(1)
    const payload = cloudMock.deviceLibraryPush.mock.calls[0][0]
    expect(payload.format).toBe('autolink-device-library')
    expect(payload.schemaVersion).toBe(1)
    expect(Array.isArray(payload.devices)).toBe(true)
    expect(payload.devices.length).toBe(2)
    const st = useDeviceLibraryStore.getState()
    expect(st.cloudCount).toBe(2)
    expect(st.lastSyncAt).toBeTruthy()
    expect(st.cloudSyncing).toBe(false)
  })

  it('pushCloudLibrary：IPC 失败 → 设置 cloudSyncError', async () => {
    cloudMock.deviceLibraryPush.mockRejectedValue(new Error('网络错误'))
    await useDeviceLibraryStore.getState().pushCloudLibrary()
    const st = useDeviceLibraryStore.getState()
    expect(st.cloudSyncError).toBe('网络错误')
    expect(st.cloudSyncing).toBe(false)
  })
})
