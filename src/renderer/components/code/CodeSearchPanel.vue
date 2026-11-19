<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  ChevronDown,
  ChevronRight,
  FileText,
  ListX,
  RefreshCw,
  Search
} from 'lucide-vue-next'
import type { FileContentSearchResult } from '../../../shared/types/workspace.js'
import { ipc, unwrap } from '../../services/ipc-client.js'
import { useEditorStore } from '../../stores/editor.store.js'
import { useProjectStore } from '../../stores/project.store.js'
import { getFileIcon } from '../../utils/file-icons.js'

const { t } = useI18n()
const editor = useEditorStore()
const projects = useProjectStore()

const query = ref('')
const replacement = ref('')
const includes = ref('')
const excludes = ref('')
const caseSensitive = ref(false)
const wholeWord = ref(false)
const regex = ref(false)
const detailsOpen = ref(false)
const loading = ref(false)
const error = ref('')
const didSearch = ref(false)
const expanded = ref(new Set<string>())
const results = ref<FileContentSearchResult[]>([])
const failedIcons = ref(new Set<string>())

let searchTimer: ReturnType<typeof setTimeout> | null = null
let searchSeq = 0

const matchCount = computed(() => results.value.reduce((sum, item) => sum + item.matches.length, 0))
const canSearch = computed(() => projects.hasWorkspace && query.value.trim().length > 0)
const canReplace = computed(() => canSearch.value && replacement.value.length > 0 && matchCount.value > 0 && !loading.value)

watch([query, includes, excludes, caseSensitive, wholeWord, regex], () => {
  scheduleSearch()
})

function scheduleSearch(): void {
  if (searchTimer) clearTimeout(searchTimer)
  if (!query.value.trim()) {
    results.value = []
    error.value = ''
    didSearch.value = false
    return
  }
  searchTimer = setTimeout(() => {
    void runSearch()
  }, 220)
}

async function runSearch(): Promise<void> {
  if (!canSearch.value) return
  const seq = ++searchSeq
  loading.value = true
  error.value = ''
  didSearch.value = true

  try {
    const nextResults = await unwrap<FileContentSearchResult[]>(ipc.workspace.searchContent({
      query: query.value,
      includes: includes.value,
      excludes: excludes.value,
      caseSensitive: caseSensitive.value,
      wholeWord: wholeWord.value,
      regex: regex.value,
      maxResults: 1000
    }))
    if (seq !== searchSeq) return
    results.value = nextResults
    expanded.value = new Set(nextResults.slice(0, 20).map((item) => item.path))
  } catch (e) {
    if (seq !== searchSeq) return
    error.value = e instanceof Error ? e.message : String(e)
    results.value = []
  } finally {
    if (seq === searchSeq) loading.value = false
  }
}

