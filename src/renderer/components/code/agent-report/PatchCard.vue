<script setup lang="ts">
import { computed, ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import { getFileIcon } from '../../../utils/file-icons.js'
import type { AgentReportPatch } from './report-types.js'
import PatchPreview from './PatchPreview.vue'

const props = withDefaults(defineProps<{
  patch: AgentReportPatch
  defaultOpen?: boolean
}>(), {
  defaultOpen: true
})

const open = ref(props.defaultOpen)
const icon = computed(() => getFileIcon(props.patch.path || props.patch.name))
const { t } = useI18n()
</script>

<template>
  <article class="patch-card" :class="{ open }">
    <button type="button" class="patch-head" @click="open = !open">
      <ChevronRight :size="14" class="patch-chevron" :class="{ open }" />
      <img v-if="icon" :src="icon" alt="" class="patch-icon" draggable="false" />
      <span class="patch-name">{{ patch.name }}</span>
      <span v-if="patch.additions" class="patch-add">+{{ patch.additions }}</span>
      <span v-if="patch.deletions" class="patch-del">-{{ patch.deletions }}</span>
    </button>
    <PatchPreview v-if="open && patch.lines.length" :lines="patch.lines" />
    <div v-else-if="open" class="patch-empty">
      {{ patch.status === 'error' ? t('codeAgent.report.patchFailed') : t('codeAgent.report.patchNoPreview') }}
    </div>
  </article>
</template>

<style scoped>
.patch-card {
  overflow: hidden;
  border: 1px solid var(--codex-border, #dadada);
  border-radius: 7px;
  background: var(--codex-bg, #fff);
}
.patch-head {
  display: flex;
  min-height: 30px;
  width: 100%;
  align-items: center;
  gap: 6px;
  border: 0;
  border-bottom: 1px solid var(--codex-border, #dadada);
  background: color-mix(in srgb, var(--codex-bg, #fff) 92%, var(--codex-hover, #f1f1f1));
  padding: 4px 9px;
  text-align: left;
}
.patch-card:not(.open) .patch-head {
  border-bottom-color: transparent;
}
.patch-head:hover {
  background: var(--codex-hover, #f3f3f3);
}
.patch-chevron {
  flex-shrink: 0;
  color: var(--codex-muted, #8c8c8c);
  transition: transform 0.14s ease;
}
.patch-chevron.open {
  transform: rotate(90deg);
}
.patch-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.patch-name {
  min-width: 0;
  overflow: hidden;
  flex: 1;
  color: var(--codex-text-secondary, #5e5e5e);
  font-size: 12.5px;
  font-weight: 560;
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.patch-add,
.patch-del {
  flex-shrink: 0;
  font-family: var(--codex-code-font, ui-monospace, SFMono-Regular, Menlo, monospace);
  font-size: 12px;
}
.patch-add {
  color: #179367;
}
.patch-del {
  color: #e04f73;
}
.patch-empty {
  padding: 8px 12px;
  color: var(--codex-muted, #999);
  font-size: 12px;
}
</style>
