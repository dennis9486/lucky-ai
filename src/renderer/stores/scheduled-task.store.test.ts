import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import type { ScheduledTask } from '../../shared/types/scheduled-task.js'

// 依赖注入点：ipc-client 直接读 window.luckyAI（node 环境没有），依赖 store 会拉起 Vue/其它 store，
// 故用 hoisted 的可控替身把这些接缝全部 mock，只保留 scheduled-task.store 自身的编排逻辑。
const h = vi.hoisted(() => {
  const scheduledTasks = {
    list: vi.fn(),
    templates: vi.fn(),
    create: vi.fn(),
    createFromTemplate: vi.fn(),
    update: vi.fn(),
    runNow: vi.fn(),
    markRun: vi.fn(),
    listRuns: vi.fn(),
    dismissPending: vi.fn(),
    archive: vi.fn(),
    onFired: vi.fn(() => () => {}),
    onOpen: vi.fn(() => () => {})
  }
  const chat = {
    isRunning: false,
    input: '',
    abortIfRunning: vi.fn(),
    sendMessage: vi.fn(async () => {})
  }
  const sessions = {
    selectSessionWithProject: vi.fn(async () => null as { id: string } | null),
    newChat: vi.fn(async () => {}),
    createSessionWithTitle: vi.fn(async () => ({ id: 'new-session' }))
  }
  const projects = { projects: [] as Array<{ id: string; name: string }>, selectProject: vi.fn(async () => {}) }
  const ui = { currentView: 'chat' as string }
  return { ipc: { scheduledTasks }, chat, sessions, projects, ui }
})

vi.mock('../services/ipc-client.js', () => ({
  ipc: h.ipc,
  unwrap: async <T>(p: Promise<{ success: boolean; data?: T; error?: string }>): Promise<T> => {
    const r = await p
    if (!r || !r.success) throw new Error(r?.error ?? 'ipc failed')
    return r.data as T
  }
}))
vi.mock('./chat.store.js', () => ({ useChatStore: () => h.chat }))
vi.mock('./session.store.js', () => ({ useSessionStore: () => h.sessions }))
vi.mock('./project.store.js', () => ({ useProjectStore: () => h.projects }))
vi.mock('./ui.store.js', () => ({ useUiStore: () => h.ui }))

import { useScheduledTaskStore } from './scheduled-task.store.js'

function ok<T>(data: T) {
  return { success: true as const, data }
}

let seq = 0
function makeTask(over: Partial<ScheduledTask> = {}): ScheduledTask {
  seq += 1
  return {
    id: `task-${seq}`,
    title: `Task ${seq}`,
    prompt: 'do the thing',
    projectId: null,
    projectName: null,
    timezone: 'UTC',
    cadence: 'daily',
    scheduleText: 'every day',
    runMode: 'notify',
    nextRunAt: 1000 + seq,
    lastRunAt: null,
    pendingRunAt: null,
    remindAt: null,
    lastRunStatus: null,
    status: 'active',
    source: 'manual',
    sourceSessionId: null,
    metadata: {},
    createdAt: 0,
    updatedAt: seq,
    archivedAt: null,
    ...over
  }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  h.chat.isRunning = false
  h.chat.input = ''
  h.projects.projects = []
  h.ui.currentView = 'chat'
  // 合理的默认返回，个别用例再覆写
  h.ipc.scheduledTasks.markRun.mockResolvedValue(ok(null))
  h.ipc.scheduledTasks.update.mockImplementation(async (input: { id: string }) => ok(makeTask({ id: input.id })))
})

describe('scheduled-task store — computed views', () => {
  it('splits current/archived/pending and counts pending', async () => {
    const store = useScheduledTaskStore()
    h.ipc.scheduledTasks.list.mockResolvedValue(
      ok([
        makeTask({ id: 'a', status: 'active' }),
        makeTask({ id: 'b', status: 'paused', pendingRunAt: 500 }),
        makeTask({ id: 'c', status: 'archived' })
      ])
    )
    await store.load()

    expect(store.currentTasks.map((t) => t.id)).toEqual(['a', 'b'])
    expect(store.archivedTasks.map((t) => t.id)).toEqual(['c'])
    expect(store.pendingTasks.map((t) => t.id)).toEqual(['b'])
    expect(store.pendingCount).toBe(1)
  })

  it('exposes only due-today pending tasks as chat reminders', async () => {
    const now = Date.now()
    const store = useScheduledTaskStore()
    h.ipc.scheduledTasks.list.mockResolvedValue(
      ok([
        makeTask({ id: 'visible', pendingRunAt: now - 60_000, remindAt: null, timezone: 'UTC' }),
        makeTask({ id: 'snoozed', pendingRunAt: now - 60_000, remindAt: now + 3_600_000, timezone: 'UTC' }),
        makeTask({ id: 'old', pendingRunAt: now - 36 * 3_600_000, remindAt: null, timezone: 'UTC' })
      ])
    )
    await store.load()

    expect(store.chatReminderTasks.map((t) => t.id)).toEqual(['visible'])
    expect(store.nextChatReminderTask?.id).toBe('visible')
  })
})

