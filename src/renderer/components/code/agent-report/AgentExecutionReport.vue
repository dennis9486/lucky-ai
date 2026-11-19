<script setup lang="ts">
import { computed } from 'vue'
import type { MessagePart, ToolCallPart } from '../../../../shared/types/ai.js'
import { buildDiff, type DiffLine } from '../../../utils/tool-display.js'
import { getToolFilePath, isMutatingAgentTool } from '../../../utils/agent-tool-path.js'
import TaskSummary from './TaskSummary.vue'
import ExecutionSummary from './ExecutionSummary.vue'
import PatchCard from './PatchCard.vue'
import ToolCallCard from './ToolCallCard.vue'
import TerminalCard from './TerminalCard.vue'
import MarkdownMessage from './MarkdownMessage.vue'
import type { AgentReportPatch, AgentReportStats } from './report-types.js'

type ReportBlock =
  | { type: 'markdown'; id: string; text: string }
  | { type: 'patch'; id: string; patch: AgentReportPatch }
  | { type: 'terminal'; id: string; tool: ToolCallPart }
  | { type: 'tool'; id: string; tool: ToolCallPart }

const props = defineProps<{
  parts: MessagePart[]
  task?: string
  live?: boolean
  isEditing?: boolean
  disabled?: boolean
  workspaceRoot?: string | null
  /** 该轮是否可回滚文件修改（主进程已捕获前像） */
  revertEnabled?: boolean
}>()

const emit = defineEmits<{ editTask: []; rollbackTask: []; revertFiles: [] }>()

const tools = computed(() => props.parts.filter((part): part is ToolCallPart => part.type === 'tool'))
/** 仅当该轮确实动过文件（存在成功的写类工具调用）时才提供文件回滚入口 */
const canRevertFiles = computed(() =>
  Boolean(props.revertEnabled)
  && tools.value.some((tool) => (isMutatingAgentTool(tool.name) || tool.name === 'GeneratePdf') && tool.status === 'success')
)
const orderedBlocks = computed<ReportBlock[]>(() => {
  const blocks: ReportBlock[] = []
  let textBuffer = ''
  let textIndex = 0

  const flushText = () => {
    const text = textBuffer.trim()
    if (!text) {
      textBuffer = ''
      return
    }
    blocks.push({ type: 'markdown', id: `text:${textIndex++}`, text })
    textBuffer = ''
  }

  props.parts.forEach((part, index) => {
    if (part.type === 'text') {
      textBuffer += `${textBuffer ? '\n\n' : ''}${part.text}`
      return
    }
    if (part.type === 'thinking') return
    flushText()
    if (part.name === 'Bash') {
      blocks.push({ type: 'terminal', id: part.id || `terminal:${index}`, tool: part })
      return
    }
    if (isPatchTool(part)) {
      const patch = patchForTool(part)
      if (patch) blocks.push({ type: 'patch', id: patch.id, patch })
      else blocks.push({ type: 'tool', id: part.id || `tool:${index}`, tool: part })
      return
    }
    blocks.push({ type: 'tool', id: part.id || `tool:${index}`, tool: part })
  })
  flushText()
  return blocks
})

const stats = computed<AgentReportStats>(() => {
  const filePaths = new Set<string>()
  let searches = 0
  let fetches = 0
  let commands = 0
  let edits = 0
  let failed = 0

  for (const tool of tools.value) {
    if (tool.status === 'error') failed++
    if (isPatchTool(tool)) edits++
    if (tool.name === 'Bash') commands++
    if (tool.name === 'Grep' || tool.name === 'Glob' || tool.name === 'WebSearch') searches++
    if (tool.name === 'WebFetch' || tool.name === 'WebCrawl') fetches++
    if (tool.name === 'Read' || isPatchTool(tool)) {
      const path = getToolFilePath(tool, props.workspaceRoot) || inferPath(tool)
      if (path) filePaths.add(path)
    }
  }

  return {
    files: filePaths.size,
    searches,
    fetches,
    commands,
    edits,
    failed
  }
})

const hasReportContent = computed(() =>
  Boolean(props.task?.trim() || orderedBlocks.value.length)
)

/**
 * 流式光标只应出现在「当前正在生成」的那个块上——即最后一个块。
 * 若最后一个块是 markdown，说明正文还在追加；只有它需要 streaming 光标，
 * 其余历史 markdown 块均为已完成内容，避免出现多个闪烁光标。
 */
const lastBlockId = computed(() => orderedBlocks.value.at(-1)?.id ?? '')

function patchForTool(tool: ToolCallPart): AgentReportPatch | null {
  const path = getToolFilePath(tool, props.workspaceRoot) || inferPath(tool)
  if (!path) return null
  const lines = diffForTool(tool)
  return {
    id: `patch:${tool.id || path}`,
    path,
    name: basename(path || tool.name),
    additions: countLines(lines, 'add'),
    deletions: countLines(lines, 'del'),
    status: tool.status,
    lines,
    tools: [tool]
  }
}

