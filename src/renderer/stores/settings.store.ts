import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AIProviderConfig } from '../../shared/types/ai.js'
import type { AgentMcpServerConfig, EditorSettings, GeneralAppSettings, SettingsData } from '../../shared/types/ipc.js'
import { DEFAULT_EDITOR_SETTINGS, DEFAULT_GENERAL_APP_SETTINGS } from '../../shared/types/ipc.js'
import { normalizeGeneralSettings } from '../../shared/utils/settings-normalize.js'
import {
  DEFAULT_PERSONALIZATION,
  type PersonalizationSettings,
  type PersonalityTone
} from '../../shared/types/personalization.js'
import type { AppLocale } from '../../shared/types/locale.js'
import { DEFAULT_LOCALE } from '../../shared/types/locale.js'
import type { AgentPermissionPolicy } from '../../shared/types/tool.js'
import {
  cloneBindings,
  DEFAULT_KEYBOARD_SHORTCUT_SETTINGS,
  type KeyboardShortcutSettings,
  type ShortcutBinding
} from '../../shared/types/shortcuts.js'
import { ipc, unwrap } from '../services/ipc-client.js'
import { toIpcPlain } from '../utils/ipc-serialize.js'
import { applyAppLocale } from '../i18n/index.js'

export const useSettingsStore = defineStore('settings', () => {
  const providers = ref<AIProviderConfig[]>([])
  const activeProviderId = ref('ollama-default')
  const maxAgentSteps = ref(20)
  const maxContextTokens = ref(32000)
  const professionalMode = ref(false)
  const agentScopeFullPower = ref(false)
  const autoApproveReadOnly = ref(true)
  const permissionPolicy = ref<AgentPermissionPolicy>({ rules: [] })
  const agentSystemPrompt = ref('')
  const skillPaths = ref<string[]>([])
  const skillDirPaths = ref<string[]>([])
  const mcpServers = ref<AgentMcpServerConfig[]>([])
  const personalization = ref<PersonalizationSettings>({ ...DEFAULT_PERSONALIZATION })
  const locale = ref<AppLocale>(DEFAULT_LOCALE)
  const editor = ref({ ...DEFAULT_EDITOR_SETTINGS })
  const general = ref<GeneralAppSettings>({ ...DEFAULT_GENERAL_APP_SETTINGS })
  const keyboardShortcuts = ref<KeyboardShortcutSettings>(
    cloneKeyboardShortcutSettings(DEFAULT_KEYBOARD_SHORTCUT_SETTINGS)
  )
  const showSettings = ref(false)
  const loaded = ref(false)
  let configurationFlush: (() => void) | null = null

  function registerConfigurationFlush(flush: () => void): void {
    configurationFlush = flush
  }

  function unregisterConfigurationFlush(): void {
    configurationFlush = null
  }

  async function flushConfigurationDraft(): Promise<void> {
    configurationFlush?.()
  }

  async function load(): Promise<void> {
    const settings = await unwrap<SettingsData>(ipc.settings.get())
    providers.value = settings.providers
    activeProviderId.value = settings.activeProviderId
    maxAgentSteps.value = settings.maxAgentSteps
    maxContextTokens.value = settings.maxContextTokens
    professionalMode.value = settings.professionalMode
    agentScopeFullPower.value = settings.agentScopeFullPower
    autoApproveReadOnly.value = settings.autoApproveReadOnly
    permissionPolicy.value = settings.permissionPolicy ?? { rules: [] }
    agentSystemPrompt.value = settings.agentSystemPrompt
    skillPaths.value = settings.skillPaths
    skillDirPaths.value = settings.skillDirPaths
    mcpServers.value = settings.mcpServers
    personalization.value = {
      ...DEFAULT_PERSONALIZATION,
      ...settings.personalization
    }
    locale.value = settings.locale ?? DEFAULT_LOCALE
    editor.value = { ...DEFAULT_EDITOR_SETTINGS, ...(settings.editor ?? {}) }
    general.value = normalizeGeneralSettings(settings.general)
    keyboardShortcuts.value = cloneKeyboardShortcutSettings(settings.keyboardShortcuts ?? DEFAULT_KEYBOARD_SHORTCUT_SETTINGS)
    applyAppLocale(locale.value)
    loaded.value = true
  }

  async function save(): Promise<void> {
    await unwrap(ipc.settings.set(toIpcPlain({
      providers: providers.value,
      activeProviderId: activeProviderId.value,
      maxAgentSteps: maxAgentSteps.value,
      maxContextTokens: maxContextTokens.value,
      professionalMode: professionalMode.value,
      agentScopeFullPower: agentScopeFullPower.value,
      autoApproveReadOnly: autoApproveReadOnly.value,
      permissionPolicy: permissionPolicy.value,
      agentSystemPrompt: agentSystemPrompt.value,
      skillPaths: skillPaths.value,
      skillDirPaths: skillDirPaths.value,
      mcpServers: mcpServers.value,
      personalization: personalization.value,
      locale: locale.value,
      editor: editor.value,
      general: general.value,
      keyboardShortcuts: keyboardShortcuts.value
    })))
  }

  async function setLocale(next: AppLocale): Promise<void> {
    locale.value = next
    applyAppLocale(next)
    await save()
  }

  async function patchPersonalization(partial: Partial<PersonalizationSettings>): Promise<void> {
    personalization.value = { ...personalization.value, ...partial }
    await save()
  }

  async function patchEditor(partial: Partial<EditorSettings>): Promise<void> {
    editor.value = { ...editor.value, ...partial }
    await save()
  }

  async function patchGeneral(partial: Partial<GeneralAppSettings>): Promise<void> {
    general.value = normalizeGeneralSettings({ ...general.value, ...partial })
    await save()
  }

  async function setKeyboardShortcutBindings(id: string, bindings: ShortcutBinding[]): Promise<void> {
    keyboardShortcuts.value = {
      ...keyboardShortcuts.value,
      [id]: cloneBindings(bindings)
    }
    await save()
  }

  async function resetKeyboardShortcut(id: string): Promise<void> {
    await setKeyboardShortcutBindings(id, DEFAULT_KEYBOARD_SHORTCUT_SETTINGS[id] ?? [])
  }

  async function removeKeyboardShortcutBinding(id: string, index: number): Promise<void> {
    const bindings = cloneBindings(keyboardShortcuts.value[id] ?? [])
    bindings.splice(index, 1)
    await setKeyboardShortcutBindings(id, bindings)
  }

  async function setPersonality(personality: PersonalityTone): Promise<void> {
    await patchPersonalization({ personality })
  }

  async function upsertMcpServer(server: AgentMcpServerConfig): Promise<void> {
    const index = mcpServers.value.findIndex((item) => item.id === server.id)
    if (index >= 0) {
      mcpServers.value[index] = server
    } else {
      mcpServers.value.push(server)
    }
    await save()
  }

  async function toggleMcpServer(id: string, enabled: boolean): Promise<void> {
    const server = mcpServers.value.find((item) => item.id === id)
    if (!server) return
    server.enabled = enabled
    await save()
  }

  async function removeMcpServer(id: string): Promise<void> {
    mcpServers.value = mcpServers.value.filter((item) => item.id !== id)
    await save()
  }

  return {
    providers, activeProviderId, maxAgentSteps, maxContextTokens,
    professionalMode, agentScopeFullPower, autoApproveReadOnly, permissionPolicy, agentSystemPrompt, skillPaths, skillDirPaths,
    mcpServers, personalization, locale, editor, general, keyboardShortcuts, showSettings, loaded, load, save,
    patchPersonalization, patchEditor, patchGeneral, setPersonality, setLocale,
    setKeyboardShortcutBindings, resetKeyboardShortcut, removeKeyboardShortcutBinding,
    upsertMcpServer, toggleMcpServer, removeMcpServer,
    registerConfigurationFlush, unregisterConfigurationFlush, flushConfigurationDraft
  }
})

function cloneKeyboardShortcutSettings(settings: KeyboardShortcutSettings): KeyboardShortcutSettings {
  return Object.fromEntries(
    Object.entries(settings).map(([id, bindings]) => [id, cloneBindings(bindings)])
  )
}
