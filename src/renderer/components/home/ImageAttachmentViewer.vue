<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronLeft, ChevronRight, FolderOpen, ImageIcon, Trash2, X } from 'lucide-vue-next'
import { useUiStore } from '../../stores/ui.store.js'
import { attachmentPreviewSrc } from '../../utils/attachment-preview.js'
import { ipc, unwrap } from '../../services/ipc-client.js'

const { t } = useI18n()
const ui = useUiStore()

const images = computed(() => {
  const source = ui.imageViewerAttachments.length ? ui.imageViewerAttachments : ui.composerAttachments
  return source.filter((item) => item.kind === 'image')
})
const canRemove = computed(() => ui.imageViewerAttachments.length === 0)
const activeIndex = computed(() =>
  images.value.findIndex((item) => item.path === ui.activeImageAttachmentPath)
)
const activeImage = computed(() => images.value[activeIndex.value] ?? null)
const isOpen = computed(() => Boolean(activeImage.value))

function close(): void {
  ui.closeImageAttachmentViewer()
}

function move(delta: number): void {
  if (!images.value.length) return
  const current = activeIndex.value >= 0 ? activeIndex.value : 0
  const next = (current + delta + images.value.length) % images.value.length
  const image = images.value[next]
  if (image) ui.openImageAttachment(image.path)
}

function removeCurrent(): void {
  if (!activeImage.value || !canRemove.value) return
  ui.removeComposerAttachment(activeImage.value.path)
}

async function revealCurrent(): Promise<void> {
  if (!activeImage.value) return
  await unwrap(ipc.app.showItemInFolder(activeImage.value.path))
}

function onKeydown(event: KeyboardEvent): void {
  if (!isOpen.value) return
  if (event.key === 'Escape') close()
  if (event.key === 'ArrowLeft') move(-1)
  if (event.key === 'ArrowRight') move(1)
  if (event.key === 'Backspace' || event.key === 'Delete') {
    event.preventDefault()
    removeCurrent()
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div v-if="isOpen && activeImage" class="viewer-backdrop" @click.self="close">
      <section class="viewer-window" role="dialog" aria-modal="true" :aria-label="t('imageViewer.title')">
        <header class="viewer-header">
          <div class="viewer-title">
            <ImageIcon :size="16" />
            <div class="title-text">
              <div class="name" :title="activeImage.name">{{ activeImage.name }}</div>
              <div class="meta">{{ t('imageViewer.counter', { current: activeIndex + 1, total: images.length }) }}</div>
            </div>
          </div>
          <div class="viewer-actions">
            <button type="button" class="icon-btn" :title="t('imageViewer.reveal')" @click="revealCurrent">
              <FolderOpen :size="16" />
            </button>
            <button v-if="canRemove" type="button" class="icon-btn danger" :title="t('imageViewer.remove')" @click="removeCurrent">
              <Trash2 :size="16" />
            </button>
            <button type="button" class="icon-btn" :title="t('common.close')" @click="close">
              <X :size="17" />
            </button>
          </div>
        </header>

        <div class="viewer-stage">
          <button
            v-if="images.length > 1"
            type="button"
            class="nav-btn previous"
            :title="t('imageViewer.previous')"
            @click="move(-1)"
          >
            <ChevronLeft :size="22" />
          </button>
          <img class="viewer-image" :src="attachmentPreviewSrc(activeImage)" :alt="activeImage.name" />
          <button
            v-if="images.length > 1"
            type="button"
            class="nav-btn next"
            :title="t('imageViewer.next')"
            @click="move(1)"
          >
            <ChevronRight :size="22" />
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.viewer-backdrop {
  @apply fixed inset-0 z-[80] flex items-center justify-center p-6 backdrop-blur-[2px];
  background: rgba(0, 0, 0, 0.28);
}
.viewer-window {
  @apply flex max-h-[88vh] min-w-0 flex-col overflow-hidden rounded-[20px] border border-codex-border
         bg-codex-bg shadow-[0_28px_90px_rgba(0,0,0,0.22)];
  width: min(980px, calc(100vw - 48px));
}
.viewer-header {
  @apply flex h-14 shrink-0 items-center justify-between gap-4 border-b border-codex-border px-4;
}
.viewer-title {
  @apply flex min-w-0 items-center gap-2 text-codex-text;
}
.title-text {
  @apply min-w-0;
}
.name {
  @apply truncate text-[13px] font-semibold;
}
.meta {
  @apply mt-0.5 text-[11px] text-codex-muted;
}
.viewer-actions {
  @apply flex shrink-0 items-center gap-1;
}
.icon-btn {
  @apply flex h-8 w-8 items-center justify-center rounded-lg text-codex-muted transition-colors
         hover:bg-codex-hover hover:text-codex-text;
}
.icon-btn.danger:hover {
  @apply text-red-500;
}
.viewer-stage {
  @apply relative flex min-h-[320px] flex-1 items-center justify-center bg-codex-sidebar p-5;
}
.viewer-image {
  @apply max-h-[72vh] max-w-full rounded-[12px] object-contain shadow-sm;
}
.nav-btn {
  @apply absolute top-1/2 z-10 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full
         border border-codex-border bg-codex-bg text-codex-text-secondary shadow-sm backdrop-blur
         transition-colors hover:bg-codex-bg hover:text-codex-text;
}
.nav-btn.previous {
  @apply left-4;
}
.nav-btn.next {
  @apply right-4;
}
@media (max-width: 720px) {
  .viewer-backdrop {
    @apply p-3;
  }
  .viewer-window {
    width: calc(100vw - 24px);
  }
  .viewer-stage {
    @apply min-h-[260px] p-3;
  }
}
</style>
