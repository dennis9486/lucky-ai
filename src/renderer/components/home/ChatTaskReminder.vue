<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { BellRing, Check, Clock3, Play, X } from 'lucide-vue-next'
import { useScheduledTaskStore } from '../../stores/scheduled-task.store.js'

const { t, locale } = useI18n()
const tasks = useScheduledTaskStore()
const running = ref(false)
const snoozing = ref(false)
const snoozeMode = ref<'15m' | '1h' | 'custom'>('15m')
const customTime = ref(defaultCustomTime())

const task = computed(() => tasks.nextChatReminderTask)
const scheduledText = computed(() => formatTime(task.value?.pendingRunAt ?? null))

watch(task, () => {
  snoozeMode.value = '15m'
  customTime.value = defaultCustomTime()
})

async function runNow(): Promise<void> {
  const current = task.value
  if (!current || running.value) return
  running.value = true
  try {
    await tasks.runScheduledTask(current, { trigger: 'pending' })
  } finally {
    running.value = false
  }
}

async function snooze(): Promise<void> {
  const current = task.value
  if (!current || snoozing.value) return
  snoozing.value = true
  try {
    await tasks.snoozePending(current.id, resolveSnoozeAt())
  } finally {
    snoozing.value = false
  }
}

async function dismiss(): Promise<void> {
  const current = task.value
  if (!current) return
  await tasks.dismissPending(current.id)
}

function resolveSnoozeAt(): number {
  const now = Date.now()
  if (snoozeMode.value === '15m') return now + 15 * 60 * 1000
  if (snoozeMode.value === '1h') return now + 60 * 60 * 1000

  const [hourPart, minutePart] = customTime.value.split(':')
  const h = parseTimePart(hourPart, 9)
  const m = parseTimePart(minutePart, 0)
  const next = new Date()
  next.setHours(h, m, 0, 0)
  if (next.getTime() <= now + 60 * 1000) next.setDate(next.getDate() + 1)
  return next.getTime()
}

function parseTimePart(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

function defaultCustomTime(): string {
  const next = new Date(Date.now() + 60 * 60 * 1000)
  next.setMinutes(0, 0, 0)
  return `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`
}

function formatTime(value: number | null): string {
  if (!value) return ''
  return new Intl.DateTimeFormat(locale.value, { hour: '2-digit', minute: '2-digit' }).format(value)
}
</script>

<template>
  <section v-if="task" class="task-reminder" aria-live="polite">
    <div class="reminder-icon" aria-hidden="true">
      <BellRing :size="18" :stroke-width="1.8" />
    </div>

    <div class="reminder-main">
      <div class="reminder-title-row">
        <span class="reminder-kicker">{{ t('scheduledTasks.chatReminder.kicker') }}</span>
        <strong class="reminder-title">{{ task.title }}</strong>
      </div>
      <p>
        {{ t('scheduledTasks.chatReminder.body', { time: scheduledText }) }}
      </p>
    </div>

    <div class="reminder-actions">
      <button type="button" class="run-btn" :disabled="running" @click="runNow">
        <Play v-if="!running" :size="15" :stroke-width="2" />
        <Check v-else :size="15" :stroke-width="2" />
        <span>{{ t('scheduledTasks.runNow') }}</span>
      </button>

      <div class="snooze-control">
        <select v-model="snoozeMode" :aria-label="t('scheduledTasks.chatReminder.snoozeLabel')">
          <option value="15m">{{ t('scheduledTasks.chatReminder.later15m') }}</option>
          <option value="1h">{{ t('scheduledTasks.chatReminder.later1h') }}</option>
          <option value="custom">{{ t('scheduledTasks.chatReminder.customTime') }}</option>
        </select>
        <input
          v-if="snoozeMode === 'custom'"
          v-model="customTime"
          type="time"
          class="time-input"
          :aria-label="t('scheduledTasks.chatReminder.customTime')"
        />
        <button type="button" class="snooze-btn" :disabled="snoozing" @click="snooze">
          <Clock3 :size="15" :stroke-width="1.9" />
          <span>{{ t('scheduledTasks.chatReminder.remindLater') }}</span>
        </button>
      </div>

      <button type="button" class="dismiss-btn" :title="t('scheduledTasks.chatReminder.dismissToday')" @click="dismiss">
        <X :size="16" :stroke-width="1.9" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.task-reminder {
  /* 提醒卡的暖橙强调色：收口为单一来源，避免同一色值在本组件内重复书写。 */
  --reminder-accent: #b45a13;
  --reminder-accent-strong: #a84d08;
  @apply flex items-center gap-3 rounded-[18px] border px-4 py-3 text-codex-text shadow-sm;
  border-color: color-mix(in srgb, var(--reminder-accent) 22%, var(--codex-border));
  background: color-mix(in srgb, var(--reminder-accent) 5%, var(--codex-bg));
}
.reminder-icon {
  @apply flex h-9 w-9 shrink-0 items-center justify-center rounded-full;
  color: var(--reminder-accent);
  background: color-mix(in srgb, var(--reminder-accent) 8%, var(--codex-bg));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--reminder-accent) 18%, transparent);
}
.reminder-main {
  @apply min-w-0 flex-1;
}
.reminder-title-row {
  @apply flex items-center gap-2 min-w-0;
}
.reminder-kicker {
  @apply shrink-0 text-[12px] font-semibold;
  color: var(--reminder-accent);
}
.reminder-title {
  @apply truncate text-[14px] font-semibold text-codex-text;
}
.reminder-main p {
  @apply mt-0.5 text-[12px] leading-5 text-codex-muted;
}
.reminder-actions {
  @apply flex shrink-0 items-center gap-2;
}
.run-btn,
.snooze-btn,
.dismiss-btn {
  @apply inline-flex h-9 items-center justify-center gap-1.5 rounded-[10px] text-[12px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50;
}
.run-btn {
  @apply border px-3;
  color: var(--reminder-accent-strong);
  border-color: color-mix(in srgb, var(--reminder-accent) 26%, var(--codex-border));
  background: var(--codex-bg);
}
.run-btn:hover {
  background: color-mix(in srgb, var(--reminder-accent) 8%, var(--codex-bg));
}
.snooze-control {
  @apply flex items-center gap-1 rounded-[11px] border px-1.5 py-1;
  border-color: color-mix(in srgb, var(--reminder-accent) 18%, var(--codex-border));
  background: var(--codex-bg);
}
.snooze-control select,
.time-input {
  @apply h-7 rounded-[8px] border-0 bg-transparent px-2 text-[12px] font-medium text-codex-text outline-none;
}
.time-input {
  @apply w-[92px] bg-codex-hover;
}
.snooze-btn {
  @apply px-2.5 text-codex-muted hover:bg-codex-hover hover:text-codex-text;
}
.dismiss-btn {
  @apply w-9 text-codex-muted hover:bg-codex-hover hover:text-codex-text;
}
@media (max-width: 980px) {
  .task-reminder {
    @apply items-start;
  }
  .reminder-actions {
    @apply flex-col items-stretch;
  }
}
</style>
