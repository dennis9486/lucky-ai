<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronDown,
  ChevronRight,
  CloudDownload,
  CloudUpload,
  GitBranch,
  GitCommitHorizontal,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  SearchCheck,
  Sparkles,
  Trash2
} from 'lucide-vue-next'
import type {
  WorkspaceGitCommitResult,
  WorkspaceGitConflictFile,
  WorkspaceGitFileDiff,
  WorkspaceGitFileHunks,
  WorkspaceGitGraphLine,
  WorkspaceGitReviewResult,
  WorkspaceGitFileStatus,
  WorkspaceGitStashEntry,
  WorkspaceGitStatus,
  WorkspaceGitSyncResult
} from '../../../shared/types/workspace.js'
import { ipc, unwrap } from '../../services/ipc-client.js'
import { useEditorStore } from '../../stores/editor.store.js'
import { useProjectStore } from '../../stores/project.store.js'
import { useWorkspaceStore } from '../../stores/workspace.store.js'
import { getFileIcon } from '../../utils/file-icons.js'

const { t } = useI18n()
const editor = useEditorStore()
const projects = useProjectStore()
const workspace = useWorkspaceStore()

const commitMessage = ref('')
const amendCommit = ref(false)
const loading = ref(false)
const committing = ref(false)
const suggesting = ref(false)
const error = ref('')
const lastCommit = ref('')
const changesOpen = ref(true)
const reviewOpen = ref(false)
const reviewing = ref(false)
const reviewResult = ref('')
const reviewFallback = ref(false)
const graphOpen = ref(false)
const graphLoading = ref(false)
const graphLines = ref<WorkspaceGitGraphLine[]>([])
const failedIcons = ref(new Set<string>())
const actingPath = ref<string | null>(null)
const expandedHunkPath = ref<string | null>(null)
const loadingHunkPath = ref<string | null>(null)
const hunkCache = ref<Record<string, WorkspaceGitFileHunks>>({})

const status = computed(() => projects.gitStatus)
const files = computed(() => status.value.files ?? [])
const stagedFiles = computed(() => files.value.filter((file) => file.index !== ' ' && file.index !== '?'))
const unstagedFiles = computed(() => files.value.filter((file) => file.workingTree !== ' ' && file.workingTree !== '?'))
const conflictFiles = computed(() => files.value.filter((file) => file.conflicted))
const rootPath = computed(() => projects.activeProject?.rootPath)
const stagedCount = computed(() => stagedFiles.value.length)
const canCommit = computed(() =>
  Boolean(
    rootPath.value
    && status.value.isRepository
    && (stagedCount.value > 0 || amendCommit.value)
    && commitMessage.value.trim()
    && !committing.value
  )
)
const syncing = ref(false)
const stashOpen = ref(false)
const stashLoading = ref(false)
const stashMessage = ref('')
const stashes = ref<WorkspaceGitStashEntry[]>([])
const actingStashIndex = ref<number | null>(null)

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    await Promise.all([
      projects.refreshGitBranch(),
      workspace.refreshTree()
    ])
    if (graphOpen.value) await loadGitGraph()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function loadGitGraph(): Promise<void> {
  if (!rootPath.value || !status.value.isRepository) {
    graphLines.value = []
    return
  }
  graphLoading.value = true
  try {
    if (typeof ipc.workspace.listGitGraph !== 'function') {
      throw new Error(t('git.preloadOutdated'))
    }
    graphLines.value = await unwrap<WorkspaceGitGraphLine[]>(ipc.workspace.listGitGraph(rootPath.value, 35))
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    graphLines.value = []
  } finally {
    graphLoading.value = false
  }
}

async function toggleGraph(): Promise<void> {
  graphOpen.value = !graphOpen.value
  if (graphOpen.value) await loadGitGraph()
}

async function commitAll(): Promise<void> {
  if (!canCommit.value) return
  committing.value = true
  error.value = ''
  lastCommit.value = ''
  try {
    if (typeof ipc.workspace.commitStaged !== 'function') {
      throw new Error(t('git.preloadOutdated'))
    }
    const result = await unwrap<WorkspaceGitCommitResult>(
      ipc.workspace.commitStaged(commitMessage.value, rootPath.value, amendCommit.value)
    )
    projects.gitStatus = result.status
    projects.gitBranch = result.status.branch
    commitMessage.value = ''
    amendCommit.value = false
    lastCommit.value = result.commit ? t('git.committed', { commit: result.commit }) : t('git.committedNoHash')
    await refresh()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    committing.value = false
  }
}

