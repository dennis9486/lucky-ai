<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { ChevronDown, Code2, MessagesSquare } from 'lucide-vue-next'
import SettingsToggle from '../SettingsToggle.vue'
import SettingsSegmented from '../SettingsSegmented.vue'
import { useSettingsStore } from '../../../stores/settings.store.js'
import { useProjectStore } from '../../../stores/project.store.js'
import type { AppLocale } from '../../../../shared/types/locale.js'
import type { ApprovalMode } from '../../../../shared/types/conversation.js'
import type { GeneralAppSettings, EditorSettings } from '../../../../shared/types/ipc.js'
import { normalizeBrowserHomepage } from '../../../../shared/utils/browser-url.js'

const { t } = useI18n()
const settings = useSettingsStore()
const project = useProjectStore()

async function setLocale(value: AppLocale): Promise<void> {
  await settings.setLocale(value)
}

async function setApprovalMode(value: ApprovalMode): Promise<void> {
  await project.setApprovalMode(value)
}

async function setAutoApproveReadOnly(value: boolean): Promise<void> {
  settings.autoApproveReadOnly = value
  await settings.save()
}

async function setProfessionalMode(value: boolean): Promise<void> {
  settings.professionalMode = value
  await settings.save()
}

async function patchGeneral(partial: Partial<GeneralAppSettings>): Promise<void> {
  await settings.patchGeneral(partial)
}

async function patchEditor(partial: Partial<EditorSettings>): Promise<void> {
  await settings.patchEditor(partial)
}

async function setRunSpeed(value: GeneralAppSettings['runSpeed']): Promise<void> {
  const steps = value === 'careful' ? 80 : value === 'balanced' ? 40 : 20
  settings.maxAgentSteps = steps
  await settings.patchGeneral({ runSpeed: value })
}

async function setBrowserHomepage(raw: string): Promise<void> {
  await settings.patchGeneral({
    browserHomepage: normalizeBrowserHomepage(raw, settings.general.browserHomepage)
  })
}
</script>

