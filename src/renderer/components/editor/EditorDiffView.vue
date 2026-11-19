<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronRight, ChevronUp } from 'lucide-vue-next'
import MonacoDiffEditor from './MonacoDiffEditor.vue'
import { useEditorStore } from '../../stores/editor.store.js'
import { summarizeDiffHunks, type DiffHunk } from '../../utils/editor-diff.js'

const { t } = useI18n()
const editor = useEditorStore()
const hunksOpen = ref(true)
const diffEditorRef = ref<InstanceType<typeof MonacoDiffEditor> | null>(null)
const activeHunkIndex = ref<number | null>(null)
const floatBarVisible = ref(false)
const floatStyle = ref<{ top: string; left: string }>({ top: '0px', left: '0px' })
let hideFloatBarTimer: number | null = null

const diffStats = computed(() => summarizeDiffHunks(editor.diffHunks))
const hasChanges = computed(() => diffStats.value.additions > 0 || diffStats.value.deletions > 0)
const isInline = computed(() => editor.diffInline)
const currentHunk = computed(() => activeHunkIndex.value === null ? null : editor.diffHunks[activeHunkIndex.value] ?? null)
const showFloatBar = computed(() => isInline.value && Boolean(currentHunk.value))

function jumpToHunk(hunk: DiffHunk): void {
  diffEditorRef.value?.revealModifiedLine(hunk.modifiedStart + 1)
}

function revealActiveHunk(): void {
  const hunk = currentHunk.value
  if (!hunk) return
  diffEditorRef.value?.revealModifiedLine(hunk.modifiedStart + 1)
}

function updateFloatPosition(): void {
  const hunk = currentHunk.value
  if (!hunk) return
  const anchorLine = Math.max(hunk.modifiedStart + 1, hunk.modifiedEnd)
  const coords = diffEditorRef.value?.getModifiedLineCoords(anchorLine)
  if (!coords) return
  const gap = 10
  floatStyle.value = {
    top: `${Math.max(8, coords.top + coords.lineHeight + gap)}px`,
    left: `${Math.max(8, coords.left + 8)}px`
  }
}

function goPrevHunk(): void {
  if (!editor.diffHunks.length) return
  const current = activeHunkIndex.value ?? 0
  activeHunkIndex.value = (current - 1 + editor.diffHunks.length) % editor.diffHunks.length
  showCurrentToolbar()
  revealActiveHunk()
}

function goNextHunk(): void {
  if (!editor.diffHunks.length) return
  const current = activeHunkIndex.value ?? 0
  activeHunkIndex.value = (current + 1) % editor.diffHunks.length
  showCurrentToolbar()
  revealActiveHunk()
}

async function keepCurrentHunk(): Promise<void> {
  const index = activeHunkIndex.value ?? -1
  if (index < 0 || index >= editor.diffHunks.length) return
  editor.acceptDiffHunk(index)
  await nextTick()
  if (!editor.diffHunks.length) {
    await persistDiffAndClose()
    return
  }
  if ((activeHunkIndex.value ?? 0) >= editor.diffHunks.length) {
    activeHunkIndex.value = Math.max(0, editor.diffHunks.length - 1)
  }
  showCurrentToolbar()
}

async function undoCurrentHunk(): Promise<void> {
  const index = activeHunkIndex.value ?? -1
  if (index < 0 || index >= editor.diffHunks.length) return
  editor.rejectDiffHunk(index)
  await nextTick()
  if (!editor.diffHunks.length) {
    await persistDiffAndClose()
    return
  }
  if ((activeHunkIndex.value ?? 0) >= editor.diffHunks.length) {
    activeHunkIndex.value = Math.max(0, editor.diffHunks.length - 1)
  }
  showCurrentToolbar()
}

async function persistDiffAndClose(): Promise<void> {
  if (editor.diffPath && editor.diffModified !== editor.diffOriginal) {
    editor.updateContent(editor.diffPath, editor.diffModified)
    await editor.saveFile(editor.diffPath).catch(() => undefined)
  }
  editor.closeDiff()
}

function onDiffLayout(): void {
  updateFloatPosition()
}

function clearFloatHideTimer(): void {
  if (!hideFloatBarTimer) return
  window.clearTimeout(hideFloatBarTimer)
  hideFloatBarTimer = null
}

