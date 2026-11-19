<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { Monitor, Sun, Moon } from 'lucide-vue-next'
import SettingsToggle from '../SettingsToggle.vue'
import SettingsSegmented from '../SettingsSegmented.vue'
import ThemePaletteEditor from './ThemePaletteEditor.vue'
import ThemeDiffPreview from './ThemeDiffPreview.vue'
import { useThemeStore } from '../../../stores/theme.store.js'
import type { DockIconStyle, ThemeMode, ThemePreset } from '../../../../shared/types/theme.js'

const { t } = useI18n()
const theme = useThemeStore()

const modeOptions = computed(() => [
  { id: 'system' as ThemeMode, label: t('settings.appearance.modeSystem'), icon: Monitor },
  { id: 'light' as ThemeMode, label: t('settings.appearance.modeLight'), icon: Sun },
  { id: 'dark' as ThemeMode, label: t('settings.appearance.modeDark'), icon: Moon }
])

const dockIcons = computed(() => [
  { id: 'default' as DockIconStyle, label: t('settings.appearance.dockDefault'), className: 'dock-default' },
  { id: 'codex-light' as DockIconStyle, label: t('settings.appearance.dockCodexLight'), className: 'dock-light' },
  { id: 'codex-dark' as DockIconStyle, label: t('settings.appearance.dockCodexDark'), className: 'dock-dark' }
])

const reduceMotionOptions = computed(() => [
  { value: 'system', label: t('settings.appearance.reduceMotionSystem') },
  { value: 'on', label: t('settings.appearance.reduceMotionOn') },
  { value: 'off', label: t('settings.appearance.reduceMotionOff') }
])

const diffMarkerOptions = computed(() => [
  { value: 'color', label: t('settings.appearance.diffMarkersColor') },
  { value: 'plus-minus', label: t('settings.appearance.diffMarkersPlusMinus') }
])

const lightPreview = computed(() => theme.settings.light)
const darkPreview = computed(() => theme.settings.dark)
</script>

