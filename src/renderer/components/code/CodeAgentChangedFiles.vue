<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, ChevronRight, X } from 'lucide-vue-next'
import type { MessagePart, ToolCallPart } from '../../../shared/types/ai.js'
import type { FileReadResult } from '../../../shared/types/ipc.js'
import type { WorkspaceGitFileDiff } from '../../../shared/types/workspace.js'
import { createLogger } from '../../../shared/utils/log.js'
import { buildDiff } from '../../utils/tool-display.js'
import { getFileIcon } from '../../utils/file-icons.js'
import { ipc, unwrap } from '../../services/ipc-client.js'
import { useCodeAgentStore } from '../../stores/code-agent.store.js'
import { useSettingsStore } from '../../stores/settings.store.js'
import { useEditorStore } from '../../stores/editor.store.js'
import { useUiStore } from '../../stores/ui.store.js'
import { useProjectStore } from '../../stores/project.store.js'

/**
 * 待审变更文件卡片：从工具调用流里汇总已落盘的修改，
 * 支持逐个/批量 保留（keep）与撤销（undo，仅 Git 仓库），点击打开 diff。
 * 审查状态持久化在 Code Agent 会话（reviewedChangeSignatures）。
 */
const { t } = useI18n()
const agent = useCodeAgentStore()
const settings = useSettingsStore()
const editor = useEditorStore()
const ui = useUiStore()
const project = useProjectStore()
const logger = createLogger('renderer/code-agent-changed-files')

const collapsed = ref(true)

interface ChangedFileItem {
  path: string
  name: string
  icon: string
  additions: number
  deletions: number
  toolIds: string[]
}

const changedFiles = computed(() => collectChangedFiles(agent.parts))
/** 已审查（保留/撤销）的变更签名集合；持久化到 Code Agent 会话，刷新后仍生效。 */
const reviewedSignatures = computed(() => new Set(agent.activeSession?.reviewedChangeSignatures ?? []))
const isGitWorkspace = computed(() => project.gitStatus.isRepository)
const pendingChangedFiles = computed(() =>
  changedFiles.value.filter((file) => !reviewedSignatures.value.has(changeSignature(file)))
)

/**
 * 工具入参在调用完成后不再变化，故按 tool id 缓存 diff 行数，
 * 避免流式期间每个 delta 都对（可能很大的）文件内容反复做 diff 切分。
 */
const diffStatsCache = new Map<string, { additions: number; deletions: number }>()

function toolDiffStats(part: ToolCallPart): { additions: number; deletions: number } {
  const cached = diffStatsCache.get(part.id)
  if (cached) return cached
  const diff = buildDiff(part) ?? []
  let additions = 0
  let deletions = 0
  for (const line of diff) {
    if (line.kind === 'add') additions += 1
    else if (line.kind === 'del') deletions += 1
  }
  const stats = { additions, deletions }
  diffStatsCache.set(part.id, stats)
  return stats
}

function collectChangedFiles(parts: MessagePart[]): ChangedFileItem[] {
  const files = new Map<string, ChangedFileItem>()
  for (const part of parts) {
    if (part.type !== 'tool') continue
    // 仅统计「已成功应用」的修改：pending/running/error/rejected 都未真正落盘，
    // 计入会让待审列表出现“假变更”，keep/undo 也无的放矢。
    if (!isAppliedMutation(part)) continue
    const path = getToolFilePath(part)
    if (!path) continue
    const { additions, deletions } = toolDiffStats(part)
    const name = getBaseName(path)
    const existing = files.get(path)
    if (existing) {
      existing.additions += additions
      existing.deletions += deletions
      existing.toolIds.push(part.id)
      continue
    }
    files.set(path, {
      path,
      name,
      icon: getFileIcon(name),
      additions,
      deletions,
      toolIds: [part.id]
    })
  }
  return [...files.values()]
}

function isMutatingTool(part: ToolCallPart): boolean {
  return ['Write', 'Edit', 'MultiEdit'].includes(part.name)
}

/** 已成功应用（落盘）的修改类工具——审查与原始内容重建都应只看这些 */
function isAppliedMutation(part: ToolCallPart): boolean {
  return isMutatingTool(part) && part.status === 'success'
}

function getToolFilePath(part: ToolCallPart): string {
  const input = part.input ?? {}
  const raw = (
    stringInput(input.file_path)
    || stringInput(input.path)
    || stringInput(input.target_path)
    || stringInput(input.absolute_path)
  )
  return toWorkspaceRelativePath(raw)
}

