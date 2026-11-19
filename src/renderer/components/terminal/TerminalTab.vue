<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useI18n } from 'vue-i18n'
import { useTerminalStore } from '../../stores/terminal.store.js'
import { useThemeStore } from '../../stores/theme.store.js'
import { resolveTerminalTheme } from '../../utils/terminal-theme.js'
import { scrollToNextCommand, scrollToPreviousCommand } from '../../utils/terminal-command.js'
import {
  attachTerminalShortcuts,
  registerTerminalSession,
  unregisterTerminalSession
} from '../../services/terminal-session.registry.js'
import { ipc, unwrap } from '../../services/ipc-client.js'
import 'xterm/css/xterm.css'

const props = defineProps<{
  sessionId: string
  visible: boolean
  focused?: boolean
}>()

const isFocused = computed(() => props.focused ?? props.visible)

const { t } = useI18n()
const terminalStore = useTerminalStore()
const themeStore = useThemeStore()
const containerRef = ref<HTMLDivElement | null>(null)
const linkTip = ref<{ text: string; x: number; y: number } | null>(null)

let term: Terminal | null = null
let fitAddon: FitAddon | null = null
let webLinksAddon: WebLinksAddon | null = null
let resizeObserver: ResizeObserver | null = null
let unsubscribeData: (() => void) | null = null
let inputBuffer = ''
let initAborted = false

function containerHasDimensions(el: HTMLElement): boolean {
  return el.clientWidth > 0 && el.clientHeight > 0
}

function waitForContainerDimensions(el: HTMLElement): Promise<boolean> {
  if (containerHasDimensions(el)) return Promise.resolve(true)

  return new Promise((resolve) => {
    let attempts = 0
    const check = () => {
      if (initAborted || containerRef.value !== el) {
        resolve(false)
        return
      }
      if (containerHasDimensions(el)) {
        resolve(true)
        return
      }
      attempts += 1
      if (attempts >= 60) {
        resolve(false)
        return
      }
      requestAnimationFrame(check)
    }
    requestAnimationFrame(check)
  })
}

const surfaceBackground = computed(() =>
  resolveTerminalTheme(themeStore.resolvedMode).background ?? '#ffffff'
)

function applyTerminalTheme(): void {
  if (!term) return
  term.options.theme = resolveTerminalTheme(themeStore.resolvedMode)
}

function fitAndResize(): void {
  if (!term || !fitAddon || !props.visible || !containerRef.value) return
  if (!containerHasDimensions(containerRef.value)) return
  fitAddon.fit()
  void terminalStore.resize(props.sessionId, term.cols, term.rows)
}

function openTerminalLink(event: MouseEvent, uri: string): void {
  if (!event.metaKey && !event.ctrlKey) return
  event.preventDefault()
  void unwrap(ipc.app.openExternal(uri))
}

function showLinkTip(event: MouseEvent): void {
  linkTip.value = {
    text: t('terminal.openLink'),
    x: event.clientX,
    y: event.clientY
  }
}

function hideLinkTip(): void {
  linkTip.value = null
}

onMounted(async () => {
  const container = containerRef.value
  if (!container) return

  await nextTick()
  const ready = await waitForContainerDimensions(container)
  if (!ready || initAborted || !containerRef.value) return

  term = new Terminal({
    theme: resolveTerminalTheme(themeStore.resolvedMode),
    fontSize: 13,
    lineHeight: 1.35,
    fontFamily: 'SF Mono, Menlo, Monaco, "Cascadia Code", "Courier New", monospace',
    fontWeight: '500',
    cursorBlink: true,
    cursorStyle: 'block',
    cursorWidth: 1,
    scrollback: 5000,
    drawBoldTextInBrightColors: true,
    allowProposedApi: true
  })

  fitAddon = new FitAddon()
  term.loadAddon(fitAddon)
  webLinksAddon = new WebLinksAddon(openTerminalLink, {
    hover: (event) => showLinkTip(event),
    leave: () => hideLinkTip()
  })
  term.loadAddon(webLinksAddon)
  term.open(containerRef.value)

  const handle = {
    sessionId: props.sessionId,
    clear: () => term?.clear(),
    scrollToPreviousCommand: () => (term ? scrollToPreviousCommand(term) : false),
    scrollToNextCommand: () => (term ? scrollToNextCommand(term) : false),
    getSelection: () => term?.getSelection() ?? '',
    focus: () => term?.focus()
  }
  registerTerminalSession(handle)
  attachTerminalShortcuts(term, handle)

  term.onData((data) => {
    trackInput(data)
    void terminalStore.write(props.sessionId, data)
  })

  unsubscribeData = ipc.terminal.onData(({ id, data }: { id: string; data: string }) => {
    if (id === props.sessionId && term) {
      term.write(data)
    }
  })

  resizeObserver = new ResizeObserver(() => fitAndResize())
  resizeObserver.observe(containerRef.value)

  if (props.visible) {
    requestAnimationFrame(fitAndResize)
  }
})

