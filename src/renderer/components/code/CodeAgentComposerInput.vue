<script setup lang="ts">
/* global ClipboardEvent, File, DocumentFragment, Text, Element */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import MentionPopover from '../home/MentionPopover.vue'
import { buildReferenceToken, detectMention, parseMentionSegments, type MentionKind } from '../../utils/mention.js'
import { getFileIcon } from '../../utils/file-icons.js'
import { isImeComposingEnter } from '../../utils/keyboard.js'
import { useSettingsStore } from '../../stores/settings.store.js'

/** 编辑器内联引用（文件 / 文件夹），与 store 的 file/folder 附件一一对应 */
export interface ComposerReference {
  kind: 'file' | 'folder'
  path: string
  name: string
}

interface MentionDomRange {
  node: Text
  start: number
  end: number
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    placeholder?: string
  }>(),
  { placeholder: '' }
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  'references-change': [refs: ComposerReference[]]
  submit: []
  escape: []
  images: [files: File[]]
}>()

const editorRef = ref<HTMLDivElement | null>(null)
const mentionRef = ref<InstanceType<typeof MentionPopover> | null>(null)
const settings = useSettingsStore()
const isEmpty = ref(true)
const mentionOpen = ref(false)
const mentionText = ref('')
const mentionCaret = ref(0)
/** 用户点了「文件 / 文件夹」分类后，强制 MentionPopover 进入对应选择模式 */
const forcedKind = ref<'file' | 'folder' | null>(null)

/** 标记最近一次由编辑器内部写回的文本，用于区分外部赋值（如编辑历史 / 清空） */
let lastEmitted = ''
let lastRefsKey = ''
let lastMentionRange: MentionDomRange | null = null

const FOLDER_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13c0 1.1.9 2 2 2Z"/></svg>'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function createChip(ref: ComposerReference): HTMLElement {
  const span = document.createElement('span')
  span.className = 'rt-chip'
  span.contentEditable = 'false'
  span.dataset.path = ref.path
  span.dataset.name = ref.name
  span.dataset.kind = ref.kind
  span.setAttribute('title', ref.path)
  const icon =
    ref.kind === 'folder'
      ? `<span class="rt-chip-icon">${FOLDER_SVG}</span>`
      : `<img class="rt-chip-icon" src="${escapeHtml(getFileIcon(ref.name))}" alt="" draggable="false" />`
  span.innerHTML =
    `${icon}<span class="rt-chip-label">${escapeHtml(ref.name)}</span>` +
    `<button type="button" class="rt-chip-x" data-remove tabindex="-1" aria-label="${escapeHtml(ref.name)}">×</button>`
  return span
}

/** 用 token 解析把序列化文本还原成「文本节点 + 内联 chip」结构 */
function renderContent(text: string): { frag: DocumentFragment; refs: ComposerReference[] } {
  const frag = document.createDocumentFragment()
  const refs: ComposerReference[] = []
  for (const seg of parseMentionSegments(text)) {
    if (seg.type === 'text') {
      if (seg.value) frag.append(document.createTextNode(seg.value))
    } else {
      const ref: ComposerReference = { kind: seg.kind, path: seg.path, name: seg.name }
      refs.push(ref)
      frag.append(createChip(ref))
    }
  }
  return { frag, refs }
}

function setContent(text: string): void {
  const el = editorRef.value
  if (!el) return
  const { frag, refs } = renderContent(text)
  el.replaceChildren(frag)
  isEmpty.value = el.textContent?.length === 0 && !el.querySelector('.rt-chip')
  const key = refsKey(refs)
  if (key !== lastRefsKey) {
    lastRefsKey = key
    emit('references-change', refs)
  }
}

interface EditorModel {
  text: string
  mentionText: string
  caret: number
  refs: ComposerReference[]
}

