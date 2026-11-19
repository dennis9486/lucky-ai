<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Atom, Paperclip, Crosshair, ListChecks } from 'lucide-vue-next'

export type AddMenuAction = 'files' | 'electron' | 'goal' | 'plan'

const { t } = useI18n()

const items = computed(() => [
  {
    id: 'files' as const,
    icon: Paperclip,
    title: t('addMenu.files')
  },
  {
    id: 'electron' as const,
    icon: Atom,
    title: t('addMenu.electron')
  },
  {
    id: 'goal' as const,
    icon: Crosshair,
    title: t('addMenu.goal'),
    description: t('addMenu.goalDesc')
  },
  {
    id: 'plan' as const,
    icon: ListChecks,
    title: t('addMenu.plan'),
    description: t('addMenu.planDesc')
  }
])

const open = defineModel<boolean>('open', { default: false })

withDefaults(
  defineProps<{
    placement?: 'above' | 'below'
  }>(),
  { placement: 'below' }
)

const emit = defineEmits<{ select: [action: AddMenuAction] }>()

function pick(action: AddMenuAction): void {
  emit('select', action)
  open.value = false
}
</script>

<template>
  <div v-if="open" class="add-menu pretty-scrollbar" :class="placement === 'above' ? 'is-above' : 'is-below'">
    <div class="section-label">{{ t('composer.add') }}</div>
    <button
      v-for="item in items"
      :key="item.id"
      type="button"
      class="menu-item"
      @click="pick(item.id)"
    >
      <component :is="item.icon" :size="15" class="item-icon shrink-0" />
      <div class="item-text min-w-0">
        <span class="item-title">{{ item.title }}</span>
        <span v-if="item.description" class="item-desc">{{ item.description }}</span>
      </div>
    </button>
    <!-- 「插件」区暂时禁用：将来接入独立的插件系统（非 VS Code 扩展） -->
  </div>
</template>

<style scoped>
.add-menu {
  @apply absolute left-0 z-50 w-[400px] max-h-[min(340px,50vh)] overflow-y-auto
         rounded-[16px] border border-codex-border bg-codex-bg p-2
         shadow-[0_12px_36px_rgba(0,0,0,0.12)];
}
.add-menu.is-below {
  @apply top-full mt-2;
}
.add-menu.is-above {
  @apply bottom-full mb-2;
}
.section-label {
  @apply px-2 py-1.5 text-[10px] font-medium text-codex-muted;
}
.menu-item {
  @apply flex w-full items-center gap-3 rounded-[10px] px-2.5 py-2 text-left
         transition-colors hover:bg-codex-hover;
}
.item-icon {
  @apply text-codex-muted;
}
.item-text {
  @apply flex min-w-0 flex-wrap items-baseline gap-x-2;
}
.item-title {
  @apply shrink-0 text-[12px] font-medium text-codex-text;
}
.item-desc {
  @apply text-[10px] leading-snug text-codex-muted;
}
</style>
