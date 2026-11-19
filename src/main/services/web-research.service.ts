import { existsSync } from 'node:fs'
import { app, BrowserWindow, shell } from 'electron'
import { Configuration, PlaywrightCrawler } from 'crawlee'
import type { Page } from 'playwright'

export interface WebSearchOptions {
  query: string
  maxResults?: number
  locale?: 'auto' | 'zh' | 'en'
  timeoutMs?: number
}

export interface WebFetchOptions {
  url: string
  maxChars?: number
  timeoutMs?: number
}

export interface WebCrawlOptions {
  url: string
  maxPages?: number
  maxDepth?: number
  maxCharsPerPage?: number
  timeoutMs?: number
  sameOrigin?: boolean
}

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

export interface WebPageSnapshot {
  url: string
  title: string
  description: string
  content: string
  markdown: string
  links: Array<{ text: string; url: string }>
  status: 'ok' | 'blocked' | 'empty'
  error?: string
}

export interface WebCrawlResult {
  seedUrl: string
  pages: WebPageSnapshot[]
  skipped: Array<{ url: string; reason: string }>
}

const DEFAULT_TIMEOUT_MS = 20_000
const DEFAULT_CONTENT_CHARS = 12_000
const MAX_RESULTS = 8
const MAX_CRAWL_PAGES = 10
const MAX_CRAWL_DEPTH = 2
/** 爬取并发度：同时抓取多页，避免逐页串行等待（每页各自一个隐藏窗口/上下文）。 */
const CRAWL_CONCURRENCY = 4
const crawleeConfig = new Configuration({
  persistStorage: false,
  purgeOnStart: true,
  headless: true,
  disableBrowserSandbox: true
})

export class WebResearchService {
  async search(options: WebSearchOptions): Promise<WebSearchResult[]> {
    const query = options.query.trim()
    if (!query) throw new Error('query 不能为空')

    const maxResults = clampInt(options.maxResults, 1, MAX_RESULTS, 5)
    const locale = options.locale ?? 'auto'
    const results: WebSearchResult[] = []
    const errors: string[] = []
    for (const searchUrl of buildSearchUrls(query, locale)) {
      try {
        const batch = await runPageEvaluation(
          searchUrl,
          options.timeoutMs,
          (page) => extractSearchResults(page, maxResults),
          evaluateSearchResults,
          maxResults
        )
        results.push(...batch)
        if (dedupeResults(results).length >= maxResults) break
      } catch (error) {
        errors.push(error instanceof Error ? error.message : String(error))
      }
    }

    if (results.length === 0 && errors.length > 0) {
      throw new Error(`搜索失败: ${errors.join('；')}`)
    }

    return dedupeResults(results).slice(0, maxResults)
  }

  async fetch(options: WebFetchOptions): Promise<WebPageSnapshot> {
    const url = normalizeHttpUrl(options.url)
    const maxChars = clampInt(options.maxChars, 1_000, 30_000, DEFAULT_CONTENT_CHARS)
    const snapshot = await runPageEvaluation(
      url,
      options.timeoutMs,
      (page) => extractPageSnapshot(page, maxChars),
      evaluatePageSnapshot,
      maxChars
    )

    if (!snapshot) throw new Error(`无法读取网页: ${url}`)
    return snapshot
  }

