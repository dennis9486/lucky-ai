<script setup lang="ts">
/* global File */
import { computed, onMounted, ref, nextTick, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import {
  Archive,
  Bug,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Infinity as InfinityIcon,
  ListChecks,
  MessageSquare,
  Pencil,
  Pin,
  Plus,
  Settings,
  Sparkles,
  Square,
  ArrowUp,
  X
} from 'lucide-vue-next'
import type { SavedAttachment } from '../../../shared/types/ipc.js'
import { createLogger } from '../../../shared/utils/log.js'
import AgentExecutionReport from './agent-report/AgentExecutionReport.vue'
import CodeAgentUserTurn from './CodeAgentUserTurn.vue'
import CodeAgentComposerInput, { type ComposerReference } from './CodeAgentComposerInput.vue'
import CodeAgentContextRow from './CodeAgentContextRow.vue'
import CodeAgentChangedFiles from './CodeAgentChangedFiles.vue'
import CodeAgentHistoryPopover from './CodeAgentHistoryPopover.vue'
import CodeAgentQueuedTurns from './CodeAgentQueuedTurns.vue'
import CodeAgentModelMenu from './CodeAgentModelMenu.vue'
import { describeTool } from '../../utils/tool-display.js'
import { ipc, unwrap } from '../../services/ipc-client.js'
import { useCodeAgentStore, type CodeAgentMode, type CodeAgentTurn } from '../../stores/code-agent.store.js'
import type { CodeAgentPlanOption } from '../../../shared/types/code-agent.js'
import { useSettingsStore } from '../../stores/settings.store.js'
import { useUiStore } from '../../stores/ui.store.js'
import { useProjectStore } from '../../stores/project.store.js'

/**
 * Code Agent 侧板骨架：会话标签 + 轮次输出 + 底部 composer。
 * 大块 UI 拆在同目录子组件：变更审查 CodeAgentChangedFiles、
 * 历史 CodeAgentHistoryPopover、排队消息 CodeAgentQueuedTurns、模型菜单 CodeAgentModelMenu。
 */
const { t } = useI18n()
const agent = useCodeAgentStore()
const settings = useSettingsStore()
const ui = useUiStore()
const project = useProjectStore()
const logger = createLogger('renderer/code-agent-panel')
const showModeMenu = ref(false)
const showModelMenu = ref(false)
const modeMenuAnchorRef = ref<HTMLElement | null>(null)
const modelMenuAnchorRef = ref<HTMLElement | null>(null)
const showHistory = ref(false)
const contextMenu = ref<{ x: number; y: number; sessionId: string } | null>(null)
const renameDraft = ref<{ sessionId: string; title: string } | null>(null)
const composerInputRef = ref<InstanceType<typeof CodeAgentComposerInput> | null>(null)
const agentBodyRef = ref<HTMLElement | null>(null)

const modeItems: Array<{ value: CodeAgentMode; icon: unknown; labelKey: string }> = [
  { value: 'agent', icon: InfinityIcon, labelKey: 'codeAgent.modeAgent' },
  { value: 'plan', icon: ListChecks, labelKey: 'codeAgent.modePlan' },
  { value: 'debug', icon: Bug, labelKey: 'codeAgent.modeDebug' },
  { value: 'multitask', icon: Sparkles, labelKey: 'codeAgent.modeMultitask' },
  { value: 'ask', icon: MessageSquare, labelKey: 'codeAgent.modeAsk' }
]

const currentMode = computed(() => modeItems.find((item) => item.value === agent.mode) ?? modeItems[0]!)

const activeModelLabel = computed(() => {
  const provider = settings.providers.find((item) => item.id === settings.activeProviderId)
  if (!provider) return t('codeAgent.noModel')
  const model =
    provider.models?.find((item) => item.id === provider.activeModelId && item.enabled)
    ?? provider.models?.find((item) => item.enabled)
  return model?.name ?? provider.model
})

const confirmTools = computed(() =>
  agent.pendingConfirm?.toolCalls.map((toolCall) => {
    const d = describeTool({
      type: 'tool',
      id: toolCall.id,
      name: toolCall.name,
      input: toolCall.input,
      output: '',
      status: 'pending'
    })
    return {
      id: toolCall.id,
      label: [d.verb, d.target].filter(Boolean).join(' ') || toolCall.name
    }
  }) ?? []
)

const panelStyle = computed(() => ({ width: `${ui.codeAgentWidth}px` }))
const composerPlaceholder = computed(() =>
  agent.isRunning ? t('codeAgent.followUpPlaceholder') : t('codeAgent.placeholder')
)
const currentContextSession = computed(() =>
  contextMenu.value ? agent.sessions.find((session) => session.id === contextMenu.value?.sessionId) : null
)

function closeComposerMenus(): void {
  showModeMenu.value = false
  showModelMenu.value = false
}

function toggleModeMenu(): void {
  if (showModeMenu.value) {
    showModeMenu.value = false
    return
  }
  showModelMenu.value = false
  showModeMenu.value = true
}

function toggleModelMenu(): void {
  if (showModelMenu.value) {
    closeComposerMenus()
    return
  }
  showModeMenu.value = false
  showModelMenu.value = true
}

onClickOutside(modeMenuAnchorRef, () => {
  showModeMenu.value = false
})

onClickOutside(modelMenuAnchorRef, () => {
  if (!showModelMenu.value) return
  closeComposerMenus()
})

function selectMode(mode: CodeAgentMode): void {
  agent.mode = mode
  showModeMenu.value = false
}

function openContextMenu(event: MouseEvent, sessionId: string): void {
  event.preventDefault()
  const menuWidth = 230
  const menuHeight = 360
  const padding = 8
  contextMenu.value = {
    x: Math.max(padding, Math.min(event.clientX, window.innerWidth - menuWidth - padding)),
    y: Math.max(padding, Math.min(event.clientY, window.innerHeight - menuHeight - padding)),
    sessionId
  }
}

function closeContextMenu(): void {
  contextMenu.value = null
}

function startRename(sessionId: string): void {
  const session = agent.sessions.find((item) => item.id === sessionId)
  if (!session) return
  renameDraft.value = { sessionId, title: session.title }
  closeContextMenu()
}

function submitRename(): void {
  if (!renameDraft.value) return
  agent.renameSession(renameDraft.value.sessionId, renameDraft.value.title)
  renameDraft.value = null
}

function beginResize(event: PointerEvent): void {
  event.preventDefault()
  const startX = event.clientX
  const startWidth = ui.codeAgentWidth
  const onMove = (move: PointerEvent) => {
    ui.setCodeAgentWidth(startWidth + startX - move.clientX)
  }
  const onUp = () => {
    document.removeEventListener('pointermove', onMove)
    document.removeEventListener('pointerup', onUp)
    document.body.classList.remove('is-resizing-code-agent')
  }
  document.body.classList.add('is-resizing-code-agent')
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onUp, { once: true })
}

