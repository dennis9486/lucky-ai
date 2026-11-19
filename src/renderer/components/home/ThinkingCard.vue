<script setup lang="ts">
import { ref, watch, computed, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Brain, ChevronRight } from 'lucide-vue-next'
import MarkdownContent from '../common/MarkdownContent.vue'

const props = defineProps<{
  text: string
  streaming?: boolean
}>()

const { t } = useI18n()

const expanded = ref(Boolean(props.streaming))
const userToggled = ref(false)
const startedAt = ref<number | null>(null)
let collapseTimer: ReturnType<typeof setTimeout> | null = null

watch(
  () => props.streaming,
  (streaming, wasStreaming) => {
    if (streaming) {
      expanded.value = true
      userToggled.value = false
      startedAt.value = Date.now()
      if (collapseTimer) {
        clearTimeout(collapseTimer)
        collapseTimer = null
      }
      return
    }
    if (wasStreaming && !userToggled.value) {
      collapseTimer = setTimeout(() => {
        expanded.value = false
      }, 1200)
    }
  },
  { immediate: true }
)

const elapsedLabel = computed(() => {
  if (!startedAt.value || props.streaming) return ''
  const sec = Math.max(1, Math.round((Date.now() - startedAt.value) / 1000))
  return t('thinking.elapsed', { n: sec })
})

const preview = computed(() => {
  const line = props.text.split('\n').find((l) => l.trim())?.trim() ?? ''
  if (line.length <= 72) return line
  return `${line.slice(0, 71)}…`
})

function toggle(): void {
  userToggled.value = true
  expanded.value = !expanded.value
  if (collapseTimer) {
    clearTimeout(collapseTimer)
    collapseTimer = null
  }
}

onUnmounted(() => {
  if (collapseTimer) clearTimeout(collapseTimer)
})
</script>

<template>
  <div class="thinking-card" :class="{ 'is-streaming': streaming, 'is-collapsed': !expanded }">
    <button type="button" class="think-head" @click="toggle">
      <ChevronRight :size="12" :stroke-width="2" class="chev" :class="{ open: expanded }" />
      <Brain :size="13" :stroke-width="1.75" class="brain" />
      <span class="label">{{ streaming ? t('thinking.streaming') : t('thinking.done') }}</span>
      <span v-if="!streaming && elapsedLabel" class="meta">{{ elapsedLabel }}</span>
      <span v-if="!expanded && preview" class="preview">{{ preview }}</span>
    </button>
    <Transition name="think-expand">
      <div v-if="expanded" class="think-body">
        <MarkdownContent :source="text" :streaming="streaming" variant="thinking" />
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.thinking-card {
  @apply my-0.5;
}
.thinking-card.is-streaming .think-head {
  background-color: color-mix(in srgb, var(--codex-accent) 12%, var(--codex-hover));
}
.think-head {
  @apply inline-flex items-center gap-1.5 max-w-full px-2 py-1 rounded-lg text-[10px] text-codex-muted
         hover:text-codex-text-secondary hover:bg-codex-hover transition-colors;
}
.thinking-card.is-collapsed .think-head {
  @apply max-w-full;
}
.chev {
  @apply transition-transform duration-150 text-codex-muted shrink-0;
}
.chev.open {
  @apply rotate-90;
}
.brain {
  @apply text-codex-accent shrink-0;
}
.thinking-card.is-streaming .brain {
  animation: pulse-brain 1.6s ease-in-out infinite;
}
.label {
  @apply font-medium shrink-0;
}
.meta {
  @apply text-[9px] text-codex-muted tabular-nums shrink-0;
}
.preview {
  @apply text-[9px] text-codex-muted truncate min-w-0;
}
.think-body {
  @apply mt-2 pl-3 ml-1 border-l border-codex-border;
}
.think-expand-enter-active,
.think-expand-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.think-expand-enter-from,
.think-expand-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
@keyframes pulse-brain {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
</style>