async function suggestCommitMessage(): Promise<void> {
  if (!rootPath.value || suggesting.value || !files.value.length) return
  suggesting.value = true
  error.value = ''
  lastCommit.value = ''
  try {
    if (typeof ipc.workspace.suggestCommitMessage !== 'function') {
      throw new Error(t('git.preloadOutdated'))
    }
    const message = await unwrap<string>(ipc.workspace.suggestCommitMessage(rootPath.value))
    if (message) commitMessage.value = message
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    suggesting.value = false
  }
}

async function reviewChanges(): Promise<void> {
  if (!rootPath.value || reviewing.value || !files.value.length) return
  reviewOpen.value = true
  reviewing.value = true
  error.value = ''
  reviewResult.value = ''
  reviewFallback.value = false
  try {
    if (typeof ipc.workspace.reviewGitChanges !== 'function') {
      throw new Error(t('git.preloadOutdated'))
    }
    const result = await unwrap<WorkspaceGitReviewResult>(ipc.workspace.reviewGitChanges(rootPath.value))
    reviewResult.value = result.summary
    reviewFallback.value = result.fallback
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    reviewing.value = false
  }
}

function reviewButtonLabel(): string {
  return reviewing.value ? t('git.reviewing') : t('git.findIssues')
}

async function openDiff(file: WorkspaceGitFileStatus): Promise<void> {
  error.value = ''
  try {
    if (file.conflicted && typeof ipc.workspace.getGitConflictFile === 'function') {
      const conflict = await unwrap<WorkspaceGitConflictFile>(ipc.workspace.getGitConflictFile(file.path, rootPath.value))
      await editor.openFile(file.path)
      editor.showConflictView(conflict)
      return
    }
    if (typeof ipc.workspace.getGitFileDiff !== 'function') {
      throw new Error(t('git.preloadOutdated'))
    }
    const diff = await unwrap<WorkspaceGitFileDiff>(ipc.workspace.getGitFileDiff(file.path, rootPath.value))
    editor.showDiffView(diff.path, diff.original, diff.modified, {
      readOnly: true,
      title: diff.binary && diff.message ? `${diff.path} · ${diff.message}` : diff.path
    })
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    await editor.openFile(file.path).catch(() => undefined)
  }
}

async function stageFile(file: WorkspaceGitFileStatus): Promise<void> {
  await runFileAction(file.path, async () => {
    projects.gitStatus = await unwrap(ipc.workspace.stageGitFile(file.path, rootPath.value))
    projects.gitBranch = projects.gitStatus.branch
    delete hunkCache.value[file.path]
  })
}

async function unstageFile(file: WorkspaceGitFileStatus): Promise<void> {
  await runFileAction(file.path, async () => {
    if (typeof ipc.workspace.unstageGitFile !== 'function') throw new Error(t('git.preloadOutdated'))
    projects.gitStatus = await unwrap(ipc.workspace.unstageGitFile(file.path, rootPath.value))
    projects.gitBranch = projects.gitStatus.branch
    delete hunkCache.value[file.path]
  })
}

async function stageHunk(file: WorkspaceGitFileStatus, index: number, staged: boolean): Promise<void> {
  const key = `${file.path}:${index}`
  await runFileAction(key, async () => {
    if (typeof ipc.workspace.stageGitHunk !== 'function') throw new Error(t('git.preloadOutdated'))
    projects.gitStatus = await unwrap(ipc.workspace.stageGitHunk(file.path, index, rootPath.value, staged))
    projects.gitBranch = projects.gitStatus.branch
    delete hunkCache.value[file.path]
  })
}

async function unstageHunk(file: WorkspaceGitFileStatus, index: number): Promise<void> {
  const key = `${file.path}:unstage:${index}`
  await runFileAction(key, async () => {
    if (typeof ipc.workspace.unstageGitHunk !== 'function') throw new Error(t('git.preloadOutdated'))
    projects.gitStatus = await unwrap(ipc.workspace.unstageGitHunk(file.path, index, rootPath.value))
    projects.gitBranch = projects.gitStatus.branch
    delete hunkCache.value[file.path]
  })
}

