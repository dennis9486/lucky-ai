<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { BookOpen, ChevronRight, File, Folder, GitBranch, Globe2, MessageSquare, SquareTerminal } from 'lucide-vue-next'
import type { FileSearchResult } from '../../../shared/types/workspace.js'
import {
  buildMentionOptions,
  detectMention,
  filterMentionOptions,
  insertAtCursor,
  isInstantMention,
  rankFileResults,
  type MentionKind,
  type MentionOption
} from '../../utils/mention.js'
import { ipc, unwrap } from '../../services/ipc-client.js'
import { useProjectStore } from '../../stores/project.store.js'
import { useEditorStore } from '../../stores/editor.store.js'
import { getFileIcon } from '../../utils/file-icons.js'

type PathMentionKind = 'file' | 'folder'
type MentionGroup = 'tab' | 'file' | 'action'
type MentionListItem =
  | {
      type: 'open-tab' | 'path'
      group: MentionGroup
      kind: PathMentionKind
      path: string
      label: string
      detail: string
      title: string
      icon?: string
    }
  | {
      type: 'option'
      group: MentionGroup
      kind: MentionKind
      label: string
      insert: string
      detail: string
      title: string
    }

const { t } = useI18n()
const projects = useProjectStore()
const editor = useEditorStore()

const props = defineProps<{
  text: string
  cursorPos: number
  open: boolean
  pathMode?: 'text' | 'reference'
  /** 富文本模式下，由外部强制进入文件/文件夹选择，无需文本里的 `@file ` 前缀 */
  forcedKind?: 'file' | 'folder' | null
  /** 点击外部关闭时忽略的区域（通常是输入框） */
  dismissIgnore?: HTMLElement | null
}>()

const emit = defineEmits<{
  select: [text: string, cursorPos: number]
  reference: [payload: { kind: 'file' | 'folder'; path: string; name: string }]
  option: [payload: { kind: MentionKind; insert: string }]
  close: []
}>()

const activeIndex = ref(0)
const fileResults = ref<FileSearchResult[]>([])
const loading = ref(false)
const popoverRef = ref<HTMLElement | null>(null)
const dismissIgnoreTarget = computed(() => props.dismissIgnore ?? undefined)

onClickOutside(popoverRef, () => {
  if (props.open) emit('close')
}, {
  ignore: [dismissIgnoreTarget]
})

const mention = computed(() => detectMention(props.text, props.cursorPos))
const mentionOptions = computed(() => buildMentionOptions(t))

const options = computed((): MentionOption[] => {
  if (!mention.value) return []
  return filterMentionOptions(mention.value.query, mention.value.kind, mentionOptions.value)
})

/** 当前生效的选择类别：优先外部强制(富文本下钻)，否则取文本里的 `@file `/`@folder ` */
const pickerKind = computed<'file' | 'folder' | null>(() => {
  if (props.forcedKind === 'file' || props.forcedKind === 'folder') return props.forcedKind
  if (mention.value?.kind === 'file' || mention.value?.kind === 'folder') return mention.value.kind
  return null
})

const isPickerMode = computed(() => pickerKind.value !== null)
const isRootMention = computed(
  () => Boolean(mention.value && mention.value.kind === null && !props.forcedKind)
)

const fileQuery = computed(() => {
  const kind = pickerKind.value
  if (!kind || !mention.value) return ''
  // 富文本下钻：没有 `@file ` 前缀，直接用 @ 后的查询
  if (props.forcedKind) return mention.value.query.trim()
  const prefix = kind === 'file' ? '@file ' : '@folder '
  const segment = props.text.slice(mention.value.triggerIndex)
  if (!segment.startsWith(prefix)) return ''
  return segment.slice(prefix.length).trim()
})

const rootQuery = computed(() => (isRootMention.value ? mention.value?.query.trim() ?? '' : ''))

/** 实际驱动后端文件搜索的查询：显式 file/folder 模式 → 子串；根级 @ 且有输入 → 直接搜文件 */
const searchQuery = computed<string | null>(() => {
  if (isPickerMode.value) return fileQuery.value
  if (isRootMention.value && rootQuery.value.length >= 1) return rootQuery.value
  return null
})

const duplicatedNames = computed(() => {
  const counts = new Map<string, number>()
  for (const item of fileResults.value) {
    counts.set(item.name, (counts.get(item.name) ?? 0) + 1)
  }
  return counts
})

function dirname(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  if (index <= 0) return ''
  return normalized.slice(0, index)
}

function shortDir(path: string): string {
  const dir = dirname(path)
  if (dir.length <= 34) return dir
  return `...${dir.slice(-31)}`
}

