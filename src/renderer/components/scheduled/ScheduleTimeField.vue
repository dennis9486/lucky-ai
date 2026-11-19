<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Clock3 } from 'lucide-vue-next'
import {
  DEFAULT_SCHEDULE_TIME,
  normalizeScheduleTime,
  scheduleTimeParts
} from '../../utils/scheduled-task-form.js'

/**
 * HH:mm 时间输入 + 滚轮弹层，编辑抽屉与手动创建对话框共用。
 * 弹层开合与外点关闭都在组件内自理，宿主只需 v-model 接管值。
 */
const props = defineProps<{
  modelValue: string
  /** 弹层对齐方向：抽屉靠右、对话框靠左 */
  popoverAlign?: 'left' | 'right'
  /** 输入文字对齐：抽屉字段右对齐、对话框左对齐 */
  inputAlign?: 'left' | 'right'
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void
}>()

const { t } = useI18n()
const open = ref(false)
const rootRef = ref<HTMLElement | null>(null)
const timeHours = Array.from({ length: 24 }, (_, index) => index.toString().padStart(2, '0'))
const timeMinutes = Array.from({ length: 60 }, (_, index) => index.toString().padStart(2, '0'))

onMounted(() => document.addEventListener('click', onDocClick))
onUnmounted(() => document.removeEventListener('click', onDocClick))

function onDocClick(event: MouseEvent): void {
  if (!rootRef.value?.contains(event.target as Node)) open.value = false
}

function onInput(event: Event): void {
  emit('update:modelValue', (event.target as HTMLInputElement).value)
}

function normalizeOnBlur(): void {
  emit('update:modelValue', normalizeScheduleTime(props.modelValue, DEFAULT_SCHEDULE_TIME))
}

function setPart(part: 'hour' | 'minute', next: string): void {
  const current = scheduleTimeParts(props.modelValue)
  emit('update:modelValue', part === 'hour' ? `${next}:${current.minute}` : `${current.hour}:${next}`)
}
</script>

<template>
  <span ref="rootRef" class="time-field" @click.stop>
    <span class="time-trigger" :class="{ 'input-right': inputAlign === 'right' }">
      <input
        :value="modelValue"
        type="text"
        inputmode="numeric"
        maxlength="5"
        placeholder="09:00"
        :aria-label="t('scheduledTasks.fields.schedule')"
        @input="onInput"
        @focus="open = true"
        @blur="normalizeOnBlur"
      />
      <button type="button" :aria-label="t('scheduledTasks.fields.schedule')" @click="open = true">
        <Clock3 :size="16" />
      </button>
    </span>
    <div
      v-if="open"
      class="time-popover"
      :class="{ 'align-left': popoverAlign === 'left' }"
      @keydown.escape.stop="open = false"
    >
      <div class="time-popover-value">{{ normalizeScheduleTime(modelValue, DEFAULT_SCHEDULE_TIME) }}</div>
      <div class="time-scroll-panel">
        <div class="time-column" :aria-label="t('scheduledTasks.timePicker.hour')">
          <button
            v-for="hour in timeHours"
            :key="hour"
            type="button"
            :class="{ selected: scheduleTimeParts(modelValue).hour === hour }"
            @click="setPart('hour', hour)"
          >
            {{ hour }}
          </button>
        </div>
        <div class="time-column" :aria-label="t('scheduledTasks.timePicker.minute')">
          <button
            v-for="minute in timeMinutes"
            :key="minute"
            type="button"
            :class="{ selected: scheduleTimeParts(modelValue).minute === minute }"
            @click="setPart('minute', minute)"
          >
            {{ minute }}
          </button>
        </div>
      </div>
    </div>
  </span>
</template>

<style scoped>
.time-field {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  min-width: 0;
  width: 100%;
}
.time-trigger {
  display: flex;
  width: 100%;
  min-height: 34px;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px 6px 12px;
  border: 1px solid var(--codex-border, #e4e4e4);
  border-radius: 8px;
  background: var(--codex-bg, #fff);
  color: var(--codex-text, #1f1f1f);
  font: inherit;
  line-height: 1.2;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.time-trigger:hover,
.time-trigger:focus-within {
  border-color: color-mix(in srgb, var(--codex-text, #1f1f1f) 28%, var(--codex-border, #e4e4e4));
  outline: 0;
}
.time-trigger input {
  min-width: 0;
  flex: 1;
  min-height: 0;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--codex-text, #1f1f1f);
  font: inherit;
  line-height: 1.2;
  text-align: left;
  appearance: textfield;
}
.time-trigger.input-right input {
  text-align: right;
}
.time-trigger input::placeholder {
  color: var(--codex-muted, #9a9a9a);
}
.time-trigger button {
  display: inline-grid;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  place-items: center;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--codex-muted, #8d8d8d);
}
.time-trigger button:hover {
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-text, #1f1f1f);
}
.time-trigger svg {
  flex-shrink: 0;
}
.time-popover {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 80;
  display: grid;
  width: 100%;
  min-width: 220px;
  max-width: min(260px, calc(100vw - 32px));
  overflow: hidden;
  padding: 0;
  border: 1px solid var(--codex-border, #e4e4e4);
  border-radius: 8px;
  background: var(--codex-bg, #fff);
  box-shadow: 0 10px 24px color-mix(in srgb, #000 10%, transparent);
}
.time-popover.align-left {
  left: 0;
  right: auto;
}
.time-popover-value {
  display: grid;
  min-height: 34px;
  place-items: center;
  border-bottom: 1px solid var(--codex-border, #e4e4e4);
  color: var(--codex-text, #1f1f1f);
  font-size: 13px;
  font-weight: 600;
}
.time-scroll-panel {
  display: grid;
  grid-template-columns: 1fr 1fr;
  min-height: 180px;
}
.time-column {
  display: grid;
  max-height: 220px;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 6px 0;
  scroll-padding-block: 6px;
}
.time-column + .time-column {
  border-left: 1px solid var(--codex-border, #eeeeee);
}
.time-column button {
  display: grid;
  min-height: 30px;
  place-items: center;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: var(--codex-text-secondary, #4f4f4f);
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  transition: background 0.15s ease, color 0.15s ease;
}
.time-column button:hover {
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-text, #1f1f1f);
}
.time-column button.selected {
  background: color-mix(in srgb, var(--codex-accent, #2f8cff) 10%, var(--codex-bg, #fff));
  color: var(--codex-accent, #2f8cff);
  font-weight: 650;
}
</style>