async function pullChanges(): Promise<void> {
  if (!rootPath.value || syncing.value) return
  syncing.value = true
  error.value = ''
  try {
    const result = await unwrap<WorkspaceGitSyncResult>(ipc.workspace.pullGit(rootPath.value))
    projects.gitStatus = result.status
    projects.gitBranch = result.status.branch
    lastCommit.value = result.summary
    await refresh()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    syncing.value = false
  }
}

async function pushChanges(): Promise<void> {
  if (!rootPath.value || syncing.value) return
  syncing.value = true
  error.value = ''
  try {
    const setUpstream = !status.value.upstream
    const result = await unwrap<WorkspaceGitSyncResult>(ipc.workspace.pushGit(rootPath.value, setUpstream))
    projects.gitStatus = result.status
    projects.gitBranch = result.status.branch
    lastCommit.value = result.summary
    await refresh()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    syncing.value = false
  }
}

async function toggleHunks(file: WorkspaceGitFileStatus, staged = false): Promise<void> {
  const cacheKey = `${file.path}:${staged ? 'staged' : 'unstaged'}`
  if (expandedHunkPath.value === cacheKey) {
    expandedHunkPath.value = null
    return
  }
  expandedHunkPath.value = cacheKey
  if (hunkCache.value[cacheKey]) return

  loadingHunkPath.value = cacheKey
  error.value = ''
  try {
    hunkCache.value = {
      ...hunkCache.value,
      [cacheKey]: await unwrap<WorkspaceGitFileHunks>(ipc.workspace.getGitFileHunks(file.path, rootPath.value, staged))
    }
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loadingHunkPath.value = null
  }
}

function hunkCacheKey(file: WorkspaceGitFileStatus, staged: boolean): string {
  return `${file.path}:${staged ? 'staged' : 'unstaged'}`
}

async function discardFile(file: WorkspaceGitFileStatus): Promise<void> {
  await runFileAction(file.path, async () => {
    if (typeof ipc.workspace.discardGitFile !== 'function') {
      throw new Error(t('git.preloadOutdated'))
    }
    projects.gitStatus = await unwrap(ipc.workspace.discardGitFile(file.path, rootPath.value))
    projects.gitBranch = projects.gitStatus.branch
    await workspace.refreshTree()
  })
}

async function toggleStash(): Promise<void> {
  stashOpen.value = !stashOpen.value
  if (stashOpen.value) await loadStashes()
}

async function loadStashes(): Promise<void> {
  if (!rootPath.value || !status.value.isRepository) {
    stashes.value = []
    return
  }
  stashLoading.value = true
  try {
    stashes.value = await unwrap<WorkspaceGitStashEntry[]>(ipc.workspace.listGitStashes(rootPath.value))
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    stashes.value = []
  } finally {
    stashLoading.value = false
  }
}

async function pushStash(): Promise<void> {
  if (!rootPath.value || stashLoading.value || !files.value.length) return
  stashLoading.value = true
  error.value = ''
  try {
    projects.gitStatus = await unwrap<WorkspaceGitStatus>(ipc.workspace.pushGitStash(stashMessage.value, rootPath.value))
    projects.gitBranch = projects.gitStatus.branch
    stashMessage.value = ''
    await Promise.all([loadStashes(), workspace.refreshTree()])
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    stashLoading.value = false
  }
}

async function applyStash(entry: WorkspaceGitStashEntry, pop: boolean): Promise<void> {
  await runStashAction(entry.index, async () => {
    projects.gitStatus = await unwrap<WorkspaceGitStatus>(ipc.workspace.applyGitStash(entry.index, pop, rootPath.value))
    projects.gitBranch = projects.gitStatus.branch
    await Promise.all([loadStashes(), workspace.refreshTree()])
  })
}

async function dropStash(entry: WorkspaceGitStashEntry): Promise<void> {
  await runStashAction(entry.index, async () => {
    projects.gitStatus = await unwrap<WorkspaceGitStatus>(ipc.workspace.dropGitStash(entry.index, rootPath.value))
    await loadStashes()
  })
}

async function runStashAction(index: number, action: () => Promise<void>): Promise<void> {
  if (actingStashIndex.value !== null) return
  actingStashIndex.value = index
  error.value = ''
  try {
    await action()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    actingStashIndex.value = null
  }
}

