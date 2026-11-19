<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ChatComposer from './ChatComposer.vue'
import ConfirmPopover from './ConfirmPopover.vue'
import ContextBar from './ContextBar.vue'
import { useChatStore } from '../../stores/chat.store.js'

const props = withDefaults(
  defineProps<{
    placeholder?: string
    context?: 'home' | 'chat'
    showContextBar?: boolean
    popoverPlacement?: 'above' | 'below'
  }>(),
  {
    context: 'home',
    showContextBar: true,
    popoverPlacement: 'below'
  }
)

defineEmits<{ send: [] }>()

const { t } = useI18n()
const chat = useChatStore()

const effectivePlaceholder = computed(() =>
  props.placeholder ?? t(props.context === 'chat' ? 'composer.placeholderChat' : 'composer.placeholderHome')
)
</script>

<template>
  <div class="composer-section">
    <ConfirmPopover />
    <div
      class="composer-card composer-surface"
      :class="{ 'is-confirm-pending': chat.showPendingConfirm }"
    >
      <ChatComposer
        :placeholder="effectivePlaceholder"
        :popover-placement="popoverPlacement"
        @send="$emit('send')"
      />
      <ContextBar v-if="showContextBar" />
    </div>
  </div>
</template>

<style scoped>
.composer-section {
  @apply w-full flex flex-col;
}
.composer-card {
  @apply relative overflow-visible rounded-[28px];
  transition:
    border-color 0.16s ease,
    box-shadow 0.16s ease,
    background-color 0.16s ease;
}
.composer-card.is-confirm-pending {
  @apply opacity-95;
}
.composer-card:focus-within {
  border-color: color-mix(in srgb, var(--codex-text) 20%, var(--codex-border));
  box-shadow:
    0 18px 54px rgba(0, 0, 0, 0.1),
    0 0 0 3px color-mix(in srgb, var(--codex-accent) 10%, transparent);
}
</style>