function toWorkspaceRelativePath(path: string): string {
  let normalized = path.replace(/\\/g, '/').trim()
  if (!normalized) return normalized

  const root = project.activeProject?.rootPath?.replace(/\\/g, '/').replace(/\/$/, '') ?? ''
  if (root && (normalized === root || normalized.startsWith(`${root}/`))) {
    normalized = normalized === root ? '' : normalized.slice(root.length + 1)
  } else {
    normalized = normalized.replace(/^\//, '')
  }
  return normalized.replace(/^\.\/+/, '')
}

function stringInput(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function getBaseName(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path
}

function getMutatingToolsForPath(path: string): ToolCallPart[] {
  // 重建原始内容时只回退已成功应用的编辑；否则会把被拒绝/失败的编辑也“反向”掉，得到错误的原文。
  return agent.parts.filter(
    (part): part is ToolCallPart =>
      part.type === 'tool' && isAppliedMutation(part) && getToolFilePath(part) === path
  )
}

function reverseSingleEdit(content: string, oldText: string, newText: string): string {
  if (!newText) return content
  const index = content.indexOf(newText)
  if (index === -1) return content
  return content.slice(0, index) + oldText + content.slice(index + newText.length)
}

function reverseToolEdit(content: string, part: ToolCallPart): string {
  const input = part.input ?? {}
  if (part.name === 'Write') return ''
  if (part.name === 'Edit') {
    return reverseSingleEdit(content, stringInput(input.old_string), stringInput(input.new_string))
  }
  if (part.name === 'MultiEdit') {
    const edits = Array.isArray(input.edits) ? input.edits : []
    return edits.reduceRight((state, edit) => {
      if (!edit || typeof edit !== 'object') return state
      const record = edit as Record<string, unknown>
      return reverseSingleEdit(state, stringInput(record.old_string), stringInput(record.new_string))
    }, content)
  }
  return content
}

function reconstructOriginalFromTools(path: string, modified: string): string {
  return getMutatingToolsForPath(path).reduceRight(
    (content, part) => reverseToolEdit(content, part),
    modified
  )
}

async function resolveChangedFileDiff(path: string): Promise<{ original: string; modified: string } | null> {
  const rootPath = project.activeProject?.rootPath

  if (isGitWorkspace.value && rootPath && typeof ipc.workspace.getGitFileDiff === 'function') {
    try {
      const diff = await unwrap<WorkspaceGitFileDiff>(ipc.workspace.getGitFileDiff(path, rootPath))
      if (diff.binary) return null
      return { original: diff.original, modified: diff.modified }
    } catch {
      // fall through to tool-based reconstruction
    }
  }

  try {
    const modified = (await unwrap<FileReadResult>(ipc.file.read(path))).content
    const original = reconstructOriginalFromTools(path, modified)
    if (original === modified) return null
    return { original, modified }
  } catch {
    return null
  }
}

async function openChangedFile(path: string): Promise<void> {
  ui.currentView = 'code'
  const diff = await resolveChangedFileDiff(path)
  if (diff) {
    await editor.openFile(path).catch(() => undefined)
    editor.showDiffView(path, diff.original, diff.modified, {
      readOnly: false,
      inline: true,
      title: getBaseName(path)
    })
    return
  }
  await editor.openFile(path).catch(() => undefined)
}

async function reviewChangedFiles(): Promise<void> {
  const first = pendingChangedFiles.value[0]
  if (!first) return
  if (settings.general.codeReviewView === 'separate') {
    ui.currentView = 'code'
    ui.codeSidebarTab = 'git'
    return
  }
  await openChangedFile(first.path)
}

function changeSignature(file: ChangedFileItem): string {
  return `${file.path}:${file.additions}:${file.deletions}:${file.toolIds.join(',')}`
}

function markReviewed(files: ChangedFileItem[]): void {
  if (!files.length) return
  agent.markReviewedChanges(files.map(changeSignature))
}

/** 保留：接受改动，仅从待审列表移除 */
function keepFile(file: ChangedFileItem): void {
  markReviewed([file])
}

function keepAllChanges(): void {
  markReviewed(pendingChangedFiles.value)
}

/** 通过 git 还原该文件的工作区改动并刷新已打开的缓冲区；返回是否成功（失败则保留待审，不误判已处理） */
async function discardFileOnDisk(file: ChangedFileItem): Promise<boolean> {
  const gitPath = toWorkspaceRelativePath(file.path)
  if (!gitPath) return false
  try {
    await unwrap(ipc.workspace.discardGitFile(gitPath, project.activeProject?.rootPath))
    await editor.reloadFiles([gitPath]).catch(() => undefined)
    return true
  } catch (error) {
    logger.error('discard changed file failed', { path: file.path, error })
    return false
  }
}

/** 撤销：还原文件后从待审列表移除（仅 Git 仓库可用） */
async function undoFile(file: ChangedFileItem): Promise<void> {
  if (!isGitWorkspace.value) return
  if (await discardFileOnDisk(file)) markReviewed([file])
}

async function undoAllChanges(): Promise<void> {
  if (!isGitWorkspace.value) return
  const files = [...pendingChangedFiles.value]
  const undone: ChangedFileItem[] = []
  for (const file of files) {
    if (await discardFileOnDisk(file)) undone.push(file)
  }
  // 仅批量标记真正成功还原的文件，避免逐个触发会话持久化写入
  markReviewed(undone)
}
</script>

<template>
  <div v-if="pendingChangedFiles.length" class="changed-files-card" :class="{ collapsed }">
    <div class="changed-files-head">
      <button type="button" class="changed-files-toggle" @click="collapsed = !collapsed">
        <ChevronRight :size="15" class="changed-files-chev" :class="{ open: !collapsed }" />
        <span>{{ t('codeAgent.changedFiles', { count: pendingChangedFiles.length }) }}</span>
      </button>
      <div class="changed-files-actions">
        <button
          v-if="isGitWorkspace"
          type="button"
          class="changed-head-action"
          @click="undoAllChanges"
        >
          {{ t('codeAgent.changedFilesUndoAll') }}
        </button>
        <button type="button" class="changed-head-action" @click="keepAllChanges">
          {{ t('codeAgent.changedFilesKeepAll') }}
        </button>
        <button type="button" class="changed-review-btn" @click="reviewChangedFiles">
          {{ t('codeAgent.reviewChangedFiles') }}
        </button>
      </div>
    </div>

    <div v-if="!collapsed" class="changed-files-list">
      <div
        v-for="file in pendingChangedFiles"
        :key="file.path"
        class="changed-file-row"
        role="button"
        tabindex="0"
        :title="file.path"
        @click="openChangedFile(file.path)"
        @keydown.enter.prevent="openChangedFile(file.path)"
      >
        <img :src="file.icon" class="changed-file-icon" alt="" draggable="false" />
        <span class="changed-file-name">{{ file.name }}</span>
        <span v-if="file.additions" class="changed-add">+{{ file.additions }}</span>
        <span v-if="file.deletions" class="changed-del">-{{ file.deletions }}</span>
        <span class="changed-row-actions">
          <button
            v-if="isGitWorkspace"
            type="button"
            class="changed-row-btn is-undo"
            :title="t('codeAgent.changedFileUndo')"
            :aria-label="t('codeAgent.changedFileUndo')"
            @click.stop="undoFile(file)"
          >
            <X :size="14" :stroke-width="2" />
          </button>
          <button
            type="button"
            class="changed-row-btn is-keep"
            :title="t('codeAgent.changedFileKeep')"
            :aria-label="t('codeAgent.changedFileKeep')"
            @click.stop="keepFile(file)"
          >
            <Check :size="14" :stroke-width="2" />
          </button>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.changed-files-card {
  margin-bottom: 8px;
  overflow: hidden;
  border: 1px solid var(--codex-border, #e5e5e5);
  border-radius: 12px;
  background: var(--codex-bg, #fafafa);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.08);
}
.changed-files-card.collapsed {
  box-shadow: none;
}
.changed-files-head {
  display: flex;
  min-height: 36px;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 0 8px 0 10px;
}
.changed-files-toggle {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  color: var(--codex-text-secondary, #4a4a4a);
  font-size: 12.5px;
  font-weight: 560;
}
.changed-files-chev {
  flex-shrink: 0;
  color: var(--codex-muted, #8a8a8a);
  transition: transform 0.14s ease;
}
.changed-files-chev.open {
  transform: rotate(90deg);
}
.changed-files-actions {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 2px;
}
.changed-head-action {
  border-radius: 7px;
  padding: 3px 7px;
  color: var(--codex-muted, #8a8a8a);
  font-size: 12.5px;
  font-weight: 500;
  transition: background 0.12s ease, color 0.12s ease;
}
.changed-head-action:hover {
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-text, #1a1a1a);
}
.changed-review-btn {
  flex-shrink: 0;
  border-radius: 7px;
  background: var(--codex-hover, #f0f0f0);
  padding: 3px 9px;
  color: var(--codex-text, #1a1a1a);
  font-size: 12.5px;
  font-weight: 600;
  transition: background 0.12s ease;
}
.changed-review-btn:hover {
  background: color-mix(in srgb, var(--codex-hover, #f0f0f0) 64%, var(--codex-text, #1a1a1a));
  color: var(--codex-bg, #fafafa);
}
.changed-files-list {
  max-height: min(260px, 38vh);
  overflow: auto;
  border-top: 1px solid var(--codex-border, #e5e5e5);
  padding: 4px 6px 8px;
}
.changed-files-list::-webkit-scrollbar {
  width: 7px;
}
.changed-files-list::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: color-mix(in srgb, var(--codex-muted, #8a8a8a) 34%, transparent);
}
.changed-file-row {
  display: flex;
  width: 100%;
  min-width: 0;
  min-height: 27px;
  align-items: center;
  gap: 7px;
  border-radius: 7px;
  padding: 3px 6px;
  color: var(--codex-text, #1a1a1a);
  text-align: left;
  font-size: 12.5px;
}
.changed-file-row:hover {
  background: var(--codex-hover, #f0f0f0);
}
.changed-file-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}
.changed-file-name {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.changed-add,
.changed-del {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.changed-add {
  color: #059669;
}
.changed-del {
  color: #e11d48;
}
.changed-row-actions {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 2px;
  margin-left: 2px;
}
.changed-row-btn {
  display: inline-flex;
  height: 22px;
  width: 22px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--codex-muted, #8a8a8a);
  transition: background 0.12s ease, color 0.12s ease;
}
.changed-row-btn.is-keep:hover {
  background: color-mix(in srgb, #059669 16%, transparent);
  color: #059669;
}
.changed-row-btn.is-undo:hover {
  background: color-mix(in srgb, #e11d48 16%, transparent);
  color: #e11d48;
}
</style>
