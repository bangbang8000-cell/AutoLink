import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

/**
 * V3.2.2-R11.4: 业务链路 E2E（建项目→渲染→导出→机房落位）
 * 链路：新建项目（5 步向导，仅参数网络 + 8 台 GPU 服务器）
 *       → 打开项目 → 生成拓扑（design:generate → Python 引擎）→ 自动开拓扑 Tab
 *       → 一键渲染（render:exportConnections 导出）→ 渲染结果断言
 *       → 机房落位（IPC 直调 room:optimize：渲染层→zod 门禁→后端优化器）
 * 前置：npm run build:electron（main 入口）+ npm run dev（webServer）。
 */

/** 主窗口：等待 splash 关闭、处理首启引导弹窗，并等待活动栏就绪（App 完全挂载） */
async function openMainWindow(app: ElectronApplication): Promise<Page> {
  const first = await app.firstWindow()
  await first.waitForEvent('close', { timeout: 8000 }).catch(() => {})
  const main = app.windows()[0]
  const dialog = main.locator('[role="dialog"]')
  await dialog.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  await main.keyboard.press('Escape').catch(() => {})
  await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  // 等待活动栏就绪（App 完成初始化），并切到项目浏览器侧栏
  // （ui.store 持久化在系统 userData，多次运行可能残留其他 activity）
  await main.locator('button[title*="Ctrl+Shift+E"]').waitFor({ state: 'visible', timeout: 30_000 })
  await main.locator('button[title*="Ctrl+Shift+E"]').click()
  await main.getByRole('button', { name: '新建项目' }).waitFor({ state: 'visible', timeout: 15_000 })
  return main
}

test('业务链路：新建项目 → 生成拓扑 → 一键渲染 → 机房落位', async () => {
  const app = await electron.launch({ args: ['.'] })
  try {
    const window = await openMainWindow(app)
    await window.waitForSelector('#root')
    const projectName = `e2e-biz-${Date.now().toString(36)}`

    // ── 1. 新建项目：5 步向导（仅保留参数网络，减少设备选择）──
    await window.getByRole('button', { name: '新建项目' }).click()
    const dialog = window.getByRole('dialog')
    await expect(dialog).toBeVisible()

    await dialog.getByPlaceholder('请输入项目名称').fill(projectName)
    await dialog.getByRole('button', { name: '下一步' }).click()

    // Step2 网络：关闭存储/业务/带外，仅保留参数网络
    for (const net of ['存储网络', '业务/带内管理', '带外管理']) {
      await dialog.getByText(net, { exact: true }).click()
    }
    await dialog.getByRole('button', { name: '下一步' }).click()

    // Step3 设备选型：GPU 服务器数量改 8，选择第一个设备
    await dialog.getByRole('spinbutton').fill('8')
    await dialog
      .getByText('GPU服务器', { exact: true })
      .locator('..')
      .getByRole('button', { name: '选择设备' })
      .click()
    // picker 是 fixed 覆盖层（无 role=dialog）；设备行按钮位于其 div.space-y-1 容器内
    await expect(window.getByText('选择设备 - GPU服务器')).toBeVisible()
    await window.locator('div.space-y-1 > button').first().click()
    await expect(window.getByText('选择设备 - GPU服务器')).toHaveCount(0)
    await dialog.getByRole('button', { name: '下一步' }).click()

    // Step4 机柜配置：默认值合法，直接下一步
    await dialog.getByRole('button', { name: '下一步' }).click()

    // Step5 确认创建
    await dialog.getByRole('button', { name: '创建项目' }).click()
    await expect(window.getByText('项目创建成功')).toBeVisible()

    // ── 2. 打开项目 → 生成拓扑（渲染）──
    await window.getByText(projectName, { exact: true }).first().click()
    await expect(window.getByText(`项目概览 - ${projectName}`, { exact: true })).toBeVisible()

    await window.getByRole('button', { name: '编辑配置' }).click()
    await expect(window.getByText(`拓扑设计 — ${projectName}`)).toBeVisible()

    await window.getByRole('button', { name: '生成拓扑' }).click()
    // 生成成功自动打开拓扑 Tab（DesignTab.handleGenerate → openTab visualization）
    await expect(window.getByText(`拓扑视图 - ${projectName}`, { exact: true })).toBeVisible({ timeout: 90_000 })
    const rf = window.locator('.react-flow')
    await expect(rf.locator('.react-flow__node').first()).toBeVisible({ timeout: 30_000 })

    // ── 3. 一键渲染（导出连接关系表/上机表/拓扑图/设备清单）──
    await window.keyboard.press('Control+Shift+W')
    await window.getByRole('button', { name: '一键渲染' }).click()
    await expect(window.getByText('渲染完成')).toBeVisible({ timeout: 120_000 })
    await expect(window.getByText('渲染结果', { exact: true })).toBeVisible()
    const editor = window.getByTestId('editor')
    for (const label of ['连接关系表', '拓扑图']) {
      await expect(editor.getByText(label, { exact: true })).toBeVisible()
    }

    // ── 4. 机房落位：IPC 直调（无 UI Tab 入口；验证渲染层→zod 门禁→后端优化器全链路）──
    const res = await window.evaluate(async () => {
      const matrix = {
        schemaVersion: 1,
        name: 'E2E机房',
        rows: ['A', 'B', 'C', 'D', 'E', 'F'],
        cols: [1, 2, 3, 4, 5, 6],
        cells: [],
      }
      return window.electron.room.optimize({
        matrix,
        counts: { gpu: 10, network: 5, storage: 5 },
        objectives: { power_balance: 1, thermal_zones: 1, network_locality: 1, shortest_cable: 1 },
      })
    })
    expect(res.success).toBe(true)
    expect(Object.keys(res.placements).length).toBe(20)
  } finally {
    await app.close()
  }
})