/** 把 contenteditable 投影成两份文本：发送文本（chip 转 @name）与提及文本（chip 转单字符哨兵 U+FFFC） */
function readEditor(): EditorModel {
  const el = editorRef.value
  if (!el) return { text: '', mentionText: '', caret: 0, refs: [] }
  const sel = window.getSelection()
  const anchorNode = sel?.anchorNode ?? null
  const anchorOffset = sel?.anchorOffset ?? 0
  const anchorInEditor = anchorNode ? el.contains(anchorNode) : false

  let text = ''
  let mtext = ''
  let caret = -1
  const refs: ComposerReference[] = []
  const children = Array.from(el.childNodes)

  children.forEach((node, index) => {
    if (anchorInEditor && caret === -1 && anchorNode === el && index === anchorOffset) {
      caret = mtext.length
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const tc = node.textContent ?? ''
      if (anchorInEditor && caret === -1 && node === anchorNode) {
        caret = mtext.length + Math.min(anchorOffset, tc.length)
      }
      text += tc
      mtext += tc
    } else if (node instanceof HTMLElement && node.classList.contains('rt-chip')) {
      const ref: ComposerReference = {
        kind: node.dataset.kind === 'folder' ? 'folder' : 'file',
        path: node.dataset.path ?? '',
        name: node.dataset.name ?? ''
      }
      refs.push(ref)
      text += buildReferenceToken(ref.kind, ref.path)
      mtext += '\uFFFC'
      if (anchorInEditor && caret === -1 && node === anchorNode) caret = mtext.length
    } else if (node.nodeName === 'BR') {
      // 浏览器残留的占位 <br>，序列化时忽略（换行用 \n 文本节点表示）
    } else {
      const tc = node.textContent ?? ''
      text += tc
      mtext += tc
    }
  })

  if (caret === -1) caret = mtext.length
  return { text, mentionText: mtext, caret, refs }
}

function refsKey(refs: ComposerReference[]): string {
  return refs.map((ref) => `${ref.kind}:${ref.path}`).join('|')
}

/** 同步：刷新提及状态、把文本/引用变化向上派发 */
function sync(): void {
  const activeMentionRange = currentMentionDomRange()
  const model = readEditor()
  isEmpty.value = model.text.length === 0
  mentionText.value = model.mentionText
  mentionCaret.value = model.caret
  mentionOpen.value = detectMention(model.mentionText, model.caret) !== null
  if (mentionOpen.value && activeMentionRange) lastMentionRange = activeMentionRange
  // @ 片段消失（如退格越过 @）时，退出文件/文件夹下钻
  if (!mentionOpen.value) {
    forcedKind.value = null
    lastMentionRange = null
  }

  if (model.text !== lastEmitted) {
    lastEmitted = model.text
    emit('update:modelValue', model.text)
  }
  const key = refsKey(model.refs)
  if (key !== lastRefsKey) {
    lastRefsKey = key
    emit('references-change', model.refs)
  }
}

function focus(): void {
  const el = editorRef.value
  if (!el) return
  el.focus()
  // 光标移动到末尾
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  range.selectNodeContents(el)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

function currentTextNodeRange(): { node: Text; offset: number } | null {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount || !sel.isCollapsed) return null
  const range = sel.getRangeAt(0)
  const node = range.startContainer
  if (node.nodeType === Node.TEXT_NODE) return { node: node as Text, offset: range.startOffset }
  return null
}

function currentMentionDomRange(): MentionDomRange | null {
  const pos = currentTextNodeRange()
  if (!pos) return null
  const text = pos.node.textContent ?? ''
  const det = detectMention(text, pos.offset)
  if (!det) return null
  return { node: pos.node, start: det.triggerIndex, end: pos.offset }
}

function isUsableMentionRange(range: MentionDomRange | null): range is MentionDomRange {
  const el = editorRef.value
  return Boolean(el && range?.node.isConnected && el.contains(range.node))
}

function placeCaretAfter(node: Node, offset = 0): void {
  const sel = window.getSelection()
  if (!sel) return
  const range = document.createRange()
  range.setStart(node, offset)
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
}

