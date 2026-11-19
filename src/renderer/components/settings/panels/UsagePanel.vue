<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, RefreshCw } from 'lucide-vue-next'
import type { AgentUsageSummary } from '../../../../shared/types/usage.js'
import { ipc, unwrap } from '../../../services/ipc-client.js'

const { t } = useI18n()

const loading = ref(false)
const error = ref('')
const summary = ref<AgentUsageSummary | null>(null)

const maxDayTokens = computed(() => {
  const days = summary.value?.days ?? []
  return Math.max(1, ...days.map((day) => day.inputTokens + day.outputTokens))
})

/** 1234567 → 1.23M，紧凑显示 */
function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M`
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`
  return String(value)
}

async function refresh(): Promise<void> {
  if (loading.value) return
  loading.value = true
  error.value = ''
  try {
    summary.value = await unwrap<AgentUsageSummary>(ipc.agent.getUsageSummary(30))
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

onMounted(refresh)
</script>

<template>
  <div class="settings-panel">
    <div class="usage-head">
      <h1 class="panel-title">{{ t('settings.usage.title') }}</h1>
      <button
        type="button"
        class="usage-refresh"
        :title="t('settings.usage.refresh')"
        :aria-label="t('settings.usage.refresh')"
        :disabled="loading"
        @click="refresh"
      >
        <Loader2 v-if="loading" :size="16" :stroke-width="2" class="spin" />
        <RefreshCw v-else :size="16" :stroke-width="2" />
        <span>{{ t('settings.usage.refreshShort') }}</span>
      </button>
    </div>

    <p v-if="error" class="usage-error">{{ error }}</p>

    <template v-if="summary">
      <section class="settings-section">
        <div class="usage-cards">
          <div class="usage-card">
            <div class="usage-card-value">{{ formatTokens(summary.totalInputTokens) }}</div>
            <div class="usage-card-label">{{ t('settings.usage.inputTokens') }}</div>
          </div>
          <div class="usage-card">
            <div class="usage-card-value">{{ formatTokens(summary.totalOutputTokens) }}</div>
            <div class="usage-card-label">{{ t('settings.usage.outputTokens') }}</div>
          </div>
          <div class="usage-card">
            <div class="usage-card-value">{{ summary.totalCalls }}</div>
            <div class="usage-card-label">{{ t('settings.usage.calls') }}</div>
          </div>
        </div>
      </section>

      <section class="settings-section">
        <h2 class="section-title">{{ t('settings.usage.dailyTitle') }}</h2>
        <div class="usage-chart" role="img" :aria-label="t('settings.usage.dailyTitle')">
          <div
            v-for="day in summary.days"
            :key="day.date"
            class="usage-bar-col"
            :title="`${day.date}\n↑ ${formatTokens(day.inputTokens)} / ↓ ${formatTokens(day.outputTokens)} · ${day.calls} calls`"
          >
            <div
              class="usage-bar"
              :style="{ height: `${Math.max(2, ((day.inputTokens + day.outputTokens) / maxDayTokens) * 100)}%` }"
              :class="{ 'is-empty': day.calls === 0 }"
            />
          </div>
        </div>
        <div class="usage-chart-range">
          <span>{{ summary.days[0]?.date }}</span>
          <span>{{ summary.days.at(-1)?.date }}</span>
        </div>
      </section>

      <section class="settings-section">
        <h2 class="section-title">{{ t('settings.usage.byModelTitle') }}</h2>
        <div v-if="summary.models.length" class="usage-table">
          <div class="usage-row usage-row-head">
            <span class="usage-col-model">{{ t('settings.usage.model') }}</span>
            <span class="usage-col-num">{{ t('settings.usage.inputTokens') }}</span>
            <span class="usage-col-num">{{ t('settings.usage.outputTokens') }}</span>
            <span class="usage-col-num">{{ t('settings.usage.calls') }}</span>
          </div>
          <div v-for="entry in summary.models" :key="`${entry.provider}:${entry.model}`" class="usage-row">
            <span class="usage-col-model" :title="`${entry.provider} / ${entry.model}`">
              {{ entry.model || '—' }}
              <em v-if="entry.provider" class="usage-provider">{{ entry.provider }}</em>
            </span>
            <span class="usage-col-num">{{ formatTokens(entry.inputTokens) }}</span>
            <span class="usage-col-num">{{ formatTokens(entry.outputTokens) }}</span>
            <span class="usage-col-num">{{ entry.calls }}</span>
          </div>
        </div>
        <p v-else class="usage-empty">{{ t('settings.usage.empty') }}</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.usage-head {
  @apply flex items-center justify-between;
}
.usage-refresh {
  @apply inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-[10px]
         border border-codex-border bg-codex-bg px-3 text-[13px] font-medium
         text-codex-text-secondary transition-colors
         hover:border-codex-border-hover hover:bg-codex-hover hover:text-codex-text
         disabled:cursor-not-allowed disabled:opacity-45;
}
.usage-error {
  @apply mt-2 rounded-md bg-red-50 px-3 py-2 text-[12px] font-medium text-red-600;
}
.usage-cards {
  @apply grid grid-cols-3 gap-3;
}
.usage-card {
  @apply rounded-lg border border-codex-border bg-codex-bg px-4 py-3;
}
.usage-card-value {
  @apply text-[20px] font-bold text-codex-text;
}
.usage-card-label {
  @apply mt-0.5 text-[12px] font-medium text-codex-text-secondary;
}
.usage-chart {
  @apply flex h-28 items-end gap-[2px] rounded-lg border border-codex-border bg-codex-bg p-2;
}
.usage-bar-col {
  @apply flex h-full flex-1 items-end;
}
.usage-bar {
  @apply w-full rounded-sm bg-[#3f87b8] transition-[height];
}
.usage-bar.is-empty {
  @apply bg-codex-border;
}
.usage-chart-range {
  @apply mt-1 flex justify-between text-[11px] text-codex-muted;
}
.usage-table {
  @apply overflow-x-auto overflow-y-hidden rounded-lg border border-codex-border;
}
.usage-row {
  @apply grid min-w-[560px] items-center gap-4 px-3 py-2 text-[12.5px] text-codex-text;
  grid-template-columns: minmax(0, 1fr) repeat(3, minmax(96px, 112px));
}
.usage-row + .usage-row {
  @apply border-t border-codex-border;
}
.usage-row-head {
  @apply bg-codex-bg text-[11px] font-semibold uppercase tracking-wide text-codex-text-secondary;
}
.usage-col-model {
  @apply min-w-0 flex-1 truncate font-medium;
}
.usage-provider {
  @apply ml-1.5 not-italic text-[11px] text-codex-muted;
}
.usage-col-num {
  @apply min-w-0 shrink-0 whitespace-nowrap text-right font-mono text-[12px];
}
.usage-row-head .usage-col-num {
  @apply font-sans leading-none;
}
.usage-empty {
  @apply text-[12.5px] text-codex-text-secondary;
}
.spin {
  animation: usage-spin 0.9s linear infinite;
}
@keyframes usage-spin {
  to { transform: rotate(360deg); }
}
</style>
