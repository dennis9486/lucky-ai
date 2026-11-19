<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Check, Loader2, RefreshCw, RotateCw, TriangleAlert } from 'lucide-vue-next'
import { useUpdaterStore } from '../../../stores/updater.store.js'
import { ipc, unwrap } from '../../../services/ipc-client.js'
import { createLogger } from '../../../../shared/utils/log.js'

const { t } = useI18n()
const updater = useUpdaterStore()
const logger = createLogger('renderer/about-panel')

const appVersion = ref('')

const version = computed(() => appVersion.value || updater.state.currentVersion || '—')

/** 检查更新按钮下方的状态行：随 updater.phase 反映检查/下载/就绪/出错 */
const statusText = computed(() => {
  switch (updater.phase) {
    case 'checking': return t('updater.checking')
    case 'not-available': return t('updater.upToDate')
    case 'available': return t('updater.newVersion', { version: updater.state.version ?? '' })
    case 'downloading': return `${t('updater.downloading')} ${updater.progressPercent}%`
    case 'downloaded': return t('updater.readyDesc', { version: updater.state.version ?? '' })
    case 'error': return `${t('updater.checkFailed')}${updater.state.error ? `：${updater.state.error}` : ''}`
    case 'disabled': return t('updater.devDisabled')
    default: return ''
  }
})

const statusKind = computed<'info' | 'success' | 'error'>(() => {
  if (updater.phase === 'error') return 'error'
  if (updater.phase === 'not-available' || updater.phase === 'downloaded') return 'success'
  return 'info'
})

onMounted(async () => {
  await updater.init()
  try {
    appVersion.value = await unwrap<string>(ipc.app.getVersion())
  } catch (error) {
    logger.debug('get app version failed', { error })
  }
})
</script>

<template>
  <div class="settings-panel">
    <h1 class="panel-title">{{ t('settings.about.title') }}</h1>

    <section class="settings-section">
      <div class="about-head">
        <div class="about-mark">AI</div>
        <div class="about-id">
          <div class="about-name">{{ t('settings.about.productName') }}</div>
          <div class="about-version">{{ t('settings.about.versionLabel', { version }) }}</div>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h2 class="section-title">{{ t('settings.about.updates') }}</h2>
      <div class="settings-group">
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.about.checkTitle') }}</div>
            <div v-if="statusText" class="row-status" :class="`is-${statusKind}`">
              <Loader2 v-if="updater.phase === 'checking' || updater.phase === 'downloading'" :size="13" class="spin" />
              <Check v-else-if="statusKind === 'success'" :size="13" :stroke-width="2.4" />
              <TriangleAlert v-else-if="statusKind === 'error'" :size="13" />
              <span class="row-status-text">{{ statusText }}</span>
            </div>
            <div v-else class="row-desc">{{ t('settings.about.checkDesc') }}</div>
          </div>

          <div class="row-actions">
            <button
              v-if="updater.isDownloaded"
              type="button"
              class="about-btn is-primary"
              @click="updater.install()"
            >
              <RotateCw :size="14" :stroke-width="2" />
              <span>{{ t('updater.restartNow') }}</span>
            </button>
            <button
              type="button"
              class="about-btn"
              :disabled="updater.checking || updater.phase === 'downloading' || updater.phase === 'disabled'"
              @click="updater.check()"
            >
              <RefreshCw :size="14" :stroke-width="2" :class="{ spin: updater.checking }" />
              <span>{{ t('settings.about.checkButton') }}</span>
            </button>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-panel {
  max-width: 720px;
  padding: 4px 2px 40px;
}
.panel-title {
  margin: 0 0 18px;
  font-size: 20px;
  font-weight: 680;
  color: var(--codex-text, #1a1a1a);
}
.settings-section {
  margin-bottom: 26px;
}
.section-title {
  margin: 0 0 10px;
  font-size: 13px;
  font-weight: 620;
  color: var(--codex-text, #1a1a1a);
}
.about-head {
  display: flex;
  align-items: center;
  gap: 14px;
}
.about-mark {
  display: flex;
  height: 52px;
  width: 52px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 14px;
  background: color-mix(in srgb, var(--codex-accent, #2563eb) 16%, var(--codex-hover, #f0f0f0));
  color: var(--codex-accent, #2563eb);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: 0.04em;
}
.about-name {
  font-size: 15px;
  font-weight: 660;
  color: var(--codex-text, #1a1a1a);
}
.about-version {
  margin-top: 3px;
  color: var(--codex-muted, #8a8a8a);
  font-size: 12.5px;
  font-variant-numeric: tabular-nums;
}
.settings-group {
  border: 1px solid var(--codex-border, #e5e5e5);
  border-radius: 12px;
  background: var(--codex-bg, #fff);
}
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 13px 14px;
}
.row-text {
  min-width: 0;
}
.row-title {
  font-size: 13px;
  font-weight: 560;
  color: var(--codex-text, #1a1a1a);
}
.row-desc {
  margin-top: 3px;
  color: var(--codex-muted, #8a8a8a);
  font-size: 12px;
  line-height: 1.45;
}
.row-status {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 4px;
  font-size: 12px;
  line-height: 1.45;
}
.row-status.is-info { color: var(--codex-text-secondary, #5f5f5f); }
.row-status.is-success { color: #16a34a; }
.row-status.is-error { color: #dc2626; }
.row-status-text {
  min-width: 0;
  word-break: break-word;
}
.row-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
}
.about-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--codex-border-hover, #d4d4d4);
  border-radius: 8px;
  padding: 6px 11px;
  font-size: 12.5px;
  font-weight: 560;
  color: var(--codex-text, #1a1a1a);
  white-space: nowrap;
  transition: background 0.12s ease, opacity 0.12s ease;
}
.about-btn:hover:not(:disabled) {
  background: var(--codex-hover, #f0f0f0);
}
.about-btn:disabled {
  cursor: default;
  opacity: 0.5;
}
.about-btn.is-primary {
  border-color: transparent;
  background: var(--codex-accent, #2563eb);
  color: #fff;
}
.about-btn.is-primary:hover:not(:disabled) {
  background: var(--codex-accent, #2563eb);
  opacity: 0.92;
}
.spin {
  animation: about-spin 0.9s linear infinite;
}
@keyframes about-spin {
  to { transform: rotate(360deg); }
}
</style>
