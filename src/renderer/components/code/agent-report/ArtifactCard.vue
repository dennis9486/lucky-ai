<script setup lang="ts">
import { FileText } from 'lucide-vue-next'
import type { AgentReportArtifact } from './report-types.js'

defineProps<{
  artifact: AgentReportArtifact
}>()
</script>

<template>
  <article class="artifact-card">
    <FileText :size="15" :stroke-width="1.8" class="artifact-icon" />
    <div class="artifact-meta">
      <div class="artifact-title">{{ artifact.title }}</div>
      <div v-if="artifact.subtitle || artifact.path" class="artifact-subtitle">
        {{ artifact.subtitle || artifact.path }}
      </div>
    </div>
  </article>
</template>

<style scoped>
.artifact-card {
  display: flex;
  gap: 8px;
  border: 1px solid var(--codex-border, #dadada);
  border-radius: 8px;
  background: var(--codex-bg, #fff);
  padding: 8px 10px;
}
.artifact-icon {
  flex-shrink: 0;
  color: var(--codex-muted, #8a8a8a);
}
.artifact-meta {
  min-width: 0;
}
.artifact-title {
  color: var(--codex-text, #222);
  font-size: 12.5px;
  font-weight: 560;
}
.artifact-subtitle {
  overflow: hidden;
  color: var(--codex-muted, #8a8a8a);
  font-size: 11.5px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
