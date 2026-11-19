<script setup lang="ts">
import { computed, type Component } from 'vue'
import { useI18n } from 'vue-i18n'
import { Laptop, GitBranchPlus, Check, CloudOff, Gauge, ChevronRight } from 'lucide-vue-next'
import type { StartupMode } from '../../../shared/types/project.js'

const { t } = useI18n()

type StartupModeOption = {
  id: StartupMode | 'cloud'
  icon: Component
  title: string
  disabled: boolean
  trailingIcon?: Component
}

const modes = computed<StartupModeOption[]>(() => [
  {
    id: 'local' as const,
    icon: Laptop,
    title: t('startup.local'),
    disabled: false
  },
  {
    id: 'worktree' as const,
    icon: GitBranchPlus,
    title: t('startup.worktree'),
    disabled: false
  },
  {
    id: 'cloud' as const,
    icon: CloudOff,
    title: t('startup.sendToCloud'),
    disabled: true
  }
])

const selected = defineModel<StartupMode>({ default: 'local' })
const open = defineModel<boolean>('open', { default: false })

const emit = defineEmits<{
  select: [mode: StartupMode]
}>()

function pick(mode: StartupMode): void {
  selected.value = mode
  emit('select', mode)
  open.value = false
}

function onOptionClick(mode: StartupModeOption): void {
  if (mode.disabled || mode.id === 'cloud') return
  pick(mode.id)
}
</script>

<template>
  <div v-if="open" class="startup-popover" @click.stop @pointerdown.stop>
    <div class="popover-header">{{ t('startup.title') }}</div>
    <button
      v-for="mode in modes"
      :key="mode.id"
      type="button"
      class="option-row"
      :class="{ 'is-disabled': mode.disabled }"
      :disabled="mode.disabled"
      @click="onOptionClick(mode)"
    >
      <component :is="mode.icon" :size="15" class="option-icon shrink-0" />
      <span class="option-title">{{ mode.title }}</span>
      <component
        :is="mode.trailingIcon"
        v-if="mode.trailingIcon"
        :size="13"
        class="trailing-icon shrink-0"
      />
      <Check v-else-if="selected === mode.id" :size="15" class="check-icon shrink-0" />
    </button>

    <div class="popover-divider" />

    <button type="button" class="option-row usage-row" disabled>
      <Gauge :size="15" class="option-icon shrink-0" />
      <span class="option-title">{{ t('startup.remainingUsage') }}</span>
      <ChevronRight :size="14" class="trailing-icon shrink-0" />
    </button>
  </div>
</template>

<style scoped>
.startup-popover {
  @apply absolute bottom-full left-0 z-[70] mb-2 w-[min(248px,calc(100vw-2rem))] rounded-[14px] border border-codex-border
         p-1.5 shadow-[0_12px_36px_rgba(0,0,0,0.12)];
  background-color: var(--codex-bg);
  isolation: isolate;
}
.popover-header {
  @apply px-2 py-1 text-[10px] font-medium text-codex-muted;
}
.option-row {
  @apply flex w-full items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors hover:bg-codex-hover;
}
.option-row.is-disabled,
.usage-row:disabled {
  @apply cursor-not-allowed opacity-45 hover:bg-transparent;
}
.option-icon {
  @apply text-codex-text-secondary shrink-0;
}
.option-title {
  @apply flex-1 text-[12px] font-medium text-codex-text;
}
.check-icon,
.trailing-icon {
  @apply text-codex-muted shrink-0;
}
.popover-divider {
  @apply my-1 border-t border-codex-border;
}
</style>
