import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { AIModelConfig, AIProviderConfig } from '../../shared/types/ai.js'
import type { AgentMcpServerConfig, SettingsData } from '../../shared/types/ipc.js'
import { DEFAULT_EDITOR_SETTINGS, DEFAULT_GENERAL_APP_SETTINGS } from '../../shared/types/ipc.js'
import { normalizeGeneralSettings } from '../../shared/utils/settings-normalize.js'
import type { AgentPermissionPolicy } from '../../shared/types/tool.js'
import { DEFAULT_THEME_SETTINGS } from '../../shared/types/theme.js'
import { DEFAULT_PERSONALIZATION } from '../../shared/types/personalization.js'
import { DEFAULT_LOCALE } from '../../shared/types/locale.js'
import {
  cloneBindings,
  DEFAULT_KEYBOARD_SHORTCUT_SETTINGS,
  type KeyboardShortcutSettings,
  type ShortcutBinding
} from '../../shared/types/shortcuts.js'
import { defaultModelProviders, presetByVendor } from '../../shared/model-provider-presets.js'
import { securityService } from './security.service.js'
import { DatabaseService } from '../db/database.service.js'
import { generalRuntimeService } from './general-runtime.service.js'

const DEFAULT_PROVIDERS: AIProviderConfig[] = defaultModelProviders()

interface StoredSettings {
  activeProviderId: string
  providers: AIProviderConfig[]
  maxAgentSteps: number
  maxContextTokens: number
  professionalMode: boolean
  agentScopeFullPower: boolean
  autoApproveReadOnly: boolean
  redactSecretsInContext?: boolean
  permissionPolicy: AgentPermissionPolicy
  agentSystemPrompt: string
  skillPaths: string[]
  skillDirPaths: string[]
  mcpServers: AgentMcpServerConfig[]
  theme: SettingsData['theme']
  personalization: SettingsData['personalization']
  locale: SettingsData['locale']
  editor?: SettingsData['editor']
  general: SettingsData['general']
  keyboardShortcuts: KeyboardShortcutSettings
  encryptedKeys: Record<string, string>
}

const DEFAULTS: StoredSettings = {
  activeProviderId: 'ollama-default',
  providers: DEFAULT_PROVIDERS,
  maxAgentSteps: 20,
  maxContextTokens: 32000,
  professionalMode: false,
  agentScopeFullPower: false,
  autoApproveReadOnly: true,
  redactSecretsInContext: true,
  permissionPolicy: { rules: [] },
  agentSystemPrompt: '',
  skillPaths: [],
  skillDirPaths: [],
  mcpServers: [],
  theme: { ...DEFAULT_THEME_SETTINGS },
  personalization: { ...DEFAULT_PERSONALIZATION },
  locale: DEFAULT_LOCALE,
  general: { ...DEFAULT_GENERAL_APP_SETTINGS },
  keyboardShortcuts: cloneKeyboardShortcutSettings(DEFAULT_KEYBOARD_SHORTCUT_SETTINGS),
  encryptedKeys: {}
}

export class SettingsService {
  private data: StoredSettings = { ...DEFAULTS, encryptedKeys: {} }
  private loaded = false
  /**
   * 已装配的对外快照缓存。getSettings 高频调用（每条消息、每次沙箱执行、每次 agent 启动），
   * 而其中 decryptKey 会走 OS 安全存储解密——不缓存则每次都重建整个对象并逐 provider 解密。
   * data 仅在 ensureLoaded（一次）与 setSettings 中变更，故只需在 setSettings 后置空。
   */
  private snapshot: SettingsData | null = null

