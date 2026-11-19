import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => {
  const settings = {
    get: vi.fn(async () => ({
      maxContextTokens: 32000,
      personalization: { chroniclePreview: false }
    }))
  }
  const agentRuntime = {
    buildContext: vi.fn(async () => ({ text: '' }))
  }
  const chronicle = {
    getSnapshot: vi.fn(async () => null)
  }
  const workspace = {
    get: vi.fn(async () => null),
    getGitStatus: vi.fn(),
    getTree: vi.fn(async () => [])
  }
  const file = {
    read: vi.fn()
  }
  const terminal = {
    getOutput: vi.fn(async () => ({ id: 'default', output: '' }))
  }
  const browser = {
    listHistory: vi.fn(async () => [])
  }
  return { settings, agentRuntime, chronicle, workspace, file, terminal, browser }
})

vi.mock('./ipc-client.js', () => ({
  ipc: {
    settings: h.settings,
    agentRuntime: h.agentRuntime,
    chronicle: h.chronicle,
    workspace: h.workspace,
    file: h.file,
    terminal: h.terminal,
    browser: h.browser
  },
  unwrap: async <T>(value: Promise<T>): Promise<T> => value
}))

vi.mock('../stores/ui.store.js', () => ({
  useUiStore: () => ({
    planMode: false,
    showGoalInput: false,
    attachedRuntime: '',
    composerAttachments: []
  })
}))

vi.mock('../stores/browser.store.js', () => ({
  useBrowserStore: () => ({
    activeTabUrl: '',
    activeTabTitle: ''
  })
}))

import { buildContext } from './context-builder.js'

beforeEach(() => {
  vi.clearAllMocks()
})

describe('buildContext', () => {
  it('does not duplicate the latest user request in automatic context', async () => {
    h.workspace.get.mockResolvedValueOnce(null)
    const context = await buildContext('请优化 AI 回复质量', 's1')

    expect(context).not.toContain('## 用户任务')
    expect(context).not.toContain('请优化 AI 回复质量')
  })
})
