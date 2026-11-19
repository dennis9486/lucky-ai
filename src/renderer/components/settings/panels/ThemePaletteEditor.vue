<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown } from 'lucide-vue-next'
import SettingsToggle from '../SettingsToggle.vue'
import SettingsColorField from '../SettingsColorField.vue'
import {
  THEME_PRESETS,
  type ThemePalette,
  type ThemePreset
} from '../../../../shared/types/theme.js'
import { themePreviewJson } from '../../../utils/theme-apply.js'
import { useThemeStore } from '../../../stores/theme.store.js'
import { useUiStore } from '../../../stores/ui.store.js'

const { t } = useI18n()

const props = defineProps<{
  title: string
  palette: ThemePalette
  preset: ThemePreset
  previewSurface: string
  variant: 'light' | 'dark'
}>()

const emit = defineEmits<{
  'update:palette': [value: ThemePalette]
  'update:preset': [value: ThemePreset]
}>()

const theme = useThemeStore()
const ui = useUiStore()

function patch(partial: Partial<ThemePalette>): void {
  emit('update:palette', { ...props.palette, ...partial })
}

const previewCode = computed(() => themePreviewJson(props.palette, props.previewSurface))

async function copyTheme(): Promise<void> {
  await navigator.clipboard.writeText(JSON.stringify(props.palette, null, 2))
}

async function importTheme(): Promise<void> {
  const raw = await ui.prompt(t('themeEditor.pastePrompt'), {
    title: t('themeEditor.import'),
    placeholder: '{\n  "accent": "#0a84ff"\n}'
  })
  if (!raw) return
  try {
    const parsed = JSON.parse(raw) as ThemePalette
    emit('update:palette', { ...props.palette, ...parsed })
  } catch {
    void ui.alert(t('themeEditor.parseError'), t('themeEditor.import'))
  }
}
</script>

<template>
  <section class="palette-section">
    <div class="palette-header">
      <h2 class="palette-title">{{ title }}</h2>
      <div class="palette-actions">
        <button type="button" class="action-btn" @click="importTheme">{{ t('themeEditor.import') }}</button>
        <button type="button" class="action-btn" @click="copyTheme">{{ t('themeEditor.copy') }}</button>
        <div class="preset-wrap">
          <select
            :value="preset"
            class="preset-select"
            @change="emit('update:preset', ($event.target as HTMLSelectElement).value as ThemePreset)"
          >
            <option value="codex">{{ t('themeEditor.presetCodex') }}</option>
            <option value="default">{{ t('themeEditor.presetDefault') }}</option>
          </select>
          <ChevronDown :size="14" class="preset-chevron" />
        </div>
      </div>
    </div>

    <pre class="preview-code" :class="`preview-${variant}`">{{ previewCode }}</pre>

    <div class="settings-group">
      <div class="settings-row">
        <div class="row-label">{{ t('themeEditor.accent') }}</div>
        <SettingsColorField
          :model-value="palette.accent"
          :fallback="THEME_PRESETS.codex.light.accent"
          @update:model-value="patch({ accent: $event })"
        />
      </div>
      <div class="settings-row">
        <div class="row-label">{{ t('themeEditor.background') }}</div>
        <SettingsColorField
          :model-value="palette.background"
          fallback="#ffffff"
          @update:model-value="patch({ background: $event })"
        />
      </div>
      <div class="settings-row">
        <div class="row-label">{{ t('themeEditor.foreground') }}</div>
        <SettingsColorField
          :model-value="palette.foreground"
          fallback="#1a1a1a"
          @update:model-value="patch({ foreground: $event })"
        />
      </div>
      <div class="settings-row">
        <div class="row-label">{{ t('themeEditor.uiFont') }}</div>
        <input
          class="font-input"
          :value="theme.settings.uiFont"
          @input="theme.patch({ uiFont: ($event.target as HTMLInputElement).value })"
        />
      </div>
      <div class="settings-row">
        <div class="row-label">{{ t('themeEditor.codeFont') }}</div>
        <input
          class="font-input"
          :value="theme.settings.codeFont"
          @input="theme.patch({ codeFont: ($event.target as HTMLInputElement).value })"
        />
      </div>
      <div class="settings-row">
        <div class="row-label">{{ t('themeEditor.translucentSidebar') }}</div>
        <SettingsToggle
          :model-value="palette.translucentSidebar"
          @update:model-value="patch({ translucentSidebar: $event })"
        />
      </div>
      <div class="settings-row">
        <div class="row-label">{{ t('themeEditor.contrast') }}</div>
        <div class="contrast-control">
          <input
            class="contrast-slider"
            type="range"
            min="0"
            max="100"
            :value="palette.contrast"
            @input="patch({ contrast: Number(($event.target as HTMLInputElement).value) })"
          />
          <span class="contrast-value">{{ palette.contrast }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.palette-section {
  @apply mb-10;
}
.palette-header {
  @apply flex items-center justify-between gap-4 mb-3;
}
.palette-title {
  @apply text-[15px] font-semibold text-codex-text;
}
.palette-actions {
  @apply flex items-center gap-2 shrink-0;
}
.action-btn {
  @apply px-3 py-1.5 text-[12px] rounded-lg border border-codex-border bg-codex-bg
         text-codex-text-secondary hover:bg-codex-hover transition-colors;
}
.preset-wrap {
  @apply relative;
}
.preset-select {
  @apply appearance-none pl-3 pr-8 py-1.5 text-[12px] rounded-lg border border-codex-border
         bg-codex-bg text-codex-text outline-none cursor-pointer min-w-[96px];
}
.preset-chevron {
  @apply absolute right-2.5 top-1/2 -translate-y-1/2 text-codex-muted pointer-events-none;
}
.preview-code {
  @apply mb-3 p-4 rounded-xl border border-codex-border text-[11px] leading-relaxed
         font-mono overflow-x-auto text-codex-text-secondary;
}
.preview-light {
  background: color-mix(in srgb, var(--codex-accent) 8%, var(--codex-bg));
}
.preview-dark {
  background: color-mix(in srgb, var(--codex-muted) 12%, var(--codex-bg));
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
  @apply text-[14px] text-codex-text shrink-0 min-w-[88px];
}
.font-input {
  @apply w-full max-w-[340px] px-3 py-2 text-[12px] rounded-[10px] border border-codex-border
         bg-codex-hover outline-none focus:border-codex-accent text-right text-codex-text;
}
.contrast-control {
  @apply flex items-center gap-3 shrink-0;
}
.contrast-slider {
  @apply w-[140px] h-1 rounded-full appearance-none cursor-pointer;
  background: linear-gradient(to right, var(--codex-accent) 0%, var(--codex-border) 100%);
}
.contrast-slider::-webkit-slider-thumb {
  @apply appearance-none w-4 h-4 rounded-full bg-codex-bg border-2 border-codex-accent shadow-sm;
}
.contrast-value {
  @apply text-[13px] text-codex-muted tabular-nums w-6 text-right;
}
</style>
