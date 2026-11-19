<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div class="panel-ports">
    <p class="panel-empty">{{ t('bottomPanel.noPorts') }}</p>
  </div>
</template>

<style scoped>
.panel-ports {
  @apply flex h-full min-h-0 items-center justify-center;
}
.panel-empty {
  @apply px-4 text-[12px] text-codex-muted;
}
</style>
