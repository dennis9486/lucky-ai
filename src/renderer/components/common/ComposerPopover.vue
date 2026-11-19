<script setup lang="ts">
withDefaults(
  defineProps<{
    open?: boolean
    title?: string
    /** mention: 50, confirm: 60 */
    layer?: 'mention' | 'confirm'
    maxHeight?: number
    role?: string
  }>(),
  {
    open: true,
    layer: 'mention',
    maxHeight: 220,
    role: 'dialog'
  }
)
</script>

<template>
  <div
    v-if="open"
    class="composer-popover"
    :class="layer === 'confirm' ? 'layer-confirm' : 'layer-mention'"
    :style="{ maxHeight: `${maxHeight}px` }"
    :role="role"
    aria-modal="true"
  >
    <div v-if="title || $slots.header" class="composer-popover-header">
      <slot name="header">{{ title }}</slot>
    </div>

    <div class="composer-popover-body">
      <slot />
    </div>

    <div v-if="$slots.footer" class="composer-popover-footer">
      <slot name="footer" />
    </div>
  </div>
</template>

<style scoped>
.composer-popover {
  @apply absolute left-3 right-3 flex flex-col overflow-hidden rounded-xl border border-codex-border
         bg-codex-bg;
  bottom: calc(100% + 6px);
  box-shadow: 0 8px 28px rgba(0, 0, 0, 0.1), 0 2px 8px rgba(0, 0, 0, 0.04);
}

.layer-mention {
  @apply z-50;
}

.layer-confirm {
  @apply z-[60];
}

.composer-popover-header {
  @apply shrink-0 px-3 pb-1 pt-1.5 text-[11px] text-codex-muted;
}

.composer-popover-body {
  @apply min-h-0 flex-1 overflow-y-auto px-1 py-0.5;
  scrollbar-width: thin;
}

.composer-popover-footer {
  @apply shrink-0 flex items-center justify-end gap-2 border-t border-codex-border px-3 py-2;
}
</style>
