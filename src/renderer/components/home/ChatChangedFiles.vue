<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, CheckCircle2, ChevronRight, FilePenLine, Terminal, Wrench } from 'lucide-vue-next'
import type { AgentRunSummary, MessagePart, ToolCallPart, ToolCallStatus } from '../../../shared/types/ai.js'
import type { FileReadResult } from '../../../shared/types/ipc.js'
import type { WorkspaceGitFileDiff } from '../../../shared/types/workspace.js'
import { buildDiff } from '../../utils/tool-display.js'
import { getFileIcon } from '../../utils/file-icons.js'
import { ipc, unwrap } from '../../services/ipc-client.js'
import { useEditorStore } from '../../stores/editor.store.js'
import { useProjectStore } from '../../stores/project.store.js'
import { useUiStore } from '../../stores/ui.store.js'

const props = defineProps<{
  parts?: MessagePart[]
  summary?: AgentRunSummary
}>()

const { t } = useI18n()
const editor = useEditorStore()
const project = useProjectStore()
const ui = useUiStore()
const open = ref(false)

interface ChangedFileItem {
  path: string
  name: string
  icon: string
  additions: number
  deletions: number
  toolIds: string[]
}

const changedFiles = computed(() => collectChangedFiles(props.parts ?? [], props.summary))
const totalAdditions = computed(() => changedFiles.value.reduce((sum, file) => sum + file.additions, 0))
const totalDeletions = computed(() => changedFiles.value.reduce((sum, file) => sum + file.deletions, 0))
const verificationCommands = computed(() => props.summary?.verificationCommands ?? [])
const failureReasons = computed(() => props.summary?.failureReasons ?? [])
const toolCount = computed(() => props.summary?.toolCount ?? 0)
const failedToolCount = computed(() => props.summary?.failedToolCount ?? 0)
const hasSummaryContent = computed(() =>
  toolCount.value > 0
  || changedFiles.value.length > 0
  || verificationCommands.value.length > 0
  || failureReasons.value.length > 0
)
const summaryTone = computed<'success' | 'warning' | 'neutral'>(() => {
  if (failedToolCount.value > 0 || failureReasons.value.length > 0) return 'warning'
  if (changedFiles.value.length > 0 || verificationCommands.value.length > 0 || toolCount.value > 0) return 'success'
  return 'neutral'
})
const summaryTitle = computed(() => {
  if (summaryTone.value === 'warning') return t('chat.runSummaryNeedsAttention')
  if (changedFiles.value.length > 0) return t('chat.runSummaryEdited')
  if (verificationCommands.value.length > 0) return t('chat.runSummaryVerified')
  return t('chat.runSummary')
})

function collectChangedFiles(parts: MessagePart[], summary?: AgentRunSummary): ChangedFileItem[] {
  const files = new Map<string, ChangedFileItem>()

  for (const part of parts) {
    if (part.type !== 'tool' || !isAppliedMutation(part)) continue
    const path = getToolFilePath(part)
    if (!path) continue
    upsertFile(files, path, part)
  }

  for (const path of summary?.changedFiles ?? []) {
    const normalized = toWorkspaceRelativePath(path)
    if (!normalized || files.has(normalized)) continue
    upsertFile(files, normalized)
  }

  return [...files.values()]
}

function upsertFile(files: Map<string, ChangedFileItem>, path: string, part?: ToolCallPart): void {
  const normalized = toWorkspaceRelativePath(path)
  if (!normalized) return
  const stats = part ? toolDiffStats(part) : { additions: 0, deletions: 0 }
  const existing = files.get(normalized)
  if (existing) {
    existing.additions += stats.additions
    existing.deletions += stats.deletions
    if (part) existing.toolIds.push(part.id)
    return
  }
  const name = getBaseName(normalized)
  files.set(normalized, {
    path: normalized,
    name,
    icon: getFileIcon(name),
    additions: stats.additions,
    deletions: stats.deletions,
    toolIds: part ? [part.id] : []
  })
}

function toolDiffStats(part: ToolCallPart): { additions: number; deletions: number } {
  const diff = buildDiff(part) ?? []
  let additions = 0
  let deletions = 0
  for (const line of diff) {
    if (line.kind === 'add') additions += 1
    else if (line.kind === 'del') deletions += 1
  }
  return { additions, deletions }
}

function isAppliedMutation(part: ToolCallPart): boolean {
  return ['Write', 'Edit', 'MultiEdit'].includes(part.name) && part.status === 'success'
}

