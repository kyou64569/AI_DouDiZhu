import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright E2E 配置（建议清单 #17）。
 *
 * - webServer：只起 Vite（固定 5199 端口、显式绑定 127.0.0.1，避免 localhost
 *   在 Windows 上解析到 ::1 导致探活失败）。E2E 用例的 AI 均走本地兜底策略，
 *   不产生任何 /api 调用，因此无需 Node 代理；
 * - 测试全部使用「未绑定模型的 AI」（本地兜底驱动，确定性出牌），不依赖任何真实 LLM；
 * - 仅跑 Chromium（本项目为单机工具，跨浏览器矩阵收益有限，需要时可再开 Firefox/WebKit）。
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:5199',
    locale: 'zh-CN',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npx vite --port 5199 --strictPort --host 127.0.0.1',
    url: 'http://127.0.0.1:5199',
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } },
    },
  ],
});
