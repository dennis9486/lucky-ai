<script setup lang="ts">
import { computed, inject, ref, type ComputedRef, type Ref } from 'vue'
import type { FileTreeNode } from '../../../shared/types/workspace.js'
import { useEditorStore } from '../../stores/editor.store.js'
import { useUiStore } from '../../stores/ui.store.js'
import { ChevronRight, ChevronDown, Folder, File } from 'lucide-vue-next'
import { getFileIcon } from '../../utils/file-icons.js'
import type { FileTreeGitDecoration } from '../../utils/file-tree-git.js'

defineOptions({ name: 'FileTreeNodeItem' })

const props = defineProps<{ node: FileTreeNode; depth: number }>()
const emit = defineEmits<{
  context: [event: MouseEvent, node: FileTreeNode]
}>()

const editor = useEditorStore()
const ui = useUiStore()
const loading = ref(false)
const showFileIcon = ref(true)

const selectedPath = inject<ComputedRef<string | null>>('fileTreeSelectedPath', computed(() => null))
const setSelected = inject<(node: FileTreeNode) => void>('fileTreeSetSelected', () => undefined)
const expandedPaths = inject<Ref<Set<string>>>('fileTreeExpandedPaths', ref(new Set<string>()))
const loadedChildren = inject<Ref<Map<string, FileTreeNode[]>>>('fileTreeLoadedChildren', ref(new Map()))
const loadTreeChildren = inject<(path: string) => Promise<FileTreeNode[]>>('fileTreeLoadChildren', async () => [])
const gitDecorations = inject<ComputedRef<{
  fileDecorations: Map<string, FileTreeGitDecoration>
  dirtyFolders: Set<string>
}>>('fileTreeGitDecorations', computed(() => ({
  fileDecorations: new Map(),
  dirtyFolders: new Set<string>()
})))

const childNodes = computed(() => {
  if (props.node.type !== 'directory') return []
  const loaded = loadedChildren.value.get(props.node.path)
  if (loaded) return loaded
  return props.node.children ?? []
})
const needsLazyLoad = computed(() => (
  props.node.type === 'directory'
  && Boolean(props.node.lazy)
  && !loadedChildren.value.has(props.node.path)
))
const isOpen = computed(() => expandedPaths.value.has(props.node.path))
const isSelected = computed(() => selectedPath.value === props.node.path)
const isActive = computed(() => props.node.type === 'file' && editor.activeTab?.path === props.node.path)
const fileIcon = computed(() => props.node.type === 'file' ? getFileIcon(props.node.name) : '')
const gitDecoration = computed(() => {
  if (props.node.type === 'file') {
    return gitDecorations.value.fileDecorations.get(props.node.path) ?? null
  }
  return null
})
const folderDirty = computed(() => (
  props.node.type === 'directory' && gitDecorations.value.dirtyFolders.has(props.node.path)
))
const labelTone = computed(() => gitDecoration.value?.tone ?? null)
const indentPx = computed(() => props.depth * 8 + 4)

async function setExpanded(open: boolean): Promise<void> {
  if (props.node.type !== 'directory') return
  const next = new Set(expandedPaths.value)
  if (open) {
    if (needsLazyLoad.value) {
      loading.value = true
      try {
        await loadTreeChildren(props.node.path)
      } finally {
        loading.value = false
      }
    }
    next.add(props.node.path)
  } else {
    next.delete(props.node.path)
  }
  expandedPaths.value = next
}

function handleRowClick(): void {
  setSelected(props.node)
  if (props.node.type === 'file') {
    openFile()
    return
  }
  void setExpanded(!isOpen.value)
}

function openFile(): void {
  void editor.openFile(props.node.path)
  ui.currentView = 'code'
}

function fallbackFileIcon(): void {
  showFileIcon.value = false
}

function openContextMenu(event: MouseEvent): void {
  event.preventDefault()
  setSelected(props.node)
  emit('context', event, props.node)
}

function forwardContext(event: MouseEvent, node: FileTreeNode): void {
  emit('context', event, node)
}
</script>

<template>
  <div class="tree-node">
    <div
      class="tree-row"
      :class="{
        active: isActive,
        selected: isSelected,
        [`git-${labelTone}`]: Boolean(labelTone)
      }"
      :style="{ paddingLeft: `${indentPx}px` }"
      @click="handleRowClick"
      @contextmenu="openContextMenu"
    >
      <button
        v-if="node.type === 'directory'"
        type="button"
        class="tree-twistie"
        :aria-label="isOpen ? 'Collapse' : 'Expand'"
        @click.stop="void setExpanded(!isOpen)"
      >
        <ChevronDown v-if="isOpen" :size="14" />
        <ChevronRight v-else :size="14" :class="{ loading }" />
      </button>
      <span v-else class="tree-twistie" aria-hidden="true" />
      <Folder v-if="node.type === 'directory'" :size="16" class="tree-folder" />
      <img
        v-else-if="showFileIcon && fileIcon"
        class="tree-file-icon"
        :src="fileIcon"
        alt=""
        loading="lazy"
        @error="fallbackFileIcon"
      />
      <File v-else :size="16" class="tree-file" />
      <span class="tree-label truncate">{{ node.name }}</span>
      <span v-if="gitDecoration" class="tree-git" :class="gitDecoration.tone">{{ gitDecoration.code }}</span>
      <span v-else-if="folderDirty" class="tree-git-dot" />
    </div>
    <template v-if="node.type === 'directory' && isOpen">
      <FileTreeNodeItem
        v-for="child in childNodes"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        @context="forwardContext"
      />
    </template>
  </div>
</template>

<style scoped>
.tree-row {
  display: flex;
  height: 22px;
  cursor: pointer;
  align-items: center;
  gap: 6px;
  padding-right: 8px;
  color: var(--codex-text, #1a1a1a);
  font-size: 13px;
  line-height: 22px;
  outline: none;
}
.tree-row:hover,
.tree-row.selected {
  background: var(--codex-hover, #f0f0f0);
}
.tree-row.active {
  background: color-mix(in srgb, var(--codex-accent, #2563eb) 12%, var(--codex-hover, #f0f0f0));
  color: var(--codex-text, #1a1a1a);
}
.tree-row:focus-visible {
  box-shadow: inset 0 0 0 1px var(--codex-accent, #2563eb);
}
.tree-twistie {
  display: inline-flex;
  width: 16px;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  padding: 0;
  color: var(--codex-text-secondary, #4a4a4a);
  cursor: pointer;
}
.tree-twistie .loading {
  opacity: 0.45;
}
.tree-file,
.tree-folder {
  flex-shrink: 0;
}
.tree-folder {
  color: #8ba4c7;
}
.tree-file {
  color: var(--codex-text-secondary, #4a4a4a);
}
.tree-file-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
  object-fit: contain;
}
.tree-label {
  min-width: 0;
  flex: 1;
}
.tree-row.git-added .tree-label {
  color: #248a52;
}
.tree-row.git-modified .tree-label {
  color: #3d7f9f;
}
.tree-row.git-renamed .tree-label {
  color: #3d7f9f;
}
.tree-row.git-deleted .tree-label {
  color: #c2413b;
}
.tree-git {
  flex-shrink: 0;
  width: 18px;
  text-align: right;
  font-size: 11px;
  font-weight: 700;
}
.tree-git.added {
  color: #248a52;
}
.tree-git.modified,
.tree-git.renamed {
  color: #3d7f9f;
}
.tree-git.deleted {
  color: #c2413b;
}
.tree-git-dot {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 999px;
  background: #c08b42;
}
</style>