  async crawl(options: WebCrawlOptions): Promise<WebCrawlResult> {
    const seedUrl = normalizeHttpUrl(options.url)
    const maxPages = clampInt(options.maxPages, 1, MAX_CRAWL_PAGES, 5)
    const maxDepth = clampInt(options.maxDepth, 0, MAX_CRAWL_DEPTH, 1)
    const maxCharsPerPage = clampInt(options.maxCharsPerPage, 1_000, 20_000, 8_000)
    const sameOrigin = options.sameOrigin ?? true
    const queue: Array<{ url: string; depth: number }> = [{ url: seedUrl, depth: 0 }]
    const seen = new Set<string>()
    const pages: WebPageSnapshot[] = []
    const skipped: WebCrawlResult['skipped'] = []
    const seedOrigin = new URL(seedUrl).origin
    const concurrency = Math.max(1, Math.min(CRAWL_CONCURRENCY, maxPages))

    // 抓取单页并把新发现的同源链接入队（并发安全：仅同步读写共享数组）。
    const fetchOne = async (item: { url: string; depth: number }): Promise<void> => {
      try {
        const page = await this.fetch({ url: item.url, maxChars: maxCharsPerPage, timeoutMs: options.timeoutMs })
        pages.push(page)
        if (item.depth >= maxDepth) return
        for (const link of page.links) {
          if (queue.length + pages.length >= maxPages * 3) break
          const linkKey = normalizeResultKey(link.url)
          if (seen.has(linkKey)) continue
          if (sameOrigin && new URL(link.url).origin !== seedOrigin) continue
          queue.push({ url: link.url, depth: item.depth + 1 })
        }
      } catch (error) {
        skipped.push({ url: item.url, reason: error instanceof Error ? error.message : String(error) })
      }
    }

    // 有界并发的 BFS：同时最多 concurrency 个抓取在飞；总抓取数不超过 maxPages。
    const inFlight = new Set<Promise<void>>()
    while ((queue.length > 0 || inFlight.size > 0) && pages.length < maxPages) {
      while (inFlight.size < concurrency && queue.length > 0 && pages.length + inFlight.size < maxPages) {
        const item = queue.shift()!
        const key = normalizeResultKey(item.url)
        if (seen.has(key)) continue
        seen.add(key)
        if (sameOrigin && new URL(item.url).origin !== seedOrigin) {
          skipped.push({ url: item.url, reason: 'cross-origin' })
          continue
        }
        const task = fetchOne(item).finally(() => inFlight.delete(task))
        inFlight.add(task)
      }
      if (inFlight.size > 0) await Promise.race(inFlight)
    }
    // 达到上限时可能仍有在飞任务，等它们收尾（结果已被 push，不丢弃）。
    await Promise.allSettled(inFlight)

    return { seedUrl, pages, skipped }
  }
}

async function runPageEvaluation<T, A extends unknown[]>(
  url: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  playwrightEvaluator: (page: Page) => Promise<T>,
  electronEvaluator: (...args: A) => T,
  ...args: A
): Promise<T> {
  if (process.env.LUCKY_WEB_RESEARCH_ENGINE !== 'playwright') {
    try {
      return await runElectronEvaluation(url, timeoutMs, electronEvaluator, ...args)
    } catch (error) {
      if (process.env.LUCKY_WEB_RESEARCH_ENGINE === 'electron') throw error
    }
  }

  return runPlaywrightEvaluation(url, timeoutMs, playwrightEvaluator)
}

async function runPlaywrightEvaluation<T>(
  url: string,
  timeoutMs: number,
  evaluator: (page: Page) => Promise<T>
): Promise<T> {
  let result: T | undefined
  const timeoutSecs = Math.max(5, Math.ceil(timeoutMs / 1000))
  const crawler = new PlaywrightCrawler({
    maxRequestsPerCrawl: 1,
    maxConcurrency: 1,
    maxRequestRetries: 1,
    useSessionPool: true,
    requestHandlerTimeoutSecs: timeoutSecs,
    navigationTimeoutSecs: timeoutSecs,
    launchContext: {
      launchOptions: {
        headless: true,
        executablePath: findSystemBrowserExecutable(),
        args: ['--disable-dev-shm-usage', '--no-sandbox']
      }
    },
    preNavigationHooks: [
      async ({ page }) => {
        await preparePage(page)
      }
    ],
    async requestHandler({ page }) {
      await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs }).catch(() => undefined)
      await page.waitForLoadState('networkidle', { timeout: Math.min(timeoutMs, 5_000) }).catch(() => undefined)
      result = await evaluator(page)
    },
    failedRequestHandler({ request, error }) {
      throw new Error(`网页访问失败: ${request.url} ${String(error)}`)
    }
  }, crawleeConfig)

  await crawler.run([url])
  if (result === undefined) throw new Error(`网页访问没有返回结果: ${url}`)
  return result
}

