<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Archive, CalendarClock, ChevronDown, Plus, Search, Trash2 } from 'lucide-vue-next'
import SettingsToggle from '../SettingsToggle.vue'
import { useSettingsStore } from '../../../stores/settings.store.js'
import { useUiStore } from '../../../stores/ui.store.js'
import { ipc, unwrap } from '../../../services/ipc-client.js'
import type { AgentMemory, PersonalityTone } from '../../../../shared/types/personalization.js'

const { t } = useI18n()
const settings = useSettingsStore()
const ui = useUiStore()

const localInstructions = ref(settings.agentSystemPrompt)
const memoryCount = ref(0)
const memories = ref<AgentMemory[]>([])
const memoryQuery = ref('')
const manualMemory = ref('')
const instructionsSaved = ref(false)
const resetting = ref(false)
const savingMemory = ref(false)
const showMemoryAdvanced = ref(false)
const memoryStatusFilter = ref<'active' | 'archived' | 'all'>('active')

const personalityOptions: Array<{ value: PersonalityTone; labelKey: string }> = [
  { value: 'amiable', labelKey: 'settings.personalization.personalityAmiable' },
  { value: 'professional', labelKey: 'settings.personalization.personalityProfessional' },
  { value: 'concise', labelKey: 'settings.personalization.personalityConcise' },
  { value: 'detailed', labelKey: 'settings.personalization.personalityDetailed' },
  { value: 'creative', labelKey: 'settings.personalization.personalityCreative' }
]

const instructionsDirty = computed(
  () => localInstructions.value.trim() !== settings.agentSystemPrompt.trim()
)

const canSaveInstructions = computed(() => instructionsDirty.value)
const activeMemoryCount = computed(() => memories.value.filter((memory) => memory.status === 'active').length)
const archivedMemoryCount = computed(() => memories.value.filter((memory) => memory.status === 'archived').length)
const displayedMemories = computed(() => {
  if (memoryStatusFilter.value === 'all') return memories.value
  return memories.value.filter((memory) => memory.status === memoryStatusFilter.value)
})

watch(
  () => settings.showSettings,
  (show) => {
    if (show) {
      localInstructions.value = settings.agentSystemPrompt
      instructionsSaved.value = false
      void refreshMemoryCount()
    }
  }
)

async function refreshMemoryCount(): Promise<void> {
  memoryCount.value = await unwrap<number>(ipc.memory.count())
  memories.value = await unwrap<AgentMemory[]>(ipc.memory.list({
    query: memoryQuery.value,
    includeArchived: true,
    limit: 200
  }))
}

async function saveInstructions(): Promise<void> {
  settings.agentSystemPrompt = localInstructions.value.trim()
  await settings.save()
  instructionsSaved.value = true
  setTimeout(() => { instructionsSaved.value = false }, 2000)
}

async function updatePersonalization(
  partial: Partial<typeof settings.personalization>
): Promise<void> {
  await settings.patchPersonalization(partial)
}

async function resetMemory(): Promise<void> {
  const confirmed = await ui.confirm(t('settings.personalization.resetConfirm'), {
    title: t('settings.personalization.resetMemory'),
    confirmLabel: t('common.reset'),
    danger: true
  })
  if (!confirmed) return
  resetting.value = true
  try {
    await unwrap(ipc.memory.reset())
    memoryCount.value = 0
    memories.value = []
  } finally {
    resetting.value = false
  }
}

async function addMemory(): Promise<void> {
  const content = manualMemory.value.trim()
  if (!content) return
  savingMemory.value = true
  try {
    if (!settings.personalization.memoryEnabled) {
      await updatePersonalization({ memoryEnabled: true })
    }
    await unwrap(ipc.memory.create({
      content,
      kind: 'instruction',
      sourceType: 'manual',
      importance: 4,
      confidence: 1
    }))
    manualMemory.value = ''
    await refreshMemoryCount()
  } finally {
    savingMemory.value = false
  }
}

async function archiveMemory(memory: AgentMemory): Promise<void> {
  await unwrap(ipc.memory.archive(memory.id))
  await refreshMemoryCount()
}

