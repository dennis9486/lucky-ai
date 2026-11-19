<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Bot, Check, Settings } from 'lucide-vue-next'
import { useSettingsStore } from '../../stores/settings.store.js'

const { t } = useI18n()

const open = defineModel<boolean>('open', { default: false })
const settings = useSettingsStore()

const enabledModels = computed(() =>
  settings.providers.flatMap((provider) => {
    if (!provider.enabled) return []
    const models = provider.models?.length
      ? provider.models
      : [{ id: provider.id, name: provider.model, enabled: true }]
    return models
      .filter((model) => model.enabled)
      .map((model) => ({
        provider,
        model,
        id: `${provider.id}:${model.id}`
      }))
  })
)

async function pick(providerId: string, modelId: string): Promise<void> {
  const provider = settings.providers.find((item) => item.id === providerId)
  const model = provider?.models?.find((item) => item.id === modelId)
  if (!provider || !model) return
  provider.activeModelId = model.id
  provider.model = model.name
  settings.activeProviderId = provider.id
  await settings.save()
  open.value = false
}

function isSelected(providerId: string, modelId: string): boolean {
  const provider = settings.providers.find((item) => item.id === providerId)
  return settings.activeProviderId === providerId && provider?.activeModelId === modelId
}

function openSettings(): void {
  settings.showSettings = true
  open.value = false
}
</script>

<template>
  <div v-if="open" class="model-popover" @click.stop>
    <div class="popover-header">{{ t('model.selectModel') }}</div>
    <button
      v-for="item in enabledModels"
      :key="item.id"
      type="button"
      class="model-row"
      :class="{ 'is-selected': isSelected(item.provider.id, item.model.id) }"
      @click="pick(item.provider.id, item.model.id)"
    >
      <Bot :size="15" class="model-icon" />
      <div class="model-copy">
        <div class="model-name">{{ item.model.name }}</div>
        <div class="model-meta">{{ item.provider.name }} · {{ item.provider.type }}</div>
      </div>
      <Check v-if="isSelected(item.provider.id, item.model.id)" :size="15" class="check-icon" />
    </button>
    <button type="button" class="settings-row" @click="openSettings">
      <Settings :size="15" />
      <span>{{ t('model.configureProviders') }}</span>
    </button>
  </div>
</template>

<style scoped>
.model-popover {
  width: min(300px, calc(100vw - 24px));
  max-width: calc(100vw - 24px);
  @apply absolute bottom-full right-0 z-50 mb-2 rounded-[16px] border border-codex-border
         bg-codex-bg p-2 shadow-[0_18px_50px_rgba(0,0,0,0.14)];
}
.popover-header {
  @apply px-2 py-2 text-[11px] font-medium text-codex-muted;
}
.model-row,
.settings-row {
  @apply flex w-full items-center gap-3 rounded-[12px] px-3 py-3 text-left transition-colors hover:bg-codex-hover;
}
.model-row.is-selected {
  @apply bg-codex-hover;
}
.model-icon,
.settings-row {
  @apply text-codex-muted;
}
.model-copy {
  @apply min-w-0 flex-1;
}
.model-name {
  @apply truncate text-[12px] font-semibold text-codex-text;
}
.model-meta {
  @apply mt-0.5 truncate text-[10px] text-codex-muted;
}
.check-icon {
  @apply shrink-0 text-codex-text;
}
.settings-row span {
  @apply text-[12px] font-medium text-codex-text;
}
</style>