async function runFileAction(path: string, action: () => Promise<void>): Promise<void> {
  if (actingPath.value) return
  actingPath.value = path
  error.value = ''
  lastCommit.value = ''
  try {
    await action()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    actingPath.value = null
  }
}

function getStatusCode(file: WorkspaceGitFileStatus): string {
  if (file.index === '?' || file.workingTree === '?') return 'U'
  if (file.index !== ' ' && file.workingTree !== ' ') return `${file.index}${file.workingTree}`.trim()
  return (file.workingTree !== ' ' ? file.workingTree : file.index).trim() || 'M'
}

function getStatusTone(file: WorkspaceGitFileStatus): string {
  const code = getStatusCode(file)
  if (code.includes('D')) return 'deleted'
  if (code.includes('A') || code.includes('U')) return 'added'
  if (code.includes('R')) return 'renamed'
  return 'modified'
}

function displayPath(path: string): string {
  const parts = path.split('/')
  if (parts.length <= 1) return ''
  return parts.slice(0, -1).join('/')
}

function displayName(path: string): string {
  return path.split('/').pop() ?? path
}

function getResultIcon(path: string): string {
  return failedIcons.value.has(path) ? '' : getFileIcon(path)
}

function fallbackResultIcon(path: string): void {
  failedIcons.value = new Set([...failedIcons.value, path])
}
</script>

