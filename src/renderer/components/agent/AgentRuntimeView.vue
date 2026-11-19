<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { Activity, Brain, Boxes, Clock3, RefreshCw, ShieldCheck } from 'lucide-vue-next'
import { useAgentRuntimeStore } from '../../stores/agent-runtime.store.js'

const runtime = useAgentRuntimeStore()
const probe = ref('')
const selectedToolIds = ref<string[]>([])
const snapshot = computed(() => runtime.snapshot)

const stateLabel = computed(() => {
  const state = snapshot.value?.state ?? 'idle'
  return {
    idle: '空闲',
    processing: '处理中',
    maintenance: '维护中',
    paused: '已暂停',
    error: '异常'
  }[state]
})

const lastTick = computed(() => {
  const at = snapshot.value?.lastTickAt
  return at ? new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '尚未启动'
})

function phaseLabel(phase: string): string {
  return {
    intent: '意图',
    context: '上下文',
    plan: '计划',
    execute: '执行',
    verify: '验证',
    tool: '工具',
    action: '结果',
    error: '错误'
  }[phase] ?? phase
}

async function runProbe(): Promise<void> {
  const text = probe.value.trim()
  if (!text) return
  const tools = await runtime.selectTools(text)
  selectedToolIds.value = tools.map((tool) => tool.id)
}

onMounted(() => runtime.start())
onUnmounted(() => runtime.stop())
</script>

