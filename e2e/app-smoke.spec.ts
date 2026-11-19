/**
 * Electron 应用冒烟测试。
 *
 * 覆盖最脆的集成面：main 进程启动（DB 迁移/IPC 注册）→ 窗口创建 →
 * preload 桥注入 → renderer 挂载。任何一环崩掉都会在这里露出来。
 *
 * 前置：`pnpm build`（加载 out/main/index.js）。userData 指向临时目录，
 * 不触碰真实用户数据。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

let app: ElectronApplication
let window: Page
const pageErrors: string[] = []

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      LUCKY_USER_DATA_DIR: mkdtempSync(join(tmpdir(), 'lucky-e2e-'))
    }
  })
  window = await app.firstWindow()
  window.on('pageerror', (error) => pageErrors.push(String(error)))
  await window.waitForLoadState('domcontentloaded')
})

test.afterAll(async () => {
  await app?.close()
})

test('window boots and renderer mounts', async () => {
  // 主进程存活且非崩溃退出
  expect(app.process().killed).toBe(false)

  // Vue 应用真实挂载（#app 有子元素，而非白屏）
  await window.waitForSelector('#app *', { timeout: 20_000 })
  const childCount = await window.locator('#app > *').count()
  expect(childCount).toBeGreaterThan(0)
})

test('preload bridge is exposed to the renderer', async () => {
  const bridge = await window.evaluate(() => {
    const api = (window as unknown as { luckyAI?: Record<string, unknown> }).luckyAI
    if (!api) return null
    return {
      hasWorkspace: typeof api.workspace === 'object',
      hasAgent: typeof api.agent === 'object',
      hasSettings: typeof api.settings === 'object'
    }
  })
  expect(bridge).not.toBeNull()
  expect(bridge?.hasWorkspace).toBe(true)
  expect(bridge?.hasAgent).toBe(true)
})

test('settings roundtrip works through real IPC', async () => {
  const settings = await window.evaluate(async () => {
    const api = (window as unknown as {
      luckyAI: { settings: { get: () => Promise<{ success: boolean; data?: { providers?: unknown[] } }> } }
    }).luckyAI
    return api.settings.get()
  })
  expect(settings.success).toBe(true)
  expect(Array.isArray(settings.data?.providers)).toBe(true)
})

test('no renderer page errors during boot', async () => {
  // 留出一拍让异步初始化的报错冒出来
  await window.waitForTimeout(1000)
  expect(pageErrors).toEqual([])
})