function onSubmit(): void {
  handlePrimaryAction()
}

function handlePrimaryAction(): void {
  if (agent.isRunning) {
    if (agent.input.trim() || agent.attachments.length > 0) {
      void agent.send()
      return
    }
    agent.stop()
    return
  }
  if (!agent.input.trim() && agent.attachments.length === 0) return
  void agent.send()
}

function onEscape(): void {
  if (showModeMenu.value || showModelMenu.value) {
    closeComposerMenus()
    return
  }
  if (!agent.editingTurnId) return
  agent.cancelEditTurn()
  void nextTick(() => composerInputRef.value?.focus())
}

function handleEditTurn(turnId: string): void {
  agent.beginEditTurn(turnId)
  void nextTick(() => composerInputRef.value?.focus())
}

async function handleRollbackTurn(turnId: string): Promise<void> {
  await agent.rollbackToTurn(turnId)
}

async function handleRevertTurnFiles(turnId: string): Promise<void> {
  await agent.revertTurnFiles(turnId)
}

function onReferencesChange(refs: ComposerReference[]): void {
  agent.setFileReferences(refs)
}

async function addPastedImages(files: File[]): Promise<void> {
  if (!files.length) return
  try {
    const attachments = await Promise.all(
      files.map(async (file) => {
        const saved = await unwrap<SavedAttachment>(ipc.app.savePastedImage({
          data: await file.arrayBuffer(),
          mimeType: file.type || 'image/png',
          name: file.name || 'pasted-image'
        }))
        return {
          ...saved,
          previewUrl: URL.createObjectURL(file)
        }
      })
    )
    agent.addAttachments(attachments)
  } catch (error) {
    logger.error('paste image failed', { error, fileCount: files.length })
  }
}

