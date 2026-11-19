<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useCodeAgentStore } from '../../stores/code-agent.store.js'
import { attachmentPreviewSrc } from '../../utils/attachment-preview.js'

const { t } = useI18n()
const agent = useCodeAgentStore()

const imageAttachments = computed(() => agent.attachments.filter((item) => item.kind === 'image'))
</script>

<template>
  <div v-if="imageAttachments.length" class="code-agent-context">
    <div v-if="imageAttachments.length" class="image-attachments">
      <div
        v-for="item in imageAttachments"
        :key="item.path"
        class="image-card"
        :title="item.name"
      >
        <img class="image-preview" :src="attachmentPreviewSrc(item)" :alt="item.name" />
        <button
          type="button"
          class="image-remove"
          :aria-label="t('composer.removeAttachment', { name: item.name })"
          @click="agent.removeAttachment(item.path)"
        >
          ×
        </button>
        <div class="image-caption" :title="item.name">{{ item.name }}</div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.code-agent-context {
  @apply flex flex-wrap items-center gap-1.5 px-4 pt-3 pb-1;
}
.image-attachments {
  @apply flex w-full flex-wrap gap-2 pb-1;
}
.image-card {
  @apply relative h-[82px] w-[82px] overflow-hidden rounded-[12px] border border-codex-border bg-codex-hover;
}
.image-preview {
  @apply h-full w-full object-cover;
}
.image-remove {
  @apply absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full
         bg-codex-text text-[15px] leading-none text-codex-bg shadow-sm hover:scale-105;
}
.image-caption {
  @apply absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/55 to-transparent px-1.5 pb-1 pt-4
         text-[9px] font-medium text-white;
}
</style>
