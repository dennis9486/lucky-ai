<script setup lang="ts">
import { ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import type { AgentReportPatch } from './report-types.js'
import PatchCard from './PatchCard.vue'

defineProps<{
  patches: AgentReportPatch[]
}>()

const emit = defineEmits<{ review: [] }>()
const { t } = useI18n()
const open = ref(true)
</script>

<template>
  <section v-if="patches.length" class="patch-list">
    <header class="patch-list-head">
      <button type="button" class="patch-list-toggle" @click="open = !open">
        <ChevronRight :size="14" class="patch-list-chevron" :class="{ open }" />
        <span>{{ t('codeAgent.changedFiles', { count: patches.length }) }}</span>
      </button>
      <button type="button" class="patch-action" @click="emit('review')">{{ t('codeAgent.reviewChangedFiles') }}</button>
    </header>
    <div v-if="open" class="patch-list-body">
      <PatchCard v-for="patch in patches" :key="patch.id" :patch="patch" />
    </div>
  </section>
</template>

<style scoped>
.patch-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.patch-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.patch-list-toggle {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  padding: 0;
  color: var(--codex-text-secondary, #666);
  font-size: 13px;
  font-weight: 540;
}
.patch-list-chevron {
  color: var(--codex-muted, #8c8c8c);
  transition: transform 0.14s ease;
}
.patch-list-chevron.open {
  transform: rotate(90deg);
}
.patch-action {
  flex-shrink: 0;
  border: 0;
  border-radius: 7px;
  background: var(--codex-hover, #ececec);
  padding: 4px 9px;
  color: var(--codex-text, #222);
  font-size: 12px;
  font-weight: 560;
}
.patch-action:hover {
  background: color-mix(in srgb, var(--codex-hover, #ececec) 72%, var(--codex-text, #222));
  color: var(--codex-bg, #fff);
}
.patch-list-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
</style>