function showCurrentToolbar(): void {
  if (!currentHunk.value) return
  clearFloatHideTimer()
  floatBarVisible.value = true
  void nextTick(updateFloatPosition)
}

function scheduleHideFloatBar(): void {
  clearFloatHideTimer()
  hideFloatBarTimer = window.setTimeout(() => {
    floatBarVisible.value = false
    hideFloatBarTimer = null
  }, 300)
}

function findHunkIndexByModifiedLine(lineNumber: number): number {
  const lineIndex = Math.max(0, lineNumber - 1)
  return editor.diffHunks.findIndex((hunk) => {
    const start = hunk.modifiedStart
    const end = Math.max(hunk.modifiedEnd - 1, hunk.modifiedStart)
    return lineIndex >= start && lineIndex <= end
  })
}

function onHunkLine(lineNumber: number): void {
  if (!isInline.value) return
  const index = findHunkIndexByModifiedLine(lineNumber)
  if (index < 0) return
  activeHunkIndex.value = index
  showCurrentToolbar()
}

function onKeydown(event: KeyboardEvent): void {
  if (!isInline.value || !showFloatBar.value || !floatBarVisible.value) return
  const primary = event.metaKey || event.ctrlKey
  if (!primary) return

  const key = event.key.toLowerCase()
  if (key === 'y') {
    event.preventDefault()
    void keepCurrentHunk()
  } else if (key === 'n') {
    event.preventDefault()
    void undoCurrentHunk()
  }
}

watch(() => editor.diffHunks.length, (length) => {
  if (!length) {
    activeHunkIndex.value = null
    floatBarVisible.value = false
    return
  }
  if (activeHunkIndex.value !== null && activeHunkIndex.value >= length) {
    activeHunkIndex.value = Math.max(0, length - 1)
  }
})

watch(currentHunk, () => {
  void nextTick(updateFloatPosition)
})

watch(() => editor.showDiff, (visible) => {
  if (!visible) {
    activeHunkIndex.value = null
    floatBarVisible.value = false
    return
  }
})

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
})

