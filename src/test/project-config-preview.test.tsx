/**
 * V3.1.3-T7-2: 需求生成预览卡片测试（解析 + 渲染 + 编辑 + 确认落盘）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@/i18n'
import { ProjectConfigPreview, parseProjectConfigBlock } from '@/components/chat/ProjectConfigPreview'
import type { GeneratedProjectPreview } from '@/components/chat/ProjectConfigPreview'

const samplePreview: GeneratedProjectPreview = {
  config: {
    meta: {
      name: 'B300集群',
      description: '',
      version: 1,
      schema_version: 2,
      created_at: '',
      updated_at: '',
    },
    networks: { param_network: true, storage_network: true, biz_network: true, oob_network: true },
    topology: {
      downlink_mode: 'custom',
      param_protocol: 'IB',
      num_gpu_servers: 1024,
      num_all_flash_storage: 8,
      num_hybrid_flash_storage: 6,
      num_compute_servers: 20,
      param_ports_per_server: 8,
      storage_ports_per_server: 1,
      param_switch_ports: 64,
      storage_switch_ports: 40,
      param_speed: '800G',
      storage_speed: '200G',
      param_downlink_limit: 25,
      storage_downlink_limit: 20,
      biz_downlink_limit: 25,
      oob_downlink_limit: 25,
    },
    device_refs: {},
    rack_config: { rack_type: 42, power_limit_per_rack: 6000, naming_prefix: '机柜' },
    scale_up: {},
  },
  annotations: {
    confidence: 0.14,
    missingFields: ['rack_config.rack_type'],
    derivedFields: ['rack_config.rack_type'],
  },
  validationIssues: [{ severity: 'warning', message: '字段完整度 14%，缺失字段为默认推导值，建议确认后再创建' }],
}

describe('parseProjectConfigBlock', () => {
  it('解析 📋 项目配置预览 的 project-config 代码块', () => {
    const content = [
      '📋 项目配置预览',
      '```project-config',
      JSON.stringify(samplePreview.config),
      '```',
      '请确认后创建。',
    ].join('\n')
    const r = parseProjectConfigBlock(content)
    expect(r).not.toBeNull()
    expect(r!.config.meta.name).toBe('B300集群')
    expect(r!.config.topology.num_gpu_servers).toBe(1024)
  })

  it('兜底解析工具执行结果 json 块（含 config + annotations）', () => {
    const content = [
      '> 工具执行结果:',
      '```json',
      JSON.stringify({ config: samplePreview.config, annotations: samplePreview.annotations }),
      '```',
      '已生成配置。',
    ].join('\n')
    const r = parseProjectConfigBlock(content)
    expect(r).not.toBeNull()
    expect(r!.annotations?.confidence).toBe(0.14)
    expect(r!.config.meta.name).toBe('B300集群')
  })

  it('无预览块时返回 null', () => {
    expect(parseProjectConfigBlock('普通回复，没有配置块')).toBeNull()
    expect(parseProjectConfigBlock('```json\n{"foo": 1}\n```')).toBeNull()
  })
})

describe('ProjectConfigPreview', () => {
  beforeEach(() => {
    ;(window as any).electron.project.createWithConfig.mockReset()
    ;(window as any).electron.project.createWithConfig.mockResolvedValue({})
    ;(window as any).electron.project.list.mockReset()
    ;(window as any).electron.project.list.mockResolvedValue([])
  })

  it('渲染项目名/置信度/缺失字段/校验提示', () => {
    render(<ProjectConfigPreview preview={samplePreview} />)
    expect(screen.getByDisplayValue('B300集群')).toBeInTheDocument()
    expect(screen.getByText('完整度 14%')).toBeInTheDocument()
    expect(screen.getByText('rack_config.rack_type')).toBeInTheDocument()
    expect(screen.getByText(/缺失字段为默认推导值/)).toBeInTheDocument()
    expect(screen.getByDisplayValue('1024')).toBeInTheDocument()
  })

  it('可编辑 GPU 服务器数量', () => {
    render(<ProjectConfigPreview preview={samplePreview} />)
    const gpuInput = screen.getByDisplayValue('1024')
    fireEvent.change(gpuInput, { target: { value: '512' } })
    expect(screen.getByDisplayValue('512')).toBeInTheDocument()
  })

  it('确认创建 → createProjectWithConfig 落盘', () => {
    render(<ProjectConfigPreview preview={samplePreview} />)
    fireEvent.click(screen.getByText('创建项目「B300集群」'))
    expect(window.electron.project.createWithConfig).toHaveBeenCalledTimes(1)
    const called = (window.electron.project.createWithConfig as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(called.meta.name).toBe('B300集群')
    expect(called.topology.num_gpu_servers).toBe(1024)
  })

  it('编辑后确认创建使用最新值', () => {
    render(<ProjectConfigPreview preview={samplePreview} />)
    fireEvent.change(screen.getByDisplayValue('1024'), { target: { value: '2048' } })
    fireEvent.click(screen.getByText('创建项目「B300集群」'))
    const called = (window.electron.project.createWithConfig as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(called.topology.num_gpu_servers).toBe(2048)
  })
})