async function deleteMemory(memory: AgentMemory): Promise<void> {
  const confirmed = await ui.confirm(t('settings.personalization.deleteMemoryConfirm'), {
    title: t('common.delete'),
    confirmLabel: t('common.delete'),
    danger: true
  })
  if (!confirmed) return
  await unwrap(ipc.memory.delete(memory.id))
  await refreshMemoryCount()
}

watch(memoryQuery, () => {
  void refreshMemoryCount()
})

watch(memoryStatusFilter, () => {
  void refreshMemoryCount()
})

void refreshMemoryCount()

function formatMemoryTime(value?: number): string {
  if (!value) return ''
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}

function memoryLifecycle(memory: AgentMemory): 'current' | 'historical' | 'deprecated' {
  return memory.metadata?.lifecycle ?? (memory.status === 'archived' ? 'historical' : 'current')
}

function memoryLineageLabel(memory: AgentMemory): string {
  const lifecycle = memoryLifecycle(memory)
  if (lifecycle === 'deprecated') return t('settings.personalization.memoryLifecycle.deprecated')
  if (lifecycle === 'historical') return t('settings.personalization.memoryLifecycle.historical')
  const supersedes = memory.metadata?.supersedesIds?.length ?? 0
  return supersedes > 0
    ? t('settings.personalization.memoryLifecycle.currentWithHistory', { count: supersedes })
    : t('settings.personalization.memoryLifecycle.current')
}

function memoryLineageHint(memory: AgentMemory): string {
  const lifecycle = memoryLifecycle(memory)
  if (lifecycle === 'deprecated') {
    return t('settings.personalization.memoryLifecycle.deprecatedHint')
  }
  if (lifecycle === 'historical') {
    return t('settings.personalization.memoryLifecycle.historicalHint')
  }
  if (memory.metadata?.canonicalKey) {
    return t('settings.personalization.memoryLifecycle.currentHint')
  }
  return ''
}
</script>