async function preparePage(page: Page): Promise<void> {
  await page.setExtraHTTPHeaders({
    'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
  }).catch(() => undefined)
  await page.route('**/*', (route) => {
    const type = route.request().resourceType()
    if (type === 'image' || type === 'media' || type === 'font') {
      void route.abort()
      return
    }
    void route.continue()
  }).catch(() => undefined)
}

async function runElectronEvaluation<T, A extends unknown[]>(
  url: string,
  timeoutMs: number,
  evaluator: (...args: A) => T,
  ...args: A
): Promise<T> {
  if (!app.isReady()) throw new Error('Electron 尚未 ready，无法创建隐藏浏览器窗口')

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      images: false
    }
  })

  win.webContents.setWindowOpenHandler(({ url: targetUrl }) => {
    try {
      void shell.openExternal(normalizeExternalUrl(targetUrl))
    } catch {
      // 屏蔽 javascript:、file: 等不安全弹窗协议
    }
    return { action: 'deny' }
  })

  try {
    await loadUrlWithTimeout(win, url, timeoutMs)
    await win.webContents.executeJavaScript('document.readyState', true).catch(() => undefined)
    const script = `(${evaluator.toString()})(...${JSON.stringify(args)})`
    return await win.webContents.executeJavaScript(script, true) as T
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}

function loadUrlWithTimeout(win: BrowserWindow, url: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error(`网页加载超时: ${url}`))
    }, timeoutMs)

    const cleanup = (): void => {
      clearTimeout(timer)
      win.webContents.off('did-finish-load', onLoaded)
      win.webContents.off('did-fail-load', onFailed)
    }

    const onLoaded = (): void => {
      cleanup()
      resolve()
    }

    const onFailed = (_event: Electron.Event, errorCode: number, errorDescription: string): void => {
      cleanup()
      reject(new Error(`网页加载失败 (${errorCode}): ${errorDescription}`))
    }

    win.webContents.once('did-finish-load', onLoaded)
    win.webContents.once('did-fail-load', onFailed)
    void win.loadURL(url).catch((error) => {
      cleanup()
      reject(error)
    })
  })
}

function findSystemBrowserExecutable(): string | undefined {
  const candidates = process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
        '/Applications/Chromium.app/Contents/MacOS/Chromium'
      ]
    : process.platform === 'win32'
      ? [
          `${process.env.PROGRAMFILES ?? 'C:\\Program Files'}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)'}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env.PROGRAMFILES ?? 'C:\\Program Files'}\\Microsoft\\Edge\\Application\\msedge.exe`
        ]
      : [
          '/usr/bin/google-chrome-stable',
          '/usr/bin/google-chrome',
          '/usr/bin/chromium-browser',
          '/usr/bin/chromium',
          '/usr/bin/microsoft-edge'
        ]

  return candidates.find((candidate) => existsSync(candidate))
}

function buildSearchUrls(query: string, locale: 'auto' | 'zh' | 'en'): string[] {
  const params = new URLSearchParams({ q: query })
  if (locale === 'zh') {
    params.set('kl', 'cn-zh')
  } else if (locale === 'en') {
    params.set('kl', 'us-en')
  }
  const liteParams = new URLSearchParams({ q: query })
  return [
    `https://duckduckgo.com/html/?${params.toString()}`,
    `https://lite.duckduckgo.com/lite/?${liteParams.toString()}`
  ]
}

async function extractSearchResults(page: Page, maxResults: number): Promise<WebSearchResult[]> {
  return page.evaluate(evaluateSearchResults, maxResults)
}

async function extractPageSnapshot(page: Page, maxChars: number): Promise<WebPageSnapshot> {
  return page.evaluate(evaluatePageSnapshot, maxChars)
}

