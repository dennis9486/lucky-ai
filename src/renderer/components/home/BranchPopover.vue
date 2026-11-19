<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Search, GitBranch, Check, Plus } from 'lucide-vue-next'
import { useProjectStore } from '../../stores/project.store.js'
import type { WorkspaceGitBranch } from '../../../shared/types/workspace.js'

const { t } = useI18n()

const open = defineModel<boolean>('open', { default: false })
const projects = useProjectStore()
const query = ref('')
const newBranch = ref('')
const busy = ref(false)
const error = ref('')

const filteredBranches = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return projects.gitBranches
  return projects.gitBranches.filter((branch) => branch.name.toLowerCase().includes(q))
})

watch(open, (value) => {
  if (value) {
    error.value = ''
    void projects.refreshGitBranch()
  }
})

async function checkout(branch: string): Promise<void> {
  if (busy.value || branch === projects.gitBranchLabel) return
  busy.value = true
  error.value = ''
  try {
    await projects.checkoutBranch(branch)
    open.value = false
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

async function createBranch(): Promise<void> {
  const branch = newBranch.value.trim()
  if (!branch || busy.value) return
  busy.value = true
  error.value = ''
  try {
    await projects.createBranch(branch)
    newBranch.value = ''
    open.value = false
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}

function branchMeta(branch: WorkspaceGitBranch): string {
  const parts = [branch.remote ? t('branch.remote') : t('branch.local')]
  if (branch.current && projects.gitStatus.dirtyCount > 0) {
    parts.push(t('branch.uncommittedPlain', { n: projects.gitStatus.dirtyCount }))
  }
  if (branch.current && (projects.gitStatus.ahead || projects.gitStatus.behind)) {
    parts.push(t('branch.aheadBehind', { ahead: projects.gitStatus.ahead ?? 0, behind: projects.gitStatus.behind ?? 0 }))
  }
  if (!branch.current && branch.upstream) {
    parts.push(branch.upstream)
  }
  return parts.join(' · ')
}
</script>

<template>
  <div v-if="open" class="branch-popover" @click.stop @pointerdown.stop>
    <div class="search-row">
      <Search :size="14" class="search-icon" />
      <input
        v-model="query"
        class="search-input"
        type="text"
        :placeholder="t('branch.search')"
      />
    </div>

    <div class="branch-label">{{ t('branch.label') }}</div>

    <div v-if="!projects.gitStatus.isRepository" class="empty-git">
      {{ t('branch.notGit') }}
    </div>

    <div v-else class="branch-list pretty-scrollbar">
      <button
        v-for="branch in filteredBranches"
        :key="branch.name"
        type="button"
        class="branch-row"
        :disabled="busy"
        @click="checkout(branch.name)"
      >
        <GitBranch :size="15" class="branch-icon" />
        <div class="branch-copy">
          <div class="branch-name">{{ branch.name }}</div>
          <div v-if="branchMeta(branch)" class="branch-meta">{{ branchMeta(branch) }}</div>
        </div>
        <Check v-if="branch.current" :size="15" class="check-icon" />
      </button>
    </div>

    <div v-if="error" class="branch-error">{{ error }}</div>

    <div class="branch-footer">
      <button type="button" class="create-icon-btn" :disabled="busy || !newBranch.trim()" @click="createBranch">
        <Plus :size="15" />
      </button>
      <input
        v-model="newBranch"
        class="new-branch-input"
        type="text"
        :placeholder="t('branch.checkoutPlaceholder')"
        @keydown.enter.prevent="createBranch"
      />
    </div>
  </div>
</template>

<style scoped>
.branch-popover {
  @apply absolute bottom-full left-1/2 z-[70] mb-2 flex w-[min(320px,calc(100vw-2rem))] -translate-x-1/2 flex-col overflow-hidden
         rounded-[14px] border border-codex-border shadow-[0_12px_36px_rgba(0,0,0,0.12)];
  background-color: var(--codex-bg);
  isolation: isolate;
}
.search-row {
  @apply flex h-10 items-center gap-2.5 border-b border-codex-border px-3;
  background-color: var(--codex-bg);
}
.search-icon {
  @apply shrink-0 text-codex-muted;
}
.search-input {
  @apply h-full flex-1 bg-transparent text-[12px] font-medium text-codex-text outline-none
         placeholder:text-codex-muted;
}
.branch-label {
  @apply px-3 pb-1 pt-2 text-[10px] font-semibold text-codex-muted;
}
.branch-list {
  @apply max-h-[168px] overflow-y-auto px-1.5 pb-1;
  background-color: var(--codex-bg);
}
.branch-row {
  @apply flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-codex-hover;
}
.branch-row:disabled {
  @apply cursor-not-allowed opacity-60;
}
.branch-icon {
  @apply shrink-0 text-codex-text-secondary;
}
.branch-copy {
  @apply min-w-0 flex-1;
}
.branch-name {
  @apply truncate text-[12px] font-medium text-codex-text;
}
.branch-meta {
  @apply mt-0.5 truncate text-[10px] text-codex-muted;
}
.check-icon {
  @apply shrink-0 text-codex-text-secondary;
}
.branch-footer {
  @apply flex items-center gap-2 border-t border-codex-border px-3 py-2;
  background-color: var(--codex-bg);
}
.create-icon-btn {
  @apply inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-codex-muted
         transition-colors hover:bg-codex-hover hover:text-codex-text;
}
.create-icon-btn:disabled {
  @apply cursor-not-allowed opacity-45;
}
.new-branch-input {
  @apply min-w-0 flex-1 bg-transparent text-[12px] text-codex-text outline-none placeholder:text-codex-muted;
}
.empty-git,
.branch-error {
  @apply mx-2 mb-1 rounded-[10px] px-2.5 py-1.5 text-[10px] font-medium;
}
.empty-git {
  @apply bg-codex-hover text-codex-muted;
}
.branch-error {
  @apply bg-red-50 text-red-700;
}
</style>
