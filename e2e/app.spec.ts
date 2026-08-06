import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

/**
 * V3.2.1-T11-4: Electron 应用级 E2E
 * 场景：启动冒烟（窗口/渲染/活动栏）→ 设置外观切换品牌主题色（T10-1 联动验证）。
 * 前置：npm run build:renderer && npm run build:electron（生产产物）。
 */

/** 主窗口：应用先显示 splash（加载 splash.html），关闭后主窗口成为唯一窗口 */
async function openMainWindow(app: ElectronApplication): Promise<Page> {
  const first = await app.firstWindow()
  // 等待 splash 关闭；若 first 即主窗口（splash 过快消失）则超时容忍
  await first.waitForEvent('close', { timeout: 8000 }).catch(() => {})
  const main = app.windows()[0]
  return main
}

test('应用启动冒烟：主窗口渲染 + 活动栏就绪', async () => {
  const app = await electron.launch({ args: ['.'] })
  try {
    const window = await openMainWindow(app)
    await expect(window).toHaveTitle(/AutoLink/)

    // 渲染根节点挂载且有内容
    await window.waitForSelector('#root')
    await expect(window.locator('#root')).not.toBeEmpty()

    // 活动栏就绪：项目入口（Ctrl+Shift+E）可见
    await expect(window.locator('button[title*="Ctrl+Shift+E"]')).toBeVisible()
  } finally {
    await app.close()
  }
})

test('设置外观：品牌主题色切换闭环（T10-1 联动）', async () => {
  const app = await electron.launch({ args: ['.'] })
  try {
    const window = await openMainWindow(app)
    await window.waitForSelector('#root')

    // 默认主题色 sky
    await expect(window.locator('html')).toHaveAttribute('data-accent', 'sky')

    // 打开设置面板（活动栏 settings 按钮，Ctrl+,）
    await window.locator('button[title*="Ctrl+,"]').click()

    // 外观分类为默认选中：主题色块可见
    const emerald = window.locator('button[aria-label="emerald"]')
    await expect(emerald).toBeVisible()

    // 切换 emerald → html data-accent 生效
    await emerald.click()
    await expect(window.locator('html')).toHaveAttribute('data-accent', 'emerald')

    // 恢复默认 sky
    await window.locator('button[aria-label="sky"]').click()
    await expect(window.locator('html')).toHaveAttribute('data-accent', 'sky')
  } finally {
    await app.close()
  }
})
