<script setup lang="ts">
import { computed } from 'vue'
import { Check, Circle, LoaderCircle, ListChecks } from 'lucide-vue-next'
import type { AgentPlan } from '../../../shared/types/ai.js'

const props = defineProps<{
  plan: AgentPlan | null
  collapsed?: boolean
}>()

const emit = defineEmits<{ 'update:collapsed': [value: boolean] }>()

const doneCount = computed(() => props.plan?.steps.filter((s) => s.status === 'done').length ?? 0)
const totalCount = computed(() => props.plan?.steps.length ?? 0)
const progress = computed(() => (totalCount.value ? (doneCount.value / totalCount.value) * 100 : 0))

function stepIcon(status: string) {
  if (status === 'done') return Check
  if (status === 'running') return LoaderCircle
  return Circle
}
</script>

<template>
  <div v-if="plan" class="plan-tracker">
    <button
      type="button"
      class="plan-head"
      @click="emit('update:collapsed', !collapsed)"
    >
      <ListChecks :size="14" class="plan-icon" />
      <span class="plan-title">{{ plan.title }}</span>
      <span class="plan-progress">{{ doneCount }}/{{ totalCount }}</span>
    </button>

    <div v-if="!collapsed" class="plan-body">
      <div class="plan-bar">
        <div class="plan-bar-fill" :style="{ width: `${progress}%` }" />
      </div>
      <ol class="plan-steps">
        <li
          v-for="step in plan.steps"
          :key="step.id"
          class="plan-step"
          :class="`is-${step.status}`"
        >
          <component
            :is="stepIcon(step.status)"
            :size="14"
            :stroke-width="step.status === 'running' ? 2 : 1.75"
            class="step-icon"
            :class="{ spinning: step.status === 'running' }"
          />
          <span class="step-text">{{ step.text }}</span>
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
.plan-tracker {
  @apply rounded-xl border border-codex-border bg-codex-hover overflow-hidden;
}
.plan-head {
  @apply flex w-full items-center gap-2 px-4 py-2.5 text-left hover:bg-codex-bg transition-colors;
}
.plan-icon {
  @apply text-codex-accent shrink-0;
}
.plan-title {
  @apply flex-1 text-[11px] font-semibold text-codex-text truncate;
}
.plan-progress {
  @apply text-[10px] font-medium text-codex-muted tabular-nums;
}
.plan-body {
  @apply px-4 pb-3 border-t border-codex-border;
}
.plan-bar {
  @apply h-1 rounded-full bg-codex-border mt-3 mb-2 overflow-hidden;
}
.plan-bar-fill {
  @apply h-full rounded-full transition-all duration-300;
  background-color: color-mix(in srgb, var(--codex-accent) 80%, var(--codex-text));
}
.plan-steps {
  @apply flex flex-col gap-1.5 list-none m-0 p-0;
}
.plan-step {
  @apply flex items-start gap-2 text-[11px] leading-snug;
}
.step-icon {
  @apply shrink-0 mt-0.5;
}
.plan-step.is-pending .step-icon {
  @apply text-codex-muted;
}
.plan-step.is-running .step-icon {
  @apply text-codex-accent;
}
.plan-step.is-done .step-icon {
  @apply text-emerald-600;
}
:global([data-theme='dark']) .plan-step.is-done .step-icon {
  @apply text-emerald-400;
}
.plan-step.is-done .step-text {
  @apply text-codex-muted line-through decoration-codex-border;
}
.plan-step.is-running .step-text {
  @apply text-codex-text font-medium;
}
.step-text {
  @apply text-codex-text-secondary;
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
