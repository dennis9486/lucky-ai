<script setup lang="ts">
/* global ClipboardEvent, DragEvent, File, Element, ChildNode, DocumentFragment, Range */
import { computed, nextTick, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ImagePlus } from 'lucide-vue-next'
import ComposerToolbar from './ComposerToolbar.vue'
import ComposerContextRow from './ComposerContextRow.vue'
import MentionPopover from './MentionPopover.vue'
import { createLogger } from '../../../shared/utils/log.js'
import { useChatStore } from '../../stores/chat.store.js'
import { useSettingsStore } from '../../stores/settings.store.js'
import { useUiStore, type ComposerAttachment } from '../../stores/ui.store.js'
import { detectMention, type MentionKind } from '../../utils/mention.js'
import { getFileIcon } from '../../utils/file-icons.js'
import { isImeComposingEnter } from '../../utils/keyboard.js'
import { ipc, unwrap } from '../../services/ipc-client.js'
import type { SavedAttachment } from '../../../shared/types/ipc.js'

type RichReference = ComposerAttachment & { kind: 'file' | 'folder' }

/** 输入框自适应高度边界（px），与 .composer-rich-input 的 min/max-height 保持一致，避免魔法值漂移。 */
const EDITOR_MIN_HEIGHT = 38
const EDITOR_MAX_HEIGHT = 120

const chat = useChatStore()
const settings = useSettingsStore()
const ui = useUiStore()
const logger = createLogger('renderer/chat-composer')
const editorRef = ref<HTMLDivElement | null>(null)
const mentionRef = ref<InstanceType<typeof MentionPopover> | null>(null)
const cursorPos = ref(0)
const mentionOpen = ref(false)
let syncingFromEditor = false
let syncingAttachments = false
let skipNextMentionSelect = false

const props = withDefaults(
  defineProps<{
    placeholder?: string
    popoverPlacement?: 'above' | 'below'
  }>(),
  { placeholder: undefined, popoverPlacement: 'below' }
)

const { t } = useI18n()
const resolvedPlaceholder = computed(
  () => props.placeholder ?? t('composer.placeholderHome')
)

const emit = defineEmits<{ send: [] }>()

