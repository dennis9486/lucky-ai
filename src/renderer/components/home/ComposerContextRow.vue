<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUiStore } from '../../stores/ui.store.js'
import { attachmentPreviewSrc } from '../../utils/attachment-preview.js'

const { t } = useI18n()
const ui = useUiStore()

const imageAttachments = computed(() => ui.composerAttachments.filter((item) => item.kind === 'image'))
const hasContext = computed(
  () =>
    imageAttachments.value.length > 0 ||
    ui.planMode ||
    ui.showGoalInput ||
    ui.attachedRuntime
)

function removeAttachment(path: string): void {
  ui.removeComposerAttachment(path)
}

function clearPlanMode(): void {
  ui.planMode = false
}

function clearGoalMode(): void {
  ui.showGoalInput = false
}

function clearRuntime(): void {
  ui.attachedRuntime = null
}
</script>

<template>
  <div v-if="hasContext" class="composer-context">
    <div v-if="imageAttachments.length" class="image-attachments">
      <div
        v-for="item in imageAttachments"
        :key="item.path"
        role="button"
        tabindex="0"
        class="image-card"
        :aria-label="t('imageViewer.open', { name: item.name })"
        :title="t('imageViewer.open', { name: item.name })"
        @click="ui.openImageAttachment(item.path)"
        @keydown.enter.prevent="ui.openImageAttachment(item.path)"
        @keydown.space.prevent="ui.openImageAttachment(item.path)"
      >
        <img class="image-preview" :src="attachmentPreviewSrc(item)" :alt="item.name" />
        <button
          type="button"
          class="image-remove"
          :aria-label="t('composer.removeAttachment', { name: item.name })"
          @click.stop="removeAttachment(item.path)"
        >
          ×
        </button>
        <div class="image-caption" :title="item.name">{{ item.name }}</div>
      </div>
    </div>

    <div v-if="ui.planMode" class="mode-chip">
      <span>{{ t('composer.planMode') }}</span>
      <button type="button" class="chip-dismiss" :aria-label="t('composer.closePlanMode')" @click="clearPlanMode">×</button>
    </div>
    <div v-if="ui.showGoalInput" class="mode-chip goal">
      <span>{{ t('composer.goalMode') }}</span>
      <button type="button" class="chip-dismiss" :aria-label="t('composer.closeGoalMode')" @click="clearGoalMode">×</button>
    </div>
    <div v-if="ui.attachedRuntime" class="mode-chip runtime">
      <span>{{ t('composer.runtime') }}</span>
      <button type="button" class="chip-dismiss" :aria-label="t('composer.removeRuntime')" @click="clearRuntime">×</button>
    </div>
  </div>
</template>

<style scoped>
.composer-context {
  @apply flex flex-wrap items-center gap-2 px-5 pt-4 pb-1;
}
.image-attachments {
  @apply flex w-full flex-wrap gap-2 pb-1;
}
.image-card {
  @apply relative h-[104px] w-[104px] cursor-pointer overflow-hidden rounded-[18px] border border-codex-border
         bg-codex-hover text-left shadow-sm outline-none transition-[transform,box-shadow] hover:-translate-y-0.5
         focus-visible:ring-2 focus-visible:ring-codex-accent;
}
.image-preview {
  @apply h-full w-full object-cover;
}
.image-remove {
  @apply absolute right-1.5 top-1.5 flex h-6 w-6 items-center justify-center rounded-full
         bg-codex-text text-[18px] leading-none text-codex-bg shadow-sm transition-transform hover:scale-105;
}
.image-caption {
  @apply absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/55 to-transparent px-2 pb-1.5 pt-5
         text-[10px] font-medium text-white;
}
.mode-chip {
  @apply inline-flex max-w-[220px] items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[12px] font-semibold
         text-codex-accent;
  background-color: color-mix(in srgb, var(--codex-accent) 14%, var(--codex-hover));
}
.mode-chip.goal {
  @apply text-emerald-600;
  background-color: color-mix(in srgb, rgb(5 150 105) 12%, var(--codex-hover));
}
:global([data-theme='dark']) .mode-chip.goal {
  @apply text-emerald-400;
  background-color: color-mix(in srgb, rgb(52 211 153) 14%, var(--codex-hover));
}
.mode-chip.runtime {
  @apply text-blue-600;
  background-color: color-mix(in srgb, rgb(37 99 235) 12%, var(--codex-hover));
}
:global([data-theme='dark']) .mode-chip.runtime {
  @apply text-blue-400;
  background-color: color-mix(in srgb, rgb(96 165 250) 14%, var(--codex-hover));
}
.chip-dismiss {
  @apply ml-0.5 text-[14px] leading-none text-codex-muted hover:text-codex-text transition-colors;
}
</style>
