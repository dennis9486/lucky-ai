<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useProjectStore } from '../../stores/project.store.js'

const { t } = useI18n()
const projects = useProjectStore()

const heading = computed(() => {
  if (!projects.hasWorkspace) return t('home.welcomeDefault')
  return t('home.welcomeProject', { project: projects.projectLabel })
})
</script>

<template>
  <h1 class="welcome-heading">
    {{ heading }}
  </h1>
</template>

<style scoped>
.welcome-heading {
  @apply mb-12 text-center text-[40px] font-medium leading-tight tracking-normal text-codex-text;
}
</style>
