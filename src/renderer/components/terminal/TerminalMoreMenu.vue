<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import ContextMenu, { type ContextMenuItem } from '../common/ContextMenu.vue'
import { getActiveEditorPath, getEditorSelection } from '../../services/editor-selection.registry.js'
import { getActiveTerminalSession } from '../../services/terminal-session.registry.js'
import { buildRunCommand } from '../../utils/terminal-command.js'
import { useTerminalStore } from '../../stores/terminal.store.js'

type MenuMode = 'main' | 'recent-dir' | 'recent-command'

const terminal = useTerminalStore()
const { t } = useI18n()

const open = ref(false)
const mode = ref<MenuMode>('main')
const anchorRef = ref<HTMLElement | null>(null)
const menuPos = ref({ x: 0, y: 0 })

const activeHandle = computed(() => getActiveTerminalSession(terminal.activeTab?.sessionId))

const canRunActiveFile = computed(() => {
  const path = getActiveEditorPath()
  return Boolean(path && buildRunCommand(path))
})

const canRunSelectedText = computed(() => Boolean(getEditorSelection()?.trim()))

const menuItems = computed<ContextMenuItem[]>(() => {
  if (mode.value === 'recent-dir') {
    return [
      { id: 'back', label: t('terminalMenu.back') },
      { id: 'sep-back', separator: true },
      ...(terminal.recentDirectories.length
        ? terminal.recentDirectories.map((dir) => ({ id: `dir:${dir}`, label: dir }))
        : [{ id: 'empty', label: t('terminalMenu.noRecentDirectory'), disabled: true }])
    ]
  }

  if (mode.value === 'recent-command') {
    return [
      { id: 'back', label: t('terminalMenu.back') },
      { id: 'sep-back', separator: true },
      ...(terminal.recentCommands.length
        ? terminal.recentCommands.map((command) => ({
            id: `cmd:${command}`,
            label: command.length > 72 ? `${command.slice(0, 69)}…` : command
          }))
        : [{ id: 'empty', label: t('terminalMenu.noRecentCommand'), disabled: true }])
    ]
  }

  return [
    {
      id: 'scroll-prev',
      label: t('terminalMenu.scrollPrevious'),
      shortcut: '⌘↑',
      disabled: !activeHandle.value
    },
    {
      id: 'scroll-next',
      label: t('terminalMenu.scrollNext'),
      shortcut: '⌘↓',
      disabled: !activeHandle.value
    },
    {
      id: 'clear',
      label: t('terminalMenu.clear'),
      shortcut: '⌘K',
      disabled: !activeHandle.value
    },
    {
      id: 'run-file',
      label: t('terminalMenu.runActiveFile'),
      disabled: !canRunActiveFile.value
    },
    {
      id: 'run-selection',
      label: t('terminalMenu.runSelectedText'),
      disabled: !canRunSelectedText.value
    },
    { id: 'sep-1', separator: true },
    {
      id: 'recent-dir',
      label: t('terminalMenu.recentDirectory'),
      shortcut: '⌘G'
    },
    {
      id: 'recent-command',
      label: t('terminalMenu.recentCommand'),
      shortcut: '⌃⌥R'
    }
  ]
})

function openMenu(): void {
  const anchor = anchorRef.value
  if (!anchor) return
  const rect = anchor.getBoundingClientRect()
  mode.value = 'main'
  menuPos.value = {
    x: Math.max(8, rect.right - 300),
    y: rect.bottom + 4
  }
  open.value = true
}

function closeMenu(): void {
  open.value = false
  mode.value = 'main'
}

function toggleMenu(): void {
  if (open.value) closeMenu()
  else openMenu()
}

async function handleSelect(item: ContextMenuItem): Promise<void> {
  if (item.disabled || item.separator) return

  if (mode.value === 'recent-dir') {
    const dir = item.id.replace(/^dir:/, '')
    closeMenu()
    await terminal.changeDirectory(dir)
    activeHandle.value?.focus()
    return
  }

  if (mode.value === 'recent-command') {
    const command = item.id.replace(/^cmd:/, '')
    closeMenu()
    await terminal.runInActiveSession(command)
    activeHandle.value?.focus()
    return
  }

  switch (item.id) {
    case 'scroll-prev':
      activeHandle.value?.scrollToPreviousCommand()
      activeHandle.value?.focus()
      closeMenu()
      break
    case 'scroll-next':
      activeHandle.value?.scrollToNextCommand()
      activeHandle.value?.focus()
      closeMenu()
      break
    case 'clear':
      activeHandle.value?.clear()
      activeHandle.value?.focus()
      closeMenu()
      break
    case 'run-file': {
      const path = getActiveEditorPath()
      const command = path ? buildRunCommand(path) : null
      closeMenu()
      if (command) {
        terminal.setActiveView('terminal')
        await terminal.runInActiveSession(command)
        activeHandle.value?.focus()
      }
      break
    }
    case 'run-selection': {
      const selection = getEditorSelection()?.trim()
      closeMenu()
      if (selection) {
        terminal.setActiveView('terminal')
        await terminal.runInActiveSession(selection.replace(/\n/g, ' && '))
        activeHandle.value?.focus()
      }
      break
    }
    case 'recent-dir':
      mode.value = 'recent-dir'
      break
    case 'recent-command':
      mode.value = 'recent-command'
      break
    case 'back':
      mode.value = 'main'
      break
    default:
      closeMenu()
  }
}

defineExpose({ toggleMenu, closeMenu })
</script>

<template>
  <button
    ref="anchorRef"
    type="button"
    class="action-btn"
    :class="{ 'is-active': open }"
    :title="t('bottomPanel.moreActions')"
    @click="toggleMenu"
  >
    <slot />
  </button>

  <ContextMenu
    v-if="open"
    :x="menuPos.x"
    :y="menuPos.y"
    :items="menuItems"
    :width="300"
    @close="closeMenu"
    @select="handleSelect"
  />
</template>

<style scoped>
.action-btn {
  @apply flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-codex-hover;
  color: var(--term-chrome-icon, var(--codex-text-secondary));
}
.action-btn:hover,
.action-btn.is-active {
  @apply bg-codex-hover;
  color: var(--term-chrome-icon-hover, var(--codex-text));
}
</style>
