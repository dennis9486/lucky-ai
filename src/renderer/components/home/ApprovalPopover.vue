<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Hand, ShieldCheck, AlertTriangle, Check } from 'lucide-vue-next'
import type { ApprovalMode } from '../../../shared/types/conversation.js'

const { t } = useI18n()

const modes = computed(() => [
  {
    id: 'ask' as const,
    icon: Hand,
    title: t('approval.ask'),
    description: t('approval.askDesc')
  },
  {
    id: 'auto' as const,
    icon: ShieldCheck,
    title: t('approval.auto'),
    description: t('approval.autoDesc')
  },
  {
    id: 'full' as const,
    icon: AlertTriangle,
    title: t('approval.full'),
    description: t('approval.fullDesc')
  }
])

const selected = defineModel<ApprovalMode>({ default: 'ask' })
const open = defineModel<boolean>('open', { default: false })

withDefaults(
  defineProps<{
    placement?: 'above' | 'below'
  }>(),
  { placement: 'below' }
)

const emit = defineEmits<{ select: [mode: ApprovalMode] }>()

function pick(mode: ApprovalMode): void {
  selected.value = mode
  emit('select', mode)
  open.value = false
}
</script>

<template>
  <div v-if="open" class="approval-popover" :class="placement === 'above' ? 'is-above' : 'is-below'">
    <div class="popover-header">
      <span>{{ t('approval.header') }}</span>
      <a href="#" class="learn-more" @click.prevent>{{ t('approval.learnMore') }}</a>
    </div>
    <button
      v-for="mode in modes"
      :key="mode.id"
      type="button"
      class="option-row"
      :class="{ 'is-selected': selected === mode.id }"
      @click="pick(mode.id)"
    >
      <component :is="mode.icon" :size="15" class="option-icon shrink-0" />
      <div class="option-text">
        <div class="option-title">{{ mode.title }}</div>
        <div class="option-desc">{{ mode.description }}</div>
      </div>
      <Check v-if="selected === mode.id" :size="15" class="check-icon shrink-0" />
    </button>
  </div>
</template>

<style scoped>
.approval-popover {
  @apply absolute left-0 z-50 w-[330px] rounded-[18px] border border-codex-border
         bg-codex-bg p-2 shadow-[0_18px_50px_rgba(0,0,0,0.14)];
}
.approval-popover.is-below {
  @apply top-full mt-2;
}
.approval-popover.is-above {
  @apply bottom-full mb-2;
}
.popover-header {
  @apply flex items-center justify-between px-2 py-2 text-[11px] font-medium text-codex-muted;
}
.learn-more {
  @apply text-codex-muted hover:text-codex-text hover:underline shrink-0 ml-2;
}
.option-row {
  @apply w-full flex items-start gap-3 rounded-[12px] px-3 py-3 text-left
         transition-colors hover:bg-codex-hover;
}
.option-row.is-selected {
  @apply bg-codex-hover;
}
.option-icon {
  @apply mt-0.5 text-codex-muted;
}
.option-title {
  @apply text-[13px] font-semibold text-codex-text;
}
.option-desc {
  @apply mt-1 text-[11px] leading-snug text-codex-muted;
}
.check-icon {
  @apply ml-auto mt-0.5 text-codex-text;
}
</style>
