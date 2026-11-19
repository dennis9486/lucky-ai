<script setup lang="ts">
import { computed } from 'vue'
import { useThemeStore } from '../../../stores/theme.store.js'

const theme = useThemeStore()

const leftLines = computed(() => [
  { type: 'plain', text: '{' },
  { type: 'plain', text: '  themePreview: {' },
  { type: 'key', text: '    surface:', value: '"sidebar"', tone: 'removed' },
  { type: 'key', text: '    accent:', value: `"${theme.settings.light.accent}"`, tone: 'removed' },
  { type: 'key', text: '    contrast:', value: String(theme.settings.light.contrast), tone: 'removed' },
  { type: 'plain', text: '  }' },
  { type: 'plain', text: '}' }
])

const rightLines = computed(() => [
  { type: 'plain', text: '{' },
  { type: 'plain', text: '  themePreview: {' },
  { type: 'key', text: '    surface:', value: '"sidebar-elevated"', tone: 'added' },
  { type: 'key', text: '    accent:', value: `"${theme.settings.dark.accent}"`, tone: 'added' },
  { type: 'key', text: '    contrast:', value: String(theme.settings.dark.contrast), tone: 'added' },
  { type: 'plain', text: '  }' },
  { type: 'plain', text: '}' }
])
</script>

<template>
  <div class="theme-diff">
    <pre class="diff-pane diff-left"><code><span
      v-for="(line, index) in leftLines"
      :key="`l-${index}`"
      class="diff-line"
      :class="line.tone ? `is-${line.tone}` : ''"
    ><template v-if="line.type === 'key'">{{ line.text }} <span class="val">{{ line.value }}</span></template><template v-else>{{ line.text }}</template>
</span></code></pre>
    <pre class="diff-pane diff-right"><code><span
      v-for="(line, index) in rightLines"
      :key="`r-${index}`"
      class="diff-line"
      :class="line.tone ? `is-${line.tone}` : ''"
    ><template v-if="line.type === 'key'">{{ line.text }} <span class="val">{{ line.value }}</span></template><template v-else>{{ line.text }}</template>
</span></code></pre>
  </div>
</template>

<style scoped>
.theme-diff {
  @apply grid grid-cols-2 gap-3 mb-8;
}
.diff-pane {
  @apply m-0 p-3 rounded-xl border border-codex-border text-[11px] leading-[1.6]
         font-mono overflow-x-auto;
}
.diff-left {
  background: #fff5f5;
}
.diff-right {
  background: #f0fdf4;
}
.diff-line {
  @apply block whitespace-pre;
  color: #6b7280;
}
.diff-line.is-removed {
  background: #fecaca;
  color: #991b1b;
}
.diff-line.is-added {
  background: #bbf7d0;
  color: #166534;
}
.val {
  color: inherit;
}
</style>
