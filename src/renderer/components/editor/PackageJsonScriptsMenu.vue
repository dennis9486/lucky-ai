<script setup lang="ts">
/* global Element */
import { onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Play } from 'lucide-vue-next'
import {
  onPackageJsonDebugMenu,
  type PackageJsonDebugMenuRequest
} from '../../services/package-json-codelens.service.js'
import { runPackageJsonScript } from '../../services/package-json-run.service.js'

const { t } = useI18n()
const menu = ref<PackageJsonDebugMenuRequest | null>(null)
let unsubscribe: (() => void) | null = null

onMounted(() => {
  unsubscribe = onPackageJsonDebugMenu((request) => {
    menu.value = request
  })
  document.addEventListener('pointerdown', handleOutside, true)
})

onUnmounted(() => {
  unsubscribe?.()
  document.removeEventListener('pointerdown', handleOutside, true)
})

function handleOutside(event: PointerEvent): void {
  const target = event.target
  if (!(target instanceof Element) || !target.closest('.package-json-scripts-menu')) {
    menu.value = null
  }
}

function close(): void {
  menu.value = null
}

async function runScript(scriptName: string): Promise<void> {
  const current = menu.value
  if (!current) return
  close()
  await runPackageJsonScript(current.packagePath, scriptName)
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="menu"
      class="package-json-scripts-menu"
      :style="{ left: `${Math.max(8, menu.x)}px`, top: `${Math.max(8, menu.y)}px` }"
      role="menu"
    >
      <div class="menu-title">{{ t('packageJson.runMenuTitle') }}</div>
      <button
        v-for="script in menu.scripts"
        :key="script.name"
        type="button"
        class="menu-item"
        role="menuitem"
        @click="runScript(script.name)"
      >
        <Play :size="12" />
        <span class="menu-item-name">{{ script.name }}</span>
        <span class="menu-item-command">{{ script.command }}</span>
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.package-json-scripts-menu {
  position: fixed;
  z-index: 1200;
  min-width: 280px;
  max-width: min(420px, calc(100vw - 16px));
  overflow: hidden;
  border: 1px solid var(--codex-border, #dcdcdc);
  border-radius: 8px;
  background: var(--codex-bg, #fafafa);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

.menu-title {
  padding: 8px 12px;
  border-bottom: 1px solid var(--codex-border, #dcdcdc);
  color: var(--codex-text-secondary, #666);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.menu-item {
  display: grid;
  width: 100%;
  grid-template-columns: auto 1fr;
  gap: 2px 8px;
  padding: 8px 12px;
  border: 0;
  background: transparent;
  color: var(--codex-text, #333);
  cursor: pointer;
  text-align: left;
}

.menu-item:hover {
  background: var(--codex-hover, #f0f0f0);
}

.menu-item svg {
  grid-row: 1 / span 2;
  align-self: center;
  color: #2f6c7a;
}

.menu-item-name {
  font-size: 13px;
  font-weight: 600;
}

.menu-item-command {
  overflow: hidden;
  color: var(--codex-text-secondary, #666);
  font-family: "JetBrains Mono", "SFMono-Regular", Consolas, monospace;
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

:global([data-theme='dark']) .package-json-scripts-menu {
  background: #252526;
  border-color: #3c3c3c;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
</style>
