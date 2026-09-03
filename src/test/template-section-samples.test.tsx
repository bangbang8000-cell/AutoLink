import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@/i18n'
import { TemplateSection } from '@/components/layout/TemplateSection'

// 49-d（示例资产与收官）：模板中心示例摘要展示门禁
// —— 4 个 H100 示例（64/128 × IB/RoCE）以 isSample=true 高亮「示例」徽标，
//    并展示规模摘要行（GPU/存储/通算/协议·速率），锁定 49-c 前端整合。

const SAMPLE_SUMMARIES = {
  'H100-64台-IB': { numGpuServers: 64, numAllFlashStorage: 4, numHybridFlashStorage: 4, numComputeServers: 8, paramProtocol: 'IB', paramSpeed: '400G', storageSpeed: '200G', powerLimitPerRack: 12000 },
  'H100-64台-RoCE': { numGpuServers: 64, numAllFlashStorage: 4, numHybridFlashStorage: 4, numComputeServers: 8, paramProtocol: 'RoCE', paramSpeed: '400G', storageSpeed: '200G', powerLimitPerRack: 12000 },
  'H100-128台-IB': { numGpuServers: 128, numAllFlashStorage: 7, numHybridFlashStorage: 7, numComputeServers: 20, paramProtocol: 'IB', paramSpeed: '400G', storageSpeed: '200G', powerLimitPerRack: 12000 },
  'H100-128台-RoCE': { numGpuServers: 128, numAllFlashStorage: 7, numHybridFlashStorage: 7, numComputeServers: 20, paramProtocol: 'RoCE', paramSpeed: '400G', storageSpeed: '200G', powerLimitPerRack: 12000 },
}

const SAMPLES = Object.entries(SAMPLE_SUMMARIES).map(([id, summary]) => ({
  id,
  name: `${id}（示例）`,
  description: 'H100 示例项目',
  scenario: id,
  tags: ['H100', '示例项目'],
  updatedAt: '2026-09-03',
  isBuiltin: true,
  isSample: true,
  summary,
}))

const NORMAL_TEMPLATE = {
  id: 'H100-100台',
  name: 'H100-100台',
  description: '',
  scenario: 'H100-100台',
  tags: ['H100'],
  updatedAt: '2026-09-03',
  isBuiltin: true,
  summary: { numGpuServers: 100, numAllFlashStorage: 8, numHybridFlashStorage: 0, numComputeServers: 8, paramProtocol: 'RoCE', paramSpeed: '400G', storageSpeed: '200G', powerLimitPerRack: 12000 },
}

const openTab = vi.fn()
const handleOpenInExplorer = vi.fn()

beforeEach(() => {
  openTab.mockReset()
  handleOpenInExplorer.mockReset()
})

describe('TemplateSection 示例资产展示（49-c）', () => {
  it('渲染 4 个 AIDC 示例并高亮「示例」徽标', () => {
    render(
      <TemplateSection
        templates={[NORMAL_TEMPLATE, ...SAMPLES]}
        openTab={openTab}
        handleOpenInExplorer={handleOpenInExplorer}
      />,
    )
    for (const s of SAMPLES) {
      expect(screen.getByText(`${s.id}（示例）`)).toBeInTheDocument()
    }
    // 4 个示例徽标（非示例模板无）
    expect(screen.getAllByText('示例')).toHaveLength(4)
    expect(screen.getByText('H100-100台')).toBeInTheDocument()
  })

  it('展示 4 示例规模摘要（GPU/存储/通算/协议·速率）', () => {
    render(
      <TemplateSection
        templates={SAMPLES}
        openTab={openTab}
        handleOpenInExplorer={handleOpenInExplorer}
      />,
    )
    // 64 台 IB：GPU 64 · 存储 8 · 通算 8 · IB 400G
    expect(screen.getByText('GPU 64 · 存储 8 · 通算 8 · IB 400G')).toBeInTheDocument()
    // 128 台 RoCE：GPU 128 · 存储 14 · 通算 20 · RoCE 400G
    expect(screen.getByText('GPU 128 · 存储 14 · 通算 20 · RoCE 400G')).toBeInTheDocument()
    // 摘要行不出现普通模板的 100 台
    expect(screen.queryByText('GPU 100 · 存储 8 · 通算 8 · RoCE 400G')).not.toBeInTheDocument()
  })
})