/** 把光标前的 @query 替换为内联 chip（来自 MentionPopover 的 reference 事件） */
function insertReference(ref: ComposerReference): void {
  const el = editorRef.value
  if (!el) return
  const range = currentMentionDomRange() ?? (isUsableMentionRange(lastMentionRange) ? lastMentionRange : null)
  mentionOpen.value = false
  forcedKind.value = null
  lastMentionRange = null

  if (!range) {
    // 兜底：直接追加 chip + 空格
    el.append(createChip(ref), document.createTextNode(' '))
    focus()
    sync()
    return
  }

  const { node, start, end } = range
  const text = node.textContent ?? ''
  const before = text.slice(0, start)
  const after = text.slice(end)
  node.textContent = before
  const parent = node.parentNode
  if (!parent) return
  const chip = createChip(ref)
  const tail = document.createTextNode(` ${after}`)
  parent.insertBefore(tail, node.nextSibling)
  parent.insertBefore(chip, tail)
  placeCaretAfter(tail, 1)
  sync()
}

/** 分类选择：文件/文件夹 → 下钻为选择模式（不插文本）；即时类别 → 以纯文本 token 插入 */
function onOption(payload: { kind: MentionKind; insert: string }): void {
  if (payload.kind === 'file' || payload.kind === 'folder') {
    // 保留已输入的 @query 作为搜索词，强制弹窗进入文件/文件夹选择，选中后再插入 chip
    forcedKind.value = payload.kind
    mentionOpen.value = true
    return
  }
  const pos = currentTextNodeRange()
  if (!pos) return
  const { node, offset } = pos
  const text = node.textContent ?? ''
  const det = detectMention(text, offset)
  const start = det ? det.triggerIndex : offset
  const next = text.slice(0, start) + payload.insert + text.slice(offset)
  node.textContent = next
  placeCaretAfter(node, start + payload.insert.length)
  closeMention()
  sync()
}

function closeMention(): void {
  mentionOpen.value = false
  forcedKind.value = null
  lastMentionRange = null
}

function insertPlainText(value: string): void {
  const sel = window.getSelection()
  if (!sel || !sel.rangeCount) {
    editorRef.value?.append(document.createTextNode(value))
    sync()
    return
  }
  const range = sel.getRangeAt(0)
  range.deleteContents()
  const textNode = document.createTextNode(value)
  range.insertNode(textNode)
  placeCaretAfter(textNode, textNode.length)
  sync()
}

function maybeDeleteChipBackward(event: KeyboardEvent): void {
  const sel = window.getSelection()
  const el = editorRef.value
  if (!sel || !sel.isCollapsed || !sel.rangeCount || !el) return
  const range = sel.getRangeAt(0)
  const node = range.startContainer
  const offset = range.startOffset
  let chip: Element | null = null
  if (node.nodeType === Node.TEXT_NODE && offset === 0) {
    const prev = node.previousSibling
    if (prev instanceof HTMLElement && prev.classList.contains('rt-chip')) chip = prev
  } else if (node === el && offset > 0) {
    const prev = el.childNodes[offset - 1]
    if (prev instanceof HTMLElement && prev.classList.contains('rt-chip')) chip = prev
  }
  if (chip) {
    event.preventDefault()
    chip.remove()
    sync()
  }
}

