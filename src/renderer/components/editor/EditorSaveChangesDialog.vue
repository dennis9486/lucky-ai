<script setup lang="ts">
import { AlertTriangle } from 'lucide-vue-next'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OpenFileTab } from '../../../shared/types/workspace.js'

const props = defineProps<{
  tabs: OpenFileTab[]
  saving?: boolean
}>()

const emit = defineEmits<{
  save: []
  discard: []
  cancel: []
}>()

const { t } = useI18n()

const primaryName = computed(() => {
  const name = props.tabs[0]?.name ?? ''
  return name.replace(/\.[^.]+$/, '') || name
})

const title = computed(() => props.tabs.length > 1
  ? t('editor.saveDialog.titleMany', { count: props.tabs.length })
  : t('editor.saveDialog.titleOne', { name: primaryName.value })
)
</script>

<template>
  <div class="save-dialog-backdrop" role="presentation" @mousedown.self="emit('cancel')">
    <section class="save-dialog" role="dialog" aria-modal="true" :aria-label="title">
      <div class="warning-icon">
        <AlertTriangle :size="48" :stroke-width="2.4" />
      </div>
      <h2>{{ title }}</h2>
      <p>{{ t('editor.saveDialog.message') }}</p>
      <div class="dialog-actions">
        <button type="button" class="dialog-btn primary" :disabled="saving" @click="emit('save')">
          {{ saving ? t('editor.saveDialog.saving') : t('editor.saveDialog.save') }}
        </button>
        <button type="button" class="dialog-btn" :disabled="saving" @click="emit('discard')">
          {{ t('editor.saveDialog.dontSave') }}
        </button>
        <button type="button" class="dialog-btn" :disabled="saving" @click="emit('cancel')">
          {{ t('common.cancel') }}
        </button>
      </div>
    </section>
  </div>
</template>

<style scoped>
.save-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.28);
  backdrop-filter: blur(2px);
}
.save-dialog {
  width: 292px;
  border: 1px solid rgba(0, 0, 0, 0.16);
  border-radius: 28px;
  background: rgba(246, 246, 246, 0.97);
  box-shadow: 0 22px 60px rgba(0, 0, 0, 0.28);
  padding: 26px 18px 18px;
  color: #202124;
}
.warning-icon {
  display: flex;
  width: 74px;
  height: 74px;
  align-items: center;
  justify-content: center;
  margin: 0 auto 18px;
  border-radius: 18px;
  color: white;
  filter: drop-shadow(0 2px 1px rgba(0, 0, 0, 0.22));
}
.warning-icon :deep(svg) {
  fill: #f5c400;
  stroke: white;
}
.save-dialog h2 {
  margin: 0 12px 14px;
  font-size: 16px;
  font-weight: 750;
  line-height: 1.25;
}
.save-dialog p {
  margin: 0 12px 22px;
  color: #2d2d2d;
  font-size: 15px;
  font-weight: 450;
  line-height: 1.35;
}
.dialog-actions {
  display: grid;
  gap: 8px;
}
.dialog-btn {
  height: 38px;
  border-radius: 999px;
  background: #dedede;
  color: #202124;
  font-size: 15px;
  font-weight: 600;
}
.dialog-btn.primary {
  background: #0a84ff;
  color: white;
}
.dialog-btn:disabled {
  cursor: default;
  opacity: 0.65;
}
:global([data-theme='dark']) .save-dialog {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(42, 42, 42, 0.97);
  color: #f5f5f5;
}
:global([data-theme='dark']) .save-dialog p {
  color: #dedede;
}
:global([data-theme='dark']) .dialog-btn {
  background: #505050;
  color: #f5f5f5;
}
:global([data-theme='dark']) .dialog-btn.primary {
  background: #0a84ff;
  color: white;
}
</style>