  private get storePath(): string {
    return join(app.getPath('userData'), 'settings.json')
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    try {
      const raw = await readFile(this.storePath, 'utf-8')
      this.data = { ...DEFAULTS, ...JSON.parse(raw) as StoredSettings }
    } catch {
      this.data = { ...DEFAULTS, encryptedKeys: {} }
    }
    this.data.providers = this.data.providers.map(normalizeProviderModels)
    this.data.permissionPolicy = normalizePermissionPolicy(this.data.permissionPolicy)
    securityService.setPermissionPolicy(this.data.permissionPolicy)
    this.loaded = true
  }

  private async persist(): Promise<void> {
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(this.storePath, JSON.stringify(this.data, null, 2), 'utf-8')
  }

  async getSettings(): Promise<SettingsData> {
    await this.ensureLoaded()
    return (this.snapshot ??= this.buildSnapshot())
  }

  private buildSnapshot(): SettingsData {
    const providers = this.data.providers.map((p) => ({
      ...p,
      apiKey: providerUsesApiKey(p) ? this.decryptKey(p.id) ?? p.apiKey : undefined
    }))
    return {
      activeProviderId: this.data.activeProviderId,
      providers,
      maxAgentSteps: this.data.maxAgentSteps,
      maxContextTokens: this.data.maxContextTokens,
      professionalMode: Boolean(this.data.professionalMode),
      agentScopeFullPower: Boolean(this.data.agentScopeFullPower),
      autoApproveReadOnly: this.data.autoApproveReadOnly,
      redactSecretsInContext: this.data.redactSecretsInContext !== false,
      permissionPolicy: normalizePermissionPolicy(this.data.permissionPolicy),
      agentSystemPrompt: this.data.agentSystemPrompt,
      skillPaths: this.data.skillPaths,
      skillDirPaths: this.data.skillDirPaths,
      mcpServers: this.data.mcpServers,
      theme: this.data.theme ?? { ...DEFAULT_THEME_SETTINGS },
      personalization: {
        ...DEFAULT_PERSONALIZATION,
        ...(this.data.personalization ?? {})
      },
      locale: this.data.locale ?? DEFAULT_LOCALE,
      editor: { ...DEFAULT_EDITOR_SETTINGS, ...(this.data.editor ?? {}) },
      general: normalizeGeneralSettings(this.data.general),
      keyboardShortcuts: normalizeKeyboardShortcutSettings(this.data.keyboardShortcuts)
    }
  }

  async setSettings(partial: Partial<SettingsData>): Promise<void> {
    await this.ensureLoaded()
    if (partial.providers !== undefined) {
      for (const p of partial.providers) {
        if (p.apiKey && p.apiKey !== '***') {
          this.data.encryptedKeys[p.id] = this.encryptKey(p.apiKey)
        } else if (p.apiKey === '' || !providerUsesApiKey(p)) {
          delete this.data.encryptedKeys[p.id]
        }
      }
      this.data.providers = partial.providers.map(({ apiKey: _key, ...rest }) =>
        normalizeProviderModels(rest as AIProviderConfig)
      )
    }
    if (partial.activeProviderId !== undefined) {
      this.data.activeProviderId = partial.activeProviderId
    }
    if (partial.maxAgentSteps !== undefined) {
      this.data.maxAgentSteps = partial.maxAgentSteps
    }
    if (partial.maxContextTokens !== undefined) {
      this.data.maxContextTokens = partial.maxContextTokens
    }
    if (partial.professionalMode !== undefined) {
      this.data.professionalMode = partial.professionalMode
    }
    if (partial.agentScopeFullPower !== undefined) {
      this.data.agentScopeFullPower = partial.agentScopeFullPower
    }
    if (partial.autoApproveReadOnly !== undefined) {
      this.data.autoApproveReadOnly = partial.autoApproveReadOnly
    }
    if (partial.redactSecretsInContext !== undefined) {
      this.data.redactSecretsInContext = partial.redactSecretsInContext
    }
    if (partial.permissionPolicy !== undefined) {
      this.data.permissionPolicy = normalizePermissionPolicy(partial.permissionPolicy)
      securityService.setPermissionPolicy(this.data.permissionPolicy)
    }
    if (partial.agentSystemPrompt !== undefined) {
      this.data.agentSystemPrompt = partial.agentSystemPrompt
    }
    if (partial.skillPaths !== undefined) {
      this.data.skillPaths = partial.skillPaths
    }
    if (partial.skillDirPaths !== undefined) {
      this.data.skillDirPaths = partial.skillDirPaths
    }
    if (partial.mcpServers) {
      this.data.mcpServers = partial.mcpServers
    }
    if (partial.theme) {
      const current = this.data.theme ?? DEFAULT_THEME_SETTINGS
      this.data.theme = {
        ...current,
        ...partial.theme,
        light: { ...current.light, ...partial.theme.light },
        dark: { ...current.dark, ...partial.theme.dark }
      }
    }
    if (partial.personalization) {
      this.data.personalization = {
        ...(this.data.personalization ?? DEFAULT_PERSONALIZATION),
        ...partial.personalization
      }
    }
    if (partial.locale !== undefined) {
      this.data.locale = partial.locale
    }
    if (partial.editor !== undefined) {
      this.data.editor = { ...DEFAULT_EDITOR_SETTINGS, ...(this.data.editor ?? {}), ...partial.editor }
    }
    if (partial.general !== undefined) {
      this.data.general = normalizeGeneralSettings({ ...(this.data.general ?? {}), ...partial.general })
      generalRuntimeService.apply(this.data.general)
    }
    if (partial.keyboardShortcuts !== undefined) {
      this.data.keyboardShortcuts = normalizeKeyboardShortcutSettings(partial.keyboardShortcuts)
    }
    this.snapshot = null // 失效缓存：下次 getSettings 按最新 data 重建
    await this.persist()
  }