function diffForTool(tool: ToolCallPart): DiffLine[] {
  const direct = buildDiff(tool)
  if (direct?.length) return direct

  const input = tool.input ?? {}
  const oldText = stringInput(input.old_string) || stringInput(input.oldString)
  const newText = stringInput(input.new_string) || stringInput(input.newString)
  if (oldText || newText) return textPairToDiff(oldText, newText)
  const content = stringInput(input.content) || stringInput(input.text) || stringInput(input.new_content)
  if (content && isWriteTool(tool.name)) return content.split('\n').map((line) => ({ kind: 'add', text: line }))

  if (!isMultiEditTool(tool.name)) return parseUnifiedDiff(tool.output)
  const edits = Array.isArray(tool.input?.edits) ? tool.input.edits : []
  const lines: DiffLine[] = []
  for (const edit of edits) {
    if (!edit || typeof edit !== 'object') continue
    const record = edit as Record<string, unknown>
    const oldText = stringInput(record.old_string) || stringInput(record.oldString)
    const newText = stringInput(record.new_string) || stringInput(record.newString)
    lines.push(...textPairToDiff(oldText, newText))
  }
  return lines.length ? lines : parseUnifiedDiff(tool.output)
}

function inferPath(tool: ToolCallPart): string {
  const input = tool.input ?? {}
  for (const key of ['file_path', 'filePath', 'path', 'target_path', 'targetPath', 'absolute_path', 'absolutePath']) {
    const value = input[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function isPatchTool(tool: ToolCallPart): boolean {
  if (isMutatingAgentTool(tool.name)) return true
  const normalized = normalizeToolName(tool.name)
  if (['writefile', 'createfile', 'editfile', 'replacefile', 'updatefile', 'applypatch', 'strreplaceeditor'].includes(normalized)) {
    return true
  }
  const input = tool.input ?? {}
  return Boolean(
    inferPath(tool)
      && (
        stringInput(input.content)
        || stringInput(input.text)
        || stringInput(input.old_string)
        || stringInput(input.new_string)
        || stringInput(input.oldString)
        || stringInput(input.newString)
        || Array.isArray(input.edits)
        || parseUnifiedDiff(tool.output).length
      )
  )
}

function isWriteTool(name: string): boolean {
  return ['write', 'writefile', 'createfile'].includes(normalizeToolName(name))
}

function isMultiEditTool(name: string): boolean {
  return ['multiedit', 'applypatch', 'strreplaceeditor'].includes(normalizeToolName(name))
}

function normalizeToolName(name: string): string {
  return name.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function textPairToDiff(oldText: string, newText: string): DiffLine[] {
  const lines: DiffLine[] = []
  if (oldText) for (const line of oldText.split('\n')) lines.push({ kind: 'del', text: line })
  if (newText) for (const line of newText.split('\n')) lines.push({ kind: 'add', text: line })
  return lines
}

function parseUnifiedDiff(output: string): DiffLine[] {
  if (!output.includes('\n+') && !output.includes('\n-')) return []
  const lines: DiffLine[] = []
  for (const raw of output.split('\n')) {
    if (raw.startsWith('+++') || raw.startsWith('---') || raw.startsWith('@@')) continue
    if (raw.startsWith('+')) lines.push({ kind: 'add', text: raw.slice(1) })
    else if (raw.startsWith('-')) lines.push({ kind: 'del', text: raw.slice(1) })
    else if (lines.length) lines.push({ kind: 'ctx', text: raw.replace(/^ /, '') })
  }
  return lines
}

function countLines(lines: DiffLine[], kind: DiffLine['kind']): number {
  return lines.filter((line) => line.kind === kind).length
}

function stringInput(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function basename(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return normalized.split('/').filter(Boolean).pop() || path
}
</script>

<template>
  <section v-if="hasReportContent" class="agent-execution-report">
    <TaskSummary
      :text="task"
      :is-editing="isEditing"
      :disabled="disabled"
      :can-revert-files="canRevertFiles"
      @edit="emit('editTask')"
      @rollback="emit('rollbackTask')"
      @revert-files="emit('revertFiles')"
    />
    <ExecutionSummary :stats="stats" :details-count="tools.length" />
    <div v-if="orderedBlocks.length" class="report-flow">
      <template v-for="block in orderedBlocks" :key="block.id">
        <MarkdownMessage v-if="block.type === 'markdown'" :source="block.text" :streaming="live && block.id === lastBlockId" />
        <PatchCard v-else-if="block.type === 'patch'" :patch="block.patch" />
        <TerminalCard v-else-if="block.type === 'terminal'" :tool="block.tool" />
        <ToolCallCard v-else :tool="block.tool" />
      </template>
    </div>
  </section>
</template>

<style scoped>
.agent-execution-report {
  display: flex;
  flex-direction: column;
  gap: 12px;
  color: var(--codex-text, #202020);
  font-size: var(--code-agent-content-size, 12.5px);
  line-height: var(--code-agent-content-line, 1.62);
}
.report-flow {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
</style>
