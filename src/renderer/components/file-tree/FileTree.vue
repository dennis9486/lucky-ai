<script setup lang="ts">
import { computed, nextTick, provide, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { ChevronDown, ChevronRight, ChevronsDownUp, FilePlus, FolderPlus, RefreshCw } from 'lucide-vue-next'
import type { FileReadResult } from '../../../shared/types/ipc.js'
import type { FileTreeNode } from '../../../shared/types/workspace.js'
import ContextMenu, { type ContextMenuItem } from '../common/ContextMenu.vue'
import FileTreeNodeItem from './FileTreeNode.vue'
import { ipc, unwrap } from '../../services/ipc-client.js'
import { useCodeAgentStore } from '../../stores/code-agent.store.js'
import { useEditorStore } from '../../stores/editor.store.js'
import { useProjectStore } from '../../stores/project.store.js'
import { useTerminalStore } from '../../stores/terminal.store.js'
import { useUiStore } from '../../stores/ui.store.js'
import { useWorkspaceStore } from '../../stores/workspace.store.js'
import { isImagePath } from '../../utils/mention.js'
import { buildGitTreeDecorations } from '../../utils/file-tree-git.js'
import {
  ancestorDirectoryPaths,
  dirname,
  findUniqueSiblingName,
  joinPath,
  resolveCreateParentDir
} from '../../utils/file-tree-path.js'

defineProps<{ tree: FileTreeNode[] }>()

const editor = useEditorStore()
const workspace = useWorkspaceStore()
const project = useProjectStore()
const agent = useCodeAgentStore()
const terminal = useTerminalStore()
const ui = useUiStore()
const { t } = useI18n()

const sectionOpen = ref(true)
const selectedNode = ref<FileTreeNode | null>(null)
const expandedPaths = ref(new Set<string>())
const loadedChildren = ref(new Map<string, FileTreeNode[]>())
const refreshing = ref(false)
const gitDecorations = computed(() => buildGitTreeDecorations(project.gitStatus.files))

provide('fileTreeSelectedPath', computed(() => selectedNode.value?.path ?? null))
provide('fileTreeSetSelected', (node: FileTreeNode) => {
  selectedNode.value = node
})
provide('fileTreeExpandedPaths', expandedPaths)
provide('fileTreeGitDecorations', gitDecorations)
provide('fileTreeLoadedChildren', loadedChildren)

async function loadTreeChildren(path: string): Promise<FileTreeNode[]> {
  const cached = loadedChildren.value.get(path)
  if (cached) return cached
  const children = await unwrap<FileTreeNode[]>(ipc.workspace.getTree(path))
  loadedChildren.value = new Map(loadedChildren.value).set(path, children)
  return children
}

provide('fileTreeLoadChildren', loadTreeChildren)

const workspaceTitle = computed(() => {
  const name = project.activeProject?.name ?? workspace.workspace?.name
  return name?.toUpperCase() ?? t('code.workspace')
})

const createParentLabel = computed(() => {
  const parent = resolveCreateParentDir(selectedNode.value)
  return parent === '.' ? workspaceTitle.value : parent
})

const createFileTitle = computed(() => t('code.newFileIn', { folder: createParentLabel.value }))
const createFolderTitle = computed(() => t('code.newFolderIn', { folder: createParentLabel.value }))

const menu = ref<{ x: number; y: number; node: FileTreeNode } | null>(null)
const compareSource = ref<FileTreeNode | null>(null)
const renameTarget = ref<FileTreeNode | null>(null)
const renameDraft = ref('')
const renameInputRef = ref<HTMLInputElement | null>(null)
const deleteTarget = ref<FileTreeNode | null>(null)

const contextMenuItems = computed<ContextMenuItem[]>(() => {
  const node = menu.value?.node
  if (!node) return []
  const isFile = node.type === 'file'
  const hasCompareSource = Boolean(compareSource.value && compareSource.value.path !== node.path)
  return [
    { id: 'open-side', label: t('editor.fileMenu.openSide'), shortcut: '⌃↩', disabled: !isFile },
    { id: 'open-browser', label: t('editor.fileMenu.openBrowser'), disabled: node.type !== 'file' },
    { id: 'open-with', label: t('editor.fileMenu.openWith') },
    { id: 'reveal', label: t('editor.fileMenu.revealInFinder'), shortcut: '⌥⌘R' },
    { id: 'terminal', label: t('editor.fileMenu.openTerminal') },
    { id: 'sep-open', separator: true },
    {
      id: hasCompareSource ? 'compare-with-selected' : 'select-compare',
      label: hasCompareSource ? t('editor.fileMenu.compareWithSelected') : t('editor.fileMenu.selectForCompare'),
      disabled: !isFile
    },
    { id: 'sep-chat', separator: true },
    { id: 'add-chat', label: t('editor.fileMenu.addToChat') },
    { id: 'add-new-chat', label: t('editor.fileMenu.addToNewChat') },
    { id: 'sep-history', separator: true },
    { id: 'timeline', label: t('editor.fileMenu.openTimeline'), disabled: true },
    { id: 'sep-edit', separator: true },
    { id: 'cut', label: t('editor.fileMenu.cut'), shortcut: '⌘X', disabled: true },
    { id: 'copy', label: t('editor.fileMenu.copy'), shortcut: '⌘C' },
    { id: 'sep-path', separator: true },
    { id: 'copy-path', label: t('editor.fileMenu.copyPath'), shortcut: '⌥⌘C' },
    { id: 'copy-relative-path', label: t('editor.fileMenu.copyRelativePath'), shortcut: '⌥⇧⌘C' },
    { id: 'sep-danger', separator: true },
    { id: 'rename', label: t('editor.fileMenu.rename'), shortcut: '↩' },
    { id: 'delete', label: t('editor.fileMenu.delete'), shortcut: '⌘⌫', danger: true }
  ]
})

function openContext(event: MouseEvent, node: FileTreeNode): void {
  event.preventDefault()
  selectedNode.value = node
  menu.value = { x: event.clientX, y: event.clientY, node }
}

async function selectMenuItem(item: ContextMenuItem): Promise<void> {
  const node = menu.value?.node
  if (!node) return
  switch (item.id) {
    case 'open-side':
      await editor.openToSide(node.path)
      break
    case 'open-browser':
    case 'open-with':
      await unwrap(ipc.app.openPath(toAbsolutePath(node.path)))
      break
    case 'reveal':
      await unwrap(ipc.app.showItemInFolder(toAbsolutePath(node.path)))
      break
    case 'terminal':
      await openTerminal(node)
      break
    case 'select-compare':
      compareSource.value = node
      break
    case 'compare-with-selected':
      await compareWithSelected(node)
      break
    case 'add-chat':
      addNodeToAgentInput(node, false)
      break
    case 'add-new-chat':
      addNodeToAgentInput(node, true)
      break
    case 'copy':
    case 'copy-relative-path':
      await navigator.clipboard.writeText(node.path)
      break
    case 'copy-path':
      await navigator.clipboard.writeText(toAbsolutePath(node.path))
      break
    case 'rename':
      beginRename(node)
      break
    case 'delete':
      deleteTarget.value = node
      break
  }
}

async function compareWithSelected(node: FileTreeNode): Promise<void> {
  const source = compareSource.value
  if (!source || source.type !== 'file' || node.type !== 'file' || source.path === node.path) return
  const [original, modified] = await Promise.all([
    unwrap<FileReadResult>(ipc.file.read(source.path)),
    unwrap<FileReadResult>(ipc.file.read(node.path))
  ])
  editor.showDiffView(node.path, original.content, modified.content, {
    title: `${source.name} ↔ ${node.name}`,
    readOnly: true
  })
  ui.currentView = 'code'
  compareSource.value = null
}

async function openTerminal(node: FileTreeNode): Promise<void> {
  const cwd = node.type === 'directory' ? node.path : dirname(node.path)
  await terminal.openAt(cwd || '.', node.type === 'directory' ? node.name : dirname(node.path))
}

function addNodeToAgentInput(node: FileTreeNode, createNew: boolean): void {
  if (createNew) agent.newSession()
  agent.addAttachments([{
    path: node.path,
    name: node.name,
    kind: node.type === 'directory' ? 'folder' : isImagePath(node.path) ? 'image' : 'file'
  }])
  ui.currentView = 'code'
}

function beginRename(node: FileTreeNode): void {
  renameTarget.value = node
  renameDraft.value = node.name
  void nextTick(() => {
    renameInputRef.value?.focus()
    renameInputRef.value?.select()
  })
}

function closeRename(): void {
  renameTarget.value = null
  renameDraft.value = ''
}

async function submitRename(): Promise<void> {
  const node = renameTarget.value
  const nextName = renameDraft.value.trim()
  if (!node || !nextName || nextName === node.name || nextName.includes('/')) return
  const nextPath = joinPath(dirname(node.path), nextName)
  await unwrap(ipc.file.rename(node.path, nextPath))
  if (node.type === 'file') editor.closeTab(node.path)
  if (selectedNode.value?.path === node.path) {
    selectedNode.value = { ...node, name: nextName, path: nextPath }
  }
  closeRename()
  await refreshExplorer()
}

async function confirmDelete(): Promise<void> {
  const node = deleteTarget.value
  if (!node) return
  await unwrap(ipc.file.delete(node.path))
  if (node.type === 'file') {
    editor.closeTab(node.path)
  } else {
    const prefix = `${node.path.replace(/\/$/, '')}/`
    editor.closeTabs(editor.tabs.filter((tab) => tab.path === node.path || tab.path.startsWith(prefix)).map((tab) => tab.path))
  }
  deleteTarget.value = null
  await refreshExplorer()
}

function toAbsolutePath(path: string): string {
  const root = workspace.workspace?.rootPath
  if (!root || path.startsWith('/')) return path
  return `${root.replace(/\/$/, '')}/${path.replace(/^\//, '')}`
}

async function pathExists(path: string): Promise<boolean> {
  return unwrap(ipc.file.exists(path))
}

async function expandAncestors(path: string): Promise<void> {
  const next = new Set(expandedPaths.value)
  for (const dir of ancestorDirectoryPaths(path)) {
    next.add(dir)
    await loadTreeChildren(dir)
  }
  expandedPaths.value = next
}

function collapseAll(): void {
  expandedPaths.value = new Set()
}

async function refreshExplorer(): Promise<void> {
  if (refreshing.value) return
  refreshing.value = true
  const expanded = [...expandedPaths.value]
  loadedChildren.value = new Map()
  try {
    await Promise.all([
      workspace.refreshTree(),
      project.refreshGitBranch()
    ])
    for (const dir of expanded) {
      await loadTreeChildren(dir).catch(() => undefined)
    }
  } finally {
    refreshing.value = false
  }
}

async function createNewFile(): Promise<void> {
  const parentDir = resolveCreateParentDir(selectedNode.value)
  const fileName = await findUniqueSiblingName(parentDir, 'untitled', pathExists)
  const path = joinPath(parentDir, fileName)
  await unwrap(ipc.file.create(path, ''))
  await expandAncestors(path)
  await refreshExplorer()
  selectedNode.value = { name: fileName, path, type: 'file' }
  await editor.openFile(path)
  beginRename(selectedNode.value)
}

async function createNewFolder(): Promise<void> {
  const parentDir = resolveCreateParentDir(selectedNode.value)
  const folderName = await findUniqueSiblingName(
    parentDir,
    t('code.newFolderDefaultName'),
    pathExists,
    { counterStyle: 'space' }
  )
  const path = joinPath(parentDir, folderName)
  await unwrap(ipc.file.create(`${path}/.gitkeep`, ''))
  await expandAncestors(path)
  await refreshExplorer()
  expandedPaths.value = new Set([...expandedPaths.value, path])
  selectedNode.value = { name: folderName, path, type: 'directory' }
  beginRename(selectedNode.value)
}
</script>

<template>
  <div class="file-explorer">
    <div class="explorer-section">
      <div class="section-header">
        <button
          type="button"
          class="section-toggle"
          :aria-expanded="sectionOpen"
          @click="sectionOpen = !sectionOpen"
        >
          <ChevronDown v-if="sectionOpen" :size="15" class="section-chevron" />
          <ChevronRight v-else :size="15" class="section-chevron" />
          <span class="section-title">{{ workspaceTitle }}</span>
        </button>
        <div class="section-actions">
          <button
            type="button"
            class="section-action"
            :title="createFileTitle"
            @click="createNewFile"
          >
            <FilePlus :size="15" />
          </button>
          <button
            type="button"
            class="section-action"
            :title="createFolderTitle"
            @click="createNewFolder"
          >
            <FolderPlus :size="15" />
          </button>
          <button
            type="button"
            class="section-action"
            :title="t('code.refresh')"
            :disabled="refreshing"
            @click="refreshExplorer"
          >
            <RefreshCw :size="15" :class="{ spinning: refreshing }" />
          </button>
          <button type="button" class="section-action" :title="t('code.collapseAll')" @click="collapseAll">
            <ChevronsDownUp :size="15" />
          </button>
        </div>
      </div>

      <div v-show="sectionOpen" class="explorer-tree pretty-scrollbar">
        <FileTreeNodeItem
          v-for="node in tree"
          :key="node.path"
          :node="node"
          :depth="0"
          @context="openContext"
        />
      </div>
    </div>

    <ContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="contextMenuItems"
      :width="292"
      @close="menu = null"
      @select="selectMenuItem"
    />

    <div v-if="renameTarget" class="tree-dialog-backdrop" @click.self="closeRename">
      <form class="tree-dialog" @submit.prevent="submitRename" @keydown.esc.prevent="closeRename">
        <div class="dialog-title">{{ t('editor.fileMenu.renameTitle') }}</div>
        <input ref="renameInputRef" v-model="renameDraft" class="dialog-input" />
        <div class="dialog-actions">
          <button type="button" class="dialog-btn" @click="closeRename">{{ t('common.cancel') }}</button>
          <button type="submit" class="dialog-btn primary" :disabled="!renameDraft.trim() || renameDraft.includes('/')">
            {{ t('common.save') }}
          </button>
        </div>
      </form>
    </div>

    <div v-if="deleteTarget" class="tree-dialog-backdrop" @click.self="deleteTarget = null">
      <div class="tree-dialog" role="dialog" aria-modal="true" @keydown.esc.prevent="deleteTarget = null">
        <div class="dialog-title">{{ t('editor.fileMenu.deleteTitle') }}</div>
        <p class="dialog-desc">
          {{ t('editor.fileMenu.deleteMessage', { name: deleteTarget.name }) }}
        </p>
        <div class="dialog-actions">
          <button type="button" class="dialog-btn" @click="deleteTarget = null">{{ t('common.cancel') }}</button>
          <button type="button" class="dialog-btn danger" @click="confirmDelete">{{ t('common.delete') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-explorer {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
}
.explorer-section {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
}
.section-header {
  display: flex;
  height: 22px;
  flex-shrink: 0;
  align-items: center;
  padding-right: 4px;
}
.section-toggle {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 2px;
  padding: 0 8px 0 4px;
  color: var(--codex-text, #1a1a1a);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  outline: none;
}
.section-toggle:focus-visible {
  box-shadow: inset 0 0 0 1px var(--codex-accent, #2563eb);
}
.section-chevron {
  flex-shrink: 0;
  color: var(--codex-text-secondary, #4a4a4a);
}
.section-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.section-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 1px;
  opacity: 0;
  transition: opacity 0.12s ease;
}
.explorer-section:hover .section-actions,
.section-actions:focus-within {
  opacity: 1;
}
.section-action {
  display: inline-flex;
  height: 22px;
  width: 22px;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: var(--codex-text-secondary, #4a4a4a);
  outline: none;
}
.section-action:hover {
  background: var(--codex-hover, #f0f0f0);
  color: var(--codex-text, #1a1a1a);
}
.section-action:focus-visible {
  box-shadow: inset 0 0 0 1px var(--codex-accent, #2563eb);
}
.section-action:disabled {
  cursor: default;
  opacity: 0.45;
}
.explorer-tree {
  min-height: 0;
  flex: 1;
  overflow-x: hidden;
  overflow-y: auto;
  padding-bottom: 8px;
}
.spinning {
  animation: spin 0.9s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.tree-dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.18);
}
.tree-dialog {
  width: 360px;
  border: 1px solid var(--codex-border, #e5e5e5);
  border-radius: 14px;
  background: var(--codex-bg, #fafafa);
  padding: 16px;
  box-shadow: 0 24px 80px rgba(0, 0, 0, 0.22);
}
.dialog-title {
  color: var(--codex-text, #1a1a1a);
  font-size: 16px;
  font-weight: 700;
}
.dialog-desc {
  margin-top: 10px;
  color: var(--codex-text-secondary, #4a4a4a);
  font-size: 13px;
  line-height: 1.5;
}
.dialog-input {
  margin-top: 12px;
  width: 100%;
  border: 1px solid var(--codex-border-hover, #d4d4d4);
  border-radius: 9px;
  background: var(--codex-bg, #fafafa);
  padding: 9px 11px;
  color: var(--codex-text, #1a1a1a);
  font-size: 13px;
  outline: none;
}
.dialog-input:focus {
  border-color: var(--codex-text-secondary, #4a4a4a);
}
.dialog-actions {
  margin-top: 15px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.dialog-btn {
  border-radius: 9px;
  background: var(--codex-hover, #f0f0f0);
  padding: 7px 12px;
  color: var(--codex-text, #1a1a1a);
  font-size: 13px;
  font-weight: 600;
}
.dialog-btn.primary {
  background: var(--codex-text, #1a1a1a);
  color: var(--codex-bg, #fafafa);
}
.dialog-btn.danger {
  background: #dc2626;
  color: #fff;
}
.dialog-btn:disabled {
  cursor: default;
  opacity: 0.45;
}
</style>
