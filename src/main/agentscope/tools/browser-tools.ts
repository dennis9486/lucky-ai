import type { Tool, Toolkit } from '@agentscope-ai/agentscope/tool'
import { securityService } from '../../services/security.service.js'
import { sitePermissionService } from '../../services/site-permission.service.js'
import { browserControlService } from '../../services/browser-control.service.js'
import { createSandboxToolResponse, sanitizeWebContent } from './tool-helpers.js'

/** 内嵌浏览器（用户可见 webview）的观察 / 交互工具群与站点授权防护 */

/** 会对页面产生动作的浏览器工具（站点级 AI 操作授权的管控对象） */
const BROWSER_ACTION_TOOLS = new Set(['ClickBrowserElement', 'FillBrowserInput', 'PressBrowserKey'])

/**
 * 站点级 AI 操作授权的动态确认判定（AOP 打在 toolkit.requireUserConfirm 上）：
 * 活动页面 origin 被用户设为 'auto' 时跳过逐次确认。注意确认判定只能看到
 * 活动标签——带 tab_id 的跨标签操作由 checkAgentSitePolicy 在调用期补防。
 */
export function patchBrowserActionConfirm(toolkit: Toolkit, globallyRequiresConfirm: boolean): void {
  if (!globallyRequiresConfirm) return
  const original = toolkit.requireUserConfirm.bind(toolkit)
  toolkit.requireUserConfirm = (toolName: string) => {
    const base = original(toolName)
    if (!base || !BROWSER_ACTION_TOOLS.has(toolName)) return base
    const origin = browserControlService.getOriginForTab()
    return sitePermissionService.getAgentPolicy(origin) === 'auto' ? false : base
  }
}

/**
 * 调用期站点授权检查（Click/Fill/PressKey 执行前）：
 * - 'block'：该站点被用户禁止 AI 操作，硬拒。
 * - tab_id 跨域防护：确认弹窗的跳过判定基于活动标签；若目标是另一个
 *   origin 且其策略不是 'auto'，而活动页是 'auto'（确认已被跳过），
 *   则拒绝——否则等于借活动页的授权对其它站点静默操作。
 * 返回错误消息；null 表示放行。
 */
function checkAgentSitePolicy(tabId: string | undefined, globallyRequiresConfirm: boolean): string | null {
  const targetOrigin = browserControlService.getOriginForTab(tabId)
  const targetPolicy = sitePermissionService.getAgentPolicy(targetOrigin)
  if (targetPolicy === 'block') {
    return `站点 ${targetOrigin || '(未知)'} 已被用户设置为禁止 AI 操作（可在浏览器设置的站点授权中修改）`
  }
  if (!tabId || !globallyRequiresConfirm) return null
  const activeOrigin = browserControlService.getOriginForTab()
  if (
    targetOrigin !== activeOrigin
    && targetPolicy !== 'auto'
    && sitePermissionService.getAgentPolicy(activeOrigin) === 'auto'
  ) {
    return `目标标签页属于 ${targetOrigin || '(未知站点)'}，该站点需要逐次确认：请让用户切换到该标签页后再操作，或请用户将其设为允许自动操作`
  }
  return null
}

export function createOpenInAppBrowserTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'OpenInAppBrowser',
    description: `Open an http/https URL in the user's embedded browser inside Lucky, then wait for it to load.
Use to drive the browser the user is looking at: inspect a page visually, follow links, or set up a page to read/navigate next.
Returns the final URL and page title once loaded. Pair with ReadBrowserPage to get the page text, and ControlBrowser to go back/forward/reload.
Use normal, user-visible browsing only. Do not use this to bypass robots, anti-bot checks, paywalls, login walls, CAPTCHAs, rate limits, or access controls.
For pure background extraction (no visible browser) prefer WebFetch/WebSearch instead.
Input: { "url": string }.`,
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'http/https URL to open in the embedded browser' }
      },
      required: ['url']
    },
    requireUserConfirm,
    async call(input: { url: string }): Promise<string> {
      securityService.assertAgentToolAllowed('OpenInAppBrowser', input as Record<string, unknown>)
      const result = await browserControlService.open(String(input.url ?? ''))
      return JSON.stringify(result, null, 2)
    }
  }
}

