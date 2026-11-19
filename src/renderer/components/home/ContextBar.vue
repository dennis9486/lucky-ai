<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, GitBranch, Laptop, NotebookTabs } from 'lucide-vue-next'
import ContextChip from './ContextChip.vue'
import StartupModePopover from './StartupModePopover.vue'
import ProjectPickerPopover from './ProjectPickerPopover.vue'
import BranchPopover from './BranchPopover.vue'
import { useProjectStore } from '../../stores/project.store.js'

const { t } = useI18n()
const projects = useProjectStore()
const showProjectPicker = ref(false)
const showStartupMode = ref(false)
const showBranchPicker = ref(false)
const barRef = ref<HTMLElement | null>(null)

const anyOpen = () => showProjectPicker.value || showStartupMode.value || showBranchPicker.value

function closeAll(): void {
  showProjectPicker.value = false
  showStartupMode.value = false
  showBranchPicker.value = false
}

function toggleProject(): void {
  showProjectPicker.value = !showProjectPicker.value
  showStartupMode.value = false
  showBranchPicker.value = false
}

function toggleStartupMode(): void {
  if (!projects.hasWorkspace) return
  showStartupMode.value = !showStartupMode.value
  showProjectPicker.value = false
  showBranchPicker.value = false
}

function toggleBranchPicker(): void {
  if (!projects.hasWorkspace) return
  showBranchPicker.value = !showBranchPicker.value
  showProjectPicker.value = false
  showStartupMode.value = false
  if (showBranchPicker.value) void projects.refreshGitBranch()
}

async function handleStartupSelect(mode: 'local' | 'worktree'): Promise<void> {
  if (mode === 'worktree') {
    await projects.pickWorktree()
  } else {
    await projects.setStartupMode('local')
  }
}

function onDocPointerDown(e: PointerEvent): void {
  if (!anyOpen()) return
  if (!barRef.value?.contains(e.target as Node)) {
    closeAll()
  }
}

onMounted(() => document.addEventListener('pointerdown', onDocPointerDown))
onUnmounted(() => document.removeEventListener('pointerdown', onDocPointerDown))
</script>

<template>
  <div ref="barRef" class="context-bar" :class="{ 'has-open-popover': anyOpen() }">
    <template v-if="!projects.hasWorkspace">
      <div class="chip-wrap" :class="{ 'is-open': showProjectPicker }">
        <button type="button" class="choose-project" @click.stop="toggleProject">
          <NotebookTabs :size="14" class="shrink-0 chip-icon" />
          <span>{{ t('context.chooseProject') }}</span>
          <ChevronDown :size="13" class="chip-chevron shrink-0" />
        </button>
        <ProjectPickerPopover v-model:open="showProjectPicker" />
      </div>
    </template>

    <template v-else>
      <div class="chip-wrap" :class="{ 'is-open': showProjectPicker }">
        <ContextChip
          :icon="NotebookTabs"
          :label="projects.projectLabel"
          :has-dropdown="true"
          :active="showProjectPicker"
          @click="toggleProject"
        />
        <ProjectPickerPopover v-model:open="showProjectPicker" />
      </div>

      <div class="chip-wrap" :class="{ 'is-open': showStartupMode }">
        <ContextChip
          :icon="Laptop"
          :label="projects.startupModeLabel"
          :has-dropdown="true"
          :active="showStartupMode"
          @click="toggleStartupMode"
        />
        <StartupModePopover
          v-model="projects.startupMode"
          v-model:open="showStartupMode"
          @select="handleStartupSelect"
        />
      </div>

      <div class="chip-wrap" :class="{ 'is-open': showBranchPicker }">
        <ContextChip
          :icon="GitBranch"
          :label="projects.gitBranchLabel"
          :has-dropdown="true"
          :active="showBranchPicker"
          @click="toggleBranchPicker"
        />
        <BranchPopover v-model:open="showBranchPicker" />
      </div>
    </template>
  </div>
</template>

<style scoped>
.context-bar {
  @apply relative flex min-h-[36px] items-center gap-5 rounded-b-[28px]
          border-t border-codex-border px-6 py-1.5;
  border-top-color: color-mix(in srgb, var(--codex-border) 72%, transparent);
}
.context-bar.has-open-popover {
  @apply z-50;
}
.chip-wrap {
  @apply relative z-30;
}
.chip-wrap.is-open {
  @apply z-[60];
}
.choose-project {
  @apply flex h-8 items-center gap-2 rounded-full px-3 text-[13px] font-medium text-codex-text
         hover:bg-codex-hover transition-colors cursor-pointer;
}
.chip-icon,
.chip-chevron {
  @apply text-codex-muted;
}
</style>