<template>
  <div class="settings-panel">
    <h1 class="panel-title">{{ t('settings.general.title') }}</h1>

    <section class="settings-section work-mode-section">
      <h2 class="section-title">{{ t('settings.general.workMode') }}</h2>
      <p class="section-desc">{{ t('settings.general.workModeDesc') }}</p>
      <div class="work-mode-grid" role="radiogroup" :aria-label="t('settings.general.workMode')">
        <button
          type="button"
          class="work-mode-card"
          :class="{ active: settings.professionalMode }"
          role="radio"
          :aria-checked="settings.professionalMode"
          @click="setProfessionalMode(true)"
        >
          <Code2 :size="22" class="work-mode-icon" />
          <span class="work-mode-copy">
            <strong>{{ t('settings.general.programming') }}</strong>
            <span>{{ t('settings.general.programmingDesc') }}</span>
          </span>
          <span class="work-mode-radio" aria-hidden="true" />
        </button>
        <button
          type="button"
          class="work-mode-card"
          :class="{ active: !settings.professionalMode }"
          role="radio"
          :aria-checked="!settings.professionalMode"
          @click="setProfessionalMode(false)"
        >
          <MessagesSquare :size="22" class="work-mode-icon" />
          <span class="work-mode-copy">
            <strong>{{ t('settings.general.daily') }}</strong>
            <span>{{ t('settings.general.dailyDesc') }}</span>
          </span>
          <span class="work-mode-radio" aria-hidden="true" />
        </button>
      </div>
    </section>

    <section class="settings-section">
      <h2 class="section-title">{{ t('settings.general.permissions') }}</h2>
      <p class="section-desc">{{ t('settings.general.permissionsHint') }}</p>
      <div class="settings-group">
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('approval.header') }}</div>
            <div class="row-desc">{{ t('settings.general.approvalModeDesc') }}</div>
          </div>
          <div class="select-wrap">
            <div class="select-inner">
              <select
                :value="project.approvalMode"
                class="settings-select"
                @change="setApprovalMode(($event.target as HTMLSelectElement).value as ApprovalMode)"
              >
                <option value="ask">{{ t('approval.ask') }}</option>
                <option value="auto">{{ t('approval.auto') }}</option>
                <option value="full">{{ t('approval.full') }}</option>
              </select>
              <ChevronDown :size="14" class="select-chevron" />
            </div>
          </div>
        </div>
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.general.autoApproveReadOnly') }}</div>
            <div class="row-desc">{{ t('settings.general.autoApproveReadOnlyDesc') }}</div>
          </div>
          <SettingsToggle
            :model-value="settings.autoApproveReadOnly"
            @update:model-value="setAutoApproveReadOnly"
          />
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h2 class="section-title">{{ t('settings.general.generalSection') }}</h2>
      <div class="settings-group">
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.language') }}</div>
            <div class="row-desc">{{ t('settings.languageDesc') }}</div>
          </div>
          <div class="select-wrap">
            <div class="select-inner">
              <select
                :value="settings.locale"
                class="settings-select"
                @change="setLocale(($event.target as HTMLSelectElement).value as AppLocale)"
              >
                <option value="system">{{ t('settings.localeAuto') }}</option>
                <option value="zh-CN">{{ t('settings.localeZh') }}</option>
                <option value="en-US">{{ t('settings.localeEn') }}</option>
              </select>
              <ChevronDown :size="14" class="select-chevron" />
            </div>
          </div>
        </div>
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.general.defaultNoProjectChat') }}</div>
            <div class="row-desc">{{ t('settings.general.defaultNoProjectChatDesc') }}</div>
          </div>
          <SettingsToggle
            :model-value="settings.general.defaultNoProjectChat"
            @update:model-value="patchGeneral({ defaultNoProjectChat: $event })"
          />
        </div>
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.general.showInMenuBar') }}</div>
            <div class="row-desc">{{ t('settings.general.showInMenuBarDesc') }}</div>
          </div>
          <SettingsToggle
            :model-value="settings.general.showInMenuBar"
            @update:model-value="patchGeneral({ showInMenuBar: $event })"
          />
        </div>
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.general.bottomPanel') }}</div>
            <div class="row-desc">{{ t('settings.general.bottomPanelDesc') }}</div>
          </div>
          <SettingsToggle
            :model-value="settings.general.showBottomPanel"
            @update:model-value="patchGeneral({ showBottomPanel: $event })"
          />
        </div>
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.general.browserHomepage') }}</div>
            <div class="row-desc">{{ t('settings.general.browserHomepageDesc') }}</div>
          </div>
          <input
            class="settings-input"
            type="url"
            spellcheck="false"
            :value="settings.general.browserHomepage"
            :placeholder="t('settings.general.browserHomepagePlaceholder')"
            @change="setBrowserHomepage(($event.target as HTMLInputElement).value)"
            @keydown.enter.prevent="setBrowserHomepage(($event.target as HTMLInputElement).value)"
          />
        </div>
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.general.popupShortcut') }}</div>
            <div class="row-desc">{{ t('settings.general.popupShortcutDesc') }}</div>
          </div>
          <SettingsToggle
            :model-value="settings.general.popupShortcutEnabled"
            @update:model-value="patchGeneral({ popupShortcutEnabled: $event })"
          />
        </div>
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.general.preventSleepWhileRunning') }}</div>
            <div class="row-desc">{{ t('settings.general.preventSleepWhileRunningDesc') }}</div>
          </div>
          <SettingsToggle
            :model-value="settings.general.preventSleepWhileRunning"
            @update:model-value="patchGeneral({ preventSleepWhileRunning: $event })"
          />
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h2 class="section-title">{{ t('settings.general.editorSection') }}</h2>
      <div class="settings-group">
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.general.defaultEditor') }}</div>
            <div class="row-desc">{{ t('settings.general.defaultEditorDesc') }}</div>
          </div>
          <SettingsSegmented
            :model-value="settings.editor.fileOpenTarget"
            :options="[
              { value: 'builtin', label: t('settings.general.builtinEditor') },
              { value: 'vscode', label: t('settings.general.vscode') }
            ]"
            @update:model-value="patchEditor({ fileOpenTarget: $event as EditorSettings['fileOpenTarget'] })"
          />
        </div>
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.general.sendShortcut') }}</div>
            <div class="row-desc">{{ t('settings.general.sendShortcutDesc') }}</div>
          </div>
          <SettingsSegmented
            :model-value="settings.general.sendShortcut"
            :options="[
              { value: 'enter', label: 'Enter' },
              { value: 'mod-enter', label: '⌘ Enter' }
            ]"
            @update:model-value="patchGeneral({ sendShortcut: $event as GeneralAppSettings['sendShortcut'] })"
          />
        </div>
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.general.followupBehavior') }}</div>
            <div class="row-desc">{{ t('settings.general.followupBehaviorDesc') }}</div>
          </div>
          <SettingsSegmented
            :model-value="settings.general.followupBehavior"
            :options="[
              { value: 'queue', label: t('settings.general.followupQueue') },
              { value: 'quote', label: t('settings.general.followupQuote') }
            ]"
            @update:model-value="patchGeneral({ followupBehavior: $event as GeneralAppSettings['followupBehavior'] })"
          />
        </div>
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.general.codeReview') }}</div>
            <div class="row-desc">{{ t('settings.general.codeReviewDesc') }}</div>
          </div>
          <SettingsSegmented
            :model-value="settings.general.codeReviewView"
            :options="[
              { value: 'inline', label: t('settings.general.reviewInline') },
              { value: 'separate', label: t('settings.general.reviewSeparate') }
            ]"
            @update:model-value="patchGeneral({ codeReviewView: $event as GeneralAppSettings['codeReviewView'] })"
          />
        </div>
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.general.defaultTerminalLocation') }}</div>
            <div class="row-desc">{{ t('settings.general.defaultTerminalLocationDesc') }}</div>
          </div>
          <SettingsSegmented
            :model-value="settings.general.defaultTerminalLocation"
            :options="[
              { value: 'bottom', label: t('settings.general.terminalBottom') },
              { value: 'right', label: t('settings.general.terminalRight') }
            ]"
            @update:model-value="patchGeneral({ defaultTerminalLocation: $event as GeneralAppSettings['defaultTerminalLocation'] })"
          />
        </div>
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.general.runSpeed') }}</div>
            <div class="row-desc">{{ t('settings.general.runSpeedDesc', { steps: settings.maxAgentSteps }) }}</div>
          </div>
          <SettingsSegmented
            :model-value="settings.general.runSpeed"
            :options="[
              { value: 'fast', label: t('settings.general.speedFast') },
              { value: 'balanced', label: t('settings.general.speedBalanced') },
              { value: 'careful', label: t('settings.general.speedCareful') }
            ]"
            @update:model-value="setRunSpeed($event as GeneralAppSettings['runSpeed'])"
          />
        </div>
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
  @apply mb-10;
}
.work-mode-section {
  @apply mb-9;
}
.section-title {
  @apply text-[15px] font-semibold text-codex-text mb-1;
}
.section-desc {
  @apply text-[13px] text-codex-muted mb-4 leading-relaxed;
}
.work-mode-grid {
  @apply grid grid-cols-2 gap-3;
}
.work-mode-card {
  @apply flex min-h-[74px] items-center gap-4 rounded-lg border border-codex-border bg-codex-bg
         px-5 py-4 text-left outline-none transition-colors;
}
.work-mode-card:hover {
  @apply bg-codex-hover;
}
.work-mode-card:focus-visible {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--codex-accent) 34%, transparent);
}
.work-mode-card.active {
  @apply border-transparent bg-codex-hover;
}
.work-mode-icon {
  @apply shrink-0 text-codex-text;
}
.work-mode-copy {
  @apply flex min-w-0 flex-1 flex-col gap-1;
}
.work-mode-copy strong {
  @apply text-[14px] font-semibold text-codex-text;
}
.work-mode-copy span {
  @apply text-[12px] font-medium leading-relaxed text-codex-text-secondary;
}
.work-mode-radio {
  @apply relative h-[18px] w-[18px] shrink-0 rounded-full border-2 border-codex-border bg-codex-bg;
}
.work-mode-card.active .work-mode-radio {
  border-color: var(--codex-accent);
  background: var(--codex-accent);
}
.work-mode-card.active .work-mode-radio::after {
  content: '';
  @apply absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white;
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
.settings-row.row-compact {
  @apply py-3.5;
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
.row-link {
  @apply text-codex-accent hover:underline;
}
.select-wrap {
  @apply shrink-0;
}
.select-inner {
  @apply relative flex items-center;
}
.settings-select {
  @apply appearance-none pl-3 pr-8 py-2 text-[13px] text-codex-text min-w-[148px]
         bg-codex-hover border border-codex-border rounded-[10px] cursor-pointer outline-none;
}
.settings-select:focus {
  border-color: var(--codex-accent);
}
.settings-input {
  @apply min-w-[260px] max-w-[360px] rounded-[10px] border border-codex-border bg-codex-hover
         px-3 py-2 text-[13px] text-codex-text outline-none placeholder:text-codex-muted;
}
.settings-input:focus {
  border-color: var(--codex-accent);
  background: var(--codex-bg);
}
.select-chevron {
  @apply absolute right-2.5 top-1/2 -translate-y-1/2 text-codex-muted pointer-events-none;
}
@media (max-width: 860px) {
  .work-mode-grid {
    @apply grid-cols-1;
  }
  .settings-input {
    @apply w-full min-w-0 max-w-none;
  }
}
</style>
