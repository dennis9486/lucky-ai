<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { FolderOpen, Package, Trash2, X } from 'lucide-vue-next'
import type { ExtensionManifestSummary } from '../../../shared/types/extension.js'
import { ipc, unwrap } from '../../services/ipc-client.js'
import { renderMarkdown } from '../../utils/markdown.js'
import { useEditorStore } from '../../stores/editor.store.js'
import { useUiStore } from '../../stores/ui.store.js'
import { notifyExtensionsChanged } from '../../stores/extension-events.js'

const props = defineProps<{ extensionId: string }>()

const { t } = useI18n()
const editor = useEditorStore()
const ui = useUiStore()
const extension = ref<ExtensionManifestSummary | null>(null)
const readmeHtml = ref('')
const loading = ref(false)

const sourceLabel = computed(() => {
  if (!extension.value) return ''
  if (extension.value.source === 'lucky-ai') return 'Lucky'
  if (extension.value.source === 'cursor') return 'Cursor'
  return 'VS Code'
})
const contributes = computed(() => extension.value?.contributes)

async function load(id: string): Promise<void> {
  loading.value = true
  readmeHtml.value = ''
  try {
    const [list, readme] = await Promise.all([
      unwrap<ExtensionManifestSummary[]>(ipc.extension.listInstalled()),
      unwrap<string>(ipc.extension.readReadme(id)).catch(() => '')
    ])
    const found = list.find((item) => item.id === id) ?? null
    // 期间可能已切换到别的扩展，避免串号
    if (props.extensionId !== id) return
    extension.value = found
    readmeHtml.value = readme ? renderMarkdown(readme) : ''
  } finally {
    if (props.extensionId === id) loading.value = false
  }
}

watch(() => props.extensionId, (id) => { if (id) void load(id) }, { immediate: true })

async function setEnabled(enabled: boolean): Promise<void> {
  if (!extension.value) return
  await unwrap(ipc.extension.setEnabled(extension.value.id, enabled))
  extension.value = { ...extension.value, enabled }
  notifyExtensionsChanged()
}

async function uninstall(): Promise<void> {
  const target = extension.value
  if (!target) return
  const confirmed = await ui.confirm(t('extensions.uninstallConfirm', { name: target.name }), {
    title: t('extensions.uninstall'),
    danger: true,
    confirmLabel: t('extensions.uninstall')
  })
  if (!confirmed) return
  await unwrap(ipc.extension.uninstall(target.id))
  notifyExtensionsChanged()
  editor.closeExtensionDetail()
}

function revealFolder(): void {
  if (extension.value) void ipc.app.showItemInFolder(extension.value.path)
}

function close(): void {
  editor.closeExtensionDetail()
}
</script>

<template>
  <section class="ext-detail">
    <header class="ext-detail-head">
      <div class="ext-detail-icon"><Package :size="28" /></div>
      <div class="ext-detail-headmeta">
        <div class="ext-detail-titlerow">
          <h1>{{ extension?.name ?? extensionId }}</h1>
          <span v-if="extension" class="ext-badge">{{ sourceLabel }}</span>
          <span v-if="extension && !extension.enabled" class="ext-badge disabled">{{ t('extensions.disabledBadge') }}</span>
        </div>
        <div v-if="extension" class="ext-detail-subtitle">
          {{ extension.publisher }} · v{{ extension.version }} · {{ extension.id }}
        </div>
        <div class="ext-detail-actions">
          <button
            v-if="extension"
            type="button"
            class="ext-btn primary"
            @click="setEnabled(!extension.enabled)"
          >
            {{ extension.enabled ? t('extensions.disable') : t('extensions.enable') }}
          </button>
          <button v-if="extension" type="button" class="ext-btn" @click="revealFolder">
            <FolderOpen :size="14" />
            <span>{{ t('extensions.revealFolder') }}</span>
          </button>
          <button v-if="extension?.managed" type="button" class="ext-btn danger" @click="uninstall">
            <Trash2 :size="14" />
            <span>{{ t('extensions.uninstall') }}</span>
          </button>
        </div>
      </div>
      <button type="button" class="ext-close" :title="t('common.close')" :aria-label="t('common.close')" @click="close">
        <X :size="18" />
      </button>
    </header>

    <div class="ext-detail-body pretty-scrollbar">
      <p v-if="loading" class="ext-hint">{{ t('extensions.detailLoading') }}</p>
      <p v-else-if="!extension" class="ext-hint">{{ t('extensions.detailNotFound') }}</p>
      <template v-else>
        <p v-if="extension.description" class="ext-desc">{{ extension.description }}</p>

        <section v-if="contributes?.commands?.length || contributes?.languages?.length || contributes?.grammars?.length || contributes?.themes?.length || extension.activationEvents?.length" class="ext-section">
          <h2>{{ t('extensions.contributions') }}</h2>
          <div v-if="contributes?.commands?.length" class="ext-contrib">
            <h3>{{ t('extensions.commandsLabel') }} ({{ contributes.commands.length }})</h3>
            <ul>
              <li v-for="c in contributes.commands" :key="c.command"><code>{{ c.command }}</code> — {{ c.title ?? c.command }}</li>
            </ul>
          </div>
          <div v-if="contributes?.languages?.length" class="ext-contrib">
            <h3>{{ t('extensions.languagesLabel') }}</h3>
            <div class="ext-tags"><span v-for="l in contributes.languages" :key="l.id">{{ l.id }}</span></div>
          </div>
          <div v-if="contributes?.grammars?.length" class="ext-contrib">
            <h3>{{ t('extensions.grammarsLabel') }}</h3>
            <div class="ext-tags"><span v-for="(g, i) in contributes.grammars" :key="i">{{ g.language ?? g.scopeName ?? 'grammar' }}</span></div>
          </div>
          <div v-if="contributes?.themes?.length" class="ext-contrib">
            <h3>{{ t('extensions.themesLabel') }}</h3>
            <div class="ext-tags"><span v-for="(th, i) in contributes.themes" :key="i">{{ th.label ?? th.id }}</span></div>
          </div>
          <div v-if="extension.activationEvents?.length" class="ext-contrib">
            <h3>{{ t('extensions.activationEventsLabel') }}</h3>
            <div class="ext-tags mono"><span v-for="(e, i) in extension.activationEvents" :key="i">{{ e }}</span></div>
          </div>
        </section>

        <section v-if="readmeHtml" class="ext-section">
          <h2>README</h2>
          <!-- eslint-disable-next-line vue/no-v-html -->
          <div class="ext-readme markdown-body" v-html="readmeHtml" />
        </section>
        <p v-else class="ext-hint">{{ t('extensions.noReadme') }}</p>
      </template>
    </div>
  </section>
