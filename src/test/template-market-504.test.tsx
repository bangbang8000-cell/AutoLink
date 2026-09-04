/**
 * 5.0.4-504-b: 模板市场协作与生态（评分星标 / 订阅数 / featured 徽标 / 订阅 / 评分）
 * - store：toggleTemplateSubscribe / rateTemplate 更新列表态
 * - 组件：精选徽标、评分+订阅数展示；订阅按钮调 IPC；星星点击评分
 */
import '@/i18n'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { useCloudStore } from '@/stores/cloud.store'
import { TemplateMarket } from '@/components/cloud/TemplateMarket'

interface CloudElectronMock {
  templateList: ReturnType<typeof vi.fn>
  templateStats: ReturnType<typeof vi.fn>
  templateSubscribe: ReturnType<typeof vi.fn>
  templateUnsubscribe: ReturnType<typeof vi.fn>
  templateRate: ReturnType<typeof vi.fn>
}

const cloudMock = (window as any).electron.cloud as CloudElectronMock

function makeTemplate(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: 'Tpl-504',
    owner: 'alice',
    full_name: 'alice/Tpl-504',
    description: '协作与生态测试模板',
    category: 'gpu',
    public: true,
    html_url: '',
    clone_url: '',
    updated_at: '2026-09-01T00:00:00Z',
    downloads: 10,
    is_favorite: false,
    my_role: 'reader',
    rating_avg: 4.3,
    rating_count: 12,
    is_subscribed: false,
    featured: true,
    subscribers_count: 3,
    ...over,
  }
}

describe('504-b 模板市场 store 订阅/评分', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCloudStore.setState({
      loggedIn: true,
      remoteTemplates: [makeTemplate()],
      templateTotal: 1,
    } as never)
  })

  it('toggleTemplateSubscribe：订阅 → is_subscribed=true（调用 subscribe）', async () => {
    cloudMock.templateSubscribe.mockResolvedValue({ subscribed: true })
    await useCloudStore.getState().toggleTemplateSubscribe('alice', 'Tpl-504', false)
    expect(cloudMock.templateSubscribe).toHaveBeenCalledWith('alice', 'Tpl-504')
    expect(useCloudStore.getState().remoteTemplates[0].is_subscribed).toBe(true)
  })

  it('toggleTemplateSubscribe：取消订阅 → is_subscribed=false（调用 unsubscribe）', async () => {
    useCloudStore.setState({
      remoteTemplates: [makeTemplate({ is_subscribed: true })],
    } as never)
    cloudMock.templateUnsubscribe.mockResolvedValue({ subscribed: false })
    await useCloudStore.getState().toggleTemplateSubscribe('alice', 'Tpl-504', true)
    expect(cloudMock.templateUnsubscribe).toHaveBeenCalledWith('alice', 'Tpl-504')
    expect(useCloudStore.getState().remoteTemplates[0].is_subscribed).toBe(false)
  })

  it('rateTemplate：评分后列表更新 rating_avg/rating_count', async () => {
    cloudMock.templateRate.mockResolvedValue({ rating_avg: 5, rating_count: 13 })
    await useCloudStore.getState().rateTemplate('alice', 'Tpl-504', 5)
    expect(cloudMock.templateRate).toHaveBeenCalledWith('alice', 'Tpl-504', 5)
    const tp = useCloudStore.getState().remoteTemplates[0]
    expect(tp.rating_avg).toBe(5)
    expect(tp.rating_count).toBe(13)
  })
})

describe('504-b 模板市场组件展示与交互', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCloudStore.setState({
      loggedIn: true,
      remoteLoading: false,
      remoteError: null,
      remoteTemplates: [makeTemplate()],
      templateTotal: 1,
      templatePage: 1,
      templateLimit: 20,
    } as never)
    cloudMock.templateList.mockResolvedValue({ templates: [makeTemplate()], total: 1, page: 1, limit: 20 })
    cloudMock.templateStats.mockResolvedValue({ downloads: 10, usages: 2 })
    cloudMock.templateSubscribe.mockResolvedValue({ subscribed: true })
    cloudMock.templateUnsubscribe.mockResolvedValue({ subscribed: false })
    cloudMock.templateRate.mockResolvedValue({ rating_avg: 5, rating_count: 13 })
  })

  it('展示评分（4.3 + (12)）、订阅数（3 订阅）与精选徽标', async () => {
    render(<TemplateMarket searchQuery="" />)
    expect(await screen.findByText('精选')).toBeInTheDocument()
    expect(screen.getByText('4.3')).toBeInTheDocument()
    expect(screen.getByText('(12)')).toBeInTheDocument()
    expect(screen.getByText('3 订阅')).toBeInTheDocument()
  })

  it('点击订阅按钮 → toggleTemplateSubscribe，订阅态翻转', async () => {
    render(<TemplateMarket searchQuery="" />)
    const subBtn = await screen.findByTitle('订阅')
    fireEvent.click(subBtn)
    await waitFor(() => {
      expect(cloudMock.templateSubscribe).toHaveBeenCalledWith('alice', 'Tpl-504')
    })
  })

  it('点击第 5 颗星 → rateTemplate 评分 5', async () => {
    render(<TemplateMarket searchQuery="" />)
    await screen.findByText('精选')
    const stars = screen.getAllByTitle('评 5 星')
    fireEvent.click(stars[0])
    await waitFor(() => {
      expect(cloudMock.templateRate).toHaveBeenCalledWith('alice', 'Tpl-504', 5)
    })
  })

  it('已订阅模板显示取消订阅（BellOff）', async () => {
    cloudMock.templateList.mockResolvedValue({
      templates: [makeTemplate({ is_subscribed: true })],
      total: 1, page: 1, limit: 20,
    })
    render(<TemplateMarket searchQuery="" />)
    expect(await screen.findByTitle('取消订阅')).toBeInTheDocument()
  })
})