  /**
   * 当前生效的 Provider：项目级覆盖优先（当前工作区 pin 过 Provider 且其
   * 仍启用），否则回落全局 activeProviderId。
   */
  async getActiveProvider(): Promise<AIProviderConfig | null> {
    const settings = await this.getSettings()
    const overrideId = this.getProjectProviderOverride(securityService.getWorkspaceRoot())
    const overridden = overrideId
      ? settings.providers.find((p) => p.id === overrideId && p.enabled)
      : undefined
    const provider = overridden
      ?? settings.providers.find((p) => p.id === settings.activeProviderId && p.enabled)
    return provider ? resolveActiveProviderModel(provider) : null
  }

  /** 读取某项目的 Provider 覆盖（无覆盖返回 null，读失败视为无覆盖） */
  getProjectProviderOverride(rootPath?: string | null): string | null {
    if (!rootPath) return null
    try {
      const row = DatabaseService.getInstance().db
        .prepare('SELECT value FROM app_preferences WHERE key = ?')
        .get(projectProviderPrefKey(rootPath)) as { value: string } | undefined
      return row?.value || null
    } catch {
      return null
    }
  }

  /** 设置/清除某项目的 Provider 覆盖（providerId 为 null 即清除） */
  setProjectProviderOverride(rootPath: string, providerId: string | null): void {
    const db = DatabaseService.getInstance().db
    const key = projectProviderPrefKey(rootPath)
    if (!providerId) {
      db.prepare('DELETE FROM app_preferences WHERE key = ?').run(key)
      return
    }
    db.prepare(
      `INSERT INTO app_preferences (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    ).run(key, providerId)
  }

  private encryptKey(key: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(key).toString('base64')
    }
    return Buffer.from(key).toString('base64')
  }

  private decryptKey(providerId: string): string | undefined {
    const encrypted = this.data.encryptedKeys[providerId]
    if (!encrypted) return undefined
    try {
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
      }
      return Buffer.from(encrypted, 'base64').toString('utf-8')
    } catch {
      return undefined
    }
  }
}

export const settingsService = new SettingsService()

function cloneKeyboardShortcutSettings(settings: KeyboardShortcutSettings): KeyboardShortcutSettings {
  return Object.fromEntries(
    Object.entries(settings).map(([id, bindings]) => [id, cloneBindings(bindings)])
  )
}

function normalizeKeyboardShortcutSettings(settings: KeyboardShortcutSettings | undefined): KeyboardShortcutSettings {
  return {
    ...cloneKeyboardShortcutSettings(DEFAULT_KEYBOARD_SHORTCUT_SETTINGS),
    ...Object.fromEntries(
      Object.entries(settings ?? {}).map(([id, bindings]) => [
        id,
        Array.isArray(bindings) ? cloneBindings(bindings as ShortcutBinding[]) : []
      ])
    )
  }
}

function normalizeModelName(name: string | undefined, fallback: string): string {
  const trimmed = name?.trim()
  return trimmed || fallback
}

function modelId(providerId: string, name: string, index: number): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return `${providerId}-model-${slug || index}`
}

function normalizeProviderModels(provider: AIProviderConfig): AIProviderConfig {
  const fallbackModel = normalizeModelName(provider.model, 'default-model')
  const seen = new Set<string>()
  const sourceModels = provider.models?.length
    ? provider.models
    : [{ id: modelId(provider.id, fallbackModel, 0), name: fallbackModel, enabled: true }]

  const models: AIModelConfig[] = sourceModels
    .map((model, index) => ({
      id: model.id || modelId(provider.id, model.name, index),
      name: normalizeModelName(model.name, fallbackModel),
      enabled: model.enabled !== false,
      vision: normalizeModelVision(model.vision)
    }))
    .filter((model) => {
      const key = model.name.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

  if (!models.length) {
    models.push({ id: modelId(provider.id, fallbackModel, 0), name: fallbackModel, enabled: true, vision: 'auto' })
  }
  if (provider.enabled && !models.some((model) => model.enabled)) {
    models[0]!.enabled = true
  }

  const active =
    models.find((model) => model.id === provider.activeModelId && model.enabled) ??
    models.find((model) => model.name === fallbackModel && model.enabled) ??
    models.find((model) => model.enabled) ??
    models[0]!

  return {
    ...provider,
    models,
    activeModelId: active.id,
    model: active.name
  }
}

function resolveActiveProviderModel(provider: AIProviderConfig): AIProviderConfig {
  const normalized = normalizeProviderModels(provider)
  const active =
    normalized.models?.find((model) => model.id === normalized.activeModelId && model.enabled) ??
    normalized.models?.find((model) => model.enabled)
  return {
    ...normalized,
    model: active?.name ?? normalized.model
  }
}

function normalizeModelVision(vision: AIModelConfig['vision'] | undefined): AIModelConfig['vision'] {
  return vision === 'on' || vision === 'off' ? vision : 'auto'
}

function providerUsesApiKey(provider: Pick<AIProviderConfig, 'type' | 'vendor'>): boolean {
  return presetByVendor(provider.vendor)?.requiresApiKey ?? (provider.type === 'openai' || provider.type === 'anthropic')
}

function normalizePermissionPolicy(policy: AgentPermissionPolicy | undefined): AgentPermissionPolicy {
  return {
    rules: (policy?.rules ?? [])
      .filter((rule) => rule.pattern?.trim())
      .map((rule) => ({
        id: rule.id || `policy-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        enabled: rule.enabled !== false,
        target: ['tool', 'path', 'command'].includes(rule.target) ? rule.target : 'tool',
        pattern: rule.pattern.trim(),
        action: ['allow', 'confirm', 'block'].includes(rule.action) ? rule.action : 'confirm',
        note: rule.note?.trim() || undefined
      }))
  }
}

/** 项目级 Provider 覆盖的偏好键（按工作区根路径散列） */
function projectProviderPrefKey(rootPath: string): string {
  return `project.activeProvider.${createHash('sha1').update(rootPath).digest('hex')}`
}
