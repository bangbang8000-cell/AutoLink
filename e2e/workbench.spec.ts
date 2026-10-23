import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

/**
 * F7（5.5.x）：工作台 e2e 主链路
 * 链路：新建项目（5 步向导，仅参数网络 + 8 台 GPU 服务器）
 *       → 生成拓扑 → 打开工作台（Ctrl+Shift+W）
 *       → 步骤条三阶段可见（配置与就绪/渲染材料与操作/校对与输出）
 *       → 一键渲染 → 渲染完成 → 结果视图（材料标签 + 完整性校验徽标）
 *       → F4 工具行重构：导出下拉组/管理下拉组展开断言
 *       → F3 渲染续传：二次渲染仍完成（已完成文件跳过，流程不中断）
 * 前置：npm run build:electron（main 入口）+ npm run dev（webServer）。
 */

/** 主窗口：等待 splash 关闭、处理首启引导弹窗，并等待活动栏就绪（App 完全挂载） */
async function openMainWindow(app: ElectronApplication): Promise<Page> {
  const first = await app.firstWindow()
  await first.waitForEvent('close', { timeout: 8000 }).catch(() => {})
  // 主窗口在 splash 显示期间以 hidden 创建，ready-to-show 后才显示；
  // 用「新窗口事件」取主窗口，避免 splash 关闭时序导致拿到已关闭页面或空列表。
  let main = app.windows().find((w) => !w.isClosed())
  if (!main) {
    main = await app.waitForEvent('window', { timeout: 30_000 })
  }
  const dialog = main.locator('[role="dialog"]')
  await dialog.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {})
  await main.keyboard.press('Escape').catch(() => {})
  await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {})
  await main.locator('button[title*="Ctrl+Shift+E"]').waitFor({ state: 'visible', timeout: 60_000 })
  await main.locator('button[title*="Ctrl+Shift+E"]').click()
  await main.getByRole('button', { name: '新建项目', exact: true }).waitFor({ state: 'visible', timeout: 15_000 })
  return main
}

