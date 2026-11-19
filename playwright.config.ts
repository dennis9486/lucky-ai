import { defineConfig } from '@playwright/test'

/**
 * E2E 冒烟测试配置（Electron）。
 * 前置条件：先 `pnpm build`（测试直接加载 out/main/index.js）。
 * 运行：`pnpm test:e2e`。与 vitest 完全隔离（testDir 独立，vitest 只扫 src/）。
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  // Electron 单实例（userData 相互冲突），串行执行
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    trace: 'retain-on-failure'
  }
})
