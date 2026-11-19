/**
 * 会话持久化 E2E — 覆盖「重启不失忆」链路：
 * conversation.createSession + appendMessage 写入 SQLite →
 * 关闭应用（will-quit 关库）→ 以同一 userData 重新启动（跑迁移）→
 * listSessions / getSession 读回完整消息（含结构化 parts）。
 *
 * 不依赖模型：直接经 preload 桥写读，专测 DB 迁移 + conversation.service 跨重启。
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test'

const userDataDir = mkdtempSync(join(tmpdir(), 'lucky-e2e-persist-'))
const SESSION_ID = 'e2e-persist-session'
const USER_TEXT = 'persisted user message'
const ASSISTANT_TEXT = 'persisted assistant reply'

async function launch(): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: ['out/main/index.js'],
    env: {
      ...process.env,
      NODE_ENV: 'production',
      LUCKY_USER_DATA_DIR: userDataDir
    }
  })
  const window = await app.firstWindow()
  await window.waitForLoadState('domcontentloaded')
  return { app, window }
}

test('conversation survives an app restart with messages and parts intact', async () => {
  test.setTimeout(120_000)

  // ── 第一次运行：写入会话与消息 ──────────────────────────────
  const first = await launch()
  const written = await first.window.evaluate(async ({ sessionId, userText, assistantText }) => {
    const api = (window as unknown as {
      luckyAI: {
        conversation: {
          createSession: (input: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
          appendMessage: (sessionId: string, message: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
        }
      }
    }).luckyAI

    const created = await api.conversation.createSession({
      id: sessionId,
      title: 'E2E persisted session',
      workspaceName: 'e2e'
    })
    if (!created.success) return { error: `createSession: ${created.error}` }

    const user = await api.conversation.appendMessage(sessionId, {
      id: 'e2e-msg-user',
      role: 'user',
      content: userText,
      timestamp: Date.now()
    })
    if (!user.success) return { error: `append user: ${user.error}` }

    const assistant = await api.conversation.appendMessage(sessionId, {
      id: 'e2e-msg-assistant',
      role: 'assistant',
      content: assistantText,
      parts: [{ type: 'text', text: assistantText }],
      timestamp: Date.now()
    })
    if (!assistant.success) return { error: `append assistant: ${assistant.error}` }
    return { ok: true }
  }, { sessionId: SESSION_ID, userText: USER_TEXT, assistantText: ASSISTANT_TEXT })
  expect(written).toEqual({ ok: true })
  await first.app.close()

  // ── 第二次运行：同一 userData 重启后读回 ────────────────────
  const second = await launch()
  try {
    const restored = await second.window.evaluate(async (sessionId) => {
      const api = (window as unknown as {
        luckyAI: {
          conversation: {
            listSessions: () => Promise<{ success: boolean; data?: Array<{ id: string; title: string }> }>
            getSession: (id: string) => Promise<{
              success: boolean
              data?: { messages?: Array<{ id: string; role: string; content: string; parts?: Array<{ type: string; text?: string }> }> } | null
            }>
          }
        }
      }).luckyAI

      const list = await api.conversation.listSessions()
      const detail = await api.conversation.getSession(sessionId)
      return {
        listed: list.data?.some((session) => session.id === sessionId) ?? false,
        messages: detail.data?.messages ?? []
      }
    }, SESSION_ID)

    expect(restored.listed).toBe(true)
    const roles = restored.messages.map((message) => message.role)
    expect(roles).toContain('user')
    expect(roles).toContain('assistant')
    const assistant = restored.messages.find((message) => message.id === 'e2e-msg-assistant')
    expect(assistant?.content).toBe(ASSISTANT_TEXT)
    // 结构化 parts（parts_json 列）跨重启保留
    expect(assistant?.parts?.[0]).toMatchObject({ type: 'text', text: ASSISTANT_TEXT })
  } finally {
    await second.app.close()
  }
})
