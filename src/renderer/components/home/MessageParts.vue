<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronRight } from 'lucide-vue-next'
import type { MessagePart, ToolCallPart } from '../../../shared/types/ai.js'
import MarkdownContent from '../common/MarkdownContent.vue'
import ToolProcessCard from './ToolProcessCard.vue'

const props = defineProps<{
  parts: MessagePart[]
  live?: boolean
}>()

const { t } = useI18n()
const processExpanded = ref(false)
const processStartedAt = ref<number | null>(null)
const now = ref(Date.now())
let timer: ReturnType<typeof setInterval> | null = null

type Segment =
  | { kind: 'text' | 'thinking'; part: MessagePart; index: number }
  | { kind: 'tools'; parts: ToolCallPart[]; index: number }

function buildSegments(parts: MessagePart[]): Segment[] {
  const result: Segment[] = []
  let i = 0
  while (i < parts.length) {
    const part = parts[i]!
    if (part.type === 'tool') {
      const tools: ToolCallPart[] = []
      const start = i
      while (i < parts.length && parts[i]!.type === 'tool') {
        tools.push(parts[i] as ToolCallPart)
        i++
      }
      result.push({ kind: 'tools', parts: tools, index: start })
    } else {
      result.push({ kind: part.type, part, index: i })
      i++
    }
  }
  return result
}

const segments = computed(() => buildSegments(props.parts))
const answerSegments = computed(() => segments.value.filter((segment) => segment.kind === 'text'))
const processSegments = computed(() => segments.value.filter((segment) => segment.kind !== 'text'))
const showProcess = computed(() => processSegments.value.length > 0)
const processState = computed<'thinking' | 'tools' | 'done'>(() => {
  const hasActiveTool = processSegments.value.some((segment) =>
    segment.kind === 'tools'
    && segment.parts.some((tool) => tool.status === 'pending' || tool.status === 'running')
  )
  if (hasActiveTool) return 'tools'

  const lastPart = props.parts[props.parts.length - 1]
  if (props.live && lastPart?.type === 'thinking') return 'thinking'

  return 'done'
})
const processLabel = computed(() => {
  switch (processState.value) {
    case 'tools': return t('thinking.processTools')
    case 'thinking': return t('thinking.processThinking')
    default: return t('thinking.processDone')
  }
})
const elapsedLabel = computed(() => {
  if (!processStartedAt.value) return ''
  const sec = Math.max(1, Math.round((now.value - processStartedAt.value) / 1000))
  if (sec < 60) return `${sec}s`
  const min = Math.floor(sec / 60)
  return `${min}m ${sec % 60}s`
})

watch(
  showProcess,
  (visible) => {
    if (!visible) {
      processExpanded.value = false
      processStartedAt.value = null
      if (timer) {
        clearInterval(timer)
        timer = null
      }
      return
    }
    processExpanded.value = false
    if (!props.live) {
      processStartedAt.value = null
      return
    }
    const started = processStartedAt.value ?? Date.now()
    processStartedAt.value = started
    now.value = started
    if (!timer) {
      timer = setInterval(() => {
        now.value = Date.now()
      }, 1000)
    }
  },
  { immediate: true }
)

onUnmounted(() => {
  if (timer) clearInterval(timer)
})

function isStreamingPart(index: number, part: MessagePart): boolean {
  if (!props.live) return false
  if (index !== props.parts.length - 1) return false
  return part.type === 'text' || part.type === 'thinking'
}

function segmentKey(segment: Segment): string {
  if (segment.kind === 'tools') {
    return `tools-${segment.parts.map((p) => p.id).join('-')}`
  }
  return `${segment.kind}-${segment.index}`
}

function toggleProcess(): void {
  processExpanded.value = !processExpanded.value
}
</script>

<template>
  <div class="message-parts">
    <div
      v-if="showProcess"
      class="process-panel"
      :class="[`is-${processState}`, { open: processExpanded }]"
    >
      <button type="button" class="process-toggle" @click="toggleProcess">
        <span class="process-label">{{ processLabel }}</span>
        <span v-if="elapsedLabel" class="process-time">{{ elapsedLabel }}</span>
        <ChevronRight :size="14" :stroke-width="2" class="process-chev" :class="{ open: processExpanded }" />
      </button>

      <Transition name="process-expand">
        <div v-if="processExpanded" class="process-body">
          <template v-for="segment in processSegments" :key="segmentKey(segment)">
            <div
              v-if="segment.kind === 'thinking' && segment.part.type === 'thinking' && segment.part.text.trim()"
              class="process-thinking"
            >
              <MarkdownContent
                :source="segment.part.text"
                :streaming="isStreamingPart(segment.index, segment.part)"
                variant="thinking"
              />
            </div>
            <div v-else-if="segment.kind === 'tools'" class="tool-group">
              <ToolProcessCard :parts="segment.parts" />
            </div>
          </template>
        </div>
      </Transition>
    </div>

    <template v-for="segment in answerSegments" :key="segmentKey(segment)">
      <MarkdownContent
        v-if="segment.kind === 'text' && segment.part.type === 'text' && segment.part.text.trim()"
        :source="segment.part.text"
        :streaming="isStreamingPart(segment.index, segment.part)"
      />
    </template>
  </div>
</template>

<style scoped>
.message-parts {
  @apply flex flex-col w-full gap-3;
}
.tool-group {
  @apply flex flex-col gap-1.5 w-full;
}
.process-panel {
  @apply mt-1 w-full;
}
.process-toggle {
  @apply flex w-full items-center gap-1.5 border-b border-codex-border pb-2.5 pt-0.5 text-left
         text-[14px] font-medium text-codex-muted transition-colors hover:text-codex-text-secondary;
}
.process-label {
  @apply shrink-0;
}
.process-time {
  @apply shrink-0 text-codex-muted tabular-nums font-medium;
}
.process-chev {
  @apply shrink-0 text-codex-muted opacity-0 transition-all duration-150;
}
.process-chev.open {
  @apply rotate-90 opacity-100;
}
.process-toggle:hover .process-chev {
  @apply opacity-100;
}
.process-body {
  @apply mt-3 flex flex-col gap-3;
}
.process-thinking {
  @apply ml-1 border-l border-codex-border pl-3;
}
.process-expand-enter-active,
.process-expand-leave-active {
  transition: opacity 0.16s ease, transform 0.16s ease;
}
.process-expand-enter-from,
.process-expand-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
