<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight, FileCode2 } from 'lucide-vue-next'
import { useEditorStore } from '../../stores/editor.store.js'
import { getFileIcon } from '../../utils/file-icons.js'

const { t } = useI18n()
const editor = useEditorStore()
const failedIcons = ref(new Set<string>())

const breadcrumbPath = computed(() => {
  if (editor.showDiff && editor.diffPath) return editor.diffPath
  return editor.activeTab?.path ?? ''
})

const parts = computed(() => breadcrumbPath.value.split('/').filter(Boolean))
const fileName = computed(() => parts.value.at(-1) ?? '')
const fileIcon = computed(() => {
  const name = fileName.value
  if (!name || failedIcons.value.has(name)) return ''
  return getFileIcon(name)
})

function fallbackIcon(name: string): void {
  failedIcons.value = new Set([...failedIcons.value, name])
}
</script>

<template>
  <nav v-if="parts.length" class="editor-breadcrumb" :title="breadcrumbPath" :aria-label="t('editor.breadcrumb')">
    <template v-for="(part, index) in parts" :key="`${part}-${index}`">
      <ChevronRight v-if="index > 0" :size="13" class="breadcrumb-separator" />
      <span class="breadcrumb-item" :class="{ leaf: index === parts.length - 1 }">
        <template v-if="index === parts.length - 1">
          <img
            v-if="fileIcon"
            class="breadcrumb-file-icon"
            :src="fileIcon"
            alt=""
            loading="lazy"
            @error="fallbackIcon(part)"
          />
          <FileCode2 v-else :size="14" class="breadcrumb-fallback-icon" />
        </template>
        <span class="breadcrumb-label">{{ part }}</span>
      </span>
    </template>
  </nav>
</template>

<style scoped>
.editor-breadcrumb {
  display: flex;
  height: 26px;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  overflow: hidden;
  border-bottom: 1px solid var(--codex-border);
  background: var(--codex-bg);
  padding: 0 14px;
  color: var(--codex-text-secondary);
  font-size: 12px;
  font-weight: 500;
  white-space: nowrap;
}
.breadcrumb-item {
  display: inline-flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
  color: var(--codex-text-secondary);
}
.breadcrumb-item.leaf {
  min-width: 0;
  color: var(--codex-text);
}
.breadcrumb-label {
  overflow: hidden;
  text-overflow: ellipsis;
}
.breadcrumb-separator {
  flex-shrink: 0;
  color: var(--codex-muted);
}
.breadcrumb-file-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  object-fit: contain;
}
.breadcrumb-fallback-icon {
  flex-shrink: 0;
  color: var(--codex-muted);
}
</style>