export function createReadBrowserPageTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'ReadBrowserPage',
    description: `Read the currently open page in the user's embedded browser: its URL, title, and visible text content.
Use to see what the user is looking at, or to read a page you just opened with OpenInAppBrowser.
Reflects live DOM (including client-rendered content), unlike WebFetch which only sees initial HTML.
Long pages: the result includes totalChars/hasMore — read in segments by advancing "offset" instead of raising max_chars, so the context never overflows.
Read only what is needed for the user's current task. Do not perform bulk extraction or attempt to evade anti-scraping protections.
Returns an error if no page is open — open one with OpenInAppBrowser first.
Extraction: mode "article" (default) heuristically extracts the main content (drops nav/sidebar/footer noise, auto-falls back to full text — see extractionMode in the result); mode "full" reads the whole page.
Pass "tab_id" from ListBrowserTabs to read a background tab without switching (multi-tab compare).
Input: { "max_chars"?: number (default 8000, max 40000), "offset"?: number, "mode"?: "article"|"full", "tab_id"?: string }.`,
    inputSchema: {
      type: 'object',
      properties: {
        max_chars: { type: 'number', description: 'Maximum characters of page text to return (500-40000)' },
        offset: { type: 'number', description: 'Character offset to start reading from (for long pages)' },
        mode: { type: 'string', enum: ['article', 'full'], description: 'article = main-content extraction (default), full = whole page' },
        tab_id: { type: 'string', description: 'Target tab id from ListBrowserTabs (default: active tab)' }
      }
    },
    requireUserConfirm,
    async call(input: { max_chars?: number; offset?: number; mode?: 'article' | 'full'; tab_id?: string }): Promise<string> {
      securityService.assertAgentToolAllowed('ReadBrowserPage', input as Record<string, unknown>)
      const page = await browserControlService.readPage(
        Number(input.max_chars) || 8000,
        Number(input.offset) || 0,
        input.tab_id ? String(input.tab_id) : undefined,
        input.mode === 'full' ? 'full' : 'article'
      )
      if (!page) return JSON.stringify({ error: 'No page is open in the embedded browser. Open one with OpenInAppBrowser first.' })
      return sanitizeWebContent(JSON.stringify(page, null, 2))
    }
  }
}

export function createScrollBrowserToTextTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'ScrollBrowserToText',
    description: `Scroll the user's embedded browser to the first occurrence of the given text and highlight it.
Use after quoting or citing a passage from the page (via ReadBrowserPage), so the user can see the source location — cite, then locate.
Returns { found } — false means the exact text is not on the page (quote a shorter, exact fragment and retry).
Input: { "text": string (exact fragment from the page, <= 200 chars) }.`,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Exact text fragment to locate on the page' }
      },
      required: ['text']
    },
    requireUserConfirm,
    async call(input: { text: string; tab_id?: string }): Promise<string> {
      securityService.assertAgentToolAllowed('ScrollBrowserToText', input as Record<string, unknown>)
      const result = await browserControlService.scrollToText(
        String(input.text ?? ''),
        input.tab_id ? String(input.tab_id) : undefined
      )
      return JSON.stringify(result, null, 2)
    }
  }
}

export function createSnapshotBrowserPageTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'SnapshotBrowserPage',
    description: `Take an interaction snapshot of the page currently open in the user's embedded browser: visible links, buttons, inputs and selects, each with a numeric element id.
This is step 1 of the browse-act loop: Snapshot → decide → ClickBrowserElement / FillBrowserInput → Snapshot again to OBSERVE the result before the next action. Never act twice without re-snapshotting.
Element ids are only valid for the most recent snapshot — after any click, navigation or page change they go stale.
The snapshot includes basic actionability hints such as enabled/readonly when available; still rely on ClickBrowserElement/FillBrowserInput to perform final Playwright-style checks before acting.
If the page shows CAPTCHA, bot checks, login walls or access-limit messages, stop and ask the user to handle it manually.
Input: { "max_elements"?: number } (default 60, max 150).`,
    inputSchema: {
      type: 'object',
      properties: {
        max_elements: { type: 'number', description: 'Maximum interactive elements to list (10-150)' },
        tab_id: { type: 'string', description: 'Target tab id from ListBrowserTabs (default: active tab)' }
      }
    },
    requireUserConfirm,
    async call(input: { max_elements?: number; tab_id?: string }): Promise<string> {
      securityService.assertAgentToolAllowed('SnapshotBrowserPage', input as Record<string, unknown>)
      const snapshot = await browserControlService.snapshotInteractive(
        Number(input.max_elements) || 60,
        input.tab_id ? String(input.tab_id) : undefined
      )
      if (!snapshot) return JSON.stringify({ error: 'No page is open in the embedded browser. Open one with OpenInAppBrowser first.' })
      return sanitizeWebContent(JSON.stringify(snapshot, null, 2))
    }
  }
}

