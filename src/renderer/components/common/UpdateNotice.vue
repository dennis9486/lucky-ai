<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowDownToLine, RefreshCw, RotateCw, X } from 'lucide-vue-next'
import { useUpdaterStore } from '../../stores/updater.store.js'

const { t } = useI18n()
const updater = useUpdaterStore()

const version = computed(() => updater.state.version ?? '')
</script>

<template>
  <Transition name="update-notice">
    <div v-if="updater.showBanner" class="update-notice" role="status">
      <div class="update-icon" :class="{ spin: updater.phase === 'downloading' }">
        <RotateCw v-if="updater.isDownloaded" :size="16" :stroke-width="2" />
        <RefreshCw v-else-if="updater.phase === 'downloading'" :size="16" :stroke-width="2" />
        <ArrowDownToLine v-else :size="16" :stroke-width="2" />
      </div>

      <div class="update-body">
        <div class="update-title">
          <template v-if="updater.isDownloaded">{{ t('updater.readyTitle') }}</template>
          <template v-else-if="updater.phase === 'downloading'">{{ t('updater.downloading') }}</template>
          <template v-else>{{ t('updater.newVersion', { version }) }}</template>
        </div>
        <div v-if="updater.isDownloaded" class="update-desc">{{ t('updater.readyDesc', { version }) }}</div>
        <div v-else-if="updater.phase === 'downloading'" class="update-progress">
          <div class="update-progress-track">
            <div class="update-progress-bar" :style="{ width: `${updater.progressPercent}%` }" />
          </div>
          <span class="update-progress-text">{{ updater.progressPercent }}%</span>
        </div>
      </div>

      <div class="update-actions">
        <button
          v-if="updater.isDownloaded"
          type="button"
          class="update-btn is-primary"
          @click="updater.install()"
        >
          {{ t('updater.restartNow') }}
        </button>
        <button
          v-else-if="updater.phase === 'available' && !updater.state.autoDownload"
          type="button"
          class="update-btn is-primary"
          @click="updater.download()"
        >
          {{ t('updater.download') }}
        </button>
        <button
          type="button"
          class="update-close"
          :aria-label="t('updater.later')"
          @click="updater.dismiss()"
        >
          <X :size="15" />
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.update-notice {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 200;
  display: flex;
  align-items: flex-start;
  gap: 11px;
  width: 340px;
  max-width: calc(100vw - 36px);
  padding: 13px 14px;
  border: 1px solid var(--codex-border, #e3e3e3);
  border-radius: 14px;
  background: var(--codex-bg, #fff);
  box-shadow: 0 16px 44px rgba(0, 0, 0, 0.16);
  color: var(--codex-text, #1a1a1a);
}
.update-icon {
  display: flex;
  height: 28px;
  width: 28px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  background: color-mix(in srgb, var(--codex-accent, #2563eb) 14%, var(--codex-hover, #f0f0f0));
  color: var(--codex-accent, #2563eb);
}
.update-icon.spin :deep(svg) {
  animation: update-spin 1s linear infinite;
}
.update-body {
  min-width: 0;
  flex: 1;
}
.update-title {
  font-size: 13px;
  font-weight: 650;
  line-height: 1.35;
}
.update-desc {
  margin-top: 2px;
  color: var(--codex-muted, #8a8a8a);
  font-size: 12px;
  line-height: 1.45;
}
.update-progress {
  margin-top: 7px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.update-progress-track {
  flex: 1;
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--codex-hover, #f0f0f0);
}
.update-progress-bar {
  height: 100%;
  border-radius: 999px;
  background: var(--codex-accent, #2563eb);
  transition: width 0.2s ease;
}
.update-progress-text {
  flex-shrink: 0;
  color: var(--codex-muted, #8a8a8a);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.update-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
}
.update-btn {
  border-radius: 8px;
  padding: 5px 10px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  transition: opacity 0.12s ease;
}
.update-btn.is-primary {
  background: var(--codex-accent, #2563eb);
  color: #fff;
}
.update-btn.is-primary:hover {
  opacity: 0.9;
}
.update-close {
  display: inline-flex;
  height: 24px;
  width: 24px;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  color: var(--codex-muted, #8a8a8a);
  transition: background 0.12s ease, color 0.12s ease;
}
.update-close:hover {
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-text, #1a1a1a);
}
.update-notice-enter-active,
.update-notice-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
}
.update-notice-enter-from,
.update-notice-leave-to {
  opacity: 0;
  transform: translateY(8px);
}
@keyframes update-spin {
  to { transform: rotate(360deg); }
}
</style>