function getToolFilePath(part: ToolCallPart): string {
  const input = part.input ?? {}
  return (
    stringInput(input.file_path)
    || stringInput(input.path)
    || stringInput(input.target_path)
    || stringInput(input.absolute_path)
  )
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
  return (props.parts ?? []).filter(
    (part): part is ToolCallPart => {
      if (part.type !== 'tool' || !isAppliedMutation(part)) return false
      const toolPath = getToolFilePath(part)
      return Boolean(toolPath) && toWorkspaceRelativePath(toolPath) === path
    }
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

  if (project.gitStatus.isRepository && rootPath && typeof ipc.workspace.getGitFileDiff === 'function') {
    try {
      const diff = await unwrap<WorkspaceGitFileDiff>(ipc.workspace.getGitFileDiff(path, rootPath))
      if (diff.binary) return null
      return { original: diff.original, modified: diff.modified }
    } catch {
      // Fall back to tool-based reconstruction.
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
      readOnly: true,
      inline: true,
      title: getBaseName(path)
    })
    return
  }
  await editor.openFile(path).catch(() => undefined)
}

async function reviewChangedFiles(): Promise<void> {
  const first = changedFiles.value[0]
  if (first) await openChangedFile(first.path)
}

function commandStatusLabel(status: ToolCallStatus): string {
  switch (status) {
    case 'success': return t('chat.runSummaryStatusSuccess')
    case 'error': return t('chat.runSummaryStatusFailed')
    case 'rejected': return t('chat.runSummaryStatusSkipped')
    case 'running': return t('chat.runSummaryStatusRunning')
    default: return t('chat.runSummaryStatusPending')
  }
}
</script>

<template>
  <section v-if="hasSummaryContent" class="chat-run-summary" :class="`is-${summaryTone}`">
    <header class="summary-head">
      <button type="button" class="summary-toggle" :aria-expanded="open" @click="open = !open">
        <ChevronRight :size="15" class="summary-chev" :class="{ open }" />
        <CheckCircle2 v-if="summaryTone === 'success'" :size="15" class="summary-state-icon" />
        <AlertTriangle v-else-if="summaryTone === 'warning'" :size="15" class="summary-state-icon" />
        <Wrench v-else :size="15" class="summary-state-icon" />
        <span>{{ summaryTitle }}</span>
      </button>
      <div class="summary-chips">
        <span v-if="toolCount" class="summary-chip">
          <Wrench :size="12" />
          {{ t('chat.runSummaryTools', { count: toolCount }) }}
        </span>
        <span v-if="changedFiles.length" class="summary-chip">
          <FilePenLine :size="12" />
          {{ t('chat.editedFiles', { count: changedFiles.length }) }}
        </span>
        <span v-if="verificationCommands.length" class="summary-chip">
          <Terminal :size="12" />
          {{ t('chat.runSummaryVerifications', { count: verificationCommands.length }) }}
        </span>
        <span v-if="failedToolCount" class="summary-chip is-warning">
          <AlertTriangle :size="12" />
          {{ t('chat.runSummaryFailures', { count: failedToolCount }) }}
        </span>
        <button v-if="changedFiles.length" type="button" class="summary-review" @click="reviewChangedFiles">
          {{ t('codeAgent.reviewChangedFiles') }}
        </button>
      </div>
    </header>

    <div v-if="open" class="summary-body">
      <section v-if="changedFiles.length" class="summary-section">
        <div class="section-head">
          <span>{{ t('chat.runSummaryEditedFiles') }}</span>
          <span class="section-stats">
            <span v-if="totalAdditions" class="changed-add">+{{ totalAdditions }}</span>
            <span v-if="totalDeletions" class="changed-del">-{{ totalDeletions }}</span>
          </span>
        </div>
        <div class="changed-list">
          <button
            v-for="file in changedFiles"
            :key="file.path"
            type="button"
            class="changed-file"
            :title="file.path"
            @click="openChangedFile(file.path)"
          >
            <img :src="file.icon" class="changed-icon" alt="" draggable="false" />
            <span class="changed-path">{{ file.path }}</span>
            <span v-if="file.additions" class="changed-add">+{{ file.additions }}</span>
            <span v-if="file.deletions" class="changed-del">-{{ file.deletions }}</span>
          </button>
        </div>
      </section>

      <section v-if="verificationCommands.length" class="summary-section">
        <div class="section-head">
          <span>{{ t('chat.runSummaryVerification') }}</span>
        </div>
        <div class="command-list">
          <div v-for="item in verificationCommands" :key="`${item.command}:${item.status}`" class="command-row">
            <code>{{ item.command }}</code>
            <span class="command-status" :class="`is-${item.status}`">{{ commandStatusLabel(item.status) }}</span>
          </div>
        </div>
      </section>

      <section v-if="failureReasons.length" class="summary-section">
        <div class="section-head">
          <span>{{ t('chat.runSummaryIssues') }}</span>
        </div>
        <ul class="issue-list">
          <li v-for="reason in failureReasons" :key="reason">{{ reason }}</li>
        </ul>
      </section>
    </div>
  </section>
