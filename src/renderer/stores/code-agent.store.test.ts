import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// code-agent.store 是多标签会话 + 追问队列的簿记核心（最易出 off-by-one / 空标签 / 串号）。
// 把持久化、agent 运行、编辑器/项目/工作区 store 等外部接缝全部 mock，聚焦纯状态迁移。
const h = vi.hoisted(() => {
  const conversation = {
    setCodeAgentState: vi.fn(async () => {}),
    getCodeAgentState: vi.fn(async () => null)
  }
  const editor = {
    reloadFiles: vi.fn(async () => {}),
    tabs: [] as Array<{ path: string }>,
    activeTab: undefined as { path: string; language: string; content: string } | undefined
  }
  const project = {
    activeProject: { rootPath: '/ws', name: 'ws' } as { rootPath: string; name: string } | undefined,
    approvalMode: 'auto' as const,
    ensureWorkspace: vi.fn(async () => true),
    refreshGitBranch: vi.fn(async () => {})
  }
  const workspace = {
    workspace: { rootPath: '/ws', name: 'ws' } as { rootPath: string; name: string } | undefined,
    refreshTree: vi.fn(async () => {})
  }
  const runAgentScope = vi.fn(async (_text: string, opts: { onEvent: (event: { type: string }) => void }) => {
    opts.onEvent({ type: 'done' })
  })
  return { conversation, editor, project, workspace, runAgentScope }
})

vi.mock('../services/conversation-client.js', () => ({ conversation: h.conversation }))
vi.mock('../services/agentscope-client.js', () => ({
  runAgentScope: h.runAgentScope,
  confirmAgentTools: vi.fn(),
  summarizeAgentTitle: vi.fn(async () => 'title')
}))
vi.mock('../services/ipc-client.js', () => ({
  ipc: { memory: { capture: vi.fn(async () => ({ success: true })) } },
  unwrap: async (p: Promise<unknown>) => p
}))
vi.mock('../services/ai-inline-edit.service.js', () => ({
  setInlineEditFocusedPane: vi.fn(),
  previewAgentToolEdit: vi.fn(async () => {}),
  clearAgentToolEdit: vi.fn()
}))
vi.mock('../i18n/index.js', () => ({ i18n: { global: { t: (k: string) => k, locale: { value: 'zh-CN' } } } }))
vi.mock('./editor.store.js', () => ({ useEditorStore: () => h.editor }))
vi.mock('./project.store.js', () => ({ useProjectStore: () => h.project }))
vi.mock('./workspace.store.js', () => ({ useWorkspaceStore: () => h.workspace }))

import { useCodeAgentStore } from './code-agent.store.js'

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  h.project.activeProject = undefined
  h.workspace.workspace = undefined
})