export function createClickBrowserElementTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'ClickBrowserElement',
    description: `Click an element in the user's embedded browser by the element id from the LATEST SnapshotBrowserPage.
Before clicking, the runtime performs Playwright/Selenium-like actionability checks: attached, visible, enabled, not covered, scrolled into view, and then sends real mouse input events.
High-risk clicks (submit/pay/delete/confirm buttons) require user approval — state your intent honestly in "reason"; it is shown to the user and logged.
Use ordinary user-visible navigation only. Never click through CAPTCHAs, bot checks, login walls, paywalls, or anti-abuse prompts on the user's behalf.
After clicking, ALWAYS SnapshotBrowserPage again to observe the outcome before deciding the next step.
If the tool returns not-visible/covered/disabled/stale, do not retry blindly; explain the issue or take a visible corrective step such as closing an overlay and then snapshot again.
Input: { "element_id": number, "reason": string (why you are clicking, one sentence) }.`,
    inputSchema: {
      type: 'object',
      properties: {
        element_id: { type: 'number', description: 'Element id from the latest SnapshotBrowserPage' },
        reason: { type: 'string', description: 'Why this click is needed (shown to the user, audited)' }
      },
      required: ['element_id', 'reason']
    },
    requireUserConfirm,
    async call(input: { element_id: number; reason: string; tab_id?: string }): Promise<string> {
      securityService.assertAgentToolAllowed('ClickBrowserElement', input as unknown as Record<string, unknown>)
      const policyError = checkAgentSitePolicy(input.tab_id ? String(input.tab_id) : undefined, requireUserConfirm)
      if (policyError) return JSON.stringify({ ok: false, error: policyError })
      const result = await browserControlService.clickElement(
        Number(input.element_id),
        input.tab_id ? String(input.tab_id) : undefined
      )
      return JSON.stringify({ ...result, reason: String(input.reason ?? '') }, null, 2)
    }
  }
}

export function createFillBrowserInputTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'FillBrowserInput',
    description: `Fill an input, textarea or select in the user's embedded browser by the element id from the LATEST SnapshotBrowserPage (dispatches native input/change events, works with React/Vue controlled forms).
Before filling, the runtime performs actionability checks: attached, visible, enabled, not covered, editable, and not a sensitive field.
Never fill passwords, card numbers, one-time codes, CAPTCHA answers or other credentials — ask the user to do that themselves.
Filling does NOT submit; submitting requires a separate ClickBrowserElement which the user can review.
Input: { "element_id": number, "value": string, "reason": string (why, one sentence) }.`,
    inputSchema: {
      type: 'object',
      properties: {
        element_id: { type: 'number', description: 'Element id from the latest SnapshotBrowserPage' },
        value: { type: 'string', description: 'Text to fill' },
        reason: { type: 'string', description: 'Why this field is being filled (shown to the user, audited)' }
      },
      required: ['element_id', 'value', 'reason']
    },
    requireUserConfirm,
    async call(input: { element_id: number; value: string; reason: string; tab_id?: string }): Promise<string> {
      securityService.assertAgentToolAllowed('FillBrowserInput', input as unknown as Record<string, unknown>)
      const policyError = checkAgentSitePolicy(input.tab_id ? String(input.tab_id) : undefined, requireUserConfirm)
      if (policyError) return JSON.stringify({ ok: false, error: policyError })
      const result = await browserControlService.fillInput(
        Number(input.element_id),
        String(input.value ?? ''),
        input.tab_id ? String(input.tab_id) : undefined
      )
      return JSON.stringify({ ...result, reason: String(input.reason ?? '') }, null, 2)
    }
  }
}

