<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { AlertTriangle, MessageSquareText } from 'lucide-vue-next'
import { useUiStore } from '../../stores/ui.store.js'
import { useFocusTrap } from '../../composables/useFocusTrap.js'

const { t } = useI18n()
const ui = useUiStore()
const inputValue = ref('')
const inputRef = ref<HTMLTextAreaElement | null>(null)
const dialogRef = ref<HTMLElement | null>(null)
const primaryBtnRef = ref<HTMLButtonElement | null>(null)

const dialog = computed(() => ui.appDialog)
const isPrompt = computed(() => dialog.value?.kind === 'prompt')
const isAlert = computed(() => dialog.value?.kind === 'alert')
const confirmLabel = computed(() => dialog.value?.confirmLabel ?? t(isAlert.value ? 'common.close' : 'common.confirm'))
const cancelLabel = computed(() => dialog.value?.cancelLabel ?? t('common.cancel'))
const title = computed(() => dialog.value?.title ?? t('appDialog.title'))
const isOpen = computed(() => dialog.value != null)

watch(
  () => dialog.value?.id,
  () => {
    inputValue.value = dialog.value?.initialValue ?? ''
  }
)

// focus trap：打开时聚焦（prompt 聚焦并全选输入框，否则聚焦主按钮），关闭后把焦点还给触发者
useFocusTrap(dialogRef, isOpen, {
  initialFocus: () => {
    if (isPrompt.value && inputRef.value) {
      inputRef.value.select()
      return inputRef.value
    }
    return primaryBtnRef.value
  }
})

function cancel(): void {
  ui.resolveDialog({ confirmed: false })
}

function confirm(): void {
  ui.resolveDialog({ confirmed: true, value: inputValue.value })
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    cancel()
  } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
    event.preventDefault()
    confirm()
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="dialog" class="dialog-overlay" @click.self="cancel" @keydown="onKeydown">
      <section
        ref="dialogRef"
        class="app-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        aria-describedby="app-dialog-message"
      >
        <div class="dialog-icon" :class="{ danger: dialog.danger }">
          <AlertTriangle v-if="dialog.danger" :size="22" />
          <MessageSquareText v-else :size="22" />
        </div>

        <div class="dialog-body">
          <h2 id="app-dialog-title" class="dialog-title">{{ title }}</h2>
          <p id="app-dialog-message" class="dialog-message">{{ dialog.message }}</p>
          <textarea
            v-if="isPrompt"
            ref="inputRef"
            v-model="inputValue"
            class="dialog-input"
            :placeholder="dialog.placeholder"
            rows="5"
            @keydown="onKeydown"
          />
        </div>

        <div class="dialog-actions">
          <button v-if="!isAlert" type="button" class="dialog-btn ghost" @click="cancel">
            {{ cancelLabel }}
          </button>
          <button
            ref="primaryBtnRef"
            type="button"
            class="dialog-btn primary"
            :class="{ danger: dialog.danger }"
            @click="confirm"
          >
            {{ confirmLabel }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  @apply fixed inset-0 z-[80] flex items-center justify-center bg-black/25 px-4;
}
.app-dialog {
  @apply w-full max-w-[520px] rounded-[18px] border border-codex-border bg-codex-bg p-6 shadow-2xl;
}
.dialog-icon {
  @apply mb-5 inline-flex h-11 w-11 items-center justify-center rounded-[12px] bg-codex-hover text-codex-text;
}
.dialog-icon.danger {
  @apply bg-red-50 text-red-500;
}
.dialog-title {
  @apply text-[18px] font-semibold text-codex-text;
}
.dialog-message {
  @apply mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-codex-muted;
}
.dialog-input {
  @apply mt-5 min-h-[150px] w-full resize-y rounded-[12px] border border-codex-border bg-codex-hover
         px-3 py-2 text-[13px] leading-relaxed text-codex-text outline-none
         placeholder:text-codex-muted focus:border-codex-text;
}
.dialog-actions {
  @apply mt-6 flex items-center justify-end gap-3;
}
.dialog-btn {
  @apply rounded-[10px] px-4 py-2 text-[14px] font-medium transition-colors;
}
.dialog-btn.ghost {
  @apply text-codex-muted hover:bg-codex-hover hover:text-codex-text;
}
.dialog-btn.primary {
  @apply bg-codex-text text-codex-bg hover:opacity-90;
}
.dialog-btn.primary.danger {
  @apply bg-red-500 text-white;
}
</style>
