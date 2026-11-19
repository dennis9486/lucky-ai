<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { ChevronRight } from 'lucide-vue-next'

export interface ContextMenuItem {
  id: string
  label?: string
  shortcut?: string
  disabled?: boolean
  danger?: boolean
  separator?: boolean
  submenu?: ContextMenuItem[]
}

const props = defineProps<{
  x: number
  y: number
  items: ContextMenuItem[]
  width?: number
}>()

const emit = defineEmits<{
  close: []
  select: [item: ContextMenuItem]
}>()

const activeSubmenuId = ref<string | null>(null)
const rowRefs = ref(new Map<string, HTMLElement>())

function setRowRef(id: string, el: HTMLElement | null): void {
  if (el) rowRefs.value.set(id, el)
  else rowRefs.value.delete(id)
}

const menuStyle = computed(() => {
  const width = props.width ?? 284
  const rowCount = props.items.filter((item) => !item.separator).length
  const separatorCount = props.items.length - rowCount
  const estimatedHeight = Math.min(window.innerHeight - 16, rowCount * 32 + separatorCount * 13 + 12)
  const maxHeight = Math.max(160, window.innerHeight - 16)
  return {
    width: `${width}px`,
    maxWidth: 'calc(100vw - 16px)',
    maxHeight: `${maxHeight}px`,
    left: `${Math.max(8, Math.min(props.x, window.innerWidth - width - 8))}px`,
    top: `${Math.max(8, Math.min(props.y, window.innerHeight - estimatedHeight - 8))}px`
  }
})

const submenuStyle = computed(() => {
  if (!activeSubmenuId.value) return {}
  const row = rowRefs.value.get(activeSubmenuId.value)
  if (!row) return {}
  const rect = row.getBoundingClientRect()
  const width = 240
  const left = rect.right + 4
  const flipped = left + width > window.innerWidth - 8
  return {
    width: `${width}px`,
    left: `${flipped ? Math.max(8, rect.left - width - 4) : left}px`,
    top: `${Math.max(8, rect.top - 6)}px`
  }
})

const activeSubmenuItems = computed(() => {
  const item = props.items.find((row) => row.id === activeSubmenuId.value)
  return item?.submenu ?? []
})

/** 按当前 items 顺序返回可聚焦（非分隔/非禁用）的行元素。 */
function focusableRows(): HTMLElement[] {
  return props.items
    .filter((item) => !item.separator && !item.disabled)
    .map((item) => rowRefs.value.get(item.id))
    .filter((el): el is HTMLElement => Boolean(el))
}

function moveFocus(delta: number): void {
  const rows = focusableRows()
  if (!rows.length) return
  const current = rows.indexOf(document.activeElement as HTMLElement)
  const start = current === -1 ? (delta > 0 ? -1 : 0) : current
  const next = (start + delta + rows.length) % rows.length
  rows[next]?.focus()
}

function onKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'Escape':
      emit('close')
      break
    case 'ArrowDown':
      event.preventDefault()
      moveFocus(1)
      break
    case 'ArrowUp':
      event.preventDefault()
      moveFocus(-1)
      break
    case 'Home':
      event.preventDefault()
      focusableRows()[0]?.focus()
      break
    case 'End': {
      event.preventDefault()
      const rows = focusableRows()
      rows[rows.length - 1]?.focus()
      break
    }
  }
}

function closeFromWindow(): void {
  emit('close')
}

function openSubmenu(id: string): void {
  activeSubmenuId.value = id
}

function select(item: ContextMenuItem): void {
  if (item.disabled || item.separator || item.submenu?.length) return
  emit('select', item)
  emit('close')
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', closeFromWindow)
  window.addEventListener('scroll', closeFromWindow, true)
  // 打开即把焦点移到首个可用项，使菜单可纯键盘操作
  void nextTick(() => focusableRows()[0]?.focus())
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', closeFromWindow)
  window.removeEventListener('scroll', closeFromWindow, true)
})
</script>