describe('code-agent store — session tabs', () => {
  it('newSession appends, activates, and clears the composer', () => {
    const store = useCodeAgentStore()
    const first = store.activeSessionId
    store.input = 'draft'
    const created = store.newSession()

    expect(created.id).not.toBe(first)
    expect(store.activeSessionId).toBe(created.id)
    expect(store.input).toBe('')
    expect(store.visibleSessions).toHaveLength(2)
  })

  it('switchSession only switches to a known id', () => {
    const store = useCodeAgentStore()
    const a = store.activeSessionId
    store.newSession()
    store.switchSession(a)
    expect(store.activeSessionId).toBe(a)
    store.switchSession('does-not-exist')
    expect(store.activeSessionId).toBe(a)
  })

  it('closeSession removes the active tab and activates a neighbor', () => {
    const store = useCodeAgentStore()
    const a = store.activeSessionId
    const b = store.newSession().id
    expect(store.activeSessionId).toBe(b)
    store.closeSession(b)
    expect(store.visibleSessions.map((s) => s.id)).toEqual([a])
    expect(store.activeSessionId).toBe(a)
  })

  it('closing the last tab replaces it with a fresh blank session (never zero tabs)', () => {
    const store = useCodeAgentStore()
    const only = store.activeSessionId
    store.closeSession(only)
    expect(store.visibleSessions).toHaveLength(1)
    expect(store.visibleSessions[0]!.id).not.toBe(only)
  })

  it('closeOtherSessions keeps only the given tab', () => {
    const store = useCodeAgentStore()
    const a = store.activeSessionId
    store.newSession()
    const c = store.newSession().id
    store.closeOtherSessions(c)
    expect(store.visibleSessions.map((s) => s.id)).toEqual([c])
    expect(store.activeSessionId).toBe(c)
    expect(a).not.toBe(c)
  })

  it('closeSessionsToRight keeps tabs up to and including the target', () => {
    const store = useCodeAgentStore()
    const a = store.activeSessionId
    const b = store.newSession().id
    store.newSession() // c, to the right of b
    store.closeSessionsToRight(b)
    expect(store.visibleSessions.map((s) => s.id)).toEqual([a, b])
  })

  it('archive then restore moves a session between visible and archived lists', () => {
    const store = useCodeAgentStore()
    const a = store.activeSessionId
    store.newSession() // keep a second visible tab so archiving a doesn't spawn a new one
    store.archiveSession(a)
    expect(store.visibleSessions.some((s) => s.id === a)).toBe(false)
    expect(store.archivedSessions.some((s) => s.id === a)).toBe(true)

    store.restoreSession(a)
    expect(store.visibleSessions.some((s) => s.id === a)).toBe(true)
    expect(store.activeSessionId).toBe(a)
  })

  it('renameSession sets a manual title and ignores blank input', () => {
    const store = useCodeAgentStore()
    const a = store.activeSessionId
    store.renameSession(a, '  My tab  ')
    const session = store.visibleSessions.find((s) => s.id === a)!
    expect(session.title).toBe('My tab')
    expect(session.titleSource).toBe('manual')

    store.renameSession(a, '   ')
    expect(store.visibleSessions.find((s) => s.id === a)!.title).toBe('My tab')
  })

  it('togglePin flips the pinned flag', () => {
    const store = useCodeAgentStore()
    const a = store.activeSessionId
    expect(store.visibleSessions[0]!.pinned).toBe(false)
    store.togglePin(a)
    expect(store.visibleSessions.find((s) => s.id === a)!.pinned).toBe(true)
    store.togglePin(a)
    expect(store.visibleSessions.find((s) => s.id === a)!.pinned).toBe(false)
  })
})

describe('code-agent store — follow-up queue', () => {
  it('enqueue trims text, ignores blanks, and appends to the active session queue', () => {
    const store = useCodeAgentStore()
    expect(store.enqueue('   ')).toBeNull()
    const queued = store.enqueue('  second turn  ')
    expect(queued).not.toBeNull()
    expect(store.queuedTurns.map((q) => q.text)).toEqual(['second turn'])
  })

  it('updateQueuedTurn edits an existing item and ignores blank edits', () => {
    const store = useCodeAgentStore()
    const q = store.enqueue('original')!
    store.updateQueuedTurn(q.id, '  edited  ')
    expect(store.queuedTurns[0]!.text).toBe('edited')
    store.updateQueuedTurn(q.id, '   ')
    expect(store.queuedTurns[0]!.text).toBe('edited')
  })

  it('removeQueuedTurn drops the matching item', () => {
    const store = useCodeAgentStore()
    const q1 = store.enqueue('one')!
    store.enqueue('two')
    store.removeQueuedTurn(q1.id)
    expect(store.queuedTurns.map((q) => q.text)).toEqual(['two'])
  })

  it('moveQueuedTurnUp reorders and is a no-op at the top', () => {
    const store = useCodeAgentStore()
    store.enqueue('one')
    const q2 = store.enqueue('two')!
    store.moveQueuedTurnUp(q2.id)
    expect(store.queuedTurns.map((q) => q.text)).toEqual(['two', 'one'])
    // 已在顶部，再上移应无变化
    store.moveQueuedTurnUp(q2.id)
    expect(store.queuedTurns.map((q) => q.text)).toEqual(['two', 'one'])
  })
})

describe('code-agent store — requestId alignment', () => {
  it('passes turn.id as requestId to runAgentScope', async () => {
    const store = useCodeAgentStore()
    h.project.ensureWorkspace.mockResolvedValue(true)
    store.mode = 'ask'
    store.input = 'what is a closure?'
    await store.send()

    const turnId = store.activeSession?.turns.at(-1)?.id
    const opts = h.runAgentScope.mock.calls[0]?.[1] as { requestId?: string } | undefined
    expect(h.runAgentScope).toHaveBeenCalledOnce()
    expect(turnId).toBeTruthy()
    expect(opts?.requestId).toBe(turnId)
  })
})
