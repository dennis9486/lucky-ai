/**
 * AI 浏览器操作链路 E2E — 覆盖最复杂也最脆的一条链：
 * snapshotInteractive（注入脚本 + 元素标记 + 敏感字段遮罩）→ fillInput
 * （原生 setter + 事件派发 + 可操作性检查）→ clickElement（坐标解析 +
 * 真实输入事件）→ DOM 变化断言。
 *
 * 驱动方式：LUCKY_E2E_HOOKS=1 时主进程暴露 __luckyE2E.browserControlService，
 * app.evaluate 在主进程中创建隐藏窗口加载 data: 测试页并直接调用服务。
 * 不经过应用 UI/登录，专测主进程操作层对真实 WebContents 的行为。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication } from '@playwright/test'

const TEST_PAGE = `<!doctype html><html><body>
  <input id="name" placeholder="Your name">
  <input type="password" value="supersecret" aria-label="Password">
  <button id="go" onclick="document.getElementById('out').textContent='clicked:'+document.getElementById('name').value">Submit</button>
  <div id="out"></div>
  <a href="https://example.com/docs">Example docs</a>
</body></html>`

let app: ElectronApplication

test.beforeAll(async () => {
  app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      LUCKY_USER_DATA_DIR: mkdtempSync(join(tmpdir(), 'lucky-e2e-bc-')),
      LUCKY_E2E_HOOKS: '1'
    }
  })
  await app.firstWindow()
})

test.afterAll(async () => {
  await app?.close()
})

test('snapshot redacts password values and fill+click mutate the real DOM', async () => {
  test.setTimeout(60_000)
  const result = await app.evaluate(async ({ BrowserWindow }, page) => {
    const hooks = (globalThis as Record<string, unknown>).__luckyE2E as {
      browserControlService: {
        setActiveWebContents(id: number | null): void
        snapshotInteractive(max?: number): Promise<{ elements: Array<Record<string, unknown>> } | null>
        fillInput(id: number, value: string): Promise<{ ok: boolean; error?: string }>
        clickElement(id: number): Promise<{ ok: boolean; error?: string }>
        scrollPage(direction: 'down' | 'up' | 'top' | 'bottom'): Promise<{ ok: boolean; atBottom: boolean }>
        waitForText(text: string, timeoutMs?: number): Promise<{ found: boolean }>
      }
    }
    const service = hooks.browserControlService

    // 隐藏测试窗口：backgroundThrottling 关闭，保证可操作性检查里的 rAF 正常触发
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 700,
      webPreferences: { sandbox: true, backgroundThrottling: false }
    })
    try {
      await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(page)}`)
      service.setActiveWebContents(win.webContents.id)

      const snapshot = await service.snapshotInteractive(50)
      const elements = snapshot?.elements ?? []
      const nameInput = elements.find((el) => el.tag === 'input' && el.label === 'Your name')
      const passwordInput = elements.find((el) => el.tag === 'input' && el.type === 'password')
      const button = elements.find((el) => el.tag === 'button')
      const link = elements.find((el) => el.tag === 'a')

      const fill = nameInput ? await service.fillInput(Number(nameInput.id), 'Lucky') : { ok: false, error: 'input not found' }
      const click = button ? await service.clickElement(Number(button.id)) : { ok: false, error: 'button not found' }
      const waited = await service.waitForText('clicked:Lucky', 5000)
      const outText = await win.webContents.executeJavaScript('document.getElementById("out").textContent', false) as string
      const scroll = await service.scrollPage('bottom')

      return {
        elementCount: elements.length,
        passwordValue: passwordInput?.value ?? '(missing)',
        linkHref: link?.href ?? '(missing)',
        fill,
        click,
        waited,
        outText,
        scroll
      }
    } finally {
      service.setActiveWebContents(null)
      win.destroy()
    }
  }, TEST_PAGE)

  // 元素识别：input×2 + button + link 至少四个
  expect(result.elementCount).toBeGreaterThanOrEqual(4)
  // 凭证防护：密码值绝不进入快照
  expect(result.passwordValue).toBe('[REDACTED:sensitive-field]')
  expect(String(result.passwordValue)).not.toContain('supersecret')
  expect(result.linkHref).toContain('example.com')

  // 操作链路：填写 → 点击 → 真实 DOM 变化
  expect(result.fill.ok).toBe(true)
  expect(result.click.ok).toBe(true)
  expect(result.waited.found).toBe(true)
  expect(result.outText).toBe('clicked:Lucky')
  expect(result.scroll.ok).toBe(true)
})