describe('scheduled-task store — applyTask (optimistic upsert)', () => {
  it('drops a task from the list when it no longer matches the active query', async () => {
    const store = useScheduledTaskStore()
    h.ipc.scheduledTasks.list.mockResolvedValue(ok([makeTask({ id: 'a', title: 'alpha' })]))
    store.query = 'alpha'
    await store.load()
    expect(store.tasks).toHaveLength(1)

    // 更新后标题不再命中搜索词 → 本地列表应移除，等价于全量重取时它不再出现
    h.ipc.scheduledTasks.update.mockResolvedValue(ok(makeTask({ id: 'a', title: 'renamed' })))
    await store.update({ id: 'a', title: 'renamed' })
    expect(store.tasks).toHaveLength(0)
  })
})

describe('scheduled-task store — runScheduledTask', () => {
  it('auto trigger defers (no run) when a chat is already running', async () => {
    const store = useScheduledTaskStore()
    h.chat.isRunning = true
    const result = await store.runScheduledTask(makeTask(), { trigger: 'auto' })

    expect(result).toEqual({ ran: false, reason: 'busy' })
    expect(h.chat.sendMessage).not.toHaveBeenCalled()
    expect(h.ipc.scheduledTasks.markRun).not.toHaveBeenCalled()
  })

  it('auto trigger defers when the composer has a draft', async () => {
    const store = useScheduledTaskStore()
    h.chat.input = '  half-typed  '
    const result = await store.runScheduledTask(makeTask(), { trigger: 'auto' })

    expect(result).toEqual({ ran: false, reason: 'busy' })
    expect(h.chat.sendMessage).not.toHaveBeenCalled()
  })

  it('manual run reuses the source session and marks an ok run with trigger', async () => {
    const store = useScheduledTaskStore()
    h.sessions.selectSessionWithProject.mockResolvedValue({ id: 'existing' })
    const task = makeTask({ sourceSessionId: 'existing' })

    const result = await store.runScheduledTask(task, { trigger: 'manual' })

    expect(result).toEqual({ ran: true })
    expect(h.chat.abortIfRunning).toHaveBeenCalledOnce()
    expect(h.sessions.createSessionWithTitle).not.toHaveBeenCalled()
    expect(h.chat.sendMessage).toHaveBeenCalledOnce()
    expect(h.ipc.scheduledTasks.markRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: task.id, status: 'ok', trigger: 'manual' })
    )
  })

  it('creates a session and persists sourceSessionId when none is linked', async () => {
    const store = useScheduledTaskStore()
    h.sessions.selectSessionWithProject.mockResolvedValue(null)
    h.sessions.createSessionWithTitle.mockResolvedValue({ id: 'fresh' })
    const task = makeTask({ sourceSessionId: null })

    const result = await store.runScheduledTask(task, { trigger: 'manual' })

    expect(result).toEqual({ ran: true })
    expect(h.sessions.newChat).toHaveBeenCalledOnce()
    expect(h.sessions.createSessionWithTitle).toHaveBeenCalledWith(task.title)
    expect(h.ipc.scheduledTasks.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: task.id, sourceSessionId: 'fresh' })
    )
  })

  it('does not preempt a busy chat on auto but does abort on manual', async () => {
    const store = useScheduledTaskStore()
    h.chat.isRunning = true
    h.sessions.selectSessionWithProject.mockResolvedValue({ id: 'existing' })

    await store.runScheduledTask(makeTask({ sourceSessionId: 'existing' }), { trigger: 'manual' })
    expect(h.chat.abortIfRunning).toHaveBeenCalledOnce()
  })

  it('records an error run (with note) and returns reason=error when sending throws', async () => {
    const store = useScheduledTaskStore()
    h.sessions.selectSessionWithProject.mockResolvedValue({ id: 'existing' })
    h.chat.sendMessage.mockRejectedValueOnce(new Error('model exploded'))
    const task = makeTask({ sourceSessionId: 'existing' })

    const result = await store.runScheduledTask(task, { trigger: 'auto' })

    expect(result).toEqual({ ran: false, reason: 'error' })
    expect(h.ipc.scheduledTasks.markRun).toHaveBeenCalledWith(
      expect.objectContaining({ id: task.id, status: 'error', trigger: 'auto', note: 'model exploded' })
    )
  })
})

describe('scheduled-task store — chat reminder snooze', () => {
  it('persists a future reminder time through update()', async () => {
    const store = useScheduledTaskStore()
    const remindAt = Date.now() + 20 * 60_000
    h.ipc.scheduledTasks.update.mockResolvedValue(ok(makeTask({ id: 'task', remindAt })))

    await store.snoozePending('task', remindAt)

    expect(h.ipc.scheduledTasks.update).toHaveBeenCalledWith(expect.objectContaining({ id: 'task', remindAt }))
  })
})

describe('scheduled-task store — listRuns', () => {
  it('unwraps the ipc run-history payload', async () => {
    const store = useScheduledTaskStore()
    h.ipc.scheduledTasks.listRuns.mockResolvedValue(
      ok([{ id: 'r1', taskId: 't', status: 'ok', trigger: 'manual', note: '', createdAt: 1 }])
    )
    const runs = await store.listRuns('t')
    expect(h.ipc.scheduledTasks.listRuns).toHaveBeenCalledWith('t', undefined)
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ id: 'r1', status: 'ok', trigger: 'manual' })
  })
})
