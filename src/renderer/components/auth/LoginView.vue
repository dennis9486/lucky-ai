<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '../../stores/auth.store.js'

const { t } = useI18n()
const auth = useAuthStore()
const displayName = ref('')
const email = ref('')

function handleContinue(): void {
  auth.continueLocally(displayName.value, email.value)
}
</script>

<template>
  <div class="login-view">
    <div class="titlebar-drag drag-region" />

    <div class="login-content">
      <div class="login-brand">
        <div class="app-logo" aria-hidden="true">
          <svg viewBox="0 0 48 48" fill="none" class="logo-svg">
            <rect width="48" height="48" rx="14" class="logo-bg" />
            <text
              x="11"
              y="32"
              fill="white"
              font-family="ui-monospace, SFMono-Regular, Menlo, monospace"
              font-size="18"
              font-weight="500"
            >&gt;_</text>
          </svg>
        </div>
        <h1 class="login-title">{{ t('auth.title') }}</h1>
        <p class="login-subtitle">{{ t('auth.subtitle') }}</p>
      </div>

      <form class="login-form" @submit.prevent="handleContinue">
        <label class="field-label" for="display-name">{{ t('auth.displayName') }}</label>
        <input
          id="display-name"
          v-model="displayName"
          class="field-input"
          type="text"
          autocomplete="nickname"
          :placeholder="t('auth.displayNamePlaceholder')"
        />

        <label class="field-label" for="email">{{ t('auth.emailOptional') }}</label>
        <input
          id="email"
          v-model="email"
          class="field-input"
          type="email"
          autocomplete="email"
          :placeholder="t('auth.emailPlaceholder')"
        />

        <button type="submit" class="btn-primary">
          {{ t('auth.continueLocal') }}
        </button>
      </form>

      <p class="login-note">{{ t('auth.localNote') }}</p>
    </div>
  </div>
</template>

<style scoped>
.login-view {
  @apply h-screen w-screen bg-codex-bg text-codex-text flex flex-col;
}
.titlebar-drag {
  @apply h-[38px] shrink-0;
}
.login-content {
  @apply flex-1 flex flex-col items-center justify-center px-6 pb-16 -mt-6;
}
.login-brand {
  @apply flex flex-col items-center text-center mb-8 max-w-[360px];
}
.app-logo {
  @apply mb-5;
}
.logo-svg {
  @apply w-12 h-12;
}
.logo-bg {
  fill: var(--codex-accent);
}
.login-title {
  @apply text-[22px] font-semibold tracking-tight text-codex-text;
}
.login-subtitle {
  @apply mt-2 text-[14px] leading-relaxed text-codex-muted;
}
.login-form {
  @apply w-full max-w-[320px] flex flex-col gap-2;
}
.field-label {
  @apply mt-2 text-[12px] font-medium text-codex-text-secondary;
}
.field-input {
  @apply h-10 w-full rounded-xl border border-codex-border bg-codex-bg px-3 text-[14px] text-codex-text
         outline-none transition-[border-color,box-shadow] placeholder:text-codex-muted
         focus:border-codex-border-hover;
  box-shadow: inset 0 1px 2px color-mix(in srgb, var(--codex-text) 4%, transparent);
}
.btn-primary {
  @apply mt-4 h-11 rounded-full bg-codex-text text-codex-bg text-[14px] font-medium
         hover:opacity-90 transition-opacity;
}
.login-note {
  @apply mt-5 max-w-[320px] text-center text-[12px] leading-relaxed text-codex-muted;
}
.drag-region {
  -webkit-app-region: drag;
}
</style>