<template>
  <section class="git-panel">
    <header class="git-header">
      <button type="button" class="section-toggle" @click="changesOpen = !changesOpen">
        <ChevronDown v-if="changesOpen" :size="15" />
        <ChevronRight v-else :size="15" />
        <span>{{ t('git.changesTitle') }}</span>
      </button>
      <div class="git-actions">
        <button type="button" class="icon-btn" :title="t('git.pull')" :disabled="syncing" @click="pullChanges">
          <CloudDownload :size="15" :class="{ spinning: syncing }" />
        </button>
        <button type="button" class="icon-btn" :title="t('git.push')" :disabled="syncing" @click="pushChanges">
          <CloudUpload :size="15" :class="{ spinning: syncing }" />
        </button>
        <button type="button" class="icon-btn" :title="t('git.refresh')" :disabled="loading || syncing" @click="refresh">
          <RefreshCw :size="15" :class="{ spinning: loading || syncing }" />
        </button>
      </div>
    </header>

    <template v-if="projects.hasWorkspace && status.isRepository">
      <div class="commit-box">
        <input
          v-model="commitMessage"
          type="text"
          spellcheck="false"
          :placeholder="t('git.commitPlaceholder', { branch: status.branch ?? 'HEAD' })"
          @keydown.meta.enter.prevent="commitAll"
          @keydown.ctrl.enter.prevent="commitAll"
        />
        <button
          type="button"
          class="spark-btn"
          :title="t('git.generateMessage')"
          :disabled="suggesting || !files.length"
          @click="suggestCommitMessage"
        >
          <Sparkles :size="15" :class="{ spinning: suggesting }" />
        </button>
      </div>

      <button type="button" class="commit-btn" :disabled="!canCommit" @click="commitAll">
        <Check :size="16" />
        <span>{{ committing ? t('git.committing') : t('git.commitStaged', { count: stagedCount }) }}</span>
      </button>

      <label class="amend-row">
        <input v-model="amendCommit" type="checkbox" />
        <span>{{ t('git.amendCommit') }}</span>
      </label>

      <p v-if="conflictFiles.length" class="git-message conflict">{{ t('git.conflicts', { count: conflictFiles.length }) }}</p>

      <p v-if="error" class="git-message error">{{ error }}</p>
      <p v-else-if="lastCommit" class="git-message success">{{ lastCommit }}</p>

      <div v-if="changesOpen" class="changes-block">
        <button type="button" class="changes-head" @click="changesOpen = !changesOpen">
          <ChevronDown :size="14" />
          <span>{{ t('git.changes') }}</span>
          <strong>{{ files.length }}</strong>
        </button>

        <div v-if="stagedFiles.length" class="changes-section">
          <div class="changes-head static">
            <span>{{ t('git.stagedChanges') }}</span>
            <strong>{{ stagedFiles.length }}</strong>
          </div>
          <div class="changes-list pretty-scrollbar">
            <div v-for="file in stagedFiles" :key="`staged:${file.path}`" class="change-item">
              <div role="button" tabindex="0" class="change-row" @click="openDiff(file)" @keydown.enter.prevent="openDiff(file)">
                <button type="button" class="hunk-toggle" :title="t('git.showHunks')" @click.stop="toggleHunks(file, true)">
                  <ChevronDown v-if="expandedHunkPath === hunkCacheKey(file, true)" :size="13" />
                  <ChevronRight v-else :size="13" />
                </button>
                <img v-if="getResultIcon(file.path)" class="change-icon" :src="getResultIcon(file.path)" alt="" @error="fallbackResultIcon(file.path)" />
                <GitCommitHorizontal v-else :size="15" class="change-fallback-icon" />
                <span class="change-name">{{ displayName(file.path) }}</span>
                <span class="change-path">{{ displayPath(file.path) }}</span>
                <span class="change-actions">
                  <button type="button" class="change-action" :title="t('git.unstageFile')" @click.stop="unstageFile(file)"><Minus :size="14" /></button>
                </span>
                <span class="change-status modified">{{ getStatusCode(file) }}</span>
              </div>
              <div v-if="expandedHunkPath === hunkCacheKey(file, true)" class="hunk-list">
                <div
                  v-for="(hunk, index) in hunkCache[hunkCacheKey(file, true)]?.hunks ?? []"
                  :key="`staged-hunk:${index}`"
                  role="button"
                  tabindex="0"
                  class="hunk-row"
                  @click="openDiff(file)"
                  @keydown.enter.prevent="openDiff(file)"
                >
                  <span class="hunk-header">{{ hunk.header }}</span>
                  <span class="hunk-stat"><span class="added">+{{ hunk.additions }}</span><span class="deleted">-{{ hunk.deletions }}</span></span>
                  <button type="button" class="hunk-action" :title="t('git.unstageHunk')" @click.stop="unstageHunk(file, index)"><Minus :size="12" /></button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="unstagedFiles.length" class="changes-section">
          <div class="changes-head static">
            <span>{{ t('git.unstagedChanges') }}</span>
            <strong>{{ unstagedFiles.length }}</strong>
          </div>
          <div class="changes-list pretty-scrollbar">
            <div v-for="file in unstagedFiles" :key="`unstaged:${file.path}`" class="change-item">
              <div role="button" tabindex="0" class="change-row" :class="{ conflict: file.conflicted }" @click="openDiff(file)">
                <button type="button" class="hunk-toggle" @click.stop="toggleHunks(file, false)">
                  <ChevronDown v-if="expandedHunkPath === hunkCacheKey(file, false)" :size="13" />
                  <ChevronRight v-else :size="13" />
                </button>
                <img v-if="getResultIcon(file.path)" class="change-icon" :src="getResultIcon(file.path)" alt="" @error="fallbackResultIcon(file.path)" />
                <GitCommitHorizontal v-else :size="15" class="change-fallback-icon" />
                <span class="change-name">{{ displayName(file.path) }}</span>
                <span class="change-path">{{ displayPath(file.path) }}</span>
                <span class="change-actions">
                  <button type="button" class="change-action" :title="t('git.discardFile')" @click.stop="discardFile(file)"><RotateCcw :size="14" /></button>
                  <button type="button" class="change-action" :title="t('git.stageFile')" @click.stop="stageFile(file)"><Plus :size="16" /></button>
                </span>
                <span class="change-status" :class="getStatusTone(file)">{{ getStatusCode(file) }}</span>
              </div>
              <div v-if="expandedHunkPath === hunkCacheKey(file, false)" class="hunk-list">
                <div
                  v-for="(hunk, index) in hunkCache[hunkCacheKey(file, false)]?.hunks ?? []"
                  :key="`unstaged-hunk:${index}`"
                  role="button"
                  tabindex="0"
                  class="hunk-row"
                  @click="openDiff(file)"
                  @keydown.enter.prevent="openDiff(file)"
                >
                  <span class="hunk-header">{{ hunk.header }}</span>
                  <span class="hunk-stat"><span class="added">+{{ hunk.additions }}</span><span class="deleted">-{{ hunk.deletions }}</span></span>
                  <button type="button" class="hunk-action" :title="t('git.stageHunk')" @click.stop="stageHunk(file, index, false)"><Plus :size="12" /></button>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div v-if="!files.length" class="git-empty">{{ t('git.noChanges') }}</div>
      </div>

      <div class="aux-section">
        <button type="button" class="section-toggle small" @click="toggleStash()">
          <ChevronDown v-if="stashOpen" :size="14" />
          <ChevronRight v-else :size="14" />
          <span>{{ t('git.stashTitle') }}</span>
          <strong v-if="stashes.length" class="stash-count">{{ stashes.length }}</strong>
        </button>
        <div v-if="stashOpen" class="stash-body">
          <div class="stash-push">
            <input
              v-model="stashMessage"
              type="text"
              spellcheck="false"
              :placeholder="t('git.stashMessagePlaceholder')"
              @keydown.enter.prevent="pushStash"
            />
            <button
              type="button"
              class="stash-action"
              :title="t('git.stashSave')"
              :disabled="stashLoading || !files.length"
              @click="pushStash"
            >
              <Archive :size="14" :class="{ spinning: stashLoading }" />
            </button>
          </div>
          <div v-if="stashes.length" class="stash-list pretty-scrollbar">
            <div v-for="entry in stashes" :key="entry.index" class="stash-row">
              <span class="stash-desc" :title="entry.description">{{ entry.description }}</span>
              <span class="stash-time">{{ entry.relativeTime }}</span>
              <span class="stash-actions">
                <button
                  type="button"
                  class="stash-action"
                  :title="t('git.stashPop')"
                  :disabled="actingStashIndex !== null"
                  @click="applyStash(entry, true)"
                >
                  <ArchiveRestore :size="13" />
                </button>
                <button
                  type="button"
                  class="stash-action"
                  :title="t('git.stashApply')"
                  :disabled="actingStashIndex !== null"
                  @click="applyStash(entry, false)"
                >
                  <RotateCcw :size="13" />
                </button>
                <button
                  type="button"
                  class="stash-action danger"
                  :title="t('git.stashDrop')"
                  :disabled="actingStashIndex !== null"
                  @click="dropStash(entry)"
                >
                  <Trash2 :size="13" />
                </button>
              </span>
            </div>
          </div>
          <p v-else-if="!stashLoading" class="stash-empty">{{ t('git.stashEmpty') }}</p>
        </div>
      </div>

      <div class="aux-section">
        <button type="button" class="section-toggle small" @click="reviewOpen = !reviewOpen">
          <ChevronDown v-if="reviewOpen" :size="14" />
          <ChevronRight v-else :size="14" />
          <span>{{ t('git.agentReview') }}</span>
        </button>
        <div v-if="reviewOpen" class="review-body">
          <button type="button" class="review-btn" :disabled="reviewing || !files.length" @click="reviewChanges">
            <SearchCheck :size="16" :class="{ spinning: reviewing }" />
            <span>{{ reviewButtonLabel() }}</span>
          </button>
          <pre
            v-if="reviewResult"
            class="review-result pretty-scrollbar"
            :class="{ fallback: reviewFallback }"
          >{{ reviewResult }}</pre>
          <p v-else>{{ t('git.reviewHint') }}</p>
        </div>
      </div>

      <div class="aux-section">
        <button type="button" class="section-toggle small" @click="toggleGraph()">
          <ChevronDown v-if="graphOpen" :size="14" />
          <ChevronRight v-else :size="14" />
          <span>{{ t('git.graph') }}</span>
        </button>
        <div v-if="graphOpen" class="graph-body">
          <p v-if="graphLoading" class="graph-status">{{ t('git.graphLoading') }}</p>
          <pre v-else-if="graphLines.length" class="graph-log pretty-scrollbar">{{ graphLines.map((line) => line.raw).join('\n') }}</pre>
          <p v-else>{{ t('git.graphEmpty') }}</p>
        </div>
      </div>
    </template>

    <div v-else class="git-empty large">
      <GitBranch :size="28" />
      <p>{{ projects.hasWorkspace ? t('git.notRepository') : t('code.openProjectHint') }}</p>
    </div>
  </section>