export function createListBrowserTabsTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'ListBrowserTabs',
    description: `List the open tabs in the user's embedded browser: tab_id, title, url and which one is active.
Use the returned tab_id with ReadBrowserPage/SnapshotBrowserPage/Click/Fill etc. to read or act on a BACKGROUND tab without switching — e.g. compare several product pages that are open in different tabs.
Incognito tabs are never listed.`,
    inputSchema: { type: 'object', properties: {} },
    requireUserConfirm,
    async call(): Promise<string> {
      securityService.assertAgentToolAllowed('ListBrowserTabs', {})
      return JSON.stringify({ tabs: browserControlService.listTabs() }, null, 2)
    }
  }
}

export function createScrollBrowserPageTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'ScrollBrowserPage',
    description: `Scroll the page in the user's embedded browser: "down"/"up" by one viewport, "top"/"bottom" to the ends.
Use with infinite-feed or long pages: scroll, then ReadBrowserPage the newly visible content; atBottom=true means you have reached the end.
Input: { "direction": "down"|"up"|"top"|"bottom", "tab_id"?: string }.`,
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['down', 'up', 'top', 'bottom'], description: 'Scroll direction' },
        tab_id: { type: 'string', description: 'Target tab id from ListBrowserTabs (default: active tab)' }
      },
      required: ['direction']
    },
    requireUserConfirm,
    async call(input: { direction: 'down' | 'up' | 'top' | 'bottom'; tab_id?: string }): Promise<string> {
      securityService.assertAgentToolAllowed('ScrollBrowserPage', input as unknown as Record<string, unknown>)
      const direction = ['down', 'up', 'top', 'bottom'].includes(input.direction) ? input.direction : 'down'
      const result = await browserControlService.scrollPage(direction, input.tab_id ? String(input.tab_id) : undefined)
      return JSON.stringify(result, null, 2)
    }
  }
}

export function createPressBrowserKeyTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'PressBrowserKey',
    description: `Send a real keyboard key to the user's embedded browser. Typical flow: FillBrowserInput a search box, then press "Enter" to submit.
Enter can submit forms — state your intent honestly in "reason"; it is shown to the user and audited.
Input: { "key": "Enter"|"Escape"|"Tab"|"ArrowDown"|"ArrowUp"|"PageDown"|"PageUp", "reason": string, "tab_id"?: string }.`,
    inputSchema: {
      type: 'object',
      properties: {
        key: { type: 'string', enum: ['Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'], description: 'Key to press' },
        reason: { type: 'string', description: 'Why this key press is needed (shown to the user, audited)' },
        tab_id: { type: 'string', description: 'Target tab id from ListBrowserTabs (default: active tab)' }
      },
      required: ['key', 'reason']
    },
    requireUserConfirm,
    async call(input: { key: string; reason: string; tab_id?: string }): Promise<string> {
      securityService.assertAgentToolAllowed('PressBrowserKey', input as unknown as Record<string, unknown>)
      const allowed = ['Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp'] as const
      const key = allowed.find((item) => item === input.key)
      if (!key) return JSON.stringify({ ok: false, error: `不支持的按键: ${String(input.key)}` })
      const policyError = checkAgentSitePolicy(input.tab_id ? String(input.tab_id) : undefined, requireUserConfirm)
      if (policyError) return JSON.stringify({ ok: false, error: policyError })
      const result = await browserControlService.pressKey(key, input.tab_id ? String(input.tab_id) : undefined)
      return JSON.stringify({ ...result, reason: String(input.reason ?? '') }, null, 2)
    }
  }
}

export function createHoverBrowserElementTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'HoverBrowserElement',
    description: `Hover the mouse over an element (by element id from the LATEST SnapshotBrowserPage) to reveal hover menus, tooltips or dropdowns.
After hovering, SnapshotBrowserPage again — the newly revealed items will appear in the snapshot.
Input: { "element_id": number, "tab_id"?: string }.`,
    inputSchema: {
      type: 'object',
      properties: {
        element_id: { type: 'number', description: 'Element id from the latest SnapshotBrowserPage' },
        tab_id: { type: 'string', description: 'Target tab id from ListBrowserTabs (default: active tab)' }
      },
      required: ['element_id']
    },
    requireUserConfirm,
    async call(input: { element_id: number; tab_id?: string }): Promise<string> {
      securityService.assertAgentToolAllowed('HoverBrowserElement', input as unknown as Record<string, unknown>)
      const result = await browserControlService.hoverElement(
        Number(input.element_id),
        input.tab_id ? String(input.tab_id) : undefined
      )
      return JSON.stringify(result, null, 2)
    }
  }
}

