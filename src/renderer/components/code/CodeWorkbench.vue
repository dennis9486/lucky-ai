<script setup lang="ts">
import EditorPanel from '../editor/EditorPanel.vue'
import EditorStatusBar from '../editor/EditorStatusBar.vue'
import CodeAgentPanel from './CodeAgentPanel.vue'
import TerminalDock from '../terminal/TerminalDock.vue'
import { useUiStore } from '../../stores/ui.store.js'
import { useTerminalStore } from '../../stores/terminal.store.js'
import { useSettingsStore } from '../../stores/settings.store.js'

const ui = useUiStore()
const terminal = useTerminalStore()
const settings = useSettingsStore()
</script>

<template>
  <section class="code-workbench">
    <div class="code-workbench-body">
      <main class="code-main">
        <div class="editor-shell">
          <EditorPanel />
        </div>
        <TerminalDock
          v-if="terminal.visible && settings.general.defaultTerminalLocation === 'bottom'"
          location="bottom"
        />
      </main>

      <TerminalDock
        v-if="terminal.visible && settings.general.defaultTerminalLocation === 'right'"
        location="right"
      />

      <CodeAgentPanel v-if="ui.codeAgentVisible" />
    </div>

    <EditorStatusBar />
  </section>
</template>

<style scoped>
.code-workbench {
  @apply flex h-full min-h-0 flex-col bg-codex-bg text-codex-text;
}
.code-workbench-body {
  @apply flex min-h-0 flex-1;
}
.code-main {
  @apply flex min-w-0 flex-1 flex-col;
}
.editor-shell {
  @apply min-h-0 flex-1;
}
</style>