const openTabItems = computed<MentionListItem[]>(() => {
  if (!isRootMention.value) return []
  const query = rootQuery.value.toLowerCase()
  return editor.tabs
    .filter((tab) => {
      if (!query) return true
      return `${tab.name} ${tab.path}`.toLowerCase().includes(query)
    })
    .slice(0, 3)
    .map((tab): MentionListItem => ({
      type: 'open-tab' as const,
      group: 'tab' as const,
      kind: 'file',
      path: tab.path,
      label: tab.name,
      detail: shortDir(tab.path),
      title: tab.path,
      icon: getFileIcon(tab.name)
    }))
})

/** 根级 @ 时直接呈现的工作区文件匹配（Cursor 行为），排除已在打开标签中的项 */
const rootFileItems = computed<MentionListItem[]>(() => {
  if (!isRootMention.value || !rootQuery.value) return []
  const openPaths = new Set(
    openTabItems.value
      .filter((item): item is Extract<MentionListItem, { type: 'open-tab' | 'path' }> => item.type !== 'option')
      .map((item) => item.path)
  )
  return rankFileResults(fileResults.value, rootQuery.value)
    .filter((r) => !openPaths.has(r.path))
    .slice(0, 7)
    .map((r): MentionListItem => ({
      type: 'path' as const,
      group: 'file' as const,
      kind: r.type === 'directory' ? 'folder' : 'file',
      path: r.path,
      label: r.name,
      detail: duplicatedNames.value.get(r.name)! > 1 ? dirname(r.path) : shortDir(r.path),
      title: r.path,
      icon: r.type === 'directory' ? undefined : getFileIcon(r.name)
    }))
})

const listItems = computed<MentionListItem[]>(() => {
  if (isPickerMode.value) {
    const scoped =
      pickerKind.value === 'folder'
        ? fileResults.value.filter((r) => r.type === 'directory')
        : fileResults.value.filter((r) => r.type !== 'directory')
    return rankFileResults(scoped, fileQuery.value).map((r): MentionListItem => ({
      type: 'path' as const,
      group: 'file' as const,
      kind: r.type === 'directory' ? 'folder' : 'file',
      path: r.path,
      label: r.name,
      detail: duplicatedNames.value.get(r.name)! > 1 ? dirname(r.path) : r.path,
      title: r.path,
      icon: r.type === 'directory' ? undefined : getFileIcon(r.name)
    }))
  }
  return [
    ...openTabItems.value,
    ...rootFileItems.value,
    ...options.value.map((opt): MentionListItem => ({
      type: 'option' as const,
      group: 'action' as const,
      kind: opt.kind,
      label: opt.label,
      insert: opt.insert,
      detail: '',
      title: optionDetail(opt.kind)
    }))
  ]
})

/** 分组标题：仅在有查询、且该分组是其首项时展示 */
function groupHeading(index: number): string | null {
  const item = listItems.value[index]
  if (!item) return null
  const previous = index > 0 ? listItems.value[index - 1] : undefined
  if (previous?.group === item.group) return null
  if (isPickerMode.value) return null
  if (!rootQuery.value) return null
  switch (item.group) {
    case 'tab': return t('mention.groupOpenTabs')
    case 'file': return t('mention.groupFiles')
    case 'action': return t('mention.groupActions')
    default: return null
  }
}

const emptyHint = computed(() => {
  if (!isPickerMode.value) return t('mention.noResults')
  if (!projects.hasWorkspace) return t('mention.openProjectFirst')
  return t('mention.noResults')
})

watch(
  () => [props.open, searchQuery.value] as const,
  async ([open, query]) => {
    activeIndex.value = 0
    if (!open || query === null) {
      fileResults.value = []
      loading.value = false
      return
    }
    if (!projects.hasWorkspace) {
      fileResults.value = []
      return
    }
    loading.value = true
    try {
      fileResults.value = await unwrap<FileSearchResult[]>(ipc.workspace.searchFiles(query))
    } catch {
      fileResults.value = []
    } finally {
      loading.value = false
    }
  }
)

function selectOption(opt: MentionOption): void {
  if (!mention.value) return
  emit('option', { kind: opt.kind, insert: opt.insert })
  const result = insertAtCursor(props.text, props.cursorPos, mention.value.triggerIndex, opt.insert)
  emit('select', result.text, result.cursorPos)
  if (isInstantMention(opt.kind)) {
    emit('close')
  }
}

function selectPath(path: string, kind: PathMentionKind): void {
  if (!mention.value) return
  if (props.pathMode === 'reference' && (kind === 'file' || kind === 'folder')) {
    const result = insertAtCursor(props.text, props.cursorPos, mention.value.triggerIndex, '')
    emit('reference', { kind, path, name: basename(path) })
    emit('select', result.text, result.cursorPos)
    emit('close')
    return
  }
  const insert = kind === 'file' ? `@file ${path}` : `@folder ${path}`
  const result = insertAtCursor(props.text, props.cursorPos, mention.value.triggerIndex, insert)
  emit('select', result.text, result.cursorPos)
  emit('close')
}

function basename(path: string): string {
  return path.split(/[/\\]/).filter(Boolean).pop() ?? path
}

