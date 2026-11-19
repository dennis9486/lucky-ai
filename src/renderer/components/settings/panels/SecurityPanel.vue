<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ShieldCheck, ShieldAlert, ShieldOff } from 'lucide-vue-next'
import SettingsSegmented from '../SettingsSegmented.vue'
import SettingsToggle from '../SettingsToggle.vue'
import { useSettingsStore } from '../../../stores/settings.store.js'
import { ipc, unwrap } from '../../../services/ipc-client.js'
import type { GeneralAppSettings } from '../../../../shared/types/ipc.js'
import type { SandboxStatus } from '../../../../shared/types/sandbox.js'

const { t } = useI18n()
const settings = useSettingsStore()
const status = ref<SandboxStatus | null>(null)

async function patchGeneral(partial: Partial<GeneralAppSettings>): Promise<void> {
  await settings.patchGeneral(partial)
}

async function refresh(): Promise<void> {
  try {
    status.value = await unwrap<SandboxStatus>(ipc.sandbox.getStatus())
  } catch {
    status.value = null
  }
}

const tone = computed<'ok' | 'warn' | 'off'>(() => {
  if (!status.value || status.value.mode === 'off') return 'off'
  return status.value.isolation === 'os' ? 'ok' : 'warn'
})
const icon = computed(() => (tone.value === 'ok' ? ShieldCheck : tone.value === 'warn' ? ShieldAlert : ShieldOff))
const levelLabel = computed(() => {
  const s = status.value
  if (!s || s.mode === 'off') return t('sandbox.level.off')
  if (s.isolation !== 'os') return t('sandbox.level.workspace')
  return s.mode === 'strict' ? t('sandbox.level.strict') : t('sandbox.level.standard')
})
const detail = computed(() => {
  const s = status.value
  if (!s) return t('sandbox.tooltip.unknown')
  if (s.mode === 'off') return t('sandbox.tooltip.off')
  const backend = t(`sandbox.backend.${s.backend}`)
  const net = s.networkPolicy === 'deny' ? t('sandbox.net.deny') : t('sandbox.net.allow')
  return s.degraded ? t('sandbox.tooltip.degraded', { backend, net }) : t('sandbox.tooltip.os', { backend, net })
})

watch(() => settings.general.agentSandbox, () => void refresh())

function onVisibility(): void {
  if (document.visibilityState === 'visible') void refresh()
}

onMounted(() => {
  void refresh()
  document.addEventListener('visibilitychange', onVisibility)
})
onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibility)
})
</script>

<template>
  <div class="settings-panel">
    <h1 class="panel-title">{{ t('settings.security.title') }}</h1>

    <section class="settings-section">
      <h2 class="section-title">{{ t('settings.security.sandboxSection') }}</h2>
      <p class="section-desc">{{ t('settings.security.sandboxHint') }}</p>

      <div class="status-card" :class="tone">
        <component :is="icon" :size="20" :stroke-width="2" class="status-icon" />
        <div class="status-text">
          <div class="status-level">{{ levelLabel }}</div>
          <div class="status-detail">{{ detail }}</div>
        </div>
      </div>

      <div class="settings-group">
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.general.agentSandbox') }}</div>
            <div class="row-desc">{{ t('settings.general.agentSandboxDesc') }}</div>
          </div>
          <SettingsSegmented
            :model-value="settings.general.agentSandbox"
            :options="[
              { value: 'strict', label: t('settings.general.agentSandboxStrict') },
              { value: 'balanced', label: t('settings.general.agentSandboxBalanced') },
              { value: 'off', label: t('settings.general.agentSandboxOff') }
            ]"
            @update:model-value="patchGeneral({ agentSandbox: $event as GeneralAppSettings['agentSandbox'] })"
          />
        </div>

        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.general.agentSandboxContainer') }}</div>
            <div class="row-desc">{{ t('settings.general.agentSandboxContainerDesc') }}</div>
          </div>
          <SettingsToggle
            :model-value="settings.general.agentSandboxContainer"
            :disabled="settings.general.agentSandbox === 'off'"
            @update:model-value="patchGeneral({ agentSandboxContainer: $event })"
          />
        </div>

        <div v-if="settings.general.agentSandboxContainer" class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.general.agentSandboxImage') }}</div>
            <div class="row-desc">{{ t('settings.general.agentSandboxImageDesc') }}</div>
          </div>
          <input
            class="image-input"
            type="text"
            :value="settings.general.agentSandboxImage"
            :placeholder="'node:20-alpine'"
            @change="patchGeneral({ agentSandboxImage: ($event.target as HTMLInputElement).value.trim() })"
          />
        </div>
      </div>

      <ul class="mode-legend">
        <li><strong>{{ t('settings.general.agentSandboxStrict') }}</strong> — {{ t('settings.security.modeStrict') }}</li>
        <li><strong>{{ t('settings.general.agentSandboxBalanced') }}</strong> — {{ t('settings.security.modeBalanced') }}</li>
        <li><strong>{{ t('settings.general.agentSandboxOff') }}</strong> — {{ t('settings.security.modeOff') }}</li>
      </ul>
    </section>
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
  @apply mb-10;
}
.section-title {
  @apply text-[15px] font-semibold text-codex-text mb-1;
}
.section-desc {
  @apply text-[13px] text-codex-muted mb-4 leading-relaxed;
}
.settings-group {
  @apply rounded-xl border border-codex-border overflow-hidden bg-codex-bg;
}
.settings-row {
  @apply flex items-center justify-between gap-6 px-4 py-[15px];
}
.row-text {
  @apply flex-1 min-w-0 pr-4;
}
.row-title {
  @apply text-[14px] font-medium text-codex-text;
}
.row-desc {
  @apply text-[12px] text-codex-muted mt-1 leading-relaxed;
}
.image-input {
  @apply h-8 w-[200px] shrink-0 rounded-lg border border-codex-border bg-codex-bg px-2.5 text-[13px] text-codex-text outline-none focus:border-codex-border-hover;
}
.status-card {
  @apply flex items-start gap-3 rounded-xl border px-4 py-3.5 mb-4;
}
.status-card.ok {
  @apply text-emerald-600 border-emerald-500/30 bg-emerald-500/10;
}
.status-card.warn {
  color: #b45309;
  border-color: color-mix(in srgb, #d97706 30%, transparent);
  background: color-mix(in srgb, #d97706 10%, transparent);
}
.status-card.off {
  @apply text-codex-muted border-codex-border bg-codex-hover;
}
.status-icon {
  @apply mt-0.5 shrink-0;
}
.status-level {
  @apply text-[14px] font-semibold;
}
.status-detail {
  @apply text-[12px] mt-1 leading-relaxed opacity-90;
}
.mode-legend {
  @apply mt-4 space-y-1.5 text-[12px] text-codex-muted leading-relaxed;
}
.mode-legend strong {
  @apply text-codex-text font-medium;
}
</style>
