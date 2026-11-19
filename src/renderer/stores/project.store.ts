import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { ApprovalMode } from '../../shared/types/conversation.js'
import type { ProjectEntry, StartupMode } from '../../shared/types/project.js'
import type { WorkspaceGitBranch, WorkspaceGitStatus } from '../../shared/types/workspace.js'
import { tGlobal } from '../i18n/index.js'
import { conversation } from '../services/conversation-client.js'
import { useWorkspaceStore } from './workspace.store.js'
import { ipc, unwrap } from '../services/ipc-client.js'
import { createLogger } from '../../shared/utils/log.js'

const logger = createLogger('renderer/project-store')

function nameFromPath(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path
}

const PINNED_PROJECTS_KEY = 'lucky:pinned-projects'

function loadPinnedProjectIds(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_PROJECTS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch {
    return []
  }
}

function savePinnedProjectIds(ids: string[]): void {
  localStorage.setItem(PINNED_PROJECTS_KEY, JSON.stringify(ids))
}

export const useProjectStore = defineStore('project', () => {
  const projects = ref<ProjectEntry[]>([])
  const activeProjectId = ref<string | null>(null)
  const startupMode = ref<StartupMode>('local')
  const approvalMode = ref<ApprovalMode>('ask')
  const gitBranch = ref<string | null>(null)
  const gitStatus = ref<WorkspaceGitStatus>({ branch: null, dirtyCount: 0, isRepository: false })
  const gitBranches = ref<WorkspaceGitBranch[]>([])
  const loaded = ref(false)
  const pinnedProjectIds = ref<string[]>(loadPinnedProjectIds())

  const activeProject = computed(() =>
    projects.value.find((p) => p.id === activeProjectId.value) ?? null
  )

  const hasWorkspace = computed(() => Boolean(activeProject.value?.rootPath))

  const projectLabel = computed(() => activeProject.value?.name ?? tGlobal('project.chooseProject'))

  const startupModeLabel = computed(() =>
    startupMode.value === 'worktree' ? tGlobal('project.worktreeMode') : tGlobal('project.localMode')
  )

  const gitBranchLabel = computed(() => {
    if (!hasWorkspace.value) return '—'
    if (!gitStatus.value.isRepository) return tGlobal('branch.noRepoShort')
    return gitBranch.value ?? 'HEAD'
  })

  async function persistState(): Promise<void> {
    await conversation.setState({
      activeProjectId: activeProjectId.value,
      startupMode: startupMode.value,
      approvalMode: approvalMode.value
    })
  }

  // .git 变化广播（终端/Agent 改动仓库）→ 自动刷新共享的 git 状态。
  // 事件已在主进程 debounce；这里合并进行中的刷新避免堆积。
  // node 测试环境的 ipc mock 可能没有该方法，静默跳过。
  let gitRefreshInFlight = false
  if (typeof ipc.workspace?.onGitChanged === 'function') {
    ipc.workspace.onGitChanged(() => {
      if (gitRefreshInFlight) return
      gitRefreshInFlight = true
      void refreshGitBranch().finally(() => {
        gitRefreshInFlight = false
      })
    })
  }

  async function refreshGitBranch(): Promise<void> {
    const path = activeProject.value?.rootPath
    if (!path) {
      gitBranch.value = null
      return
    }
    try {
      gitStatus.value = await unwrap<WorkspaceGitStatus>(ipc.workspace.getGitStatus(path))
      gitBranch.value = gitStatus.value.branch
      gitBranches.value = gitStatus.value.isRepository
        ? await unwrap<WorkspaceGitBranch[]>(ipc.workspace.listGitBranches(path))
        : []
    } catch {
      logger.warn('failed to refresh git branch', { path })
      gitBranch.value = null
      gitStatus.value = { branch: null, dirtyCount: 0, isRepository: false }
      gitBranches.value = []
    }
  }

  async function checkoutBranch(branch: string): Promise<void> {
    const path = activeProject.value?.rootPath
    if (!path) throw new Error(tGlobal('project.selectFirst'))
    gitStatus.value = await unwrap<WorkspaceGitStatus>(ipc.workspace.checkoutGitBranch(branch, path))
    gitBranch.value = gitStatus.value.branch
    await refreshGitBranch()
  }

  async function createBranch(branch: string): Promise<void> {
    const path = activeProject.value?.rootPath
    if (!path) throw new Error(tGlobal('project.selectFirst'))
    gitStatus.value = await unwrap<WorkspaceGitStatus>(ipc.workspace.createGitBranch(branch, path))
    gitBranch.value = gitStatus.value.branch
    await refreshGitBranch()
  }

  async function load(): Promise<void> {
    if (loaded.value) return

    const [list, state] = await Promise.all([conversation.listProjects(), conversation.getState()])
    projects.value = list
    activeProjectId.value = state.activeProjectId
    startupMode.value = state.startupMode
    approvalMode.value = state.approvalMode

    const active = activeProject.value
    if (active?.rootPath) {
      await useWorkspaceStore().setWorkspace(active.rootPath)
      await refreshGitBranch()
    } else {
      activeProjectId.value = null
    }

    loaded.value = true
  }

  function isPinned(id: string): boolean {
    return pinnedProjectIds.value.includes(id)
  }

  function togglePinProject(id: string): void {
    const next = new Set(pinnedProjectIds.value)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    pinnedProjectIds.value = [...next]
    savePinnedProjectIds(pinnedProjectIds.value)
  }

  async function renameProject(id: string, name: string): Promise<void> {
    const trimmed = name.trim()
    if (!trimmed) return
    const project = projects.value.find((item) => item.id === id)
    if (!project) return
    await upsertProject({ ...project, name: trimmed })
  }

  async function removeProject(id: string): Promise<void> {
    await conversation.removeProject(id)
    projects.value = projects.value.filter((item) => item.id !== id)
    pinnedProjectIds.value = pinnedProjectIds.value.filter((item) => item !== id)
    savePinnedProjectIds(pinnedProjectIds.value)
    if (activeProjectId.value === id) {
      activeProjectId.value = projects.value[0]?.id ?? null
      await persistState()
    }
  }

  async function revealProject(id: string): Promise<void> {
    const project = projects.value.find((item) => item.id === id)
    if (!project?.rootPath) return
    await unwrap(ipc.app.showItemInFolder(project.rootPath))
  }

  async function createWorktreeForProject(id: string): Promise<void> {
    const project = projects.value.find((item) => item.id === id)
    if (!project) return
    await activateProject(project)
    await setStartupMode('worktree')
    await addProjectFromDialog()
  }

  function resetOnLogout(): void {
    loaded.value = false
    projects.value = []
    activeProjectId.value = null
    gitBranch.value = null
    gitStatus.value = { branch: null, dirtyCount: 0, isRepository: false }
    gitBranches.value = []
    pinnedProjectIds.value = []
    savePinnedProjectIds([])
  }

  async function upsertProject(entry: ProjectEntry): Promise<void> {
    await conversation.upsertProject(entry)
    const index = projects.value.findIndex((p) => p.rootPath === entry.rootPath)
    if (index >= 0) {
      projects.value[index] = { ...projects.value[index], ...entry, id: entry.rootPath }
    } else {
      projects.value.unshift(entry)
    }
    logger.info('upsert project', { id: entry.id, rootPath: entry.rootPath })
  }

  async function activateProject(project: ProjectEntry): Promise<void> {
    activeProjectId.value = project.id
    await persistState()
    if (project.rootPath) {
      logger.info('activate project', { id: project.id, rootPath: project.rootPath })
      await useWorkspaceStore().setWorkspace(project.rootPath)
      await refreshGitBranch()
    }
  }

  async function selectProject(id: string): Promise<void> {
    const project = projects.value.find((p) => p.id === id)
    if (!project) return
    await activateProject(project)
  }

  async function activateByPath(rootPath: string): Promise<void> {
    let project = projects.value.find((p) => p.rootPath === rootPath)
    if (!project) {
      project = {
        id: rootPath,
        name: nameFromPath(rootPath),
        rootPath,
        addedAt: Date.now()
      }
      await upsertProject(project)
    }
    await activateProject(project)
  }

  async function addProjectFromDialog(): Promise<ProjectEntry | null> {
    let path: string
    try {
      path = await unwrap<string>(ipc.app.openFolderDialog())
    } catch (e) {
      if (isDialogCancel(e)) return null
      throw e
    }
    const entry: ProjectEntry = {
      id: path,
      name: nameFromPath(path),
      rootPath: path,
      addedAt: Date.now()
    }
    await upsertProject(entry)
    await activateProject(entry)
    return entry
  }

  async function ensureWorkspace(): Promise<boolean> {
    if (hasWorkspace.value) return true
    const entry = await addProjectFromDialog()
    return Boolean(entry)
  }

  async function setStartupMode(mode: StartupMode): Promise<void> {
    startupMode.value = mode
    await persistState()
  }

  async function setApprovalMode(mode: ApprovalMode): Promise<void> {
    approvalMode.value = mode
    await persistState()
  }

  async function pickWorktree(): Promise<void> {
    await setStartupMode('worktree')
    await addProjectFromDialog()
  }

  function searchProjects(query: string): ProjectEntry[] {
    const q = query.trim().toLowerCase()
    if (!q) return projects.value
    return projects.value.filter(
      (p) => p.name.toLowerCase().includes(q) || p.rootPath.toLowerCase().includes(q)
    )
  }

  return {
    projects,
    activeProjectId,
    activeProject,
    hasWorkspace,
    projectLabel,
    startupMode,
    startupModeLabel,
    approvalMode,
    gitBranch,
    gitStatus,
    gitBranches,
    gitBranchLabel,
    pinnedProjectIds,
    isPinned,
    togglePinProject,
    renameProject,
    removeProject,
    revealProject,
    createWorktreeForProject,
    load,
    selectProject,
    activateByPath,
    addProjectFromDialog,
    ensureWorkspace,
    setStartupMode,
    setApprovalMode,
    pickWorktree,
    checkoutBranch,
    createBranch,
    searchProjects,
    refreshGitBranch,
    resetOnLogout
  }
})

function isDialogCancel(error: unknown): boolean {
  return error instanceof Error
    ? error.message.includes('取消') || error.message.toLowerCase().includes('cancel')
    : String(error).includes('取消')
}
