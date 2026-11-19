<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Folder, Undo2 } from 'lucide-vue-next'
import { parseMentionSegments } from '../../utils/mention.js'
import { getFileIcon } from '../../utils/file-icons.js'

const props = defineProps<{
  text: string
  isEditing?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{ edit: []; rollback: [] }>()

const { t } = useI18n()

const segments = computed(() => parseMentionSegments(props.text))
</script>

<template>
  <div
    class="user-turn-card"
    :class="{ 'is-editing': isEditing, 'is-disabled': disabled }"
    role="button"
    tabindex="0"
    @click="!disabled && emit('edit')"
    @keydown.enter.prevent="!disabled && emit('edit')"
  >
    <div class="user-turn-text">
      <template v-for="(seg, index) in segments" :key="index">
        <span v-if="seg.type === 'text'" class="ut-text">{{ seg.value }}</span>
        <span v-else class="ut-chip" :title="seg.path">
          <img
            v-if="seg.kind === 'file'"
            :src="getFileIcon(seg.name)"
            alt=""
            class="ut-chip-icon"
            draggable="false"
          />
          <Folder v-else :size="13" :stroke-width="1.75" class="ut-chip-folder" />
          <span class="ut-chip-label">{{ seg.name }}</span>
        </span>
      </template>
    </div>
    <button
      type="button"
      class="user-turn-rollback"
      :title="t('codeAgent.rollbackMessage')"
      :disabled="disabled"
      @click.stop="emit('rollback')"
    >
      <Undo2 :size="14" :stroke-width="1.75" />
    </button>
  </div>
</template>

<style scoped>
.user-turn-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  max-width: 100%;
  margin: 0 0 18px 0;
  border: 1px solid transparent;
  border-radius: 16px;
  background: var(--codex-hover, #f0f0f0);
  padding: 9px 11px 9px 14px;
  box-shadow: none;
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    box-shadow 0.15s ease,
    background 0.15s ease;
}
.user-turn-card:hover:not(.is-disabled) {
  border-color: color-mix(in srgb, var(--codex-text) 10%, transparent);
  background: color-mix(in srgb, var(--codex-hover, #f0f0f0) 78%, var(--codex-bg, #fff));
}
.user-turn-card.is-editing {
  border-color: color-mix(in srgb, var(--codex-accent) 45%, var(--codex-border));
  background: color-mix(in srgb, var(--codex-accent) 4%, var(--codex-bg));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--codex-accent) 12%, transparent);
}
.user-turn-card.is-disabled {
  cursor: default;
  opacity: 0.72;
}
.user-turn-text {
  min-width: 0;
  flex: 1;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--codex-text, #1a1a1a);
  font-size: var(--code-agent-content-size, 12.5px);
  font-weight: 400;
  line-height: var(--code-agent-content-line, 1.62);
}
.ut-text {
  font-weight: inherit;
}
.ut-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 240px;
  margin: 0 1px;
  padding: 1px 6px 1px 5px;
  border-radius: 6px;
  vertical-align: baseline;
  font-size: 0.92em;
  font-weight: 500;
  line-height: 1.5;
  white-space: nowrap;
  background: color-mix(in srgb, var(--codex-accent, #2563eb) 14%, var(--codex-hover, #f0f0f0));
  color: color-mix(in srgb, var(--codex-accent, #2563eb) 62%, var(--codex-text, #1a1a1a));
}
.ut-chip-icon {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}
.ut-chip-folder {
  flex-shrink: 0;
  color: color-mix(in srgb, var(--codex-accent, #2563eb) 60%, var(--codex-muted, #8a8a8a));
}
.ut-chip-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-turn-rollback {
  display: flex;
  height: 24px;
  width: 24px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--codex-muted, #8a8a8a);
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.12s ease,
    background 0.12s ease,
    color 0.12s ease;
}
.user-turn-card:hover:not(.is-disabled) .user-turn-rollback,
.user-turn-card.is-editing .user-turn-rollback {
  opacity: 1;
  pointer-events: auto;
}
.user-turn-rollback:hover:not(:disabled) {
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-text, #1a1a1a);
}
.user-turn-rollback:disabled {
  cursor: default;
}
</style>