function turnHasOutput(turn: CodeAgentTurn): boolean {
  return turn.parts.some((part) =>
    part.type === 'tool'
      || (part.type === 'text' && part.text.trim())
      || (part.type === 'thinking' && part.text.trim())
  )
}

function canContinueTurn(turn: CodeAgentTurn, index: number): boolean {
  return Boolean(turn.incomplete && !agent.isRunning && index === agent.turns.length - 1 && !turn.runSummary)
}

function riskLabel(option: CodeAgentPlanOption): string {
  const key = option.estimatedRisk === 'high'
    ? 'codeAgent.planRiskHigh'
    : option.estimatedRisk === 'low'
      ? 'codeAgent.planRiskLow'
      : 'codeAgent.planRiskMedium'
  return t(key)
}

function scrollAgentBodyToBottom(): void {
  const el = agentBodyRef.value
  if (!el) return
  el.scrollTop = el.scrollHeight
}

async function scrollAgentBodyToBottomWhenReady(): Promise<void> {
  await nextTick()
  scrollAgentBodyToBottom()
  requestAnimationFrame(scrollAgentBodyToBottom)
}

onMounted(() => {
  void scrollAgentBodyToBottomWhenReady()
})

watch(
  () => agent.activeSessionId,
  () => { void scrollAgentBodyToBottomWhenReady() },
  { flush: 'post' }
)

watch(
  () => agent.turns,
  () => { void scrollAgentBodyToBottomWhenReady() },
  { deep: true, flush: 'post' }
)

watch(
  () => agent.isRunning,
  () => { void scrollAgentBodyToBottomWhenReady() },
  { flush: 'post' }
)
</script>

