import { defineConfig } from '@playwright/test'

/**
 * V3.2.1-T11-4: Playwright E2E（Electron）
 * 应用以 dev 模式启动（webServer 拉起 vite :5174，Electron 未打包 → loadURL dev）。
 * 本地: npx playwright test
 * CI  : xvfb-run --auto-servernum npx playwright test（.github/workflows/ci.yml e2e job）
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  reporter: 'list',
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5174',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
  use: {
    trace: 'retain-on-failure',
  },
})
