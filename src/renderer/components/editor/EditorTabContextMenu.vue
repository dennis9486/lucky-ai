<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import type { OpenFileTab } from '../../../shared/types/workspace.js'
import { ipc, unwrap } from '../../services/ipc-client.js'
import { useEditorStore } from '../../stores/editor.store.js'
import { useWorkspaceStore } from '../../stores/workspace.store.js'

const props = defineProps<{
  tab: OpenFileTab
  x: number
  y: number
}>()

const emit = defineEmits<{
  close: []
  closeTab: [tab: OpenFileTab]
  closeOthers: [tab: OpenFileTab]
  closeRight: [tab: OpenFileTab]
  closeSaved: []
  closeAll: []
}>()

const { t } = useI18n()
const editor = useEditorStore()
const workspace = useWorkspaceStore()

const absolutePath = computed(() => {
  const root = workspace.workspace?.rootPath
  if (!root || props.tab.path.startsWith('/')) return props.tab.path
  return `${root.replace(/\/$/, '')}/${props.tab.path.replace(/^\//, '')}`
})

const canCloseToRight = computed(() => {
  const index = editor.tabs.findIndex((tab) => tab.path === props.tab.path)
  return index >= 0 && index < editor.tabs.length - 1
})

const hasSavedTabs = computed(() => editor.tabs.some((tab) => !tab.isDirty))

function run(action: () => void | Promise<void>): void {
  void Promise.resolve(action()).finally(() => emit('close'))
}

async function copyPath(): Promise<void> {
  await navigator.clipboard.writeText(absolutePath.value)
}

async function copyRelativePath(): Promise<void> {
  await navigator.clipboard.writeText(props.tab.path)
}

async function revealInFinder(): Promise<void> {
  await unwrap(ipc.app.showItemInFolder(absolutePath.value))
}

function handleWindowEvent(): void {
  emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', handleWindowEvent)
  window.addEventListener('scroll', handleWindowEvent, true)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', handleWindowEvent)
  window.removeEventListener('scroll', handleWindowEvent, true)
})

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') emit('close')
}
</script>

<template>
  <div class="tab-menu-scrim" @mousedown="emit('close')" @contextmenu.prevent="emit('close')" />
  <div
    class="tab-context-menu"
    :style="{ left: `${x}px`, top: `${y}px` }"
    role="menu"
    @mousedown.stop
    @contextmenu.prevent.stop
  >
    <button type="button" role="menuitem" class="menu-row" @click="run(() => emit('closeTab', tab))">
      <span>{{ t('editor.tabMenu.close') }}</span>
      <kbd>⌘W</kbd>
    </button>
    <button type="button" role="menuitem" class="menu-row" :disabled="editor.tabs.length <= 1" @click="run(() => emit('closeOthers', tab))">
      <span>{{ t('editor.tabMenu.closeOthers') }}</span>
    </button>
    <button type="button" role="menuitem" class="menu-row" :disabled="!canCloseToRight" @click="run(() => emit('closeRight', tab))">
      <span>{{ t('editor.tabMenu.closeRight') }}</span>
    </button>
    <button type="button" role="menuitem" class="menu-row" :disabled="!hasSavedTabs" @click="run(() => emit('closeSaved'))">
      <span>{{ t('editor.tabMenu.closeSaved') }}</span>
    </button>
    <button type="button" role="menuitem" class="menu-row" :disabled="!editor.tabs.length" @click="run(() => emit('closeAll'))">
      <span>{{ t('editor.tabMenu.closeAll') }}</span>
    </button>

    <div class="menu-divider" />

    <button type="button" role="menuitem" class="menu-row" @click="run(() => editor.openToSide(tab.path))">
      <span>{{ t('editor.tabMenu.openToSide') }}</span>
      <kbd>⌥⌘\\</kbd>
    </button>
    <button v-if="editor.splitEnabled" type="button" role="menuitem" class="menu-row" @click="run(() => editor.closeSplit())">
      <span>{{ t('editor.tabMenu.closeSplit') }}</span>
    </button>

    <div class="menu-divider" />

    <button type="button" role="menuitem" class="menu-row" @click="run(copyPath)">
      <span>{{ t('editor.tabMenu.copyPath') }}</span>
      <kbd>⌥⌘C</kbd>
    </button>
    <button type="button" role="menuitem" class="menu-row" @click="run(copyRelativePath)">
      <span>{{ t('editor.tabMenu.copyRelativePath') }}</span>
      <kbd>⌥⇧⌘C</kbd>
    </button>

    <div class="menu-divider" />

    <button type="button" role="menuitem" class="menu-row" @click="run(revealInFinder)">
      <span>{{ t('editor.tabMenu.revealInFinder') }}</span>
      <kbd>⌥⌘R</kbd>
    </button>
  </div>
</template>

<style scoped>
.tab-menu-scrim {
  position: fixed;
  inset: 0;
  z-index: 80;
}
.tab-context-menu {
  position: fixed;
  z-index: 81;
  width: 284px;
  max-width: calc(100vw - 16px);
  overflow: hidden;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 12px;
  background: rgba(250, 250, 250, 0.96);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.16), 0 2px 8px rgba(0, 0, 0, 0.08);
  padding: 6px;
  backdrop-filter: blur(18px);
}
.menu-row {
  display: flex;
  width: 100%;
  height: 32px;
  align-items: center;
  justify-content: space-between;
  gap: 14px;
  border-radius: 7px;
  padding: 0 10px;
  color: #202124;
  font-size: 13px;
  font-weight: 500;
  text-align: left;
}
.menu-row:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.06);
}
.menu-row:disabled {
  cursor: default;
  color: #b5b5b5;
}
.menu-row kbd {
  flex-shrink: 0;
  color: #9b9b9b;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
}
.menu-divider {
  height: 1px;
  margin: 6px 4px;
  background: rgba(0, 0, 0, 0.09);
}
:global([data-theme='dark']) .tab-context-menu {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(38, 38, 38, 0.96);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.36), 0 2px 8px rgba(0, 0, 0, 0.28);
}
:global([data-theme='dark']) .menu-row {
  color: #ededed;
}
:global([data-theme='dark']) .menu-row:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.09);
}
:global([data-theme='dark']) .menu-row:disabled {
  color: #6f6f6f;
}
:global([data-theme='dark']) .menu-divider {
  background: rgba(255, 255, 255, 0.1);
}
</style>