<template>
  <div class="settings-panel">
    <h1 class="panel-title">{{ t('settings.personalization.title') }}</h1>

    <section class="settings-section">
      <div class="settings-group">
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.personalization.personality') }}</div>
            <div class="row-desc">{{ t('settings.personalization.personalityDesc') }}</div>
          </div>
          <div class="select-wrap">
            <select
              :value="settings.personalization.personality"
              class="settings-select"
              @change="settings.setPersonality(($event.target as HTMLSelectElement).value as PersonalityTone)"
            >
              <option
                v-for="option in personalityOptions"
                :key="option.value"
                :value="option.value"
              >
                {{ t(option.labelKey) }}
              </option>
            </select>
            <ChevronDown :size="14" class="select-chevron" />
          </div>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <div class="instructions-card">
        <div class="instructions-header">
          <div class="row-title">{{ t('settings.personalization.customInstructions') }}</div>
          <p class="row-desc">
            {{ t('settings.personalization.customInstructionsDesc') }}
            <a href="#" class="row-link" @click.prevent>{{ t('common.learnMore') }}</a>
          </p>
        </div>
        <div class="instructions-body">
          <textarea
            v-model="localInstructions"
            class="instructions-textarea"
            rows="6"
            :placeholder="t('settings.personalization.customInstructionsPlaceholder')"
          />
          <div class="instructions-footer">
            <button
              type="button"
              class="save-btn"
              :class="{ 'is-enabled': canSaveInstructions, 'is-saved': instructionsSaved }"
              :disabled="!canSaveInstructions && !instructionsSaved"
              @click="saveInstructions()"
            >
              {{ instructionsSaved ? t('common.saved') : t('common.save') }}
            </button>
          </div>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <div class="memory-header">
        <h2 class="section-title">{{ t('settings.personalization.memorySection') }}</h2>
        <p class="section-desc">
          {{ t('settings.personalization.memorySectionDesc') }}
          <a href="#" class="row-link" @click.prevent>{{ t('common.learnMore') }}</a>
        </p>
      </div>

      <div class="settings-group">
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.personalization.memoryEnabled') }}</div>
            <div class="row-desc">{{ t('settings.personalization.memoryEnabledDesc') }}</div>
          </div>
          <SettingsToggle
            :model-value="settings.personalization.memoryEnabled"
            @update:model-value="updatePersonalization({ memoryEnabled: $event })"
          />
        </div>
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.personalization.chroniclePreview') }}</div>
            <div class="row-desc">
              {{ t('settings.personalization.chroniclePreviewDesc') }}
              <a href="#" class="row-link" @click.prevent>{{ t('common.learnMore') }}</a>
            </div>
          </div>
          <SettingsToggle
            :model-value="settings.personalization.chroniclePreview"
            @update:model-value="updatePersonalization({ chroniclePreview: $event })"
          />
        </div>
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.personalization.skipToolAssisted') }}</div>
            <div class="row-desc">{{ t('settings.personalization.skipToolAssistedDesc') }}</div>
          </div>
          <SettingsToggle
            :model-value="settings.personalization.skipToolAssistedMemory"
            @update:model-value="updatePersonalization({ skipToolAssistedMemory: $event })"
          />
        </div>
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.personalization.memoryAdvanced') }}</div>
            <div class="row-desc">{{ t('settings.personalization.memoryAdvancedDesc') }}</div>
          </div>
          <button type="button" class="secondary-btn" @click="showMemoryAdvanced = true">
            {{ t('settings.personalization.openAdvanced') }}
          </button>
        </div>
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.personalization.resetMemory') }}</div>
            <div class="row-desc">
              {{ t('settings.personalization.resetMemoryDesc') }}
              <span v-if="memoryCount > 0" class="memory-count">
                {{ t('settings.personalization.memoryCount', { count: memoryCount }) }}
              </span>
            </div>
          </div>
          <button
            type="button"
            class="reset-btn"
            :disabled="resetting || memoryCount === 0"
            @click="resetMemory()"
          >
            {{ t('common.reset') }}
          </button>
        </div>
      </div>

      <div class="memory-viewer">
        <div class="memory-toolbar">
          <div class="memory-search">
            <Search :size="14" />
            <input
              v-model="memoryQuery"
              type="search"
              :placeholder="t('settings.personalization.searchMemory')"
            />
          </div>
          <div class="memory-status-tabs" role="tablist">
            <button
              type="button"
              :class="{ active: memoryStatusFilter === 'active' }"
              @click="memoryStatusFilter = 'active'"
            >
              {{ t('settings.personalization.memoryStatus.active') }}
              <span>{{ memoryCount }}</span>
            </button>
            <button
              type="button"
              :class="{ active: memoryStatusFilter === 'archived' }"
              @click="memoryStatusFilter = 'archived'"
            >
              {{ t('settings.personalization.memoryStatus.archived') }}
              <span>{{ archivedMemoryCount }}</span>
            </button>
            <button
              type="button"
              :class="{ active: memoryStatusFilter === 'all' }"
              @click="memoryStatusFilter = 'all'"
            >
              {{ t('settings.personalization.memoryStatus.all') }}
              <span>{{ activeMemoryCount + archivedMemoryCount }}</span>
            </button>
          </div>
        </div>

        <div class="manual-memory">
          <textarea
            v-model="manualMemory"
            rows="2"
            :placeholder="t('settings.personalization.manualMemoryPlaceholder')"
          />
          <button
            type="button"
            :disabled="savingMemory || !manualMemory.trim()"
            @click="addMemory()"
          >
            <Plus :size="14" />
            {{ t('settings.personalization.addMemory') }}
          </button>
        </div>

        <div class="memory-list">
          <article
            v-for="memory in displayedMemories"
            :key="memory.id"
            class="memory-item"
            :class="{ archived: memory.status === 'archived' }"
          >
            <div class="memory-item-main">
              <div class="memory-item-head">
                <span class="memory-status" :class="memory.status">
                  {{ t(`settings.personalization.memoryStatus.${memory.status}`) }}
                </span>
                <span
                  class="memory-lineage"
                  :class="memoryLifecycle(memory)"
                  :title="memoryLineageHint(memory)"
                >
                  {{ memoryLineageLabel(memory) }}
                </span>
                <span class="memory-kind">{{ t(`settings.personalization.memoryKind.${memory.kind}`) }}</span>
                <span class="memory-scope">{{ t(`settings.personalization.memoryScope.${memory.scope}`) }}</span>
                <span class="memory-score">I{{ memory.importance }} · {{ Math.round(memory.confidence * 100) }}%</span>
              </div>
              <p class="memory-content">{{ memory.content }}</p>
              <div class="memory-meta">
                <span>
                  <CalendarClock :size="12" />
                  {{ memory.status === 'archived'
                    ? t('settings.personalization.memoryArchivedAt', { time: formatMemoryTime(memory.archivedAt || memory.updatedAt) })
                    : t('settings.personalization.memoryUpdatedAt', { time: formatMemoryTime(memory.updatedAt) }) }}
                </span>
                <span>{{ t(`settings.personalization.memorySource.${memory.sourceType}`) }}</span>
              </div>
              <div v-if="memory.tags.length" class="memory-tags">
                <span v-for="tag in memory.tags" :key="tag">#{{ tag }}</span>
              </div>
            </div>
            <div class="memory-actions">
              <button
                v-if="memory.status === 'active'"
                type="button"
                :title="t('settings.personalization.archiveMemory')"
                @click="archiveMemory(memory)"
              >
                <Archive :size="14" />
              </button>
              <button type="button" class="danger" :title="t('settings.personalization.deleteMemory')" @click="deleteMemory(memory)">
                <Trash2 :size="14" />
              </button>
            </div>
          </article>
          <div v-if="!displayedMemories.length" class="memory-empty">
            {{ t('settings.personalization.memoryEmpty') }}
          </div>
        </div>
      </div>
    </section>

    <div v-if="showMemoryAdvanced" class="modal-backdrop" @click.self="showMemoryAdvanced = false">
      <div class="advanced-modal">
        <div class="modal-head">
          <div>
            <h2>{{ t('settings.personalization.memoryAdvanced') }}</h2>
            <p>{{ t('settings.personalization.memoryAdvancedDesc') }}</p>
          </div>
          <button type="button" class="modal-close" @click="showMemoryAdvanced = false">×</button>
        </div>

        <div class="modal-body">
          <div class="modal-row">
            <div>
              <div class="row-title">{{ t('settings.personalization.memoryAutoCapture') }}</div>
              <div class="row-desc">{{ t('settings.personalization.memoryAutoCaptureDesc') }}</div>
            </div>
            <select
              :value="settings.personalization.memoryAutoCapture"
              class="compact-select"
              @change="updatePersonalization({ memoryAutoCapture: ($event.target as HTMLSelectElement).value as typeof settings.personalization.memoryAutoCapture })"
            >
              <option value="off">{{ t('settings.personalization.memoryAutoCaptureOff') }}</option>
              <option value="explicit">{{ t('settings.personalization.memoryAutoCaptureExplicit') }}</option>
              <option value="balanced">{{ t('settings.personalization.memoryAutoCaptureBalanced') }}</option>
              <option value="aggressive">{{ t('settings.personalization.memoryAutoCaptureAggressive') }}</option>
            </select>
          </div>

          <div class="modal-row">
            <div>
              <div class="row-title">{{ t('settings.personalization.memoryDefaultScope') }}</div>
              <div class="row-desc">{{ t('settings.personalization.memoryDefaultScopeDesc') }}</div>
            </div>
            <select
              :value="settings.personalization.memoryDefaultScope"
              class="compact-select"
              @change="updatePersonalization({ memoryDefaultScope: ($event.target as HTMLSelectElement).value as typeof settings.personalization.memoryDefaultScope })"
            >
              <option value="workspace">{{ t('settings.personalization.memoryScope.workspace') }}</option>
              <option value="global">{{ t('settings.personalization.memoryScope.global') }}</option>
            </select>
          </div>

          <div class="modal-row">
            <div>
              <div class="row-title">{{ t('settings.personalization.memoryIncludeGlobal') }}</div>
              <div class="row-desc">{{ t('settings.personalization.memoryIncludeGlobalDesc') }}</div>
            </div>
            <SettingsToggle
              :model-value="settings.personalization.memoryIncludeGlobal"
              @update:model-value="updatePersonalization({ memoryIncludeGlobal: $event })"
            />
          </div>

          <div class="modal-row">
            <div>
              <div class="row-title">{{ t('settings.personalization.memoryPromptLimit') }}</div>
              <div class="row-desc">{{ t('settings.personalization.memoryPromptLimitDesc') }}</div>
            </div>
            <input
              type="number"
              min="1"
              max="20"
              class="number-input"
              :value="settings.personalization.memoryPromptLimit"
              @change="updatePersonalization({ memoryPromptLimit: Number(($event.target as HTMLInputElement).value) })"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-panel {
  @apply w-full;
}
.panel-title {
  @apply text-[28px] font-semibold text-codex-text mb-8 tracking-tight;
}
.settings-section {
  @apply mb-8;
}
.section-title {
  @apply text-[15px] font-semibold text-codex-text mb-1;
}
.section-desc {
  @apply text-[13px] text-codex-muted mb-4 leading-relaxed;
}
.memory-header {
  @apply mb-3;
}
.settings-group {
  @apply rounded-xl border border-codex-border overflow-hidden bg-codex-bg;
}
.settings-row {
  @apply flex items-center justify-between gap-6 px-4 py-3.5;
}
.settings-row + .settings-row {
  @apply border-t border-codex-border;
}
.row-text {
  @apply flex-1 min-w-0;
}
.row-title {
  @apply text-[14px] font-medium text-codex-text;
}
.row-desc {
  @apply text-[12px] text-codex-muted mt-0.5 leading-relaxed;
}
.row-link {
  @apply text-codex-accent hover:underline;
}
.select-wrap {
  @apply relative shrink-0;
}
.settings-select {
  @apply appearance-none pl-3 pr-8 py-1.5 text-[13px] text-codex-text
         bg-codex-hover border border-codex-border rounded-lg cursor-pointer
         outline-none focus:border-codex-accent min-w-[120px];
}
.compact-select,
.number-input {
  @apply shrink-0 rounded-lg border border-codex-border bg-codex-hover px-3 py-1.5 text-[13px]
         text-codex-text outline-none focus:border-codex-accent;
}
.number-input {
  @apply w-20;
}
.select-chevron {
  @apply absolute right-2.5 top-1/2 -translate-y-1/2 text-codex-muted pointer-events-none;
}
.instructions-card {
  @apply rounded-xl border border-codex-border bg-codex-bg overflow-hidden;
}
.instructions-header {
  @apply px-4 pt-4 pb-3 border-b border-codex-border;
}
.instructions-body {
  @apply p-4;
}
.instructions-textarea {
  @apply w-full resize-y min-h-[140px] px-3 py-2.5 text-[13px] leading-relaxed
         rounded-xl border border-codex-border outline-none focus:border-codex-accent
         bg-codex-hover placeholder:text-codex-muted;
}
.instructions-footer {
  @apply flex justify-end mt-3;
}
.save-btn {
  @apply px-4 py-1.5 text-[13px] font-medium rounded-lg transition-colors
         bg-codex-border text-codex-muted cursor-not-allowed;
}
.save-btn.is-enabled {
  @apply bg-codex-text text-codex-bg cursor-pointer hover:opacity-90;
}
.save-btn.is-saved {
  @apply bg-codex-accent text-white cursor-default;
}
.reset-btn {
  @apply text-[13px] font-medium text-red-500 hover:text-red-600
         disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0;
}
.secondary-btn {
  @apply shrink-0 rounded-lg border border-codex-border bg-codex-hover px-3 py-1.5 text-[13px]
         font-medium text-codex-text transition-colors hover:border-codex-border-hover;
}
.memory-count {
  @apply text-codex-muted;
}
.memory-viewer {
  @apply mt-4 rounded-xl border border-codex-border bg-codex-bg overflow-hidden;
}
.memory-toolbar {
  @apply sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-codex-border bg-codex-bg px-4 py-3;
}
.memory-search {
  @apply flex min-w-[180px] flex-1 items-center gap-2 rounded-lg border border-codex-border bg-codex-hover px-3 py-1.5 text-codex-muted;
}
.memory-search input {
  @apply min-w-0 flex-1 bg-transparent text-[13px] text-codex-text outline-none placeholder:text-codex-muted;
}
.memory-status-tabs {
  @apply flex shrink-0 items-center rounded-lg bg-codex-hover p-0.5;
}
.memory-status-tabs button {
  @apply flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-medium text-codex-muted transition-colors
         hover:text-codex-text;
}
.memory-status-tabs button.active {
  @apply bg-codex-bg text-codex-text shadow-sm;
}
.memory-status-tabs span {
  @apply text-[11px] opacity-70;
}
.manual-memory {
  @apply flex gap-3 border-b border-codex-border p-4;
}
.manual-memory textarea {
  @apply min-h-[58px] flex-1 resize-y rounded-lg border border-codex-border bg-codex-hover px-3 py-2 text-[13px]
         text-codex-text outline-none placeholder:text-codex-muted focus:border-codex-accent;
}
.manual-memory button {
  @apply flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-codex-text px-3 text-[13px] font-medium text-codex-bg
         transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35;
}
.memory-list {
  @apply max-h-[420px] overflow-auto overscroll-contain;
}
.memory-item {
  @apply flex items-start gap-3 border-b border-codex-border px-4 py-3.5 last:border-b-0 transition-colors hover:bg-codex-hover;
}
.memory-item.archived {
  @apply bg-codex-hover;
}
.memory-item-main {
  @apply min-w-0 flex-1;
}
.memory-item-head {
  @apply flex flex-wrap items-center gap-1.5;
}
.memory-status {
  @apply rounded-md px-1.5 py-0.5 text-[10px] font-semibold;
}
.memory-status.active {
  @apply bg-emerald-500/10 text-emerald-600;
}
.memory-status.archived {
  @apply bg-codex-hover text-codex-muted;
}
.memory-lineage {
  @apply rounded-md px-1.5 py-0.5 text-[10px] font-semibold;
}
.memory-lineage.current {
  @apply bg-blue-500/10 text-blue-600;
}
.memory-lineage.historical {
  @apply bg-codex-hover text-codex-text-secondary;
}
.memory-lineage.deprecated {
  @apply bg-amber-500/10 text-amber-700;
}
.memory-kind,
.memory-scope,
.memory-score {
  @apply rounded-md bg-codex-hover px-1.5 py-0.5 text-[10px] font-medium text-codex-muted;
}
.memory-content {
  @apply mt-1.5 max-h-[4.75rem] overflow-auto pr-2 text-[13px] leading-relaxed text-codex-text;
}
.memory-item.archived .memory-content {
  @apply text-codex-muted;
}
.memory-meta {
  @apply mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-codex-muted;
}
.memory-meta span {
  @apply inline-flex items-center gap-1;
}
.memory-tags {
  @apply mt-2 flex flex-wrap gap-1.5;
}
.memory-tags span {
  @apply text-[11px] text-codex-muted;
}
.memory-actions {
  @apply flex shrink-0 items-center gap-1 pt-0.5;
}
.memory-actions button {
  @apply rounded-md p-1.5 text-codex-muted transition-colors hover:bg-codex-hover hover:text-codex-text;
}
.memory-actions button.danger {
  @apply hover:text-red-500;
}
.memory-empty {
  @apply px-4 py-8 text-center text-[13px] text-codex-muted;
}
.modal-backdrop {
  @apply fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-6;
}
.advanced-modal {
  @apply w-full max-w-[560px] overflow-hidden rounded-2xl border border-codex-border bg-codex-bg shadow-2xl;
}
.modal-head {
  @apply flex items-start justify-between gap-4 border-b border-codex-border px-5 py-4;
}
.modal-head h2 {
  @apply text-[16px] font-semibold text-codex-text;
}
.modal-head p {
  @apply mt-1 text-[12px] leading-relaxed text-codex-muted;
}
.modal-close {
  @apply flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[20px] leading-none text-codex-muted
         transition-colors hover:bg-codex-hover hover:text-codex-text;
}
.modal-body {
  @apply divide-y divide-codex-border;
}
.modal-row {
  @apply flex items-center justify-between gap-5 px-5 py-4;
}
</style>