</template>

<style scoped>
.chat-run-summary {
  width: 100%;
  overflow: hidden;
  border: 1px solid var(--codex-border, #dedede);
  border-radius: 8px;
  background: color-mix(in srgb, var(--codex-bg, #fff) 96%, var(--codex-hover, #f2f2f2));
}
.chat-run-summary.is-success {
  border-color: color-mix(in srgb, #079455 26%, var(--codex-border, #dedede));
}
.chat-run-summary.is-warning {
  border-color: color-mix(in srgb, #d97706 32%, var(--codex-border, #dedede));
}
.summary-head {
  display: flex;
  min-height: 40px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 0 10px;
}
.summary-toggle,
.summary-review,
.changed-file {
  border: 0;
  background: transparent;
}
.summary-toggle {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 7px;
  color: var(--codex-text, #222);
  font-size: 13px;
  font-weight: 620;
}
.summary-chev {
  flex-shrink: 0;
  color: var(--codex-muted, #8b8b8b);
  transition: transform 0.14s ease;
}
.summary-chev.open {
  transform: rotate(90deg);
}
.summary-state-icon {
  flex-shrink: 0;
  color: var(--codex-muted, #8b8b8b);
}
.is-success .summary-state-icon {
  color: #079455;
}
.is-warning .summary-state-icon {
  color: #d97706;
}
.summary-chips {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
  justify-content: flex-end;
}
.summary-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--codex-text, #222) 5%, transparent);
  padding: 3px 7px;
  color: var(--codex-text-secondary, #555);
  font-size: 12px;
  font-weight: 560;
}
.summary-chip.is-warning {
  background: color-mix(in srgb, #d97706 12%, transparent);
  color: #b45309;
}
.changed-add {
  color: #079455;
}
.changed-del {
  color: #d92d20;
}
.summary-review {
  margin-left: 4px;
  border-radius: 7px;
  background: var(--codex-hover, #efefef);
  padding: 4px 9px;
  color: var(--codex-text, #222);
  font-family: inherit;
  font-size: 12px;
  font-weight: 620;
}
.summary-review:hover,
.changed-file:hover {
  background: var(--codex-hover, #f1f1f1);
}
.summary-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
  border-top: 1px solid var(--codex-border, #dedede);
  padding: 10px;
}
.summary-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--codex-muted, #777);
  font-size: 11.5px;
  font-weight: 650;
  text-transform: uppercase;
}
.section-stats {
  display: inline-flex;
  gap: 6px;
  font-family: var(--codex-code-font, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  text-transform: none;
}
.changed-list {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--codex-border, #dedede);
  border-radius: 7px;
}
.changed-file {
  display: flex;
  min-height: 34px;
  width: 100%;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  text-align: left;
}
.changed-file + .changed-file {
  border-top: 1px solid var(--codex-border, #dedede);
}
.changed-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
}
.changed-path {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--codex-text-secondary, #555);
  font-size: 12.5px;
  font-weight: 520;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.command-list {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--codex-border, #dedede);
  border-radius: 7px;
}
.command-row {
  display: flex;
  min-height: 32px;
  align-items: center;
  gap: 8px;
  padding: 0 9px;
}
.command-row + .command-row {
  border-top: 1px solid var(--codex-border, #dedede);
}
.command-row code {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  color: var(--codex-text-secondary, #555);
  font-family: var(--codex-code-font, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.command-status {
  flex-shrink: 0;
  border-radius: 999px;
  padding: 2px 7px;
  color: var(--codex-muted, #777);
  background: color-mix(in srgb, var(--codex-text, #222) 5%, transparent);
  font-size: 11.5px;
  font-weight: 650;
}
.command-status.is-success {
  color: #067647;
  background: color-mix(in srgb, #079455 12%, transparent);
}
.command-status.is-error {
  color: #b42318;
  background: color-mix(in srgb, #d92d20 12%, transparent);
}
.issue-list {
  margin: 0;
  border: 1px solid color-mix(in srgb, #d97706 24%, var(--codex-border, #dedede));
  border-radius: 7px;
  padding: 7px 10px 7px 24px;
  color: var(--codex-text-secondary, #555);
  font-size: 12.5px;
}
@media (max-width: 720px) {
  .summary-head {
    align-items: flex-start;
    flex-direction: column;
    padding: 9px 10px;
  }
  .summary-chips {
    justify-content: flex-start;
  }
}
</style>
