<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Plus, Hand, ChevronDown, Mic, ArrowUp, Square } from 'lucide-vue-next'
import ApprovalPopover from './ApprovalPopover.vue'
import ModelPopover from './ModelPopover.vue'
import type { ApprovalMode } from '../../../shared/types/conversation.js'
import AddMenuPopover, { type AddMenuAction } from './AddMenuPopover.vue'
import { useChatStore } from '../../stores/chat.store.js'
import { useProjectStore } from '../../stores/project.store.js'
import { useUiStore } from '../../stores/ui.store.js'
import { useSettingsStore } from '../../stores/settings.store.js'
import { ipc, unwrap } from '../../services/ipc-client.js'

const { t } = useI18n()
const chat = useChatStore()
const projects = useProjectStore()
const ui = useUiStore()
const settings = useSettingsStore()
const showApproval = ref(false)
const showAddMenu = ref(false)
const showModel = ref(false)
const listening = ref(false)
const approvalWrap = ref<HTMLElement | null>(null)
const addWrap = ref<HTMLElement | null>(null)
const modelWrap = ref<HTMLElement | null>(null)

const approvalLabel = computed(() => {
  const labels: Record<ApprovalMode, string> = {
    ask: t('approval.ask'),
    auto: t('approval.auto'),
    full: t('approval.full')
  }
  return labels[projects.approvalMode]
})

const modelLabel = computed(() => {
  const provider = settings.providers.find((item) => item.id === settings.activeProviderId)
  if (!provider) return t('composer.configureModel')
  const activeModel =
    provider.models?.find((model) => model.id === provider.activeModelId && model.enabled) ??
    provider.models?.find((model) => model.enabled)
  const modelName = activeModel?.name ?? provider.model
  return modelName.length > 14 ? `${modelName.slice(0, 14)}…` : modelName
})

const emit = defineEmits<{ send: [] }>()

withDefaults(
  defineProps<{
    popoverPlacement?: 'above' | 'below'
  }>(),
  { popoverPlacement: 'below' }
)

function handlePrimaryAction(): void {
  if (chat.isRunning) {
    if (chat.input.trim() || ui.composerAttachments.length > 0) {
      emit('send')
      return
    }
    chat.stopAgent()
    return
  }
  if (!chat.input.trim() && ui.composerAttachments.length === 0) return
  emit('send')
}

function toggleApproval(): void {
  showApproval.value = !showApproval.value
  showAddMenu.value = false
  showModel.value = false
}

function toggleAddMenu(): void {
  showAddMenu.value = !showAddMenu.value
  showApproval.value = false
  showModel.value = false
}

function toggleModel(): void {
  showModel.value = !showModel.value
  showApproval.value = false
  showAddMenu.value = false
}

function handleApprovalSelect(mode: ApprovalMode): void {
  projects.setApprovalMode(mode)
}

async function handleAddSelect(action: AddMenuAction): Promise<void> {
  switch (action) {
    case 'files':
      try {
        const paths = await unwrap<string[]>(ipc.app.openAttachmentDialog())
        ui.addComposerAttachments(paths)
      } catch {
        // user cancelled
      }
      break
    case 'electron':
      ui.attachedRuntime = 'electron'
      break
    case 'goal':
      ui.showGoalInput = true
      if (!chat.input.trim()) {
        chat.input = t('composer.goalPrefix')
      }
      break
    case 'plan':
      ui.planMode = !ui.planMode
      {
        const planPrompt = t('composer.planPrompt')
        if (ui.planMode && !chat.input.includes(planPrompt)) {
          chat.input = chat.input.trim()
            ? `${chat.input}\n\n${planPrompt}`
            : planPrompt
        }
      }
      break
  }
}

function toggleVoiceInput(): void {
  type SpeechRecognitionConstructor = new () => {
    lang: string
    interimResults: boolean
    continuous: boolean
    onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
    onerror: (() => void) | null
    onend: (() => void) | null
    start: () => void
  }
  const speechWindow = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  const SpeechRecognitionCtor = speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition
  if (!SpeechRecognitionCtor) {
    const message = t('composer.voiceUnsupported')
    chat.input = chat.input ? `${chat.input}\n${message}` : message
    return
  }

  const recognition = new SpeechRecognitionCtor()
  recognition.lang = 'zh-CN'
  recognition.interimResults = false
  recognition.continuous = false
  listening.value = true
  recognition.onresult = (event) => {
    const transcript = Array.from(event.results)
      .map((result) => result[0]?.transcript ?? '')
      .join('')
      .trim()
    if (transcript) {
      chat.input = chat.input ? `${chat.input} ${transcript}` : transcript
    }
  }
  recognition.onerror = () => {
    listening.value = false
  }
  recognition.onend = () => {
    listening.value = false
  }
  recognition.start()
}

function onDocClick(e: MouseEvent): void {
  const target = e.target as Node
  if (!approvalWrap.value?.contains(target)) showApproval.value = false
  if (!addWrap.value?.contains(target)) showAddMenu.value = false
  if (!modelWrap.value?.contains(target)) showModel.value = false
}

