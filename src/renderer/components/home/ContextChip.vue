<script setup lang="ts">
import { computed, type Component } from 'vue'
import { ChevronDown, File, Folder, GitBranch, Globe2, Link2, MessageSquare, SquareTerminal, X } from 'lucide-vue-next'
import { getFileIcon } from '../../utils/file-icons.js'

export type ContextChipKind = 'generic' | 'file' | 'folder' | 'link' | 'terminal' | 'browser' | 'branch' | 'chat'

const props = withDefaults(defineProps<{
  icon?: Component
  iconUrl?: string
  kind?: ContextChipKind
  label: string
  detail?: string
  path?: string
  href?: string
  hasDropdown?: boolean
  active?: boolean
  removable?: boolean
  removeLabel?: string
  variant?: 'toolbar' | 'reference' | 'inline'
}>(), {
  kind: 'generic',
  variant: 'toolbar',
  detail: '',
  path: '',
  href: '',
  removeLabel: ''
})

defineEmits<{
  click: []
  remove: []
}>()

const resolvedTitle = computed(() => props.path || props.href || props.detail || props.label)
const resolvedIconUrl = computed(() => {
  if (props.iconUrl) return props.iconUrl
  if (props.kind === 'file') return getFileIcon(props.label || props.path)
  return ''
})
const resolvedIcon = computed(() => {
  if (props.icon) return props.icon
  switch (props.kind) {
    case 'file': return File
    case 'folder': return Folder
    case 'link': return Link2
    case 'terminal': return SquareTerminal
    case 'browser': return Globe2
    case 'branch': return GitBranch
    case 'chat': return MessageSquare
    default: return null
  }
})
</script>

<template>
  <div
    role="button"
    tabindex="0"
    class="context-chip"
    :class="[`is-${variant}`, `kind-${kind}`, { 'is-active': active, 'is-removable': removable }]"
    :title="resolvedTitle"
    :aria-label="resolvedTitle"
    @click.stop="$emit('click')"
    @keydown.enter.prevent="$emit('click')"
    @keydown.space.prevent="$emit('click')"
  >
    <img
      v-if="resolvedIconUrl"
      :src="resolvedIconUrl"
      alt=""
      class="chip-file-icon"
      draggable="false"
    />
    <component :is="resolvedIcon" v-else-if="resolvedIcon" :size="14" class="chip-icon" />
    <span class="chip-text">
      <span class="chip-label">{{ label }}</span>
      <span v-if="detail" class="chip-detail">{{ detail }}</span>
    </span>
    <ChevronDown v-if="hasDropdown" :size="13" class="chip-chevron" />
    <button
      v-if="removable"
      type="button"
      class="chip-remove"
      :aria-label="removeLabel || label"
      @click.stop="$emit('remove')"
    >
      <X :size="12" />
    </button>
  </div>
</template>

<style scoped>
.context-chip {
  @apply inline-flex max-w-[260px] items-center gap-2 border border-transparent
         text-codex-text-secondary transition-colors hover:bg-codex-hover;
}
.context-chip.is-toolbar {
  @apply rounded-full px-3 py-1.5 text-[12px];
}
.context-chip.is-reference {
  @apply max-w-[260px] rounded-lg px-2 py-1 text-[12px] font-medium;
  background: color-mix(in srgb, var(--codex-accent) 13%, var(--codex-hover));
  color: color-mix(in srgb, var(--codex-accent) 58%, var(--codex-text));
}
.context-chip.is-inline {
  @apply max-w-[180px] rounded-md px-2 py-[3px] text-[12px] font-medium;
  background: color-mix(in srgb, var(--codex-accent) 14%, var(--codex-hover));
  color: color-mix(in srgb, var(--codex-accent) 62%, var(--codex-text));
}
.context-chip.is-active {
  @apply bg-codex-hover text-codex-text;
}
.context-chip.is-reference:hover,
.context-chip.is-inline:hover {
  background: color-mix(in srgb, var(--codex-accent) 18%, var(--codex-hover));
}
.chip-icon,
.chip-chevron {
  @apply shrink-0 text-codex-muted;
}
.chip-file-icon {
  @apply h-[15px] w-[15px] shrink-0;
}
.chip-text {
  @apply flex min-w-0 items-baseline gap-1.5;
}
.chip-label,
.chip-detail {
  @apply truncate;
}
.chip-detail {
  @apply text-[11px] font-normal text-codex-muted;
}
.chip-remove {
  @apply -mr-0.5 ml-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full
         text-codex-muted transition-colors hover:bg-codex-bg hover:text-codex-text;
}
</style>
