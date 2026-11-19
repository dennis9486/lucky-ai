<script setup lang="ts">
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, NotebookTabs, Plus, ChevronRight } from 'lucide-vue-next'
import { useProjectStore } from '../../stores/project.store.js'

const { t } = useI18n()

const open = defineModel<boolean>('open', { default: false })

const projects = useProjectStore()
const query = ref('')

const filtered = computed(() => projects.searchProjects(query.value))

const emit = defineEmits<{ select: [] }>()

async function pickProject(id: string): Promise<void> {
  await projects.selectProject(id)
  open.value = false
  emit('select')
}

async function handleNewProject(): Promise<void> {
  await projects.addProjectFromDialog()
  open.value = false
  emit('select')
}
</script>

<template>
  <div v-if="open" class="project-popover" @click.stop @pointerdown.stop>
    <div class="search-wrap">
      <Search :size="14" class="search-icon" />
      <input
        v-model="query"
        type="text"
        class="search-input"
        :placeholder="t('project.search')"
        @click.stop
      />
    </div>

    <div class="project-list pretty-scrollbar">
      <button
        v-for="project in filtered"
        :key="project.id"
        type="button"
        class="project-row"
        :class="{ 'is-active': projects.activeProjectId === project.id }"
        @click="pickProject(project.id)"
      >
        <NotebookTabs :size="15" class="project-icon" />
        <span class="truncate">{{ project.name }}</span>
        <span v-if="project.rootPath && project.name !== projects.projectLabel" class="project-path">
          {{ project.rootPath.split('/').filter(Boolean).slice(-2, -1)[0] }}
        </span>
      </button>
      <p v-if="!projects.projects.length" class="empty">{{ t('project.empty') }}</p>
      <p v-else-if="!filtered.length" class="empty">{{ t('project.notFound') }}</p>
    </div>

    <button type="button" class="new-project-row" @click="handleNewProject">
      <Plus :size="14" class="shrink-0" />
      <span class="flex-1 text-left">{{ t('project.newProject') }}</span>
      <ChevronRight :size="14" class="shrink-0 text-codex-muted" />
    </button>
  </div>
</template>

<style scoped>
.project-popover {
  @apply absolute bottom-full left-0 z-[70] mb-2 w-[min(300px,calc(100vw-2rem))] overflow-hidden rounded-[14px]
         border border-codex-border shadow-[0_12px_36px_rgba(0,0,0,0.12)];
  background-color: var(--codex-bg);
  isolation: isolate;
}
.search-wrap {
  @apply flex h-10 items-center gap-2.5 border-b border-codex-border px-3;
  background-color: var(--codex-bg);
}
.search-icon {
  @apply shrink-0 text-codex-muted;
}
.search-input {
  @apply flex-1 bg-transparent text-[12px] font-medium text-codex-text outline-none placeholder:text-codex-muted;
}
.project-list {
  @apply max-h-[160px] overflow-y-auto px-1.5 py-1;
  background-color: var(--codex-bg);
}
.project-row {
  @apply flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[12px] font-medium
         text-codex-text transition-colors hover:bg-codex-hover;
}
.project-row.is-active {
  @apply bg-codex-hover;
}
.project-icon {
  @apply shrink-0 text-codex-text-secondary;
}
.project-path {
  @apply truncate text-[10px] text-codex-muted;
}
.empty {
  @apply px-2.5 py-3 text-[11px] text-codex-muted;
}
.new-project-row {
  @apply flex w-full items-center gap-2 border-t border-codex-border px-3 py-2.5 text-[12px] font-medium
         text-codex-text transition-colors hover:bg-codex-hover;
  background-color: var(--codex-bg);
}
</style>