<template>
  <div class="settings-panel">
    <h1 class="panel-title">{{ t('settings.appearance.title') }}</h1>

    <section class="settings-section">
      <div class="mode-cards">
        <button
          v-for="option in modeOptions"
          :key="option.id"
          type="button"
          class="mode-card"
          :class="{ 'is-selected': theme.settings.mode === option.id }"
          @click="theme.setMode(option.id)"
        >
          <div class="mode-preview" :class="`mode-preview-${option.id}`">
            <div class="preview-window">
              <div class="preview-sidebar" />
              <div class="preview-main">
                <div class="preview-line" />
                <div class="preview-line short" />
                <div class="preview-line shorter" />
              </div>
            </div>
          </div>
          <div class="mode-card-footer">
            <div class="footer-label">
              <component :is="option.icon" :size="14" :stroke-width="1.75" />
              <span>{{ option.label }}</span>
            </div>
            <span
              class="mode-radio"
              :class="{ 'is-checked': theme.settings.mode === option.id }"
            >
              <span v-if="theme.settings.mode === option.id" class="mode-radio-dot" />
            </span>
          </div>
        </button>
      </div>
    </section>

    <ThemeDiffPreview />

    <ThemePaletteEditor
      :title="t('settings.appearance.lightTheme')"
      variant="light"
      :palette="lightPreview"
      :preset="theme.settings.preset"
      preview-surface="sidebar"
      @update:palette="theme.updatePalette('light', $event)"
      @update:preset="theme.setPreset($event as ThemePreset)"
    />

    <ThemePaletteEditor
      :title="t('settings.appearance.darkTheme')"
      variant="dark"
      :palette="darkPreview"
      :preset="theme.settings.preset"
      preview-surface="sidebar-elevated"
      @update:palette="theme.updatePalette('dark', $event)"
      @update:preset="theme.setPreset($event as ThemePreset)"
    />

    <section class="settings-section">
      <div class="settings-group">
        <div class="settings-row">
          <div class="row-label">{{ t('settings.appearance.usePointerCursor') }}</div>
          <SettingsToggle
            :model-value="theme.settings.usePointerCursor"
            @update:model-value="theme.patch({ usePointerCursor: $event })"
          />
        </div>
        <div class="settings-row">
          <div class="row-label">{{ t('settings.appearance.reduceMotion') }}</div>
          <SettingsSegmented
            :model-value="theme.settings.reduceMotion"
            :options="reduceMotionOptions"
            @update:model-value="theme.patch({ reduceMotion: $event as 'system' | 'on' | 'off' })"
          />
        </div>
        <div class="settings-row">
          <div class="row-label">{{ t('settings.appearance.uiFontSize') }}</div>
          <div class="number-wrap">
            <input
              class="number-input"
              type="number"
              min="11"
              max="20"
              :value="theme.settings.uiFontSize"
              @input="theme.patch({ uiFontSize: Number(($event.target as HTMLInputElement).value) })"
            />
            <span class="number-unit">px</span>
          </div>
        </div>
        <div class="settings-row">
          <div class="row-label">{{ t('settings.appearance.codeFontSize') }}</div>
          <div class="number-wrap">
            <input
              class="number-input"
              type="number"
              min="10"
              max="18"
              :value="theme.settings.codeFontSize"
              @input="theme.patch({ codeFontSize: Number(($event.target as HTMLInputElement).value) })"
            />
            <span class="number-unit">px</span>
          </div>
        </div>
        <div class="settings-row">
          <div class="row-label">{{ t('settings.appearance.diffMarkers') }}</div>
          <SettingsSegmented
            :model-value="theme.settings.diffMarkers"
            :options="diffMarkerOptions"
            @update:model-value="theme.patch({ diffMarkers: $event as 'color' | 'plus-minus' })"
          />
        </div>
        <div class="settings-row">
          <div class="row-label">{{ t('settings.appearance.fontSmoothing') }}</div>
          <SettingsToggle
            :model-value="theme.settings.fontSmoothing"
            @update:model-value="theme.patch({ fontSmoothing: $event })"
          />
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h2 class="section-title">{{ t('settings.appearance.dockIcons') }}</h2>
      <p class="section-desc">{{ t('settings.appearance.dockIconsDesc') }}</p>
      <div class="dock-cards">
        <button
          v-for="icon in dockIcons"
          :key="icon.id"
          type="button"
          class="dock-card"
          :class="{ 'is-selected': theme.settings.dockIcon === icon.id }"
          @click="theme.patch({ dockIcon: icon.id })"
        >
          <div class="dock-icon-preview" :class="icon.className">L</div>
          <div class="dock-card-label">{{ icon.label }}</div>
          <span
            class="mode-radio dock-radio"
            :class="{ 'is-checked': theme.settings.dockIcon === icon.id }"
          >
            <span v-if="theme.settings.dockIcon === icon.id" class="mode-radio-dot" />
          </span>
        </button>
      </div>
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
  @apply mb-8;
}
.section-title {
  @apply text-[15px] font-semibold text-codex-text mb-1;
}
.section-desc {
  @apply text-[13px] text-codex-muted mb-4 leading-relaxed;
}
.mode-cards {
  @apply grid grid-cols-3 gap-3;
}
.mode-card {
  @apply rounded-xl border border-codex-border bg-codex-bg overflow-hidden text-left
         transition-all cursor-pointer hover:border-codex-border-hover;
}
.mode-card.is-selected {
  @apply border-codex-accent;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--codex-accent) 25%, transparent);
}
.mode-preview {
  @apply h-[92px] p-3 flex items-center justify-center border-b border-codex-border;
}
.mode-preview-system {
  background: linear-gradient(90deg, #f3f3f3 50%, #1c1c1e 50%);
}
.mode-preview-light {
  @apply bg-codex-hover;
}
.mode-preview-dark {
  @apply bg-[#1c1c1e];
}
.preview-window {
  @apply w-full h-full flex gap-1.5 rounded-md overflow-hidden border border-black/5;
}
.mode-preview-dark .preview-window {
  @apply border-white/10;
}
.preview-sidebar {
  @apply w-[28%] bg-black/[0.08];
}
.mode-preview-dark .preview-sidebar {
  @apply bg-white/10;
}
.mode-preview-system .preview-window {
  background: linear-gradient(90deg, #ececec 50%, #2c2c2e 50%);
}
.preview-main {
  @apply flex-1 p-1.5 space-y-1.5;
}
.preview-line {
  @apply h-[6px] rounded-full bg-black/10;
}
.mode-preview-dark .preview-line {
  @apply bg-white/20;
}
.preview-line.short {
  @apply w-[70%];
}
.preview-line.shorter {
  @apply w-[45%];
}
.mode-card-footer {
  @apply flex items-center justify-between px-3 py-2.5;
}
.footer-label {
  @apply flex items-center gap-1.5 text-[13px] text-codex-text;
}
.mode-radio {
  @apply w-[18px] h-[18px] rounded-full border-2 border-codex-border-hover
         flex items-center justify-center shrink-0;
}
.mode-radio.is-checked {
  @apply border-codex-accent;
}
.mode-radio-dot {
  @apply w-[8px] h-[8px] rounded-full bg-codex-accent;
}
.settings-group {
  @apply rounded-xl border border-codex-border overflow-hidden bg-codex-bg;
}
.settings-row {
  @apply flex items-center justify-between gap-6 px-4 py-[15px];
}
.settings-row + .settings-row {
  @apply border-t border-codex-border;
}
.row-label {
  @apply text-[14px] text-codex-text;
}
.number-wrap {
  @apply flex items-center gap-1.5 shrink-0;
}
.number-input {
  @apply w-[52px] px-2 py-1.5 text-[13px] text-right rounded-[10px] border border-codex-border
         bg-codex-hover outline-none focus:border-codex-accent tabular-nums text-codex-text;
}
.number-unit {
  @apply text-[12px] text-codex-muted;
}
.dock-cards {
  @apply grid grid-cols-3 gap-3;
}
.dock-card {
  @apply relative rounded-xl border border-codex-border bg-codex-bg p-4 text-center cursor-pointer
         hover:border-codex-border-hover transition-colors;
}
.dock-card.is-selected {
  @apply border-codex-accent;
}
.dock-icon-preview {
  @apply w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center
         text-xl font-bold text-white;
}
.dock-default {
  @apply bg-codex-accent;
}
.dock-light {
  @apply bg-codex-bg text-codex-accent border border-codex-border;
}
.dock-dark {
  @apply bg-[#1a1a1a];
}
.dock-card-label {
  @apply text-[12px] text-codex-text;
}
.dock-radio {
  @apply absolute bottom-3 right-3;
}
</style>