<template>
  <div class="context-menu-scrim" @mousedown="emit('close')" @contextmenu.prevent="emit('close')" />
  <div class="context-menu" :style="menuStyle" role="menu" @mousedown.stop @contextmenu.prevent.stop @mouseleave="activeSubmenuId = null">
    <template v-for="item in items" :key="item.id">
      <div v-if="item.separator" class="context-menu-divider" />
      <button
        v-else
        :ref="(el) => setRowRef(item.id, el as HTMLElement | null)"
        type="button"
        role="menuitem"
        class="context-menu-row"
        :class="{ danger: item.danger, 'has-submenu': item.submenu?.length, active: activeSubmenuId === item.id }"
        :disabled="item.disabled"
        @mouseenter="item.submenu?.length ? openSubmenu(item.id) : (activeSubmenuId = null)"
        @click="select(item)"
      >
        <span>{{ item.label }}</span>
        <span class="row-tail">
          <kbd v-if="item.shortcut">{{ item.shortcut }}</kbd>
          <ChevronRight v-if="item.submenu?.length" :size="14" class="submenu-chevron" />
        </span>
      </button>
    </template>
  </div>

  <div
    v-if="activeSubmenuItems.length"
    class="context-submenu"
    :style="submenuStyle"
    role="menu"
    @mousedown.stop
    @mouseleave="activeSubmenuId = null"
  >
    <button
      v-for="child in activeSubmenuItems"
      :key="child.id"
      type="button"
      role="menuitem"
      class="context-menu-row"
      :disabled="child.disabled"
      @click="select(child)"
    >
      <span>{{ child.label }}</span>
      <kbd v-if="child.shortcut">{{ child.shortcut }}</kbd>
    </button>
  </div>
</template>

<style scoped>
.context-menu-scrim {
  position: fixed;
  inset: 0;
  z-index: 190;
}
.context-menu,
.context-submenu {
  position: fixed;
  z-index: 191;
  overflow: auto;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 13px;
  background: rgba(250, 250, 250, 0.96);
  padding: 6px;
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.16), 0 2px 8px rgba(0, 0, 0, 0.08);
  backdrop-filter: blur(18px);
}
.context-submenu {
  z-index: 192;
}
.context-menu::-webkit-scrollbar,
.context-submenu::-webkit-scrollbar {
  width: 7px;
}
.context-menu::-webkit-scrollbar-thumb,
.context-submenu::-webkit-scrollbar-thumb {
  border-radius: 999px;
  background: rgba(0, 0, 0, 0.16);
}
.context-menu-row {
  display: flex;
  width: 100%;
  min-height: 32px;
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
.context-menu-row:hover:not(:disabled),
.context-menu-row.active:not(:disabled) {
  background: rgba(0, 0, 0, 0.06);
}
.context-menu-row:disabled {
  cursor: default;
  color: #b7b7b7;
}
.context-menu-row.danger:not(:disabled) {
  color: #b42318;
}
.row-tail {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}
.context-menu-row kbd {
  color: #9b9b9b;
  font-family: inherit;
  font-size: 12px;
  font-weight: 600;
}
.submenu-chevron {
  color: #9b9b9b;
}
.context-menu-divider {
  height: 1px;
  margin: 6px 4px;
  background: rgba(0, 0, 0, 0.09);
}
:global([data-theme='dark']) .context-menu,
:global([data-theme='dark']) .context-submenu {
  border-color: rgba(255, 255, 255, 0.12);
  background: rgba(38, 38, 38, 0.96);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.36), 0 2px 8px rgba(0, 0, 0, 0.28);
}
:global([data-theme='dark']) .context-menu::-webkit-scrollbar-thumb,
:global([data-theme='dark']) .context-submenu::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.18);
}
:global([data-theme='dark']) .context-menu-row {
  color: #ededed;
}
:global([data-theme='dark']) .context-menu-row:hover:not(:disabled),
:global([data-theme='dark']) .context-menu-row.active:not(:disabled) {
  background: rgba(255, 255, 255, 0.09);
}
:global([data-theme='dark']) .context-menu-row:disabled {
  color: #6f6f6f;
}
:global([data-theme='dark']) .context-menu-row.danger:not(:disabled) {
  color: #ff8a80;
}
:global([data-theme='dark']) .context-menu-row kbd,
:global([data-theme='dark']) .submenu-chevron {
  color: #8a8a8a;
}
:global([data-theme='dark']) .context-menu-divider {
  background: rgba(255, 255, 255, 0.1);
}
</style>