async function replaceVisibleResults(): Promise<void> {
  if (!canReplace.value) return
  loading.value = true
  error.value = ''
  const paths = results.value.map((item) => item.path)
  try {
    await unwrap(ipc.workspace.replaceContent({
      query: query.value,
      replacement: replacement.value,
      includes: includes.value,
      excludes: excludes.value,
      caseSensitive: caseSensitive.value,
      wholeWord: wholeWord.value,
      regex: regex.value,
      paths
    }))
    await editor.reloadFiles(paths)
    await runSearch()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function toggleResult(path: string): void {
  const next = new Set(expanded.value)
  if (next.has(path)) next.delete(path)
  else next.add(path)
  expanded.value = next
}

function clearResults(): void {
  query.value = ''
  replacement.value = ''
  results.value = []
  error.value = ''
  didSearch.value = false
}

function toggleFlag(flag: 'case' | 'whole' | 'regex'): void {
  if (flag === 'case') caseSensitive.value = !caseSensitive.value
  if (flag === 'whole') wholeWord.value = !wholeWord.value
  if (flag === 'regex') regex.value = !regex.value
}

function openMatch(result: FileContentSearchResult, index: number): void {
  const match = result.matches[index]
  if (!match) return
  void editor.openFile(result.path, {
    lineNumber: match.lineNumber,
    column: match.startColumn,
    endColumn: match.endColumn
  })
}

function getResultIcon(path: string): string {
  return failedIcons.value.has(path) ? '' : getFileIcon(path)
}

function fallbackResultIcon(path: string): void {
  failedIcons.value = new Set([...failedIcons.value, path])
}
</script>

<template>
  <section class="code-search-panel">
    <header class="search-header">
      <h2>{{ t('code.searchTitle') }}</h2>
      <div class="search-header-actions">
        <button type="button" class="icon-btn" :title="t('code.refresh')" :disabled="loading || !canSearch" @click="runSearch">
          <RefreshCw :size="14" :class="{ spinning: loading }" />
        </button>
        <button type="button" class="icon-btn" :title="t('code.clearSearch')" @click="clearResults">
          <ListX :size="15" />
        </button>
      </div>
    </header>

    <div class="search-fields">
      <div class="search-input-row">
        <button
          type="button"
          class="replace-toggle"
          :class="{ active: detailsOpen }"
          :title="t('code.toggleSearchDetails')"
          @click="detailsOpen = !detailsOpen"
        >
          <ChevronDown v-if="detailsOpen" :size="14" />
          <ChevronRight v-else :size="14" />
        </button>
        <div class="field-shell">
          <input
            v-model="query"
            type="text"
            spellcheck="false"
            :placeholder="t('code.searchPlaceholder')"
            @keydown.enter.prevent="runSearch"
          />
          <div class="search-flags">
            <button
              type="button"
              class="text-flag"
              :class="{ active: caseSensitive }"
              :title="t('code.matchCase')"
              @click="toggleFlag('case')"
            >
              Aa
            </button>
            <button
              type="button"
              class="text-flag whole-word"
              :class="{ active: wholeWord }"
              :title="t('code.matchWholeWord')"
              @click="toggleFlag('whole')"
            >
              ab
            </button>
            <button
              type="button"
              class="text-flag regex"
              :class="{ active: regex }"
              :title="t('code.useRegex')"
              @click="toggleFlag('regex')"
            >
              <span class="regex-dot" aria-hidden="true">.</span>*
            </button>
          </div>
        </div>
      </div>

      <template v-if="detailsOpen">
      <div class="search-input-row replace-row">
        <span class="replace-spacer" />
        <div class="field-shell">
          <input
            v-model="replacement"
            type="text"
            spellcheck="false"
            :placeholder="t('code.replacePlaceholder')"
          />
          <button type="button" class="replace-all-btn" :disabled="!canReplace" :title="t('code.replaceAll')" @click="replaceVisibleResults">
            AB
          </button>
        </div>
      </div>

      <label class="path-field">
        <span>{{ t('code.filesToInclude') }}</span>
        <input v-model="includes" type="text" spellcheck="false" placeholder="src/**, *.vue" />
      </label>
      <label class="path-field">
        <span>{{ t('code.filesToExclude') }}</span>
        <input v-model="excludes" type="text" spellcheck="false" placeholder="dist/**, *.lock" />
      </label>
      </template>
    </div>

    <div v-if="loading || didSearch || error" class="search-summary">
      <span v-if="loading">{{ t('code.searching') }}</span>
      <span v-else-if="error" class="error-text">{{ error }}</span>
      <span v-else>{{ t('code.searchSummary', { files: results.length, matches: matchCount }) }}</span>
    </div>

    <div class="result-list pretty-scrollbar">
      <div v-if="!projects.hasWorkspace" class="empty-state">
        <FileText :size="24" />
        <p>{{ t('code.openProjectHint') }}</p>
      </div>
      <div v-else-if="didSearch && !loading && !error && !results.length" class="empty-state">
        <Search :size="24" />
        <p>{{ t('code.noSearchResults') }}</p>
      </div>
      <div
        v-for="result in results"
        :key="result.path"
        class="result-file"
      >
        <button type="button" class="result-file-head" @click="toggleResult(result.path)">
          <ChevronDown v-if="expanded.has(result.path)" :size="14" />
          <ChevronRight v-else :size="14" />
          <img
            v-if="getResultIcon(result.path)"
            class="result-file-icon"
            :src="getResultIcon(result.path)"
            alt=""
            loading="lazy"
            @error="fallbackResultIcon(result.path)"
          />
          <FileText v-else :size="14" class="result-fallback-icon" />
          <span class="result-name">{{ result.name }}</span>
          <span class="result-count">{{ result.matches.length }}</span>
        </button>
        <div v-if="expanded.has(result.path)" class="result-matches">
          <button
            v-for="(match, index) in result.matches"
            :key="`${result.path}:${match.lineNumber}:${match.startColumn}:${index}`"
            type="button"
            class="result-match"
            @click="openMatch(result, index)"
          >
            <span class="line-number">{{ match.lineNumber }}</span>
            <span class="preview">{{ match.preview }}</span>
          </button>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.code-search-panel {
  @apply flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-codex-sidebar text-codex-text;
}
.search-header {
  @apply flex h-9 shrink-0 items-center justify-between px-4;
}
.search-header h2 {
  @apply text-[13px] font-bold uppercase tracking-wide text-codex-text;
}
.search-header-actions {
  @apply flex items-center gap-1;
}
.icon-btn {
  @apply flex h-7 w-7 items-center justify-center rounded-md text-codex-text-secondary
         transition-colors hover:bg-codex-hover hover:text-codex-text disabled:cursor-not-allowed disabled:opacity-35;
}
.search-fields {
  @apply shrink-0 space-y-2 px-3 pb-2;
}
.search-input-row {
  @apply flex items-center gap-1.5;
}
.replace-toggle,
.replace-spacer {
  @apply flex h-8 w-5 shrink-0 items-center justify-center text-codex-text-secondary;
}
.replace-toggle {
  @apply rounded-md transition-colors hover:bg-codex-hover hover:text-codex-text;
}
.replace-toggle.active {
  @apply text-codex-text;
}
.field-shell {
  @apply flex h-[26px] min-w-0 flex-1 items-center rounded border bg-codex-bg px-2;
  border-color: color-mix(in srgb, var(--codex-border) 92%, #000);
}
.field-shell:focus-within {
  border-color: color-mix(in srgb, var(--codex-border-hover) 88%, #000);
}
.field-shell input {
  @apply min-w-0 flex-1 bg-transparent text-[13px] text-codex-text outline-none;
}
.field-shell input::placeholder {
  color: color-mix(in srgb, var(--codex-muted) 92%, #666);
  font-weight: 400;
}
.search-flags {
  @apply flex shrink-0 items-center gap-0.5 pl-1;
}
.text-flag {
  min-width: 22px;
  height: 20px;
  padding: 0 3px;
  border: 0;
  background: transparent;
  color: color-mix(in srgb, var(--codex-muted) 88%, #666);
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  transition: color 0.12s ease;
}
.text-flag:hover {
  color: var(--codex-text-secondary);
}
.text-flag.active {
  color: var(--codex-text);
}
.text-flag.whole-word.active {
  text-decoration: underline;
  text-decoration-thickness: 1px;
  text-underline-offset: 2px;
}
.text-flag.regex {
  display: inline-flex;
  align-items: center;
  gap: 0;
  font-family: var(--codex-code-font);
  font-size: 11px;
  letter-spacing: 0.01em;
}
.regex-dot {
  opacity: 0.92;
}
.replace-all-btn {
  @apply h-6 rounded px-1.5 text-[12px] font-semibold text-codex-text-secondary transition-colors
         hover:bg-codex-hover hover:text-codex-text disabled:cursor-not-allowed disabled:opacity-35;
}
.path-field {
  @apply block;
}
.path-field span {
  @apply mb-1 block px-6 text-[13px] font-semibold lowercase text-codex-text-secondary;
}
.path-field input {
  @apply ml-6 h-8 w-[calc(100%-1.5rem)] rounded-md border bg-codex-bg px-2 text-[12px]
         font-medium text-codex-text outline-none focus:border-codex-accent;
  border-color: color-mix(in srgb, var(--codex-border) 86%, #000);
}
.path-field input::placeholder {
  color: color-mix(in srgb, var(--codex-muted) 86%, #333);
}
.search-summary {
  @apply shrink-0 border-y border-codex-border px-4 py-2 text-[12px] font-semibold text-codex-text;
}
.error-text {
  @apply text-red-500;
}
.result-list {
  @apply min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--codex-text-secondary) 28%, transparent) transparent;
}
.result-list::-webkit-scrollbar {
  width: 8px;
}
.result-list::-webkit-scrollbar-track {
  background: transparent;
}
.result-list::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background-clip: content-box;
  background-color: color-mix(in srgb, var(--codex-text-secondary) 32%, transparent);
}
.empty-state {
  @apply flex min-h-[180px] flex-col items-center justify-center gap-2 px-6 text-center text-[12px] font-medium leading-relaxed text-codex-text-secondary;
}
.result-file {
  @apply border-b;
  border-color: color-mix(in srgb, var(--codex-border) 88%, transparent);
}
.result-file-head {
  @apply flex h-9 w-full items-center gap-1.5 px-3 text-left text-[13px] font-semibold text-codex-text
         transition-colors hover:bg-codex-hover hover:text-codex-text;
}
.result-file-icon {
  @apply h-4 w-4 shrink-0 object-contain;
}
.result-fallback-icon {
  @apply shrink-0 text-codex-text-secondary;
}
.result-name {
  @apply min-w-0 flex-1 truncate;
}
.result-count {
  @apply rounded-md bg-codex-hover px-1.5 py-0.5 text-[11px] font-semibold text-codex-text;
}
.result-matches {
  @apply pb-1;
}
.result-match {
  @apply flex w-full gap-2 px-8 py-1.5 text-left text-[12px] leading-snug transition-colors hover:bg-codex-hover;
}
.line-number {
  @apply w-8 shrink-0 text-right font-mono text-[12px] font-medium text-codex-text-secondary;
  opacity: 0.9;
}
.preview {
  @apply min-w-0 flex-1 truncate font-mono text-[12px] font-semibold text-codex-text;
  opacity: 0.82;
}
.spinning {
  animation: search-spin 0.9s linear infinite;
}
@keyframes search-spin {
  to { transform: rotate(360deg); }
}
</style>