onUnmounted(() => {
  initAborted = true
  hideLinkTip()
  unregisterTerminalSession(props.sessionId)
  unsubscribeData?.()
  resizeObserver?.disconnect()
  webLinksAddon?.dispose()
  webLinksAddon = null
  term?.dispose()
})

function trackInput(data: string): void {
  if (data === '\r') {
    if (inputBuffer.trim()) terminalStore.recordCommand(inputBuffer)
    inputBuffer = ''
    return
  }
  if (data === '\u007f') {
    inputBuffer = inputBuffer.slice(0, -1)
    return
  }
  if (data === '\u0003' || data === '\u0015') {
    inputBuffer = ''
    return
  }
  if (data === '\u0016') {
    const pasted = term?.getSelection() ?? ''
    if (pasted) inputBuffer += pasted.replace(/\r?\n/g, ' ')
    return
  }
  for (const char of data) {
    const code = char.charCodeAt(0)
    if (code >= 32 && code !== 127) inputBuffer += char
  }
}

watch(
  () => themeStore.resolvedMode,
  () => applyTerminalTheme()
)

watch(
  () => props.visible,
  (visible) => {
    if (visible) requestAnimationFrame(fitAndResize)
  }
)

watch(
  () => isFocused.value,
  (focused) => {
    if (focused && props.visible) {
      setTimeout(() => {
        fitAndResize()
        term?.focus()
      }, 50)
    }
  }
)

watch(
  () => terminalStore.visible,
  (visible) => {
    if (visible && props.visible) {
      setTimeout(fitAndResize, 100)
    }
  }
)

watch(
  () => terminalStore.splitPaneSizes,
  () => {
    if (props.visible) setTimeout(fitAndResize, 50)
  },
  { deep: true }
)

watch(
  () => terminalStore.sessionsSidebarWidth,
  () => {
    if (props.visible) setTimeout(fitAndResize, 50)
  }
)
</script>

<template>
  <div
    ref="containerRef"
    class="terminal-tab"
    :class="{ 'is-visible': visible, 'is-focused': isFocused }"
    :style="{ '--term-surface-bg': surfaceBackground }"
    @mousedown="isFocused && term?.focus()"
  />
  <div
    v-if="linkTip && visible"
    class="terminal-link-tip"
    :style="{ left: `${linkTip.x + 12}px`, top: `${linkTip.y + 16}px` }"
  >
    {{ linkTip.text }}
  </div>
</template>

<style scoped>
.terminal-tab {
  @apply absolute inset-0 overflow-hidden;
  visibility: hidden;
  pointer-events: none;
  background: var(--term-surface-bg, #ffffff);
}
.terminal-tab.is-visible {
  visibility: visible;
  pointer-events: auto;
}
.terminal-tab.is-focused {
  z-index: 1;
}
.terminal-tab :deep(.xterm) {
  height: 100%;
  padding: 6px 10px;
}
.terminal-tab :deep(.xterm-rows) {
  font-weight: 500;
}
.terminal-tab :deep(.xterm-screen) {
  outline: none;
}
.terminal-tab :deep(.xterm-viewport) {
  scrollbar-width: thin;
  scrollbar-color: transparent transparent;
  background-color: var(--term-surface-bg, #ffffff) !important;
}
.terminal-tab:hover :deep(.xterm-viewport),
.terminal-tab.is-focused :deep(.xterm-viewport) {
  scrollbar-color: var(--scrollbar-thumb, color-mix(in srgb, var(--codex-text) 14%, transparent)) transparent;
}
.terminal-tab :deep(.xterm-viewport::-webkit-scrollbar) {
  width: 6px;
}
.terminal-tab :deep(.xterm-viewport::-webkit-scrollbar-track) {
  background: transparent;
}
.terminal-tab :deep(.xterm-viewport::-webkit-scrollbar-thumb) {
  background-color: transparent;
  border-radius: 999px;
  transition: background-color 0.18s ease;
}
.terminal-tab:hover :deep(.xterm-viewport::-webkit-scrollbar-thumb),
.terminal-tab.is-focused :deep(.xterm-viewport::-webkit-scrollbar-thumb) {
  background-color: var(--scrollbar-thumb, color-mix(in srgb, var(--codex-text) 14%, transparent));
}
.terminal-tab :deep(.xterm-viewport::-webkit-scrollbar-thumb:hover) {
  background-color: var(--scrollbar-thumb-hover, color-mix(in srgb, var(--codex-text) 24%, transparent));
}
.terminal-tab :deep(.xterm-decoration-container .xterm-decoration) {
  cursor: pointer;
}
.terminal-link-tip {
  position: fixed;
  z-index: 120;
  pointer-events: none;
  border: 1px solid var(--codex-border, #e5e5e5);
  border-radius: 8px;
  background: var(--codex-bg, #fafafa);
  padding: 4px 8px;
  color: var(--codex-text-secondary, #4a4a4a);
  font-size: 11px;
  line-height: 1.35;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
  white-space: nowrap;
}
</style>
