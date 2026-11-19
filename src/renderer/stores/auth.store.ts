import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

const AUTH_KEY = 'lucky-ai:auth'

export type AuthProvider = 'local' | 'chatgpt' | 'other'

interface AuthSession {
  displayName: string
  email?: string
  provider: AuthProvider
  loggedInAt: number
}

function defaultDisplayName(): string {
  const suffix = crypto.randomUUID().slice(0, 8)
  return `User-${suffix}`
}

function normalizeDisplayName(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export const useAuthStore = defineStore('auth', () => {
  const displayName = ref<string | null>(null)
  const email = ref<string | null>(null)
  const provider = ref<AuthProvider | null>(null)
  const loaded = ref(false)

  const isLoggedIn = computed(() => Boolean(displayName.value))

  function persist(): void {
    if (!displayName.value || !provider.value) return
    const session: AuthSession = {
      displayName: displayName.value,
      email: email.value ?? undefined,
      provider: provider.value,
      loggedInAt: Date.now()
    }
    localStorage.setItem(AUTH_KEY, JSON.stringify(session))
  }

  function load(): void {
    try {
      const raw = localStorage.getItem(AUTH_KEY)
      if (!raw) return
      const session = JSON.parse(raw) as Partial<AuthSession> & { email?: string }
      const name = typeof session.displayName === 'string'
        ? session.displayName
        : typeof session.email === 'string'
          ? session.email.split('@')[0] ?? session.email
          : ''
      if (name.length > 0) {
        displayName.value = name
        email.value = typeof session.email === 'string' ? session.email : null
        provider.value = session.provider ?? 'local'
      }
    } catch {
      localStorage.removeItem(AUTH_KEY)
    } finally {
      loaded.value = true
    }
  }

  function continueLocally(name?: string, nextEmail?: string): void {
    const normalized = normalizeDisplayName(name ?? '') || defaultDisplayName()
    displayName.value = normalized
    const trimmedEmail = nextEmail?.trim()
    email.value = trimmedEmail || null
    provider.value = 'local'
    persist()
  }

  function logout(): void {
    displayName.value = null
    email.value = null
    provider.value = null
    localStorage.removeItem(AUTH_KEY)
  }

  return {
    displayName,
    email,
    provider,
    loaded,
    isLoggedIn,
    load,
    continueLocally,
    logout
  }
})
