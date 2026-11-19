import type { Tool } from '@agentscope-ai/agentscope/tool'
import { securityService } from '../../services/security.service.js'
import { webResearchService } from '../../services/web-research.service.js'
import { browserNavigationService } from '../../services/browser-navigation.service.js'
import { sanitizeWebContent } from './tool-helpers.js'

/** 后台网页获取工具（Crawlee + Playwright，无可见浏览器）：搜索 / 单页读取 / 小范围爬取 */

export function createWebSearchTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'WebSearch',
    description: `Search the public web with Crawlee + Playwright and return concise structured results.
Use this when the user asks for latest/current information, docs, release notes, external websites, or anything that may have changed.
Input: { "query": string, "max_results"?: number, "locale"?: "auto" | "zh" | "en" }.
Returns JSON with title, url, and snippet. Follow up with WebFetch for pages that need closer reading.`,
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        max_results: { type: 'number', description: 'Maximum results, 1-8' },
        locale: { type: 'string', enum: ['auto', 'zh', 'en'], description: 'Search locale/language preference' }
      },
      required: ['query']
    },
    requireUserConfirm,
    async call(input: { query: string; max_results?: number; locale?: 'auto' | 'zh' | 'en' }): Promise<string> {
      securityService.assertAgentToolAllowed('WebSearch', input as Record<string, unknown>)
      const results = await webResearchService.search({
        query: String(input.query ?? ''),
        maxResults: input.max_results,
        locale: input.locale ?? 'auto'
      })
      return sanitizeWebContent(JSON.stringify({ query: input.query, results }, null, 2))
    }
  }
}

export function createWebFetchTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'WebFetch',
    description: `Open a specific http/https URL with Crawlee + Playwright and extract readable page text, markdown, metadata, links, and access status.
Use this after WebSearch, or when the user provides a URL. Do not use it for local files or private credentials.
Set open_in_app=true to also open the URL in the user's embedded browser tab (Playwright fetch still runs for structured content).
Input: { "url": string, "max_chars"?: number, "open_in_app"?: boolean }.`,
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http/https URL to read' },
        max_chars: { type: 'number', description: 'Maximum extracted text characters, 1000-30000' },
        open_in_app: { type: 'boolean', description: 'Also open this URL in the embedded browser UI' }
      },
      required: ['url']
    },
    requireUserConfirm,
    async call(input: { url: string; max_chars?: number; open_in_app?: boolean }): Promise<string> {
      securityService.assertAgentToolAllowed('WebFetch', input as Record<string, unknown>)
      let openedInApp: string | undefined
      if (input.open_in_app) {
        openedInApp = browserNavigationService.openUrl(String(input.url ?? ''))
      }
      const page = await webResearchService.fetch({
        url: String(input.url ?? ''),
        maxChars: input.max_chars
      })
      return sanitizeWebContent(JSON.stringify(openedInApp ? { ...page, opened_in_app: openedInApp } : page, null, 2))
    }
  }
}

export function createWebCrawlTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'WebCrawl',
    description: `Crawl a small public website area with Crawlee + Playwright, then return AI-readable snapshots for each page.
Use this when one page is not enough, such as docs sections, product pages, or source pages linked from an index.
It is intentionally bounded for safety and speed.
Input: { "url": string, "max_pages"?: number, "max_depth"?: number, "max_chars_per_page"?: number, "same_origin"?: boolean }.
Defaults: same_origin=true, max_pages=5, max_depth=1. Prefer WebSearch first for open web discovery.`,
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Seed http/https URL' },
        max_pages: { type: 'number', description: 'Maximum pages to crawl, 1-10' },
        max_depth: { type: 'number', description: 'Link depth from seed, 0-2' },
        max_chars_per_page: { type: 'number', description: 'Maximum extracted characters per page, 1000-20000' },
        same_origin: { type: 'boolean', description: 'Restrict crawl to the seed URL origin' }
      },
      required: ['url']
    },
    requireUserConfirm,
    async call(input: {
      url: string
      max_pages?: number
      max_depth?: number
      max_chars_per_page?: number
      same_origin?: boolean
    }): Promise<string> {
      securityService.assertAgentToolAllowed('WebCrawl', input as Record<string, unknown>)
      const crawl = await webResearchService.crawl({
        url: String(input.url ?? ''),
        maxPages: input.max_pages,
        maxDepth: input.max_depth,
        maxCharsPerPage: input.max_chars_per_page,
        sameOrigin: input.same_origin
      })
      return sanitizeWebContent(JSON.stringify(crawl, null, 2))
    }
  }
}