<template>
  <aside class="code-agent" :style="panelStyle" @click="() => { closeContextMenu(); closeComposerMenus() }">
    <div class="resize-handle" @pointerdown="beginResize" />

    <header class="agent-tabs">
      <div class="agent-tab-strip">
        <div
          v-for="session in agent.visibleSessions"
          :key="session.id"
          class="agent-tab"
          role="button"
          tabindex="0"
          :class="{ 'is-active': session.id === agent.activeSessionId }"
          @click="agent.switchSession(session.id)"
          @keydown.enter.prevent="agent.switchSession(session.id)"
          @keydown.space.prevent="agent.switchSession(session.id)"
          @contextmenu="openContextMenu($event, session.id)"
        >
          <MessageSquare :size="15" />
          <span>{{ session.title }}</span>
          <span v-if="session.pinned" class="pin-mark"><Pin :size="11" /></span>
          <button type="button" class="tab-close" @click.stop="agent.closeSession(session.id)">
            <X :size="15" />
          </button>
        </div>
      </div>

      <button type="button" class="tab-action" :title="t('codeAgent.newAgent')" @click="agent.newSession">
        <Plus :size="17" />
      </button>

      <div class="history-anchor">
        <button
          type="button"
          class="tab-action"
          :class="{ active: showHistory }"
          :title="t('codeAgent.history')"
          @click.stop="showHistory = !showHistory"
        >
          <Clock :size="17" />
        </button>

        <CodeAgentHistoryPopover
          v-if="showHistory"
          @close="showHistory = false"
          @context-menu="openContextMenu"
        />
      </div>
    </header>

    <main ref="agentBodyRef" class="agent-body pretty-scrollbar">
      <template v-if="agent.turns.length">
        <div v-for="(turn, index) in agent.turns" :key="turn.id" class="agent-turn">
          <CodeAgentUserTurn
            v-if="turn.userText && !turnHasOutput(turn)"
            :text="turn.userText"
            :is-editing="agent.editingTurnId === turn.id"
            :disabled="agent.isRunning"
            @edit="handleEditTurn(turn.id)"
            @rollback="handleRollbackTurn(turn.id)"
          />
          <div v-if="turnHasOutput(turn)" class="agent-output">
            <AgentExecutionReport
              :parts="turn.parts"
              :task="turn.userText"
              :is-editing="agent.editingTurnId === turn.id"
              :disabled="agent.isRunning"
              :live="agent.isRunning && index === agent.turns.length - 1"
              :workspace-root="project.activeProject?.rootPath"
              :revert-enabled="Boolean(turn.agentSessionId)"
              @edit-task="handleEditTurn(turn.id)"
              @rollback-task="handleRollbackTurn(turn.id)"
              @revert-files="handleRevertTurnFiles(turn.id)"
            />
          </div>
          <div v-if="canContinueTurn(turn, index)" class="incomplete-banner">
            <span>{{ t('chat.incompleteLabel') }}</span>
            <button type="button" class="continue-btn" @click="agent.continueTurn(turn.id)">
              {{ t('common.continue') }}
            </button>
          </div>
        </div>
      </template>

      <div v-else class="agent-empty-hint">{{ t('codeAgent.emptyHint') }}</div>
    </main>

    <footer class="agent-composer-wrap">
      <div v-if="agent.showPendingConfirm" class="tool-confirm">
        <div class="confirm-title">{{ t('codeAgent.confirmTitle', { count: confirmTools.length }) }}</div>
        <div class="confirm-list">
          <div v-for="tool in confirmTools" :key="tool.id" class="confirm-row">{{ tool.label }}</div>
        </div>
        <div class="confirm-actions">
          <button type="button" class="ghost-btn" @click="agent.confirmTools(false)">
            {{ t('codeAgent.reject') }}
          </button>
          <button type="button" class="primary-btn" @click="agent.confirmTools(true)">
            {{ t('codeAgent.approve') }}
          </button>
        </div>
      </div>

      <CodeAgentQueuedTurns />

      <CodeAgentChangedFiles />

      <div v-if="agent.editingTurnId" class="composer-edit-bar">
        <span>{{ t('codeAgent.editingMessage') }}</span>
        <button type="button" class="composer-edit-cancel" :title="t('common.cancel')" @click="agent.cancelEditTurn()">
          <X :size="14" />
        </button>
      </div>

      <div v-if="agent.activePlan" class="plan-choice-card">
        <div class="plan-choice-head">
          <div>
            <div class="plan-choice-title">{{ t('codeAgent.planChoicesTitle') }}</div>
            <div class="plan-choice-desc">{{ t('codeAgent.planChoicesDesc') }}</div>
          </div>
          <button type="button" class="plan-dismiss-btn" @click="agent.dismissActivePlan">
            {{ t('codeAgent.dismissPlan') }}
          </button>
        </div>
        <div class="plan-option-list">
          <button
            v-for="option in agent.activePlan.options"
            :key="option.id"
            type="button"
            class="plan-option"
            :disabled="agent.isRunning"
            @click="agent.executePlan(option.id)"
          >
            <span class="plan-option-label">{{ option.label }}</span>
            <span class="plan-option-main">
              <span class="plan-option-title">{{ option.title }}</span>
              <span class="plan-option-summary">{{ option.summary }}</span>
            </span>
            <span class="plan-option-risk">{{ riskLabel(option) }}</span>
            <ChevronRight :size="14" />
          </button>
        </div>
      </div>

      <div class="agent-composer composer-surface" :class="{ 'is-editing': agent.editingTurnId }">
        <CodeAgentContextRow />
        <div class="composer-input-wrap">
          <CodeAgentComposerInput
            ref="composerInputRef"
            v-model="agent.input"
            :placeholder="composerPlaceholder"
            @references-change="onReferencesChange"
            @images="addPastedImages"
            @submit="onSubmit"
            @escape="onEscape"
          />
        </div>

        <div class="composer-bottom">
          <div class="composer-left">
            <div ref="modeMenuAnchorRef" class="menu-anchor">
              <button type="button" class="pill-btn" @click.stop="toggleModeMenu">
                <component :is="currentMode.icon" :size="13" />
                <span>{{ t(currentMode.labelKey) }}</span>
                <ChevronDown :size="11" />
              </button>
              <div v-if="showModeMenu" class="mode-menu" @click.stop>
                <button
                  v-for="item in modeItems"
                  :key="item.value"
                  type="button"
                  class="menu-row"
                  :class="{ selected: item.value === agent.mode }"
                  @click="selectMode(item.value)"
                >
                  <component :is="item.icon" :size="16" />
                  <span>{{ t(item.labelKey) }}</span>
                  <Check v-if="item.value === agent.mode" :size="14" class="row-check" />
                </button>
              </div>
            </div>

            <div ref="modelMenuAnchorRef" class="menu-anchor">
              <button type="button" class="model-btn" @click.stop="toggleModelMenu">
                <span>{{ activeModelLabel }}</span>
                <ChevronDown :size="11" />
              </button>
              <CodeAgentModelMenu
                v-if="showModelMenu"
                :anchor-el="modelMenuAnchorRef"
                @close="closeComposerMenus"
              />
            </div>
          </div>

          <div class="composer-actions">
            <button
              type="button"
              class="send-btn composer-send-btn"
              :class="{ 'is-ready': agent.isRunning || Boolean(agent.input.trim()) || agent.attachments.length > 0 }"
              :disabled="!agent.isRunning && !agent.input.trim() && agent.attachments.length === 0"
              :title="agent.isRunning && (agent.input.trim() || agent.attachments.length > 0) ? t('codeAgent.queueFollowUp') : agent.isRunning ? t('codeAgent.stop') : t('codeAgent.send')"
              @click="handlePrimaryAction"
            >
              <ArrowUp v-if="agent.isRunning && (agent.input.trim() || agent.attachments.length > 0)" :size="14" stroke-width="2.5" />
              <Square v-else-if="agent.isRunning" :size="12" stroke-width="0" fill="currentColor" />
              <ArrowUp v-else :size="14" stroke-width="2.5" />
            </button>
          </div>
        </div>
      </div>
    </footer>

    <div
      v-if="contextMenu && currentContextSession"
      class="tab-context-menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @click.stop
    >
      <button type="button" @click="startRename(currentContextSession.id)">
        <Pencil :size="15" />
        <span>{{ t('codeAgent.rename') }}</span>
      </button>
      <button type="button" @click="agent.togglePin(currentContextSession.id); closeContextMenu()">
        <Pin :size="15" />
        <span>{{ currentContextSession.pinned ? t('codeAgent.unpin') : t('codeAgent.pin') }}</span>
      </button>
      <button type="button" @click="agent.archiveSession(currentContextSession.id); closeContextMenu()">
        <Archive :size="15" />
        <span>{{ t('codeAgent.archive') }}</span>
      </button>
      <div class="menu-separator" />
      <button type="button" @click="agent.closeSession(currentContextSession.id); closeContextMenu()">
        <X :size="15" />
        <span>{{ t('codeAgent.close') }}</span>
      </button>
      <button type="button" @click="agent.closeOtherSessions(currentContextSession.id); closeContextMenu()">
        <span>{{ t('codeAgent.closeOthers') }}</span>
      </button>
      <button type="button" @click="agent.closeSessionsToRight(currentContextSession.id); closeContextMenu()">
        <span>{{ t('codeAgent.closeToRight') }}</span>
      </button>
      <div class="menu-separator" />
      <button type="button" @click="settings.showSettings = true; closeContextMenu()">
        <Settings :size="15" />
        <span>{{ t('codeAgent.agentSettings') }}</span>
      </button>
    </div>

    <div v-if="renameDraft" class="rename-backdrop" @click.self="renameDraft = null">
      <form class="rename-dialog" @submit.prevent="submitRename">
        <div class="rename-title">{{ t('codeAgent.rename') }}</div>
        <input v-model="renameDraft.title" class="rename-input" autofocus />
        <div class="rename-actions">
          <button type="button" class="ghost-btn" @click="renameDraft = null">
            {{ t('common.cancel') }}
          </button>
          <button type="submit" class="primary-btn">{{ t('common.save') }}</button>
        </div>
      </form>
    </div>
  </aside>