<template>
  <div class="settings-panel no-select">
    <div class="panel-heading">
      <h1 class="panel-title">Brain</h1>
      <button type="button" class="refresh-btn" :disabled="runtime.loading" @click="runtime.load">
        <RefreshCw :size="16" :class="{ spinning: runtime.loading }" />
        刷新
      </button>
    </div>

    <section class="settings-section">
      <h2 class="section-title">运行状态</h2>
      <p class="section-desc">统一观察 Agent 主循环、上下文注入、任务队列和工具门控。</p>
      <div class="status-grid">
        <div class="status-tile">
          <Brain :size="17" />
          <span>状态</span>
          <strong>{{ stateLabel }}</strong>
        </div>
        <div class="status-tile">
          <Boxes :size="17" />
          <span>队列</span>
          <strong>{{ snapshot?.stats.queued ?? 0 }}</strong>
        </div>
        <div class="status-tile">
          <ShieldCheck :size="17" />
          <span>今日完成</span>
          <strong>{{ snapshot?.stats.doneToday ?? 0 }}</strong>
        </div>
        <div class="status-tile">
          <Clock3 :size="17" />
          <span>心跳</span>
          <strong>{{ lastTick }}</strong>
        </div>
      </div>
    </section>

    <div v-if="runtime.error || snapshot?.error" class="runtime-error">
      {{ runtime.error || snapshot?.error }}
    </div>

    <section class="settings-section">
      <h2 class="section-title">队列与事件</h2>
      <div class="settings-group">
        <div class="runtime-block">
          <div class="block-title">
            <Activity :size="15" />
            <span>任务队列</span>
          </div>
          <div v-if="snapshot?.queue.length" class="event-list">
            <article v-for="item in snapshot.queue" :key="item.id" class="event-row">
              <div>
                <strong>{{ item.title }}</strong>
                <p>{{ item.source }} · {{ item.status }} · {{ item.detail || '等待调度' }}</p>
              </div>
              <span class="pill">{{ item.priority }}</span>
            </article>
          </div>
          <p v-else class="empty">当前没有排队事件。</p>
        </div>
        <div class="runtime-block border-top">
          <div class="block-title">
            <Clock3 :size="15" />
            <span>最近事件</span>
          </div>
          <div v-if="snapshot?.recentEvents.length" class="event-list">
            <article v-for="item in snapshot.recentEvents.slice(0, 8)" :key="item.id" class="event-row compact">
              <div>
                <strong>{{ item.title }}</strong>
                <p>{{ new Date(item.createdAt).toLocaleString() }} · {{ item.status }}</p>
              </div>
            </article>
          </div>
          <p v-else class="empty">暂无事件。</p>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h2 class="section-title">工具门控</h2>
      <p class="section-desc">按用户意图选择候选工具，避免每轮暴露完整工具表。</p>
      <div class="settings-group">
        <div class="probe-row">
          <input v-model="probe" type="text" placeholder="输入一句话测试意图与工具选择" @keydown.enter.prevent="runProbe" />
          <button type="button" @click="runProbe">分析</button>
        </div>
        <div class="tool-table">
          <div class="tool-head">
            <span>工具</span>
            <span>风险</span>
            <span>确认</span>
            <span>状态</span>
          </div>
          <div
            v-for="tool in snapshot?.tools ?? []"
            :key="tool.id"
            class="tool-row"
            :class="{ selected: selectedToolIds.includes(tool.id) }"
          >
            <div>
              <strong>{{ tool.name }}</strong>
              <p>{{ tool.description }}</p>
            </div>
            <span>{{ tool.risk }}</span>
            <span>{{ tool.requiresConfirmation ? '需要' : '无需' }}</span>
            <span>{{ tool.enabled ? '启用' : '停用' }}</span>
          </div>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h2 class="section-title">ContextBuilder Manifest</h2>
      <p class="section-desc">每轮明确上下文来源、预算、选中/跳过原因和候选工具。</p>
      <div class="settings-group manifest-group">
        <div v-if="snapshot?.manifests.length" class="manifest-list">
          <article v-for="manifest in snapshot.manifests.slice(0, 6)" :key="manifest.id" class="manifest-row">
            <div class="manifest-head">
              <div>
                <strong>{{ manifest.source }} · {{ manifest.intent.primary }}</strong>
                <p>{{ manifest.usedChars }} / {{ manifest.budgetChars }} chars · {{ new Date(manifest.createdAt).toLocaleString() }}</p>
              </div>
              <span class="pill">{{ Math.round(manifest.intent.confidence * 100) }}%</span>
            </div>
            <div class="source-list">
              <span
                v-for="source in manifest.sources"
                :key="`${manifest.id}-${source.id}`"
                class="source-pill"
                :class="source.status"
                :title="source.reason"
              >
                {{ source.label }} · {{ source.status }} · {{ source.chars }}
              </span>
            </div>
            <p class="manifest-tools">
              工具: {{ manifest.tools.map((tool) => tool.name).join(' / ') || '无' }}
            </p>
          </article>
        </div>
        <p v-else class="empty audit-empty">发送一条消息后，这里会显示本轮上下文来源与预算。</p>
      </div>
    </section>

    <section class="settings-section">
      <h2 class="section-title">执行闭环 Trace</h2>
      <p class="section-desc">观察每轮是否经过计划、执行与验证，避免复杂任务只靠提示词推进。</p>
      <div class="settings-group trace-group">
        <div v-if="snapshot?.traces.length" class="trace-list">
          <article v-for="trace in snapshot.traces.slice(0, 12)" :key="trace.id" class="trace-row">
            <span class="trace-phase" :class="trace.phase">{{ phaseLabel(trace.phase) }}</span>
            <div class="trace-main">
              <strong>{{ trace.title }}</strong>
              <p>{{ new Date(trace.createdAt).toLocaleString() }}</p>
            </div>
          </article>
        </div>
        <p v-else class="empty audit-empty">暂无执行 Trace。</p>
      </div>
    </section>

    <section class="settings-section">
      <h2 class="section-title">上下文审计</h2>
      <p class="section-desc">保留旧版审计记录，便于对照 selected/skipped 摘要。</p>
      <div class="settings-group audit-group">
        <div v-if="snapshot?.audits.length" class="audit-list">
          <article v-for="audit in snapshot.audits.slice(0, 8)" :key="audit.id" class="audit-row">
            <div class="audit-main">
              <strong>{{ audit.intent.primary }} · {{ Math.round(audit.intent.confidence * 100) }}%</strong>
              <p>{{ audit.usedChars }} / {{ audit.budgetChars }} chars · {{ new Date(audit.createdAt).toLocaleString() }}</p>
            </div>
            <div class="audit-tags">
              <span v-for="item in audit.selected.slice(0, 5)" :key="item">{{ item }}</span>
            </div>
          </article>
        </div>
        <p v-else class="empty audit-empty">发送一条消息后，这里会显示本轮上下文选择与跳过原因。</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-panel {
  @apply w-full;
}
.panel-heading {
  @apply mb-8 flex items-start justify-between gap-4;
}
.panel-title {
  @apply text-[28px] font-semibold text-codex-text tracking-tight;
}
.settings-section {
  @apply mb-10;
}
.section-title {
  @apply text-[15px] font-semibold text-codex-text mb-1;
}
.section-desc {
  @apply text-[13px] text-codex-muted mb-4 leading-relaxed;
}
.settings-group {
  @apply overflow-hidden rounded-xl border border-codex-border bg-codex-bg;
}
.refresh-btn {
  @apply inline-flex h-9 shrink-0 items-center gap-2 rounded-[10px] border border-codex-border bg-codex-bg px-3 text-[13px] font-medium
         text-codex-text-secondary transition-colors hover:bg-codex-hover hover:text-codex-text disabled:opacity-50;
}
.status-grid {
  @apply grid grid-cols-2 gap-3;
}
.status-tile {
  @apply flex items-center gap-3 rounded-lg border border-codex-border bg-codex-bg px-4 py-3;
}
.status-tile svg {
  @apply text-codex-text-secondary;
}
.status-tile span {
  @apply text-[12px] text-codex-muted;
}
.status-tile strong {
  @apply ml-auto text-[14px] font-semibold text-codex-text;
}
.runtime-error {
  @apply mb-8 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700;
}
.runtime-block {
  @apply px-4 py-4;
}
.runtime-block.border-top {
  @apply border-t border-codex-border;
}
.block-title {
  @apply mb-3 flex items-center gap-2 text-[14px] font-semibold text-codex-text;
}
.event-list {
  @apply space-y-2;
}
.event-row {
  @apply flex items-start justify-between gap-3 rounded-lg bg-codex-hover px-3 py-2.5;
}
.event-row.compact {
  @apply py-2;
}
.event-row strong,
.tool-row strong,
.audit-row strong {
  @apply text-[13px] font-semibold text-codex-text;
}
.event-row p,
.tool-row p,
.audit-row p,
.empty {
  @apply mt-1 text-[12px] leading-relaxed text-codex-muted;
}
.pill {
  @apply rounded-full bg-codex-bg px-2 py-0.5 text-[11px] font-medium text-codex-text-secondary;
}
.probe-row {
  @apply flex gap-2 border-b border-codex-border px-4 py-4;
}
.probe-row input {
  @apply h-9 min-w-0 flex-1 rounded-[10px] border border-codex-border bg-codex-hover px-3 text-[13px]
         text-codex-text outline-none placeholder:text-codex-muted focus:border-codex-accent focus:bg-codex-bg;
}
.probe-row button {
  @apply h-9 rounded-[10px] bg-codex-text px-4 text-[13px] font-medium text-codex-bg transition-opacity hover:opacity-90;
}
.tool-table {
  @apply w-full;
}
.tool-head,
.tool-row {
  @apply grid grid-cols-[1fr_58px_58px_52px] items-center gap-2 px-4;
}
.tool-head {
  @apply h-10 bg-codex-hover text-[12px] font-medium text-codex-muted;
}
.tool-row {
  @apply min-h-[64px] border-t border-codex-border py-2 text-[12px] text-codex-text-secondary;
}
.tool-row.selected {
  @apply bg-codex-hover;
}
.audit-group {
  @apply px-4 py-4;
}
.trace-group {
  @apply px-4 py-4;
}
.trace-list {
  @apply space-y-2;
}
.trace-row {
  @apply flex items-center gap-3 rounded-lg bg-codex-hover px-3 py-2.5;
}
.trace-phase {
  @apply inline-flex h-7 w-12 shrink-0 items-center justify-center rounded-md bg-codex-bg text-[12px] font-semibold text-codex-text-secondary;
}
.trace-phase.plan {
  @apply text-blue-600;
}
.trace-phase.execute,
.trace-phase.tool {
  @apply text-amber-700;
}
.trace-phase.verify,
.trace-phase.action {
  @apply text-emerald-700;
}
.trace-phase.error {
  @apply text-red-600;
}
.trace-main {
  @apply min-w-0;
}
.trace-main strong {
  @apply block truncate text-[13px] font-semibold text-codex-text;
}
.trace-main p {
  @apply mt-1 text-[12px] text-codex-muted;
}
.manifest-group {
  @apply px-4 py-4;
}
.manifest-list {
  @apply space-y-3;
}
.manifest-row {
  @apply rounded-lg bg-codex-hover px-3 py-3;
}
.manifest-head {
  @apply flex items-start justify-between gap-3;
}
.manifest-row strong {
  @apply text-[13px] font-semibold text-codex-text;
}
.manifest-row p {
  @apply mt-1 text-[12px] leading-relaxed text-codex-muted;
}
.source-list {
  @apply mt-3 flex flex-wrap gap-1.5;
}
.source-pill {
  @apply rounded-md bg-codex-bg px-2 py-1 text-[11px] font-medium text-codex-text-secondary;
}
.source-pill.selected {
  @apply text-codex-text;
}
.source-pill.skipped,
.source-pill.truncated {
  @apply text-codex-muted;
}
.source-pill.error {
  @apply text-red-600;
}
.manifest-tools {
  @apply mb-0;
}
.audit-list {
  @apply space-y-2;
}
.audit-row {
  @apply flex items-center justify-between gap-4 rounded-lg bg-codex-hover px-3 py-2.5;
}
.audit-main {
  @apply min-w-0;
}
.audit-tags {
  @apply flex max-w-[46%] flex-wrap justify-end gap-1;
}
.audit-tags span {
  @apply rounded-md bg-codex-bg px-2 py-1 text-[11px] text-codex-text-secondary;
}
.audit-empty {
  @apply m-0;
}
.spinning {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
@media (max-width: 860px) {
  .status-grid {
    @apply grid-cols-1;
  }
  .tool-head,
  .tool-row {
    @apply grid-cols-[1fr_48px_48px_44px] px-3;
  }
  .audit-row {
    @apply flex-col items-start;
  }
  .audit-tags {
    @apply max-w-none justify-start;
  }
}
</style>