</template>

<style scoped>
.git-panel {
  @apply flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-codex-sidebar text-codex-text;
}
.git-header {
  @apply flex h-10 shrink-0 items-center justify-between px-3;
}
.section-toggle {
  @apply flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1 text-left text-[13px] font-bold uppercase tracking-wide
         text-codex-text transition-colors hover:bg-codex-hover;
}
.section-toggle.small {
  @apply w-full justify-start text-[12px];
}
.git-actions {
  @apply flex items-center gap-1;
}
.icon-btn {
  @apply flex h-7 w-7 items-center justify-center rounded-md text-codex-text-secondary transition-colors
         hover:bg-codex-hover hover:text-codex-text disabled:cursor-not-allowed disabled:opacity-40;
}
.commit-box {
  @apply mx-3 flex h-8 shrink-0 items-center gap-1 rounded-md border border-codex-border bg-codex-bg px-2
         focus-within:border-codex-accent;
}
.commit-box input {
  @apply min-w-0 flex-1 bg-transparent text-[13px] font-medium text-codex-text outline-none placeholder:text-codex-muted;
}
.spark-btn {
  @apply flex h-6 w-6 items-center justify-center rounded text-codex-text-secondary transition-colors hover:bg-codex-hover hover:text-codex-text;
}
.commit-btn {
  @apply mx-3 mt-2 flex h-8 shrink-0 items-center justify-center gap-2 rounded-md bg-[#3f87b8] text-[13px] font-semibold text-white
         transition-colors hover:bg-[#3578a7] disabled:cursor-not-allowed disabled:opacity-45;
}
.git-message {
  @apply mx-3 mt-2 rounded-md px-3 py-2 text-[12px] font-medium;
}
.git-message.error {
  @apply bg-red-50 text-red-600;
}
.git-message.success {
  @apply bg-green-50 text-green-700;
}
.changes-block {
  @apply mt-2 flex min-h-0 flex-1 flex-col overflow-hidden border-t border-codex-border;
}
.changes-head {
  @apply flex h-9 shrink-0 items-center gap-1.5 px-3 text-left text-[13px] font-semibold text-codex-text-secondary transition-colors hover:bg-codex-hover hover:text-codex-text;
}
.changes-head span {
  @apply flex-1;
}
.changes-head.static {
  @apply cursor-default;
}
.changes-section + .changes-section {
  @apply border-t border-codex-border;
}
.change-row.conflict {
  background: color-mix(in srgb, #c2413b 8%, transparent);
}
.hunk-action {
  @apply ml-auto flex h-5 w-5 items-center justify-center rounded text-codex-text-secondary hover:bg-codex-bg hover:text-codex-text;
}
.git-message.conflict {
  @apply bg-red-50 text-red-700;
}
.changes-list {
  @apply min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-1;
  scrollbar-width: thin;
}
.change-item {
  border-bottom: 1px solid color-mix(in srgb, var(--codex-border) 70%, transparent);
}
.change-item:last-child {
  border-bottom: 0;
}
.change-row {
  @apply flex h-8 w-full cursor-pointer items-center gap-1.5 px-2.5 text-left text-[13px] font-medium text-codex-text
         outline-none transition-colors hover:bg-codex-hover focus-visible:bg-codex-hover;
}
.hunk-toggle {
  @apply flex h-5 w-5 shrink-0 items-center justify-center rounded text-codex-text-secondary transition-colors
         hover:bg-codex-bg hover:text-codex-text;
}
.change-icon {
  @apply h-4 w-4 shrink-0 object-contain;
}
.change-fallback-icon {
  @apply shrink-0 text-codex-text-secondary;
}
.change-name {
  @apply min-w-0 truncate font-semibold text-codex-text;
}
.change-path {
  @apply min-w-0 flex-1 truncate text-[12px] font-medium text-codex-text-secondary;
}
.change-actions {
  @apply ml-auto hidden shrink-0 items-center gap-0.5 rounded-md bg-codex-hover px-0.5;
}
.change-row:hover .change-actions,
.change-row:focus-within .change-actions {
  @apply flex;
}
.change-action {
  @apply flex h-6 w-6 items-center justify-center rounded text-codex-text-secondary transition-colors
         hover:bg-codex-bg hover:text-codex-text disabled:cursor-not-allowed disabled:opacity-40;
}
.change-status {
  @apply w-5 shrink-0 text-right text-[12px] font-bold;
}
.change-status.modified,
.change-status.renamed {
  color: #3d7f9f;
}
.change-status.added {
  color: #248a52;
}
.change-status.deleted {
  color: #c2413b;
}
.hunk-list {
  @apply pb-1 pl-8 pr-2;
  background: color-mix(in srgb, var(--codex-bg) 55%, var(--codex-sidebar));
}
.hunk-row {
  @apply flex min-h-7 w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left text-[11px] outline-none transition-colors hover:bg-codex-hover focus-visible:bg-codex-hover;
}
.hunk-header {
  @apply min-w-0 flex-1 truncate font-mono text-codex-text-secondary;
}
.hunk-stat {
  @apply inline-flex shrink-0 items-center gap-1 font-mono text-[11px] font-semibold;
}
.hunk-stat .added {
  @apply text-emerald-600;
}
.hunk-stat .deleted {
  @apply text-red-500;
}
.hunk-empty {
  @apply px-2 py-2 text-[11px] font-medium text-codex-muted;
}
.amend-row {
  @apply mx-3 mt-1.5 flex cursor-pointer select-none items-center gap-1.5 text-[12px] font-medium text-codex-text-secondary;
}
.amend-row input {
  @apply h-3.5 w-3.5 accent-[#3f87b8];
}
.aux-section {
  @apply shrink-0 border-t border-codex-border px-3 py-1.5;
}
.stash-count {
  @apply ml-auto rounded bg-codex-hover px-1.5 text-[11px] font-semibold text-codex-text-secondary;
}
.stash-body {
  @apply px-1 py-1.5;
}
.stash-push {
  @apply flex h-7 items-center gap-1 rounded-md border border-codex-border bg-codex-bg px-2 focus-within:border-codex-accent;
}
.stash-push input {
  @apply min-w-0 flex-1 bg-transparent text-[12px] font-medium text-codex-text outline-none placeholder:text-codex-muted;
}
.stash-list {
  @apply mt-1.5 max-h-40 overflow-y-auto;
}
.stash-row {
  @apply flex min-h-7 items-center gap-2 rounded px-1.5 py-0.5 text-[12px] transition-colors hover:bg-codex-hover;
}
.stash-desc {
  @apply min-w-0 flex-1 truncate font-medium text-codex-text;
}
.stash-time {
  @apply shrink-0 text-[11px] text-codex-muted;
}
.stash-actions {
  @apply hidden shrink-0 items-center gap-0.5;
}
.stash-row:hover .stash-actions {
  @apply flex;
}
.stash-action {
  @apply flex h-6 w-6 items-center justify-center rounded text-codex-text-secondary transition-colors
         hover:bg-codex-bg hover:text-codex-text disabled:cursor-not-allowed disabled:opacity-40;
}
.stash-action.danger:hover {
  @apply text-red-500;
}
.stash-empty {
  @apply mt-1.5 px-1 text-[12px] font-medium text-codex-muted;
}
.review-body p,
.graph-body p {
  @apply mt-1.5 text-[12px] font-medium leading-relaxed text-codex-text-secondary;
}
.graph-status {
  @apply px-1 py-1 text-[12px] font-medium text-codex-muted;
}
.graph-log {
  @apply mt-1 max-h-52 overflow-auto rounded-md border border-codex-border bg-codex-bg p-2
         whitespace-pre font-mono text-[11px] leading-relaxed text-codex-text;
}
.review-btn {
  @apply mt-1.5 flex h-8 w-full items-center justify-center gap-2 rounded-md bg-[#3f87b8] text-[13px] font-semibold text-white
         transition-colors hover:bg-[#3578a7] disabled:cursor-not-allowed disabled:opacity-50;
}
.review-result {
  @apply mt-2 max-h-44 overflow-auto rounded-md border border-codex-border bg-codex-bg p-2.5
         whitespace-pre-wrap text-left font-mono text-[11px] leading-relaxed text-codex-text;
}
.review-result.fallback {
  @apply text-codex-text-secondary;
}
.graph-body {
  @apply px-1 py-1.5 text-codex-text-secondary;
}
.git-empty {
  @apply px-5 py-8 text-center text-[12px] font-medium leading-relaxed text-codex-text-secondary;
}
.git-empty.large {
  @apply flex min-h-[220px] flex-col items-center justify-center gap-3;
}
.spinning {
  animation: git-spin 0.9s linear infinite;
}
@keyframes git-spin {
  to { transform: rotate(360deg); }
}
</style>
