<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Settings } from 'lucide-vue-next'
import { useCodeAgentStore, type CodeAgentEffort } from '../../stores/code-agent.store.js'
import { useSettingsStore } from '../../stores/settings.store.js'

/**
 * 模型选择菜单（fixed 定位弹层）：搜索 + 努力档位 + 启用模型列表 + 设置入口。
 * 位置根据宿主传入的锚点元素计算，窗口缩放/滚动时跟随。
 */
const props = defineProps<{
  /** 触发按钮所在的锚点元素，用于计算弹层位置 */
  anchorEl: HTMLElement | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()

const { t } = useI18n()
const agent = useCodeAgentStore()
const settings = useSettingsStore()

const modelQuery = ref('')
const menuStyle = ref<Record<string, string>>({})

const effortItems: Array<{ value: CodeAgentEffort; labelKey: string }> = [
  { value: 'auto', labelKey: 'codeAgent.effortAuto' },
  { value: 'fast', labelKey: 'codeAgent.effortFast' },
  { value: 'high', labelKey: 'codeAgent.effortHigh' }
]

const enabledModels = computed(() => {
  const q = modelQuery.value.trim().toLowerCase()
  return settings.providers.flatMap((provider) => {
    if (!provider.enabled) return []
    const models = provider.models?.length
      ? provider.models
      : [{ id: provider.id, name: provider.model, enabled: true }]
    return models
      .filter((model) => model.enabled)
      .map((model) => ({ provider, model, id: `${provider.id}:${model.id}` }))
      .filter((item) => {
        if (!q) return true
        return `${item.model.name} ${item.provider.name} ${item.provider.type}`.toLowerCase().includes(q)
      })
  })
})

function updatePosition(): void {
  const anchor = props.anchorEl
  if (!anchor) return
  const rect = anchor.getBoundingClientRect()
  const margin = 12
  const width = Math.min(340, Math.max(286, window.innerWidth - margin * 2))
  const left = Math.max(margin, Math.min(rect.right - width, window.innerWidth - width - margin))
  const bottom = Math.max(margin, window.innerHeight - rect.top + 8)
  const maxHeight = Math.max(220, rect.top - margin * 2)

  menuStyle.value = {
    left: `${left}px`,
    bottom: `${bottom}px`,
    width: `${width}px`,
    maxHeight: `${maxHeight}px`
  }
}

onMounted(() => {
  updatePosition()
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
})

onUnmounted(() => {
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
})

function selectEffort(effort: CodeAgentEffort): void {
  agent.effort = effort
}

async function selectModel(providerId: string, modelId: string): Promise<void> {
  const provider = settings.providers.find((item) => item.id === providerId)
  const model = provider?.models?.find((item) => item.id === modelId)
  if (!provider || !model) return
  provider.activeModelId = model.id
  provider.model = model.name
  settings.activeProviderId = provider.id
  await settings.save()
  emit('close')
}

function isSelectedModel(providerId: string, modelId: string): boolean {
  const provider = settings.providers.find((item) => item.id === providerId)
  return settings.activeProviderId === providerId && provider?.activeModelId === modelId
}

function openSettings(): void {
  settings.showSettings = true
  emit('close')
}
</script>

<template>
  <div class="model-menu" :style="menuStyle" @click.stop>
    <input v-model="modelQuery" class="model-search" :placeholder="t('codeAgent.searchModels')" />
    <div class="effort-row">
      <span>{{ t('codeAgent.effort') }}</span>
      <div class="effort-options">
        <button
          v-for="item in effortItems"
          :key="item.value"
          type="button"
          :class="{ active: item.value === agent.effort }"
          @click="selectEffort(item.value)"
        >
          {{ t(item.labelKey) }}
        </button>
      </div>
    </div>
    <div class="model-list-wrap">
      <div class="model-list pretty-scrollbar">
        <button
          v-for="item in enabledModels"
          :key="item.id"
          type="button"
          class="model-row"
          :class="{ selected: isSelectedModel(item.provider.id, item.model.id) }"
          @click="selectModel(item.provider.id, item.model.id)"
        >
          <div>
            <div class="model-name">{{ item.model.name }}</div>
            <div class="model-meta">{{ item.provider.name }} · {{ item.provider.type }}</div>
          </div>
          <Check v-if="isSelectedModel(item.provider.id, item.model.id)" :size="14" />
        </button>
      </div>
    </div>
    <button type="button" class="settings-row" @click="openSettings">
      <Settings :size="14" />
      <span>{{ t('codeAgent.addModels') }}</span>
    </button>
  </div>
</template>

<style scoped>
.model-menu {
  position: fixed;
  left: 12px;
  bottom: 56px;
  z-index: 80;
  display: flex;
  flex-direction: column;
  width: min(340px, calc(100vw - 24px));
  max-height: min(520px, calc(100vh - 24px));
  overflow: hidden;
  border: 1px solid var(--codex-border, #e5e5e5);
  border-radius: 12px;
  background: var(--codex-bg, #fafafa);
  padding: 6px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.16);
}
.model-row,
.settings-row {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 9px;
  border-radius: 8px;
  padding: 8px 9px;
  text-align: left;
  color: var(--codex-text, #1a1a1a);
  font-size: var(--code-agent-content-size, 12.5px);
  line-height: var(--code-agent-content-line, 1.62);
}
.model-row:hover,
.model-row.selected,
.settings-row:hover {
  background: var(--codex-hover, #f0f0f0);
}
.model-row svg {
  margin-left: auto;
  flex-shrink: 0;
}
.model-search {
  width: 100%;
  border: 0;
  border-bottom: 1px solid var(--codex-border, #e5e5e5);
  background: transparent;
  padding: 8px 9px 10px;
  font-size: var(--code-agent-content-size, 12.5px);
  outline: none;
}
.model-search::placeholder {
  color: var(--codex-muted, #8a8a8a);
}
.effort-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 9px;
  color: var(--codex-muted, #8a8a8a);
  font-size: 12px;
}
.effort-options {
  display: inline-flex;
  border-radius: 999px;
  background: var(--codex-hover, #f0f0f0);
  padding: 2px;
}
.effort-options button {
  border-radius: 999px;
  padding: 3px 7px;
  color: var(--codex-muted, #8a8a8a);
  font-size: 11px;
}
.effort-options button.active {
  background: var(--codex-bg, #fafafa);
  color: var(--codex-text, #1a1a1a);
}
.model-list-wrap {
  margin: 0 -6px;
  min-height: 0;
  overflow: hidden;
  border-top: 1px solid var(--codex-border, #e5e5e5);
  border-bottom: 1px solid var(--codex-border, #e5e5e5);
}
.model-list {
  max-height: min(260px, calc(100vh - 260px));
  overflow-y: auto;
  padding: 4px 6px;
  scrollbar-gutter: stable;
}
.model-row > div {
  min-width: 0;
}
.model-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--code-agent-content-size, 12.5px);
  font-weight: 500;
}
.model-meta {
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--codex-muted, #8a8a8a);
  font-size: 11px;
}
.settings-row {
  color: var(--codex-text-secondary, #4a4a4a);
}
</style>
