<script setup lang="ts">
import { computed } from 'vue'
import { History, Undo2 } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  text?: string
  thumbnail?: string
  isEditing?: boolean
  disabled?: boolean
  /** 是否展示「撤销本轮文件修改」按钮（该轮有可回滚的文件前像） */
  canRevertFiles?: boolean
}>()

const emit = defineEmits<{ edit: []; rollback: []; revertFiles: [] }>()
const { t } = useI18n()
const normalizedText = computed(() => props.text?.trim() ?? '')
</script>

<template>
  <section
    v-if="normalizedText"
    class="task-summary"
    :class="{ 'is-editing': isEditing, 'is-disabled': disabled }"
    role="button"
    tabindex="0"
    @click="!disabled && emit('edit')"
    @keydown.enter.prevent="!disabled && emit('edit')"
  >
    <img v-if="thumbnail" :src="thumbnail" alt="" class="task-thumb" draggable="false" />
    <div class="task-text">{{ normalizedText }}</div>
    <button
      v-if="canRevertFiles"
      type="button"
      class="task-action"
      :disabled="disabled"
      :title="t('codeAgent.revertTurnFiles')"
      @click.stop="emit('revertFiles')"
    >
      <History :size="15" />
    </button>
    <button
      type="button"
      class="task-action"
      :disabled="disabled"
      :title="t('codeAgent.rollbackTurn')"
      @click.stop="emit('rollback')"
    >
      <Undo2 :size="15" />
    </button>
  </section>
</template>

<style scoped>
.task-summary {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  border: 1px solid var(--codex-border, #d8d8d8);
  border-radius: 8px;
  background: var(--codex-bg, #fff);
  padding: 10px 12px;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    background 0.15s ease,
    box-shadow 0.15s ease;
}
.task-summary:hover:not(.is-disabled) {
  border-color: color-mix(in srgb, var(--codex-text, #222) 10%, var(--codex-border, #d8d8d8));
  background: color-mix(in srgb, var(--codex-bg, #fff) 88%, var(--codex-hover, #f1f1f1));
}
.task-summary.is-editing {
  border-color: color-mix(in srgb, var(--codex-accent, #2563eb) 42%, var(--codex-border, #d8d8d8));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--codex-accent, #2563eb) 12%, transparent);
}
.task-summary.is-disabled {
  cursor: default;
  opacity: 0.72;
}
.task-thumb {
  width: 42px;
  height: 42px;
  flex-shrink: 0;
  border-radius: 4px;
  border: 1px solid var(--codex-border, #d8d8d8);
  object-fit: cover;
}
.task-text {
  min-width: 0;
  flex: 1;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--codex-text, #1a1a1a);
  font-size: var(--code-agent-content-size, 12.5px);
  font-weight: 400;
  line-height: var(--code-agent-content-line, 1.62);
}
.task-action {
  display: flex;
  height: 26px;
  width: 26px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  border: 0;
  background: transparent;
  color: var(--codex-muted, #8a8a8a);
  opacity: 0;
  pointer-events: none;
  transition:
    background 0.12s ease,
    color 0.12s ease,
    opacity 0.12s ease;
}
.task-summary:hover:not(.is-disabled) .task-action,
.task-summary.is-editing .task-action {
  opacity: 1;
  pointer-events: auto;
}
.task-action:hover:not(:disabled) {
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-text, #1f1f1f);
}
.task-action:disabled {
  cursor: default;
}
</style>