function autoResize(): void {
  const el = editorRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(Math.max(el.scrollHeight, EDITOR_MIN_HEIGHT), EDITOR_MAX_HEIGHT)}px`
}

function isRichReference(item: ComposerAttachment): item is RichReference {
  return item.kind === 'file' || item.kind === 'folder'
}

function referenceKey(item: Pick<RichReference, 'kind' | 'path'>): string {
  return `${item.kind}:${item.path}`
}

function referenceToken(item: Pick<RichReference, 'kind' | 'path'>): string {
  return item.kind === 'folder' ? `@folder ${item.path}` : `@file ${item.path}`
}

function readChip(el: Element): RichReference | null {
  if (!(el instanceof HTMLElement)) return null
  const kind = el.dataset.mentionKind
  const path = el.dataset.mentionPath
  const name = el.dataset.mentionName
  if ((kind !== 'file' && kind !== 'folder') || !path || !name) return null
  return { kind, path, name }
}

function textFromNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
  if (!(node instanceof HTMLElement)) {
    return Array.from(node.childNodes).map(textFromNode).join('')
  }
  if (node.classList.contains('rich-reference-chip')) {
    const chip = readChip(node)
    return chip ? referenceToken(chip) : ''
  }
  if (node.tagName === 'BR') return '\n'
  return Array.from(node.childNodes).map(textFromNode).join('')
}

function serializeEditor(): string {
  const el = editorRef.value
  if (!el) return ''
  return Array.from(el.childNodes).map(textFromNode).join('').replace(/\u00a0/g, ' ')
}

function getReferencesInEditor(): RichReference[] {
  const el = editorRef.value
  if (!el) return []
  return [...el.querySelectorAll('.rich-reference-chip')]
    .map(readChip)
    .filter((item): item is RichReference => Boolean(item))
}

function normalizeEmptyEditor(): void {
  const el = editorRef.value
  if (!el) return
  if (serializeEditor().trim() === '' && !el.querySelector('.rich-reference-chip')) {
    el.replaceChildren()
  }
}

function syncMentionState(): void {
  cursorPos.value = getCaretOffset()
  mentionOpen.value = detectMention(chat.input, cursorPos.value) !== null
}

function syncFromEditor(): void {
  syncingFromEditor = true
  normalizeEmptyEditor()
  chat.input = serializeEditor()
  syncMentionState()
  autoResize()
  void nextTick(() => {
    syncingFromEditor = false
  })
}

function setPlainTextContent(text: string): void {
  const el = editorRef.value
  if (!el) return
  el.replaceChildren()
  if (text) {
    const lines = text.split('\n')
    lines.forEach((line, index) => {
      if (index > 0) el.append(document.createElement('br'))
      if (line) el.append(document.createTextNode(line))
    })
  }
  cursorPos.value = text.length
  mentionOpen.value = false
  void nextTick(autoResize)
}

watch(
  () => chat.input,
  (value) => {
    if (syncingFromEditor) return
    if (value === serializeEditor()) return
    setPlainTextContent(value)
  }
)

watch(
  () => ui.composerAttachments.filter(isRichReference).map(referenceKey).join('\n'),
  () => {
    if (syncingAttachments) return
    syncReferenceChipsFromAttachments()
  }
)

watch(
  () => chat.showPendingConfirm,
  (visible) => {
    if (visible) mentionOpen.value = false
  }
)

function syncReferenceChipsFromAttachments(): void {
  const el = editorRef.value
  if (!el) return
  const refs = ui.composerAttachments.filter(isRichReference)
  const refKeys = new Set(refs.map(referenceKey))

  for (const chip of [...el.querySelectorAll('.rich-reference-chip')]) {
    const item = readChip(chip)
    if (!item || !refKeys.has(referenceKey(item))) chip.remove()
  }

  const existing = new Set(getReferencesInEditor().map(referenceKey))
  const missing = refs.filter((item) => !existing.has(referenceKey(item)))
  if (!missing.length) {
    syncFromEditor()
    return
  }

  const hadText = serializeEditor().length > 0
  for (const item of missing) {
    if (hadText || el.childNodes.length > 0) el.append(document.createTextNode(' '))
    el.append(createReferenceChip(item))
    el.append(document.createTextNode(' '))
  }
  syncFromEditor()
}

function removeReference(path: string): void {
  syncingAttachments = true
  ui.removeComposerAttachment(path)
  for (const chip of [...(editorRef.value?.querySelectorAll('.rich-reference-chip') ?? [])]) {
    if ((chip as HTMLElement).dataset.mentionPath === path) chip.remove()
  }
  syncFromEditor()
  void nextTick(() => {
    syncingAttachments = false
  })
}

function createReferenceChip(item: RichReference): HTMLElement {
  const chip = document.createElement('span')
  chip.className = 'rich-reference-chip'
  chip.contentEditable = 'false'
  chip.dataset.mentionKind = item.kind
  chip.dataset.mentionPath = item.path
  chip.dataset.mentionName = item.name
  chip.title = item.path

  const icon = document.createElement('span')
  icon.className = 'rich-reference-chip-icon'
  if (item.kind === 'file') {
    const src = getFileIcon(item.name || item.path)
    if (src) {
      const img = document.createElement('img')
      img.src = src
      img.alt = ''
      img.draggable = false
      icon.append(img)
    }
  } else {
    icon.classList.add('is-folder')
  }

  const label = document.createElement('span')
  label.className = 'rich-reference-chip-label'
  label.textContent = item.name

  const remove = document.createElement('button')
  remove.type = 'button'
  remove.tabIndex = -1
  remove.className = 'rich-reference-chip-remove'
  remove.setAttribute('aria-label', t('composer.removeAttachment', { name: item.name }))
  remove.textContent = '×'
  remove.addEventListener('mousedown', (event) => event.preventDefault())
  remove.addEventListener('click', (event) => {
    event.preventDefault()
    event.stopPropagation()
    removeReference(item.path)
    editorRef.value?.focus()
  })

  chip.append(icon, label, remove)
  return chip
}

function getSelectionRange(): Range | null {
  const el = editorRef.value
  const selection = window.getSelection()
  if (!el || !selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null
  return range
}

function getCaretOffset(): number {
  const el = editorRef.value
  const range = getSelectionRange()
  if (!el || !range) return serializeEditor().length
  const before = range.cloneRange()
  before.selectNodeContents(el)
  before.setEnd(range.endContainer, range.endOffset)
  return Array.from(before.cloneContents().childNodes).map(textFromNode).join('').length
}

function locateOffset(target: number): { node: Node; offset: number } {
  const root = editorRef.value
  if (!root) throw new Error('Editor is not mounted')
  let current = 0

  const visit = (node: Node): { node: Node; offset: number } | null => {
    if (node.nodeType === Node.TEXT_NODE) {
      const length = node.textContent?.length ?? 0
      if (target <= current + length) return { node, offset: Math.max(0, target - current) }
      current += length
      return null
    }

    if (node instanceof HTMLElement && node.classList.contains('rich-reference-chip')) {
      const chip = readChip(node)
      const length = chip ? referenceToken(chip).length : 0
      if (target <= current + length) return { node: node.parentNode ?? root, offset: childIndex(node) + 1 }
      current += length
      return null
    }

    if (node instanceof HTMLElement && node.tagName === 'BR') {
      if (target <= current + 1) return { node: node.parentNode ?? root, offset: childIndex(node) + 1 }
      current += 1
      return null
    }

    for (const child of Array.from(node.childNodes)) {
      const found = visit(child)
      if (found) return found
    }
    return null
  }

  const found = visit(root)
  return found ?? { node: root, offset: root.childNodes.length }
}

function childIndex(node: Node): number {
  return Array.from(node.parentNode?.childNodes ?? []).indexOf(node as ChildNode)
}

function setCaretAfter(node: Node): void {
  const range = document.createRange()
  range.setStartAfter(node)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  cursorPos.value = getCaretOffset()
}

function replaceRange(start: number, end: number, content: Node | string): void {
  const el = editorRef.value
  if (!el) return
  const startPoint = locateOffset(start)
  const endPoint = locateOffset(end)
  const range = document.createRange()
  range.setStart(startPoint.node, startPoint.offset)
  range.setEnd(endPoint.node, endPoint.offset)
  range.deleteContents()

  if (typeof content === 'string') {
    const inserted = document.createTextNode(content)
    range.insertNode(inserted)
    setCaretAfter(inserted)
  } else if (content instanceof DocumentFragment) {
    const last = content.lastChild
    range.insertNode(content)
    if (last) setCaretAfter(last)
  } else {
    range.insertNode(content)
    setCaretAfter(content)
  }
  syncFromEditor()
}

function insertPlainText(text: string): void {
  if (!text) return
  const range = getSelectionRange()
  if (!range) return
  range.deleteContents()
  const fragment = document.createDocumentFragment()
  let lastNode: Node | null = null
  const lines = text.split('\n')
  lines.forEach((line, index) => {
    if (index > 0) {
      const br = document.createElement('br')
      fragment.append(br)
      lastNode = br
    }
    if (line) {
      const node = document.createTextNode(line)
      fragment.append(node)
      lastNode = node
    }
  })
  range.insertNode(fragment)
  if (lastNode) setCaretAfter(lastNode)
  syncFromEditor()
}

function insertLineBreak(): void {
  insertPlainText('\n')
}

function currentMentionRange(): { start: number; end: number } | null {
  const state = detectMention(chat.input, cursorPos.value)
  if (!state) return null
  return { start: state.triggerIndex, end: cursorPos.value }
}

function handleInput(): void {
  syncFromEditor()
}

function handleClick(): void {
  syncFromEditor()
}

/** 把一组图片 File 保存到工作区附件目录并加入 composer 附件（粘贴 / 拖放共用）。 */
async function addImageFiles(files: File[]): Promise<void> {
  if (!files.length) return
  try {
    const attachments = await Promise.all(
      files.map(async (file) => {
        const previewUrl = await fileToDataUrl(file)
        const saved = await unwrap<SavedAttachment>(ipc.app.savePastedImage({
          data: await file.arrayBuffer(),
          mimeType: file.type || 'image/png',
          name: file.name || 'image'
        }))
        return { ...saved, previewUrl }
      })
    )
    ui.addComposerAttachments(attachments)
  } catch (error) {
    logger.error('add image files failed', { error, fileCount: files.length })
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read image preview'))
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.readAsDataURL(file)
  })
}

async function handlePaste(event: ClipboardEvent): Promise<void> {
  const files = getPastedImageFiles(event)
  if (files.length) {
    event.preventDefault()
    await addImageFiles(files)
    return
  }

  const text = event.clipboardData?.getData('text/plain') ?? ''
  if (text) {
    event.preventDefault()
    insertPlainText(text)
  }
}

function getPastedImageFiles(event: ClipboardEvent): File[] {
  const files = [...(event.clipboardData?.files ?? [])].filter((file) => file.type.startsWith('image/'))
  if (files.length) return files

  return [...(event.clipboardData?.items ?? [])]
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file))
}

// ── 拖放图片（参考 Codex/ChatGPT：拖图片到输入框即添加） ──────────────
const isDraggingImage = ref(false)
let dragDepth = 0

function dragHasFiles(event: DragEvent): boolean {
  return [...(event.dataTransfer?.items ?? [])].some((item) => item.kind === 'file')
}

function onDragEnter(event: DragEvent): void {
  if (!dragHasFiles(event)) return
  dragDepth += 1
  isDraggingImage.value = true
}

function onDragOver(event: DragEvent): void {
  if (!dragHasFiles(event)) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(): void {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) isDraggingImage.value = false
}

async function onDrop(event: DragEvent): Promise<void> {
  dragDepth = 0
  isDraggingImage.value = false
  const images = [...(event.dataTransfer?.files ?? [])].filter((file) => file.type.startsWith('image/'))
  if (!images.length) return
  event.preventDefault()
  await addImageFiles(images)
}

function handleMentionOption(payload: { kind: MentionKind; insert: string }): void {
  const range = currentMentionRange()
  if (!range) return
  skipNextMentionSelect = true
  replaceRange(range.start, range.end, payload.insert)
  mentionOpen.value = detectMention(chat.input, cursorPos.value) !== null
}

function handleMentionSelect(text: string, pos: number): void {
  if (skipNextMentionSelect) {
    skipNextMentionSelect = false
    return
  }
  setPlainTextContent(text)
  chat.input = text
  void nextTick(() => {
    setCaretByOffset(pos)
    syncMentionState()
  })
}

function handleMentionReference(payload: { kind: 'file' | 'folder'; path: string; name: string }): void {
  const range = currentMentionRange()
  if (!range) return
  skipNextMentionSelect = true
  const item: RichReference = {
    path: payload.path,
    name: payload.name,
    kind: payload.kind
  }
  const chip = createReferenceChip(item)
  const fragment = document.createDocumentFragment()
  fragment.append(chip, document.createTextNode(' '))
  replaceRange(range.start, range.end, fragment)
  ui.addComposerAttachments([item])
  mentionOpen.value = false
}

function setCaretByOffset(offset: number): void {
  const point = locateOffset(offset)
  const range = document.createRange()
  range.setStart(point.node, point.offset)
  range.collapse(true)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  cursorPos.value = offset
}

function handleKeydown(e: KeyboardEvent): void {
  // IME uses Enter to confirm the candidate; sending here would submit half-composed text.
  if (isImeComposingEnter(e)) return

  if (chat.showPendingConfirm) {
    if (e.key === 'Escape') {
      e.preventDefault()
      chat.confirmTools(false)
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      chat.confirmTools(true)
      return
    }
  }

  if (mentionOpen.value) {
    if (e.key === 'ArrowDown' && mentionRef.value?.hasItems()) {
      e.preventDefault()
      mentionRef.value.moveHighlight(1)
      return
    }
    if (e.key === 'ArrowUp' && mentionRef.value?.hasItems()) {
      e.preventDefault()
      mentionRef.value.moveHighlight(-1)
      return
    }
    if ((e.key === 'Tab' || e.key === 'Enter') && !e.shiftKey) {
      e.preventDefault()
      if (mentionRef.value?.hasItems()) mentionRef.value.selectActive()
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      mentionOpen.value = false
      return
    }
  }

  const modEnter = e.key === 'Enter' && (e.metaKey || e.ctrlKey)
  const plainEnter = e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey

  if (settings.general.sendShortcut === 'enter' && e.key === 'Enter' && e.shiftKey) {
    e.preventDefault()
    insertLineBreak()
    return
  }

  if (settings.general.sendShortcut === 'enter' && plainEnter) {
    e.preventDefault()
    handleSend()
    return
  }

  if (settings.general.sendShortcut === 'mod-enter' && modEnter) {
    e.preventDefault()
    handleSend()
    return
  }

  if (settings.general.sendShortcut === 'mod-enter' && e.key === 'Enter') {
    return
  }
}

function handleSend(): void {
  syncFromEditor()
  mentionOpen.value = false
  emit('send')
}

defineExpose({ focus: () => editorRef.value?.focus() })
</script>

<template>
  <div
    class="composer-input-area"
    @dragenter="onDragEnter"
    @dragover="onDragOver"
    @dragleave="onDragLeave"
    @drop="onDrop"
  >
    <div v-if="isDraggingImage" class="composer-drop-overlay">
      <ImagePlus :size="20" :stroke-width="1.75" />
      <span>{{ t('composer.dropImage') }}</span>
    </div>
    <ComposerContextRow />
    <div class="composer-input-wrap">
      <div
        ref="editorRef"
        class="composer-rich-input pretty-scrollbar"
        contenteditable="true"
        role="textbox"
        aria-multiline="true"
        spellcheck="true"
        :data-placeholder="resolvedPlaceholder"
        @input="handleInput"
        @click="handleClick"
        @keyup="syncFromEditor"
        @keydown="handleKeydown"
        @paste="handlePaste"
      />
      <MentionPopover
        ref="mentionRef"
        :text="chat.input"
        :cursor-pos="cursorPos"
        :open="mentionOpen"
        path-mode="reference"
        :dismiss-ignore="editorRef"
        @select="handleMentionSelect"
        @reference="handleMentionReference"
        @option="handleMentionOption"
        @close="mentionOpen = false"
      />
    </div>
    <ComposerToolbar :popover-placement="props.popoverPlacement" @send="handleSend" />
  </div>
</template>

<style scoped>
.composer-input-area {
  @apply relative z-10 flex min-h-[78px] flex-col overflow-visible;
}
.composer-drop-overlay {
  @apply absolute inset-0 z-30 flex items-center justify-center gap-2 rounded-[28px]
         text-[13px] font-semibold text-codex-accent pointer-events-none;
  border: 1.5px dashed var(--codex-accent, #2563eb);
  background: color-mix(in srgb, var(--codex-accent, #2563eb) 8%, var(--codex-bg, #fff));
}
.composer-input-wrap {
  position: relative;
  overflow: visible;
  padding: 16px 20px 6px;
}
.composer-rich-input {
  width: 100%;
  min-height: 38px;
  max-height: 120px;
  overflow-y: auto;
  background: transparent;
  padding: 0 4px;
  font-size: 15px;
  line-height: 1.6;
  color: color-mix(in srgb, var(--codex-text, #1a1a1a) 96%, #000);
  outline: none;
  border: none;
  white-space: pre-wrap;
  word-break: break-word;
}
.composer-rich-input:empty::before {
  content: attr(data-placeholder);
  color: color-mix(in srgb, var(--codex-text-secondary, #4a4a4a) 68%, var(--codex-muted, #8a8a8a));
  pointer-events: none;
}
.composer-rich-input :deep(.rich-reference-chip) {
  display: inline-flex;
  max-width: 150px;
  height: 23px;
  align-items: center;
  gap: 5px;
  margin: 0 2px;
  padding: 0 6px;
  border-radius: 7px;
  vertical-align: -5px;
  background: color-mix(in srgb, var(--codex-accent) 14%, var(--codex-hover));
  color: color-mix(in srgb, var(--codex-accent) 62%, var(--codex-text));
  font-size: 12px;
  font-weight: 600;
  line-height: 23px;
  user-select: none;
}
.composer-rich-input :deep(.rich-reference-chip-icon) {
  display: inline-flex;
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  color: var(--codex-muted);
}
.composer-rich-input :deep(.rich-reference-chip-icon img) {
  width: 13px;
  height: 13px;
  display: block;
}
.composer-rich-input :deep(.rich-reference-chip-icon.is-folder) {
  position: relative;
  border: 1.6px solid #2b8cff;
  border-radius: 3px;
}
.composer-rich-input :deep(.rich-reference-chip-icon.is-folder)::before {
  content: '';
  position: absolute;
  left: 1px;
  top: -4px;
  width: 7px;
  height: 4px;
  border: 1.6px solid #2b8cff;
  border-bottom: 0;
  border-radius: 2px 2px 0 0;
  background: var(--codex-bg);
}
.composer-rich-input :deep(.rich-reference-chip-label) {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.composer-rich-input :deep(.rich-reference-chip-remove) {
  display: inline-flex;
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--codex-muted);
  font-size: 13px;
  line-height: 1;
  cursor: pointer;
}
.composer-rich-input :deep(.rich-reference-chip-remove:hover) {
  background: color-mix(in srgb, var(--codex-text) 8%, transparent);
  color: var(--codex-text);
}
</style>