</template>

<style scoped>
.code-agent {
  position: relative;
  display: flex;
  min-width: 280px;
  flex-shrink: 0;
  flex-direction: column;
  border-left: 1px solid var(--codex-border, #e5e5e5);
  background: var(--codex-bg, #fafafa);
  color: var(--codex-text, #1a1a1a);
}
.resize-handle {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -3px;
  z-index: 30;
  width: 6px;
  cursor: col-resize;
}
.resize-handle:hover::after,
:global(.is-resizing-code-agent) .resize-handle::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 2px;
  width: 2px;
  background: color-mix(in srgb, var(--codex-accent, #2563eb) 45%, transparent);
}
.agent-tabs {
  display: flex;
  height: var(--codex-editor-tab-height, 40px);
  flex-shrink: 0;
  align-items: stretch;
  border-bottom: 1px solid var(--codex-border, #e5e5e5);
  background: var(--codex-editor-chrome, var(--codex-sidebar, #f3f3f3));
}
.agent-tab-strip {
  display: flex;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}
.agent-tab {
  position: relative;
  display: inline-flex;
  height: var(--codex-editor-tab-height, 40px);
  min-width: 132px;
  max-width: 220px;
  align-items: center;
  gap: 9px;
  border-right: 1px solid var(--codex-border, #e5e5e5);
  border-bottom: 1px solid var(--codex-border, #e5e5e5);
  background: var(--codex-editor-chrome, var(--codex-sidebar, #f3f3f3));
  padding: 0 12px;
  color: var(--codex-text-secondary, #4a4a4a);
  font-size: 12.5px;
  font-weight: 500;
}
.agent-tab.is-active {
  z-index: 1;
  margin-bottom: -1px;
  border-bottom-color: transparent;
  background: var(--codex-bg, #fafafa);
  color: var(--codex-text, #1a1a1a);
  font-weight: 650;
  box-shadow: none;
}
.agent-tab.is-active::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 1px;
  background: var(--codex-bg, #fafafa);
  content: "";
}
.agent-tab span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pin-mark {
  display: inline-flex;
  color: var(--codex-muted, #8a8a8a);
}
.tab-close {
  display: inline-flex;
  margin-left: auto;
  align-items: center;
  justify-content: center;
  border-radius: 5px;
  color: var(--codex-muted, #8a8a8a);
}
.tab-close:hover {
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-text, #1a1a1a);
}
.tab-action {
  display: inline-flex;
  width: var(--codex-editor-tab-height, 40px);
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-left: 1px solid var(--codex-border, #e5e5e5);
  color: var(--codex-muted, #8a8a8a);
}
.tab-action:hover,
.tab-action.active {
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-text, #1a1a1a);
}
.history-anchor {
  position: relative;
  display: flex;
}
.tab-context-menu {
  position: fixed;
  z-index: 120;
  min-width: 220px;
  max-width: calc(100vw - 16px);
  max-height: calc(100vh - 16px);
  overflow: auto;
  border: 1px solid var(--codex-border, #e5e5e5);
  border-radius: 12px;
  background: var(--codex-bg, #fafafa);
  padding: 6px;
  box-shadow: 0 18px 56px rgba(0, 0, 0, 0.18);
}
.tab-context-menu button {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 9px;
  border-radius: 8px;
  padding: 8px 10px;
  color: var(--codex-text, #1a1a1a);
  text-align: left;
  font-size: 13px;
}
.tab-context-menu button:hover {
  background: var(--codex-hover, #f0f0f0);
}
.menu-separator {
  height: 1px;
  margin: 6px 4px;
  background: var(--codex-border, #e5e5e5);
}
.rename-backdrop {
  position: fixed;
  inset: 0;
  z-index: 130;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.18);
}
.rename-dialog {
  width: 380px;
  border: 1px solid var(--codex-border, #e5e5e5);
  border-radius: 16px;
  background: var(--codex-bg, #fafafa);
  padding: 18px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.22);
}
.rename-title {
  font-size: 16px;
  font-weight: 700;
}
.rename-input {
  margin-top: 14px;
  width: 100%;
  border: 1px solid var(--codex-border-hover, #d4d4d4);
  border-radius: 10px;
  background: var(--codex-bg, #fafafa);
  padding: 10px 12px;
  font-size: 14px;
  outline: none;
}
.rename-input:focus {
  border-color: var(--codex-text-secondary, #4a4a4a);
}
.rename-actions {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.agent-turn + .agent-turn {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid color-mix(in srgb, var(--codex-border) 70%, transparent);
}
.incomplete-banner {
  @apply mt-3 flex items-center justify-between gap-3 rounded-xl border border-amber-200
         bg-amber-50 px-3 py-2 text-[12px] text-amber-900;
}
:global([data-theme='dark']) .incomplete-banner {
  @apply border-amber-900/40 bg-amber-950/30 text-amber-200;
}
.continue-btn {
  @apply rounded-lg bg-codex-text px-3 py-1 text-[12px] font-medium text-white hover:opacity-90;
}
.composer-input-wrap {
  position: relative;
  padding: 12px 16px 4px;
}
.agent-composer :deep(.composer-context) {
  padding: 10px 14px 4px;
}
.agent-composer :deep(.attach-chip),
.agent-composer :deep(.mode-chip) {
  font-size: var(--code-agent-content-size, 12.5px);
}
.agent-body {
  min-height: 0;
  flex: 1;
  overflow: auto;
  padding: 16px;
  --code-agent-content-size: 12.5px;
  --code-agent-content-line: 1.62;
}
.agent-turn {
  width: 100%;
}
.agent-output {
  font-size: var(--code-agent-content-size, 12.5px);
  line-height: var(--code-agent-content-line, 1.62);
}
.agent-output :deep(.markdown-body) {
  font-size: var(--code-agent-content-size, 12.5px);
  line-height: var(--code-agent-content-line, 1.62);
}
.agent-output :deep(.markdown-inner p) {
  margin-top: 10px;
  margin-bottom: 10px;
  line-height: 1.62;
}
.agent-output :deep(.process-toggle) {
  font-size: 12.5px;
  padding-bottom: 8px;
}
.agent-output :deep(.process-body) {
  margin-top: 10px;
  gap: 10px;
}
.agent-empty-hint {
  display: flex;
  min-height: 220px;
  align-items: center;
  justify-content: center;
  color: var(--codex-muted, #8a8a8a);
  font-size: 13px;
}
.agent-composer-wrap {
  flex-shrink: 0;
  padding: 12px;
  --code-agent-content-size: 12.5px;
  --code-agent-content-line: 1.62;
}
.composer-edit-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  border: 1px solid color-mix(in srgb, var(--codex-accent) 24%, var(--codex-border));
  border-radius: 12px;
  background: color-mix(in srgb, var(--codex-accent) 5%, var(--codex-bg));
  padding: 6px 10px;
  color: var(--codex-text-secondary, #4a4a4a);
  font-size: 12px;
  font-weight: 500;
}
.composer-edit-cancel {
  display: flex;
  height: 22px;
  width: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--codex-text-secondary, #4a4a4a);
  transition: background 0.12s ease, color 0.12s ease;
}
.composer-edit-cancel:hover {
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-text, #1a1a1a);
}
.plan-choice-card {
  margin-bottom: 8px;
  overflow: hidden;
  border: 1px solid var(--codex-border, #e5e5e5);
  border-radius: 13px;
  background: var(--codex-bg, #fafafa);
  box-shadow: 0 12px 34px rgba(0, 0, 0, 0.08);
}
.plan-choice-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 11px 8px;
}
.plan-choice-title {
  color: var(--codex-text, #1a1a1a);
  font-size: 12.5px;
  font-weight: 700;
}
.plan-choice-desc {
  margin-top: 2px;
  color: var(--codex-muted, #8a8a8a);
  font-size: 11.5px;
}
.plan-dismiss-btn {
  flex-shrink: 0;
  border-radius: 7px;
  padding: 3px 7px;
  color: var(--codex-muted, #8a8a8a);
  font-size: 12px;
}
.plan-dismiss-btn:hover {
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-text, #1a1a1a);
}
.plan-option-list {
  border-top: 1px solid var(--codex-border, #e5e5e5);
  padding: 5px;
}
.plan-option {
  display: flex;
  width: 100%;
  min-width: 0;
  align-items: center;
  gap: 8px;
  border-radius: 9px;
  padding: 7px 8px;
  color: var(--codex-text, #1a1a1a);
  text-align: left;
}
.plan-option:hover:not(:disabled) {
  background: var(--codex-hover, #f0f0f0);
}
.plan-option:disabled {
  cursor: default;
  opacity: 0.52;
}
.plan-option-label {
  display: inline-flex;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  background: color-mix(in srgb, var(--codex-accent, #2563eb) 12%, var(--codex-hover, #f0f0f0));
  color: var(--codex-accent, #2563eb);
  font-size: 12px;
  font-weight: 750;
}
.plan-option-main {
  min-width: 0;
  flex: 1;
}
.plan-option-title,
.plan-option-summary {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plan-option-title {
  font-size: 12.5px;
  font-weight: 650;
}
.plan-option-summary {
  margin-top: 1px;
  color: var(--codex-muted, #8a8a8a);
  font-size: 11.5px;
}
.plan-option-risk {
  flex-shrink: 0;
  border-radius: 999px;
  background: var(--codex-hover, #f0f0f0);
  padding: 2px 6px;
  color: var(--codex-muted, #8a8a8a);
  font-size: 11px;
}
.agent-composer.is-editing {
  border-color: color-mix(in srgb, var(--codex-accent) 45%, var(--codex-border));
  box-shadow:
    0 10px 32px rgba(0, 0, 0, 0.06),
    0 0 0 1px color-mix(in srgb, var(--codex-accent) 12%, transparent);
}
.agent-composer {
  border-radius: 16px;
}
.composer-bottom {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px 6px;
}
.composer-left,
.composer-actions {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 5px;
}
.menu-anchor {
  position: relative;
}
.pill-btn,
.model-btn {
  display: inline-flex;
  max-width: 140px;
  align-items: center;
  gap: 4px;
  border-radius: 999px;
  padding: 2px 7px;
  color: var(--codex-text-secondary, #4a4a4a);
  font-size: var(--code-agent-content-size, 12.5px);
  line-height: 1.25;
  transition: background 0.15s ease, color 0.15s ease;
}
.pill-btn {
  background: var(--codex-hover, #f0f0f0);
}
.model-btn span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pill-btn:hover,
.model-btn:hover,
.icon-btn:hover {
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-text, #1a1a1a);
}
.icon-btn:disabled {
  cursor: default;
  opacity: 0.35;
}
.icon-btn.active {
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-text, #1a1a1a);
}
.mode-menu {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 0;
  z-index: 80;
  width: 220px;
  overflow: hidden;
  border: 1px solid var(--codex-border, #e5e5e5);
  border-radius: 12px;
  background: var(--codex-bg, #fafafa);
  padding: 6px;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.16);
}
.menu-row {
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
.menu-row:hover,
.menu-row.selected {
  background: var(--codex-hover, #f0f0f0);
}
.row-check {
  margin-left: auto;
  flex-shrink: 0;
}
.icon-btn {
  display: inline-flex;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: var(--codex-muted, #8a8a8a);
  transition: background 0.15s ease, color 0.15s ease, opacity 0.15s ease;
}
.send-btn {
  width: 26px;
  height: 26px;
}
.tool-confirm {
  margin-bottom: 8px;
  border: 1px solid var(--codex-border, #e5e5e5);
  border-radius: 13px;
  background: var(--codex-bg, #fafafa);
  padding: 10px;
  box-shadow: 0 14px 40px rgba(0, 0, 0, 0.12);
}
.confirm-title {
  color: var(--codex-muted, #8a8a8a);
  font-size: 12px;
}
.confirm-list {
  margin-top: 6px;
  display: grid;
  gap: 4px;
}
.confirm-row {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 8px;
  background: var(--codex-hover, #f0f0f0);
  padding: 6px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.confirm-actions {
  margin-top: 8px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.ghost-btn,
.primary-btn {
  border-radius: 8px;
  padding: 6px 10px;
  font-size: 12px;
}
.ghost-btn {
  color: var(--codex-muted, #8a8a8a);
}
.primary-btn {
  background: var(--codex-text, #1a1a1a);
  color: var(--codex-bg, #fafafa);
}
</style>








