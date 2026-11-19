<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import IntegrationCard from './IntegrationCard.vue'
import { integrationCardDefs } from '../../data/sidebar.js'

const { t } = useI18n()

const cards = computed(() =>
  integrationCardDefs.map((card) => ({
    id: card.id,
    icon: card.icon,
    title: t(card.titleKey),
    description: t(card.descKey)
  }))
)
</script>

<template>
  <div class="integration-cards">
    <IntegrationCard
      v-for="card in cards"
      :key="card.id"
      :icon="card.icon"
      :title="card.title"
      :description="card.description"
    />
  </div>
</template>

<style scoped>
.integration-cards {
  @apply mt-7 grid w-full grid-cols-3 gap-3;
}
</style>