test('工作台主链路：步骤条 → 一键渲染 → 结果/完整性 → F4 工具行 → F3 续传', async () => {
  const app = await electron.launch({ args: ['.'] })
  try {
    const window = await openMainWindow(app)
    // 诊断：透传渲染进程 console（渲染失败原因定位）
    window.on('console', (msg) => console.log('[renderer]', msg.type(), msg.text()))
    window.on('pageerror', (err) => console.log('[pageerror]', err.message))
    await window.waitForSelector('#root')
    const projectName = `e2e-wb-${Date.now().toString(36)}`

    // ── 1. 新建项目：5 步向导（仅参数网络 + 8 台 GPU 服务器）──
    await window.getByRole('button', { name: '新建项目', exact: true }).click()
    const dialog = window.getByRole('dialog')
    await expect(dialog).toBeVisible()
    await dialog.getByPlaceholder('请输入项目名称').fill(projectName)
    await dialog.getByRole('button', { name: '下一步' }).click()
    for (const net of ['存储网络', '业务/带内管理', '带外管理']) {
      await dialog.getByText(net, { exact: true }).click()
    }
    await dialog.getByRole('button', { name: '下一步' }).click()
    await dialog.getByRole('spinbutton').fill('8')
    await dialog.getByText('GPU服务器', { exact: true }).locator('..').getByRole('button', { name: '选择设备' }).click()
    await expect(window.getByText('选择设备 - GPU服务器')).toBeVisible()
    await window.locator('div.space-y-1 > button').first().click()
    await expect(window.getByText('选择设备 - GPU服务器')).toHaveCount(0)
    await dialog.getByRole('button', { name: '下一步' }).click()
    await dialog.getByRole('button', { name: '下一步' }).click()
    await dialog.getByRole('button', { name: '创建项目' }).click()
    await expect(window.getByText('项目创建成功')).toBeVisible()

    // ── 2. 打开项目 → 生成拓扑 ──
    await window.getByText(projectName, { exact: true }).first().click()
    await expect(window.getByText(`项目概览 - ${projectName}`, { exact: true })).toBeVisible()
    await window.getByRole('button', { name: '编辑配置' }).click()
    await expect(window.getByText(`拓扑设计 — ${projectName}`)).toBeVisible()
    await window.getByRole('button', { name: '生成拓扑' }).click()
    await expect(window.getByText(`拓扑视图 - ${projectName}`, { exact: true })).toBeVisible({ timeout: 90_000 })
    const rf = window.locator('.react-flow')
    await expect(rf.locator('.react-flow__node').first()).toBeVisible({ timeout: 30_000 })

    // ── 3. 打开工作台：步骤条三阶段可见 ──
    await window.keyboard.press('Control+Shift+W')
    await expect(window.getByText('配置与就绪', { exact: true })).toBeVisible()
    await expect(window.getByText('渲染材料与操作', { exact: true })).toBeVisible()
    await expect(window.getByText('校对与输出', { exact: true })).toBeVisible()

    // ── 4. 一键渲染 → 渲染完成 → 结果视图 ──
    // 场景说明：本 e2e 项目只做组网+机柜设计，未做机房矩阵 → 取消勾选「机房布局图」，
    // 其余 8 类输出（连接/设备/布线/BOM/PDF/上机表/拓扑图/柜图）渲染全成功，批次完整性徽标 ✓完整
    await window.locator('label:has-text("机房布局图") input').uncheck()
    await window.getByRole('button', { name: '一键渲染' }).click()
    await expect(window.getByText('渲染完成').first()).toBeVisible({ timeout: 180_000 })
    await expect(window.getByText('渲染结果', { exact: true })).toBeVisible()
    await expect(window.getByText('连接关系表', { exact: true }).first()).toBeVisible({ timeout: 60_000 })
    for (const label of ['连接关系表', '拓扑图']) {
      await expect(window.getByText(label, { exact: true }).first()).toBeVisible()
    }
    // F2 完整性校验：点「预览」打开 results 子视图 → 批次完整性徽标（✓完整，title 为完整文案）
    await window.getByRole('button', { name: '预览', exact: true }).click()
    await expect(window.getByText('材料（版本批次）', { exact: true })).toBeVisible()
    await expect(window.locator('[title="产物完整性校验通过"]').first()).toBeVisible({ timeout: 20_000 })

    // ── 5. F4 工具行重构：导出下拉组 ──
    await window.locator('summary:has-text("导出")').first().click()
    await expect(window.getByText('导出机房设计 Excel', { exact: true })).toBeVisible()
    await expect(window.getByText('导出机柜设计 Excel', { exact: true })).toBeVisible()
    await expect(window.getByText('导出快照文件', { exact: true })).toBeVisible()
    await expect(window.getByText('导出评审包', { exact: true })).toBeVisible()
    await window.keyboard.press('Escape')

    // ── 6. F4 工具行重构：管理下拉组（破坏性操作置底收敛）──
    await window.locator('summary:has-text("管理")').first().click()
    await expect(window.getByText('清空项目输出', { exact: true })).toBeVisible()
    await expect(window.getByText('清空全部输出', { exact: true })).toBeVisible()
    await window.keyboard.press('Escape')

    // ── 7. F3 渲染续传：切回主视图 → 二次渲染仍完成（已完成文件跳过，不中断）──
    await window.getByRole('button', { name: '组网渲染', exact: true }).click()
    await expect(window.getByText('渲染材料与操作', { exact: true })).toBeVisible()
    await window.getByRole('button', { name: '一键渲染' }).click()
    await expect(window.getByText('渲染完成').first()).toBeVisible({ timeout: 180_000 })
    await window.getByRole('button', { name: '预览', exact: true }).click()
    await expect(window.locator('[title="产物完整性校验通过"]').first()).toBeVisible({ timeout: 20_000 })
  } finally {
    await app.close()
  }
})