function onKeydown(event: KeyboardEvent): void {
  // During IME composition, Enter belongs to the input method instead of the composer.
  if (isImeComposingEnter(event)) return

  if (mentionOpen.value && mentionRef.value?.hasItems()) {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      mentionRef.value.moveHighlight(1)
      return
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      mentionRef.value.moveHighlight(-1)
      return
    }
    if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) {
      event.preventDefault()
      mentionRef.value.selectActive()
      return
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeMention()
      return
    }
  }

  if (event.key === 'Enter') {
    const modEnter = event.metaKey || event.ctrlKey
    const plainEnter = !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey
    if (
      (settings.general.sendShortcut === 'enter' && plainEnter) ||
      (settings.general.sendShortcut === 'mod-enter' && modEnter)
    ) {
      event.preventDefault()
      emit('submit')
      return
    }
    event.preventDefault()
    insertPlainText('\n')
    return
  }
  if (event.key === 'Escape') {
    emit('escape')
    return
  }
  if (event.key === 'Backspace') {
    maybeDeleteChipBackward(event)
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

function onPaste(event: ClipboardEvent): void {
  const images = getPastedImageFiles(event)
  if (images.length) {
    event.preventDefault()
    emit('images', images)
    return
  }
  event.preventDefault()
  const text = event.clipboardData?.getData('text/plain') ?? ''
  if (text) insertPlainText(text)
}

function onEditorClick(event: MouseEvent): void {
  const target = event.target as HTMLElement | null
  const removeBtn = target?.closest('.rt-chip-x')
  if (removeBtn) {
    event.preventDefault()
    removeBtn.closest('.rt-chip')?.remove()
    focus()
    sync()
    return
  }
  // 普通点击：同步光标 / 提及态
  sync()
}

watch(
  () => props.modelValue,
  (value) => {
    if (value === lastEmitted) return
    lastEmitted = value
    setContent(value)
  }
)

onMounted(() => {
  lastEmitted = props.modelValue
  setContent(props.modelValue)
})

onBeforeUnmount(() => {
  mentionOpen.value = false
  lastMentionRange = null
})

defineExpose({ focus })
</script>

<template>
  <div class="rt-wrap">
    <MentionPopover
      ref="mentionRef"
      :text="mentionText"
      :cursor-pos="mentionCaret"
      :open="mentionOpen"
      path-mode="reference"
      :forced-kind="forcedKind"
      :dismiss-ignore="editorRef"
      @reference="insertReference"
      @option="onOption"
      @close="closeMention"
    />
    <div
      ref="editorRef"
      class="rt-editor"
      :class="{ 'is-empty': isEmpty }"
      contenteditable="true"
      role="textbox"
      aria-multiline="true"
      :data-placeholder="placeholder"
      spellcheck="false"
      @input="sync"
      @keyup="sync"
      @keydown="onKeydown"
      @paste="onPaste"
      @click="onEditorClick"
    />
  </div>
</template>

<style scoped>
.rt-wrap {
  position: relative;
  width: 100%;
}
.rt-editor {
  position: relative;
  width: 100%;
  min-height: 22px;
  max-height: 200px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  outline: none;
  color: var(--codex-text, #1a1a1a);
  font-size: var(--code-agent-content-size, 12.5px);
  line-height: var(--code-agent-content-line, 1.62);
}
.rt-editor.is-empty::before {
  content: attr(data-placeholder);
  position: absolute;
  inset: 0 auto auto 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--codex-muted, #8a8a8a);
  pointer-events: none;
  user-select: none;
}
.rt-editor :deep(.rt-chip) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 180px;
  margin: 0 1px;
  padding: 1px 5px 1px 4px;
  border-radius: 6px;
  vertical-align: baseline;
  font-size: 0.92em;
  font-weight: 500;
  line-height: 1.5;
  user-select: none;
  white-space: nowrap;
  background: color-mix(in srgb, var(--codex-accent, #2563eb) 14%, var(--codex-hover, #f0f0f0));
  color: color-mix(in srgb, var(--codex-accent, #2563eb) 62%, var(--codex-text, #1a1a1a));
}
.rt-editor :deep(.rt-chip-icon) {
  display: inline-flex;
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.rt-editor :deep(.rt-chip-label) {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rt-editor :deep(.rt-chip-x) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border-radius: 999px;
  font-size: 13px;
  line-height: 1;
  color: color-mix(in srgb, var(--codex-accent, #2563eb) 55%, var(--codex-muted, #8a8a8a));
}
.rt-editor :deep(.rt-chip-x:hover) {
  background: color-mix(in srgb, var(--codex-accent, #2563eb) 22%, transparent);
  color: var(--codex-text, #1a1a1a);
}
</style>