export function createWaitForBrowserTextTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'WaitForBrowserText',
    description: `Wait until the given text appears on the page (polls up to timeout, max 20s).
Use after ClickBrowserElement/PressBrowserKey on SPA pages where content loads asynchronously WITHOUT navigation — wait for an expected marker before re-snapshotting.
Input: { "text": string (expected exact fragment), "timeout_ms"?: number (default 8000), "tab_id"?: string }.`,
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string', description: 'Exact text fragment to wait for' },
        timeout_ms: { type: 'number', description: 'Max wait in milliseconds (500-20000, default 8000)' },
        tab_id: { type: 'string', description: 'Target tab id from ListBrowserTabs (default: active tab)' }
      },
      required: ['text']
    },
    requireUserConfirm,
    async call(input: { text: string; timeout_ms?: number; tab_id?: string }): Promise<string> {
      securityService.assertAgentToolAllowed('WaitForBrowserText', input as Record<string, unknown>)
      const result = await browserControlService.waitForText(
        String(input.text ?? ''),
        Number(input.timeout_ms) || 8000,
        input.tab_id ? String(input.tab_id) : undefined
      )
      return JSON.stringify(result, null, 2)
    }
  }
}

export function createCaptureBrowserPageTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'CaptureBrowserPage',
    description: `Take a screenshot of the page in the user's embedded browser and return it as an image (vision input).
Use when layout/visual judgement matters — "does this page look broken", locating things Snapshot cannot describe, or confirming what the user sees. Requires a vision-capable model; on text-only models the image is replaced by a placeholder note.
The screenshot is downscaled (max 1024px wide) to control token cost. Prefer ReadBrowserPage/SnapshotBrowserPage for textual tasks.
Input: { "tab_id"?: string }.`,
    inputSchema: {
      type: 'object',
      properties: {
        tab_id: { type: 'string', description: 'Target tab id from ListBrowserTabs (default: active tab)' }
      }
    },
    requireUserConfirm,
    async call(input: { tab_id?: string }) {
      securityService.assertAgentToolAllowed('CaptureBrowserPage', input as Record<string, unknown>)
      const shot = await browserControlService.captureScreenshot(input.tab_id ? String(input.tab_id) : undefined)
      if (!shot) {
        return createSandboxToolResponse(
          'No page is open in the embedded browser. Open one with OpenInAppBrowser first.',
          'error'
        )
      }
      // ToolResponse 带图片块：视觉模型直接看图；非视觉模型由 formatter 替换为占位说明
      return {
        content: [
          {
            id: crypto.randomUUID(),
            type: 'text' as const,
            text: `Screenshot of the current page (${shot.width}x${shot.height}, downscaled).`
          },
          {
            id: crypto.randomUUID(),
            type: 'data' as const,
            name: 'browser-screenshot.jpg',
            source: { type: 'base64' as const, media_type: shot.mediaType, data: shot.base64 }
          }
        ],
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        metadata: {},
        state: 'success' as const,
        stream: false,
        isLast: true,
        isInterrupted: false
      }
    }
  }
}

export function createControlBrowserTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'ControlBrowser',
    description: `Navigate the user's embedded browser: go back, go forward, or reload the current page.
Use after OpenInAppBrowser/ReadBrowserPage to move through history or refresh. Returns the resulting URL and title.
Input: { "action": "back" | "forward" | "reload" }.`,
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['back', 'forward', 'reload'], description: 'Navigation action' }
      },
      required: ['action']
    },
    requireUserConfirm,
    async call(input: { action: 'back' | 'forward' | 'reload' }): Promise<string> {
      securityService.assertAgentToolAllowed('ControlBrowser', input as Record<string, unknown>)
      const action = input.action
      if (action !== 'back' && action !== 'forward' && action !== 'reload') {
        return JSON.stringify({ error: 'action must be one of: back, forward, reload' })
      }
      const result = await browserControlService.navigate(action)
      if (!result) return JSON.stringify({ error: 'No page is open in the embedded browser. Open one with OpenInAppBrowser first.' })
      return JSON.stringify(result, null, 2)
    }
  }
}