function evaluateSearchResults(limit: number): WebSearchResult[] {
  const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>(
    'a.result__a, a[data-testid="result-title-a"], td.result-link a, a[href]'
  ))
  const results: WebSearchResult[] = []

  for (const anchor of anchors) {
    const title = cleanText(anchor.textContent ?? '')
    if (!title || title.length < 2) continue

    const href = anchor.href
    const url = normalizeDuckDuckGoRedirect(href)
    if (!url || !/^https?:\/\//i.test(url)) continue

    const container = anchor.closest('.result, article, li, div')
    const snippet = cleanText(
      container?.querySelector('.result__snippet, [data-result="snippet"], p')?.textContent
        ?? container?.textContent
        ?? ''
    ).replace(title, '').trim()

    results.push({ title, url, snippet })
    if (results.length >= limit) break
  }

  return results

  function normalizeDuckDuckGoRedirect(href: string): string {
    try {
      const parsed = new URL(href)
      const uddg = parsed.searchParams.get('uddg')
      return uddg ? decodeURIComponent(uddg) : parsed.href
    } catch {
      return ''
    }
  }

  function cleanText(text: string): string {
    return text.replace(/\s+/g, ' ').trim()
  }
}

function evaluatePageSnapshot(limit: number): WebPageSnapshot {
  const title = cleanText(document.title)
  const description = cleanText(
    document.querySelector<HTMLMetaElement>('meta[name="description"], meta[property="og:description"]')?.content ?? ''
  )

  const root = selectReadableRoot()
  const content = cleanText(root?.textContent ?? document.body?.textContent ?? '').slice(0, limit)
  const markdown = elementToMarkdown(root ?? document.body, limit)
  const links = extractReadableLinks(root ?? document.body)
  const status = detectPageStatus(content, title)

  return {
    url: location.href,
    title,
    description,
    content,
    markdown,
    links,
    status
  }

  function selectReadableRoot(): Element | null {
    const direct = document.querySelector('main, article, [role="main"], .markdown-body, .post-content, .entry-content')
    if (direct && cleanText(direct.textContent ?? '').length > 300) return direct

    const candidates = Array.from(document.body?.querySelectorAll('article, main, section, div') ?? [])
      .filter((node) => !isNoise(node))
      .map((node) => ({ node, score: scoreNode(node) }))
      .sort((a, b) => b.score - a.score)
    return candidates[0]?.score > 80 ? candidates[0].node : document.body
  }

  function scoreNode(node: Element): number {
    const text = cleanText(node.textContent ?? '')
    if (text.length < 120) return 0
    const tag = node.tagName.toLowerCase()
    const paragraphCount = node.querySelectorAll('p, li, pre, code').length
    const linkText = Array.from(node.querySelectorAll('a')).map((a) => a.textContent ?? '').join(' ')
    const linkDensity = linkText.length / Math.max(text.length, 1)
    const semanticBoost = tag === 'article' || tag === 'main' ? 220 : tag === 'section' ? 80 : 0
    return text.length * (1 - Math.min(linkDensity, 0.85)) + paragraphCount * 24 + semanticBoost
  }

  function elementToMarkdown(rootElement: Element | null, maxChars: number): string {
    if (!rootElement) return ''
    const clone = rootElement.cloneNode(true) as Element
    clone.querySelectorAll('script, style, noscript, svg, canvas, iframe, nav, aside, footer, form, button').forEach((n) => n.remove())
    const lines: string[] = []
    walk(clone, lines)
    return normalizeMarkdown(lines.join('\n')).slice(0, maxChars)
  }

  function walk(node: Node, lines: string[]): void {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = cleanText(node.textContent ?? '')
      if (text) lines.push(text)
      return
    }
    if (!(node instanceof Element) || isNoise(node)) return

    const tag = node.tagName.toLowerCase()
    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1])
      const text = cleanText(node.textContent ?? '')
      if (text) lines.push(`${'#'.repeat(level)} ${text}`)
      return
    }
    if (tag === 'p') {
      const text = inlineMarkdown(node)
      if (text) lines.push(text)
      return
    }
    if (tag === 'li') {
      const text = inlineMarkdown(node)
      if (text) lines.push(`- ${text}`)
      return
    }
    if (tag === 'pre') {
      const text = (node.textContent ?? '').trim()
      if (text) lines.push(`\`\`\`\n${text.slice(0, 4_000)}\n\`\`\``)
      return
    }
    if (tag === 'table') {
      const text = cleanText(node.textContent ?? '')
      if (text) lines.push(text)
      return
    }

    node.childNodes.forEach((child) => walk(child, lines))
  }

  function inlineMarkdown(node: Element): string {
    const clone = node.cloneNode(true) as Element
    clone.querySelectorAll('script, style, svg, button').forEach((n) => n.remove())
    clone.querySelectorAll<HTMLAnchorElement>('a[href]').forEach((anchor) => {
      const text = cleanText(anchor.textContent ?? '')
      const href = normalizeLink(anchor.href)
      anchor.replaceWith(text && href ? `[${text}](${href})` : text)
    })
    return cleanText(clone.textContent ?? '')
  }

  function extractReadableLinks(rootElement: Element | null): Array<{ text: string; url: string }> {
    const seen = new Set<string>()
    const links: Array<{ text: string; url: string }> = []
    for (const anchor of Array.from(rootElement?.querySelectorAll<HTMLAnchorElement>('a[href]') ?? [])) {
      const url = normalizeLink(anchor.href)
      const text = cleanText(anchor.textContent ?? anchor.getAttribute('aria-label') ?? '')
      if (!url || !text || seen.has(url)) continue
      seen.add(url)
      links.push({ text: text.slice(0, 120), url })
      if (links.length >= 30) break
    }
    return links
  }

  function detectPageStatus(text: string, pageTitle: string): WebPageSnapshot['status'] {
    const blockedPatterns = [
      /access denied/i,
      /captcha/i,
      /cloudflare/i,
      /checking your browser/i,
      /verify you are human/i,
      /unusual traffic/i,
      /forbidden/i,
      /too many requests/i
    ]
    const sample = `${pageTitle}\n${text.slice(0, 2_000)}`
    if (blockedPatterns.some((pattern) => pattern.test(sample))) return 'blocked'
    if (text.length < 80) return 'empty'
    return 'ok'
  }

  function normalizeLink(href: string): string {
    try {
      const parsed = new URL(href, location.href)
      if (!['http:', 'https:'].includes(parsed.protocol)) return ''
      parsed.hash = ''
      return parsed.href
    } catch {
      return ''
    }
  }

  function isNoise(node: Element): boolean {
    const raw = `${node.tagName} ${node.id} ${node.className}`.toLowerCase()
    return /\b(nav|menu|footer|sidebar|comment|cookie|modal|popup|advert|ad-|share|social|breadcrumb)\b/.test(raw)
  }

  function normalizeMarkdown(markdownText: string): string {
    return markdownText
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  }

  function cleanText(text: string): string {
    return text.replace(/\s+/g, ' ').trim()
  }
}

function normalizeHttpUrl(rawUrl: string): string {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error(`URL 无效: ${rawUrl}`)
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('仅允许访问 http/https URL')
  }

  parsed.hash = ''
  return parsed.href
}

function normalizeExternalUrl(raw: string): string {
  const parsed = new URL(raw)
  if (!['http:', 'https:', 'mailto:'].includes(parsed.protocol)) {
    throw new Error(`Blocked external URL protocol: ${parsed.protocol}`)
  }
  return parsed.href
}

function dedupeResults(results: WebSearchResult[]): WebSearchResult[] {
  const seen = new Set<string>()
  return results.filter((result) => {
    const key = normalizeResultKey(result.url)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function normalizeResultKey(url: string): string {
  try {
    const parsed = new URL(url)
    parsed.hash = ''
    parsed.searchParams.delete('utm_source')
    parsed.searchParams.delete('utm_medium')
    parsed.searchParams.delete('utm_campaign')
    parsed.searchParams.delete('utm_term')
    parsed.searchParams.delete('utm_content')
    return parsed.href
  } catch {
    return url
  }
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(Math.max(Math.trunc(value as number), min), max)
}

export const webResearchService = new WebResearchService()