</template>

<style scoped>
.ext-detail {
  @apply flex h-full min-h-0 flex-col bg-codex-bg text-codex-text;
}
.ext-detail-head {
  @apply flex shrink-0 items-start gap-4 border-b border-codex-border px-6 py-5;
}
.ext-detail-icon {
  @apply flex h-16 w-16 shrink-0 items-center justify-center rounded-xl text-codex-text-secondary;
  background: color-mix(in srgb, var(--codex-hover) 78%, transparent);
}
.ext-detail-headmeta {
  @apply min-w-0 flex-1;
}
.ext-detail-titlerow {
  @apply flex flex-wrap items-center gap-2;
}
.ext-detail-titlerow h1 {
  @apply text-[20px] font-bold;
}
.ext-badge {
  @apply inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-semibold uppercase text-codex-text-secondary;
  background: color-mix(in srgb, var(--codex-hover) 88%, transparent);
}
.ext-badge.disabled {
  color: #b45309;
  background: rgb(245 158 11 / 16%);
}
.ext-detail-subtitle {
  @apply mt-1 truncate text-[12px] text-codex-muted;
}
.ext-detail-actions {
  @apply mt-3 flex flex-wrap items-center gap-2;
}
.ext-btn {
  @apply inline-flex h-8 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium text-codex-text-secondary transition-colors hover:bg-codex-hover hover:text-codex-text;
  border-color: var(--codex-border);
}
.ext-btn.primary {
  @apply border-transparent text-codex-bg;
  background: var(--codex-text);
}
.ext-btn.danger {
  @apply text-red-600 hover:bg-red-50 hover:text-red-600;
  border-color: color-mix(in srgb, #e5484d 40%, var(--codex-border));
}
:global([data-theme='dark']) .ext-btn.danger {
  @apply text-red-400 hover:bg-red-950/40;
}
.ext-close {
  @apply flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-codex-muted transition-colors hover:bg-codex-hover hover:text-codex-text;
}
.ext-detail-body {
  @apply min-h-0 flex-1 overflow-y-auto px-6 py-5;
}
.ext-hint {
  @apply text-[13px] text-codex-muted;
}
.ext-desc {
  @apply text-[14px] leading-relaxed text-codex-text-secondary;
}
.ext-section {
  @apply mt-6;
}
.ext-section h2 {
  @apply mb-2 border-b border-codex-border pb-1 text-[13px] font-bold uppercase tracking-wide text-codex-text-secondary;
}
.ext-contrib {
  @apply mt-3;
}
.ext-contrib h3 {
  @apply mb-1 text-[12px] font-semibold text-codex-text;
}
.ext-contrib ul {
  @apply flex flex-col gap-0.5 text-[12px] text-codex-text-secondary;
}
.ext-contrib code {
  @apply rounded bg-codex-hover px-1 py-0.5 text-[11px];
}
.ext-tags {
  @apply flex flex-wrap gap-1.5;
}
.ext-tags span {
  @apply rounded px-1.5 py-0.5 text-[11px] font-medium text-codex-text-secondary;
  background: color-mix(in srgb, var(--codex-hover) 80%, transparent);
}
.ext-tags.mono span {
  @apply font-mono text-[10px];
}
.ext-readme {
  @apply mt-2 text-[13px] leading-relaxed text-codex-text-secondary;
}
</style>