onMounted(() => {
  void settings.load()
  document.addEventListener('click', onDocClick)
})
onUnmounted(() => document.removeEventListener('click', onDocClick))
</script>

<template>
  <div class="composer-toolbar">
    <div class="left">
      <div ref="addWrap" class="add-wrap">
        <button
          type="button"
          class="add-btn"
          :class="{ 'is-open': showAddMenu }"
          :title="t('composer.add')"
          @click.stop="toggleAddMenu"
        >
          <Plus :size="18" />
        </button>
        <AddMenuPopover
          v-model:open="showAddMenu"
          :placement="popoverPlacement"
          @select="handleAddSelect"
        />
      </div>
      <div ref="approvalWrap" class="approval-wrap">
        <button type="button" class="approval-btn" @click.stop="toggleApproval">
          <Hand :size="15" />
          <span>{{ approvalLabel }}</span>
          <ChevronDown :size="13" class="opacity-70" />
        </button>
        <ApprovalPopover
          v-model="projects.approvalMode"
          v-model:open="showApproval"
          :placement="popoverPlacement"
          @select="handleApprovalSelect"
        />
      </div>
    </div>
    <div class="right">
      <div ref="modelWrap" class="model-wrap">
        <button type="button" class="model-btn" :class="{ 'is-open': showModel }" @click.stop="toggleModel">
          <span>{{ modelLabel }}</span>
          <ChevronDown :size="13" class="opacity-70" />
        </button>
        <ModelPopover v-model:open="showModel" />
      </div>
      <button type="button" class="icon-btn" :class="{ 'is-listening': listening }" :title="t('composer.voiceInput')" @click="toggleVoiceInput">
        <Mic :size="18" />
      </button>
      <button
        type="button"
        class="send-btn composer-send-btn"
        :class="{ 'is-ready': chat.isRunning || Boolean(chat.input.trim()) || ui.composerAttachments.length > 0 }"
        :disabled="!chat.isRunning && !chat.input.trim() && ui.composerAttachments.length === 0"
        :title="chat.isRunning && (chat.input.trim() || ui.composerAttachments.length > 0) ? t('composer.queueFollowUp') : chat.isRunning ? t('composer.stop') : t('composer.send')"
        @click="handlePrimaryAction"
      >
        <ArrowUp v-if="chat.isRunning && (chat.input.trim() || ui.composerAttachments.length > 0)" :size="18" stroke-width="2.5" />
        <Square v-else-if="chat.isRunning" :size="13" stroke-width="0" fill="currentColor" />
        <ArrowUp v-else :size="18" stroke-width="2.5" />
      </button>
    </div>
  </div>
</template>

<style scoped>
.composer-toolbar {
  @apply flex items-center justify-between gap-3 px-3 pb-3 pt-1;
}
.left,
.right {
  @apply flex min-w-0 items-center gap-1.5;
}
.right {
  @apply justify-end;
}
.add-wrap,
.approval-wrap,
.model-wrap {
  @apply relative z-20;
}
.add-btn {
  @apply flex h-9 w-9 items-center justify-center rounded-full
         transition-colors hover:bg-codex-hover hover:text-codex-text;
  color: color-mix(in srgb, var(--codex-text-secondary, #4a4a4a) 82%, var(--codex-muted, #8a8a8a));
}
.add-btn.is-open {
  @apply bg-codex-hover text-codex-text;
}
.icon-btn {
  @apply flex h-9 w-9 items-center justify-center rounded-full
         transition-colors hover:bg-codex-hover hover:text-codex-text;
  color: color-mix(in srgb, var(--codex-text-secondary, #4a4a4a) 82%, var(--codex-muted, #8a8a8a));
}
.approval-btn {
  @apply flex h-9 max-w-[190px] items-center gap-1.5 rounded-full px-2.5 text-[13px] font-medium
         transition-colors hover:bg-codex-hover hover:text-codex-text;
  color: color-mix(in srgb, var(--codex-text-secondary, #4a4a4a) 86%, var(--codex-muted, #8a8a8a));
}
.approval-btn span {
  @apply min-w-0 truncate;
}
.model-btn {
  @apply flex h-9 max-w-[180px] items-center gap-1 rounded-full px-2.5 text-[13px] font-medium
         transition-colors hover:bg-codex-hover hover:text-codex-text;
  color: color-mix(in srgb, var(--codex-text-secondary, #4a4a4a) 86%, var(--codex-muted, #8a8a8a));
}
.model-btn span {
  @apply min-w-0 truncate;
}
.model-btn.is-open,
.icon-btn.is-listening {
  @apply bg-codex-hover text-codex-text;
}
.send-btn {
  @apply h-10 w-10 shrink-0;
}
@media (max-width: 720px) {
  .approval-btn span,
  .model-btn span {
    @apply hidden;
  }
  .approval-btn,
  .model-btn {
    @apply w-9 justify-center px-0;
  }
}
</style>