onBeforeUnmount(() => {
  clearFloatHideTimer()
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <section class="diff-view" :class="{ inline: isInline }">
    <header v-if="!isInline" class="diff-head">
      <div class="diff-head-main">
        <span>{{ t('editor.diffLabel', { path: editor.diffTitle || editor.diffPath }) }}</span>
        <span v-if="hasChanges" class="diff-stats">
          <span class="diff-stat-add">+{{ diffStats.additions }}</span>
          <span class="diff-stat-del">-{{ diffStats.deletions }}</span>
          <span class="diff-stat-hunks">{{ t('editor.hunks', { count: diffStats.count }) }}</span>
        </span>
        <span v-else class="diff-stat-empty">{{ t('editor.diffNoChanges') }}</span>
      </div>
      <div class="diff-actions">
        <button
          v-if="!editor.diffReadOnly"
          type="button"
          class="diff-btn primary"
          @click="editor.acceptDiff()"
        >
          {{ t('editor.accept') }}
        </button>
        <button
          v-if="!editor.diffReadOnly"
          type="button"
          class="diff-btn"
          @click="editor.rejectDiff()"
        >
          {{ t('editor.reject') }}
        </button>
        <button
          v-else
          type="button"
          class="diff-btn"
          @click="editor.closeDiff()"
        >
          {{ t('common.close') }}
        </button>
      </div>
    </header>

    <div
      v-if="!isInline && editor.diffHunks.length"
      class="diff-hunks"
      :class="{ open: hunksOpen }"
    >
      <button type="button" class="hunks-toggle" @click="hunksOpen = !hunksOpen">
        <ChevronDown v-if="hunksOpen" :size="15" />
        <ChevronRight v-else :size="15" />
        <span>{{ t('editor.diffChanges') }}</span>
      </button>
      <div v-if="hunksOpen" class="hunk-list">
        <article
          v-for="(hunk, index) in editor.diffHunks"
          :key="hunk.id"
          class="hunk-row"
          :class="{ accepted: editor.isDiffHunkAccepted(hunk), clickable: editor.diffReadOnly }"
          @click="editor.diffReadOnly ? jumpToHunk(hunk) : undefined"
        >
          <div class="hunk-meta">
            <span class="hunk-header">{{ hunk.header }}</span>
            <span v-if="hunk.additions" class="hunk-add">+{{ hunk.additions }}</span>
            <span v-if="hunk.deletions" class="hunk-del">-{{ hunk.deletions }}</span>
            <span v-if="editor.isDiffHunkAccepted(hunk)" class="hunk-state">{{ t('editor.hunkAccepted') }}</span>
          </div>
          <div v-if="!editor.diffReadOnly" class="hunk-actions">
            <button
              type="button"
              class="hunk-btn"
              :disabled="editor.isDiffHunkAccepted(hunk)"
              @click="editor.acceptDiffHunk(index)"
            >
              {{ t('editor.acceptHunk') }}
            </button>
            <button
              type="button"
              class="hunk-btn danger"
              @click="editor.rejectDiffHunk(index)"
            >
              {{ t('editor.rejectHunk') }}
            </button>
          </div>
          <span v-else class="hunk-jump">{{ t('editor.jumpToHunk') }}</span>
        </article>
      </div>
    </div>

    <div class="diff-editor-shell">
      <div v-if="!isInline" class="diff-pane-labels">
        <span class="diff-pane-label original">{{ t('editor.diffOriginal') }}</span>
        <span class="diff-pane-label modified">{{ t('editor.diffModified') }}</span>
      </div>
      <MonacoDiffEditor
        ref="diffEditorRef"
        class="diff-editor"
        :class="{ 'is-inline': isInline }"
        :original="editor.diffOriginal"
        :modified="editor.diffModified"
        :path="editor.diffPath"
        :read-only="editor.diffReadOnly"
        :inline="isInline"
        @layout="onDiffLayout"
        @hunk-line="onHunkLine"
        @hunk-leave="scheduleHideFloatBar"
      />

      <div
        v-if="showFloatBar"
        class="diff-float-bar"
        :class="{ visible: floatBarVisible }"
        :style="floatStyle"
        @mouseenter="showCurrentToolbar"
        @mouseleave="scheduleHideFloatBar"
      >
        <div class="diff-float-nav">
          <button type="button" class="diff-float-icon" :title="t('editor.prevHunk')" @click="goPrevHunk">
            <ChevronUp :size="14" />
          </button>
          <span class="diff-float-count">{{ (activeHunkIndex ?? 0) + 1 }} / {{ editor.diffHunks.length }}</span>
          <button type="button" class="diff-float-icon" :title="t('editor.nextHunk')" @click="goNextHunk">
            <ChevronDown :size="14" />
          </button>
        </div>
        <div v-if="!editor.diffReadOnly" class="diff-float-actions">
          <button type="button" class="diff-float-btn" @click="undoCurrentHunk">
            {{ t('codeAgent.changedFileUndo') }}
            <kbd>⌘N</kbd>
          </button>
          <button type="button" class="diff-float-btn primary" @click="keepCurrentHunk">
            {{ t('codeAgent.changedFileKeep') }}
            <kbd>⌘Y</kbd>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.diff-view {
  @apply flex min-h-0 flex-1 flex-col py-0 px-2;
}
.diff-view.inline {
  @apply px-0;
}
.diff-head {
  @apply flex shrink-0 items-center justify-between gap-3 text-[13px] font-medium text-codex-text;
}
.diff-head-main {
  @apply flex min-w-0 flex-wrap items-center gap-2;
}
.diff-stats {
  @apply inline-flex items-center gap-2 text-[12px] font-semibold;
}
.diff-stat-add {
  @apply font-mono text-emerald-600;
}
.diff-stat-del {
  @apply font-mono text-rose-500;
}
.diff-stat-hunks {
  @apply rounded-full bg-codex-hover px-2 py-0.5 text-[11px] font-medium text-codex-text-secondary;
}
.diff-stat-empty {
  @apply text-[12px] font-normal text-codex-muted;
}
.diff-actions {
  @apply flex shrink-0 gap-2;
}
.diff-btn {
  @apply rounded-lg px-3 py-1.5 text-[12px] font-medium text-codex-text-secondary hover:bg-codex-hover hover:text-codex-text;
}
.diff-btn.primary {
  @apply bg-codex-text text-codex-bg hover:bg-codex-text hover:text-codex-bg;
}
.diff-editor-shell {
  @apply relative flex min-h-0 flex-1 flex-col overflow-hidden;
}
.diff-pane-labels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  flex-shrink: 0;
  overflow: hidden;
  border: 1px solid var(--codex-border, #e5e5e5);
  border-bottom: 0;
  border-radius: 8px 8px 0 0;
}
.diff-pane-label {
  padding: 6px 12px;
  font-size: 11px;
  font-weight: 650;
  letter-spacing: 0.02em;
}
.diff-pane-label.original {
  border-right: 1px solid var(--codex-border, #e5e5e5);
  background: #fff1f2;
  color: #be123c;
}
.diff-pane-label.modified {
  background: #ecfdf5;
  color: #047857;
}
.diff-editor {
  @apply min-h-0 flex-1 overflow-hidden rounded-b-lg border border-t-0 border-codex-border;
}
.diff-editor.is-inline {
  @apply rounded-none border-0;
}
.diff-hunks {
  @apply mb-2 shrink-0 overflow-hidden rounded-lg border border-codex-border;
  background: var(--codex-surface, #f7f7f7);
}
.hunks-toggle {
  @apply flex h-8 w-full items-center gap-1.5 px-2.5 text-left text-[12px] font-medium text-codex-text-secondary hover:bg-codex-hover hover:text-codex-text;
}
.hunk-list {
  @apply max-h-52 overflow-auto border-t border-codex-border;
}
.hunk-row {
  @apply flex items-center justify-between gap-3 border-b border-codex-border px-3 py-2 last:border-b-0;
}
.hunk-row.accepted {
  @apply bg-emerald-500/5;
}
.hunk-row.clickable {
  cursor: pointer;
}
.hunk-row.clickable:hover {
  @apply bg-codex-hover;
}
.hunk-meta {
  @apply flex min-w-0 items-center gap-2 text-[12px];
}
.hunk-header {
  @apply font-mono text-codex-muted;
}
.hunk-add {
  @apply font-mono font-medium text-emerald-600;
}
.hunk-del {
  @apply font-mono font-medium text-rose-500;
}
.hunk-state {
  @apply rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700;
}
.hunk-actions {
  @apply flex shrink-0 items-center gap-1.5;
}
.hunk-btn {
  @apply rounded-md px-2 py-1 text-[11px] font-medium text-codex-text-secondary hover:bg-codex-hover hover:text-codex-text disabled:pointer-events-none disabled:opacity-50;
}
.hunk-btn.danger {
  @apply text-rose-500 hover:bg-rose-500/10;
}
.hunk-jump {
  @apply shrink-0 text-[11px] font-medium text-codex-accent;
}
.diff-float-bar {
  position: absolute;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px;
  border: 1px solid var(--codex-border, #dcdcdc);
  border-radius: 10px;
  background: color-mix(in srgb, var(--codex-bg, #fff) 92%, transparent);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.12);
  backdrop-filter: blur(8px);
  opacity: 0;
  transform: translateY(-2px);
  pointer-events: none;
  transition:
    opacity 140ms ease,
    transform 140ms ease;
}
.diff-float-bar.visible {
  opacity: 1;
  transform: translateY(0);
  pointer-events: auto;
}
.diff-float-nav {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding-right: 6px;
  border-right: 1px solid var(--codex-border, #dcdcdc);
}
.diff-float-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  color: var(--codex-text-secondary, #667085);
}
.diff-float-icon:hover {
  background: var(--codex-hover, #f2f4f7);
  color: var(--codex-text, #101828);
}
.diff-float-count {
  min-width: 44px;
  text-align: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--codex-text-secondary, #667085);
}
.diff-float-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.diff-float-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--codex-text-secondary, #667085);
}
.diff-float-btn:hover {
  background: var(--codex-hover, #f2f4f7);
  color: var(--codex-text, #101828);
}
.diff-float-btn.primary {
  background: var(--codex-text, #101828);
  color: var(--codex-bg, #fff);
}
.diff-float-btn.primary:hover {
  opacity: 0.92;
}
.diff-float-btn kbd {
  font-size: 10px;
  font-weight: 500;
  opacity: 0.72;
}
</style>