function handleSelect(index: number): void {
  const item = listItems.value[index]
  if (!item) return
  if (item.type === 'option') {
    selectOption({
      kind: item.kind,
      label: item.label,
      insert: item.insert
    })
  } else {
    selectPath(item.path, item.kind)
  }
}

function moveHighlight(delta: number): void {
  const len = listItems.value.length
  if (!len) return
  activeIndex.value = (activeIndex.value + delta + len) % len
}

function iconForKind(kind: MentionKind) {
  switch (kind) {
    case 'file': return File
    case 'folder': return Folder
    case 'docs': return BookOpen
    case 'terminal': return SquareTerminal
    case 'chat': return MessageSquare
    case 'branch': return GitBranch
    case 'browser': return Globe2
  }
}

function optionDetail(kind: MentionKind): string {
  switch (kind) {
    case 'file': return t('mention.fileDetail')
    case 'folder': return t('mention.folderDetail')
    case 'docs': return t('mention.docsDetail')
    case 'terminal': return t('mention.terminalDetail')
    case 'chat': return t('mention.pastChatsDetail')
    case 'branch': return t('mention.branchDetail')
    case 'browser': return t('mention.browserDetail')
  }
}

defineExpose({
  moveHighlight,
  handleSelect,
  selectActive: () => handleSelect(activeIndex.value),
  hasItems: () => listItems.value.length > 0
})
</script>

<template>
  <div v-if="open && mention" ref="popoverRef" class="mention-popover pretty-scrollbar" role="listbox">
    <div v-if="!isRootMention || isPickerMode" class="mention-header">
      <template v-if="isPickerMode">
        {{ pickerKind === 'file' ? t('mention.selectFile') : t('mention.selectFolder') }}
      </template>
      <template v-else>
        {{ t('mention.header') }}
      </template>
    </div>

    <div v-if="loading && isPickerMode" class="mention-empty">{{ t('mention.searching') }}</div>
    <div v-else-if="!listItems.length" class="mention-empty">{{ emptyHint }}</div>

    <template v-for="(item, index) in listItems" :key="item.type === 'option' ? `option:${item.kind}` : `${item.type}:${item.path}`">
      <div v-if="groupHeading(index)" class="mention-group">{{ groupHeading(index) }}</div>
      <button
        type="button"
        role="option"
        class="mention-item"
        :class="{ 'is-active': index === activeIndex }"
        :title="item.title || item.detail || item.label"
        @mousedown.prevent="handleSelect(index)"
        @mousemove="activeIndex = index"
      >
      <img
        v-if="item.type !== 'option' && item.icon"
        :src="item.icon"
        alt=""
        class="mention-file-icon"
        draggable="false"
      />
      <File
        v-else-if="item.kind === 'file'"
        :size="15"
        :stroke-width="1.75"
        class="mention-icon"
      />
      <Folder
        v-else-if="item.kind === 'folder'"
        :size="15"
        :stroke-width="1.75"
        class="mention-icon"
      />
      <component
        :is="iconForKind(item.kind)"
        v-else
        :size="15"
        :stroke-width="1.75"
        class="mention-icon"
      />
      <span class="mention-label">{{ item.label }}</span>
      <span v-if="item.type !== 'option' && item.detail" class="mention-detail">{{ item.detail }}</span>
      <ChevronRight v-if="item.type === 'option'" :size="13" class="mention-chevron" />
      </button>
    </template>
  </div>
</template>

<style scoped>
.mention-popover {
  @apply absolute left-3 right-3 z-50 overflow-y-auto rounded-xl border border-codex-border
         bg-codex-bg py-1;
  bottom: calc(100% + 6px);
  max-height: 220px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.04);
  scrollbar-gutter: stable;
}

.mention-header {
  @apply px-3 pb-1 pt-1.5 text-[11px] text-codex-muted;
}

.mention-group {
  @apply px-3 pb-0.5 pt-1.5 text-[10px] font-medium uppercase tracking-wide text-codex-muted;
}
.mention-group:first-of-type {
  @apply pt-0.5;
}

.mention-empty {
  @apply px-3 py-2 text-[12px] text-codex-muted;
}

.mention-item {
  @apply flex w-full items-center gap-2.5 mx-1 px-2 py-[7px] text-left rounded-lg
         transition-colors hover:bg-codex-hover;
  width: calc(100% - 8px);
}

.mention-item.is-active {
  @apply bg-codex-hover;
}

.mention-icon {
  @apply shrink-0 text-codex-text-secondary;
}
.mention-file-icon {
  @apply h-[15px] w-[15px] shrink-0;
}

.mention-label {
  @apply min-w-0 text-[13px] text-codex-text truncate;
}

.mention-detail {
  @apply ml-auto min-w-[80px] max-w-[58%] truncate text-right text-[11px] text-codex-muted;
}
.mention-chevron {
  @apply ml-auto shrink-0 text-codex-muted;
}
</style>
