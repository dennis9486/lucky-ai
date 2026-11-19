<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Cloud, Cpu, FlaskConical, HardDrive, Pin, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-vue-next'
import type { Component } from 'vue'
import SettingsToggle from '../SettingsToggle.vue'
import { useSettingsStore } from '../../../stores/settings.store.js'
import { useProjectStore } from '../../../stores/project.store.js'
import { useUiStore } from '../../../stores/ui.store.js'
import { ipc, unwrap } from '../../../services/ipc-client.js'
import { toIpcPlain } from '../../../utils/ipc-serialize.js'
import type { AIModelConfig, AIProviderConfig, AIProviderType, ModelCapabilityProfile } from '../../../../shared/types/ai.js'
import type { ProviderModelListResult, ProviderTestResult } from '../../../../shared/types/ipc.js'
import type { AgentPermissionRule, AgentPermissionRuleAction, AgentPermissionRuleTarget } from '../../../../shared/types/tool.js'
import {
  MODEL_PROVIDER_PRESETS,
  presetById,
  presetByVendor,
  providerFromPreset,
  type ModelProviderPreset
} from '../../../../shared/model-provider-presets.js'

const { t } = useI18n()
const settings = useSettingsStore()
const ui = useUiStore()

interface LocalProvider extends AIProviderConfig {
  apiKey?: string
  models: AIModelConfig[]
  activeModelId: string
}

const providerMeta = computed<
  Record<AIProviderType, { icon: Component }>
>(() => ({
  ollama: {
    icon: HardDrive
  },
  openai: {
    icon: Cloud
  },
  lmstudio: {
    icon: Cpu
  },
  anthropic: {
    icon: Cloud
  }
}))

const localProviders = ref<LocalProvider[]>([])
const localActiveProviderId = ref('')
const selectedPresetId = ref('deepseek')
const localMaxAgentSteps = ref(20)
const localMaxContextTokens = ref(32000)
const localAgentScopeFullPower = ref(false)
const localSkillPathsText = ref('')
const localSkillDirPathsText = ref('')
const localPermissionRules = ref<AgentPermissionRule[]>([])
const maskedApiKeys = ref<Record<string, boolean>>({})
const saved = ref(false)
const saving = ref(false)
const saveError = ref('')
const testingId = ref<string | null>(null)
const fetchingModelsId = ref<string | null>(null)
const testResults = ref<Record<string, ProviderTestResult>>({})

const permissionTargets: AgentPermissionRuleTarget[] = ['tool', 'path', 'command']
const permissionActions: AgentPermissionRuleAction[] = ['allow', 'confirm', 'block']
const modelVisionOptions: NonNullable<AIModelConfig['vision']>[] = ['auto', 'on', 'off']

function buildLocalSnapshot(): string {
  return JSON.stringify({
    activeProviderId: localActiveProviderId.value,
    maxAgentSteps: localMaxAgentSteps.value,
    maxContextTokens: localMaxContextTokens.value,
    agentScopeFullPower: localAgentScopeFullPower.value,
    skillPaths: splitLines(localSkillPathsText.value),
    skillDirPaths: splitLines(localSkillDirPathsText.value),
    permissionPolicy: { rules: localPermissionRules.value },
    providers: localProviders.value.map((provider) => ({
      id: provider.id,
      type: provider.type,
      vendor: provider.vendor,
      name: provider.name,
      enabled: provider.enabled,
      baseUrl: provider.baseUrl,
      model: provider.model,
      activeModelId: provider.activeModelId,
      models: provider.models,
      apiKey: providerRequiresApiKey(provider) ? (provider.apiKey?.trim() ?? '') : undefined
    }))
  })
}

function buildStoreSnapshot(): string {
  return JSON.stringify({
    activeProviderId: settings.activeProviderId,
    maxAgentSteps: settings.maxAgentSteps,
    maxContextTokens: settings.maxContextTokens,
    agentScopeFullPower: settings.agentScopeFullPower,
    skillPaths: settings.skillPaths,
    skillDirPaths: settings.skillDirPaths,
    permissionPolicy: settings.permissionPolicy,
    providers: settings.providers.map((provider) => ({
      id: provider.id,
      type: provider.type,
      vendor: provider.vendor,
      name: provider.name,
      enabled: provider.enabled,
      baseUrl: provider.baseUrl,
      model: provider.model,
      activeModelId: provider.activeModelId,
      models: provider.models,
      apiKey: providerRequiresApiKey(provider) && provider.apiKey === '***' ? '' : undefined
    }))
  })
}

const isDirty = computed(() => buildLocalSnapshot() !== buildStoreSnapshot())

watch(
  () => settings.showSettings,
  (show) => {
    if (show) syncFromStore()
  }
)

watch(
  () => settings.providers.length,
  (length, previous) => {
    if (length > 0 && previous === 0) syncFromStore()
  }
)

function syncFromStore(): void {
  maskedApiKeys.value = {}
  localProviders.value = settings.providers.map((provider) => {
    const hasMaskedKey = provider.apiKey === '***'
    if (hasMaskedKey) maskedApiKeys.value[provider.id] = true
    const normalized = normalizeLocalProvider(provider)
    return {
      ...normalized,
      apiKey: hasMaskedKey ? '' : provider.apiKey
    }
  })
  localActiveProviderId.value = settings.activeProviderId
  localMaxAgentSteps.value = settings.maxAgentSteps
  localMaxContextTokens.value = settings.maxContextTokens
  localAgentScopeFullPower.value = settings.agentScopeFullPower
  localSkillPathsText.value = settings.skillPaths.join('\n')
  localSkillDirPathsText.value = settings.skillDirPaths.join('\n')
  localPermissionRules.value = settings.permissionPolicy.rules.map((rule) => ({ ...rule }))
  saved.value = false
  saveError.value = ''
  testResults.value = {}
}

function splitLines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean)
}

function setDefaultProvider(id: string): void {
  localActiveProviderId.value = id
  const provider = localProviders.value.find((item) => item.id === id)
  if (provider) {
    provider.enabled = true
    ensureActiveModel(provider)
  }
}

function toggleProvider(id: string, enabled: boolean): void {
  const provider = localProviders.value.find((item) => item.id === id)
  if (!provider) return
  provider.enabled = enabled
  if (enabled) ensureActiveModel(provider)
  if (!enabled && localActiveProviderId.value === id) {
    const fallback = localProviders.value.find((item) => item.enabled && item.id !== id)
    if (fallback) localActiveProviderId.value = fallback.id
  }
}

function createModelId(providerId: string, name = 'model'): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return `${providerId}-${slug || 'model'}-${Date.now().toString(36)}`
}

function createProviderId(preset: ModelProviderPreset): string {
  return `${preset.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function providerPreset(provider: LocalProvider): ModelProviderPreset {
  return presetByVendor(provider.vendor) ?? presetById(provider.type === 'ollama' ? 'ollama' : provider.type === 'lmstudio' ? 'lmstudio' : 'custom-openai')
}

function providerPresetId(provider: LocalProvider): string {
  return providerPreset(provider).id
}

function providerBadge(provider: LocalProvider): string {
  const badge = providerPreset(provider).badge
  if (badge === 'local') return t('settings.config.providerBadgeLocal')
  if (badge === 'router') return t('settings.config.providerBadgeRouter')
  return t('settings.config.providerBadgeCloud')
}

function providerDescription(provider: LocalProvider): string {
  const key = providerPreset(provider).descriptionKey
  if (key === 'ollama') return t('settings.config.providerOllamaDesc')
  if (key === 'lmstudio') return t('settings.config.providerLmstudioDesc')
  if (key === 'anthropic') return t('settings.config.providerAnthropicDesc')
  return t('settings.config.providerOpenaiDesc')
}

function providerRequiresApiKey(provider: Pick<AIProviderConfig, 'type' | 'vendor'>): boolean {
  const preset = presetByVendor(provider.vendor)
  return preset?.requiresApiKey ?? (provider.type === 'openai' || provider.type === 'anthropic')
}

function addProviderFromPreset(): void {
  const preset = presetById(selectedPresetId.value)
  const provider = normalizeLocalProvider(providerFromPreset(preset.id, {
    id: createProviderId(preset),
    enabled: true
  }))
  localProviders.value.push(provider)
  localActiveProviderId.value = provider.id
}

function applyPreset(provider: LocalProvider, presetId: string): void {
  const preset = presetById(presetId)
  const previousKey = provider.apiKey
  const previousMasked = maskedApiKeys.value[provider.id]
  const next = normalizeLocalProvider(providerFromPreset(preset.id, {
    id: provider.id,
    enabled: provider.enabled
  }))

  Object.assign(provider, {
    ...next,
    apiKey: preset.requiresApiKey ? previousKey ?? '' : undefined
  })
  if (previousMasked && preset.requiresApiKey) {
    maskedApiKeys.value[provider.id] = true
  } else {
    delete maskedApiKeys.value[provider.id]
  }
}

function handlePresetChange(provider: LocalProvider, event: Event): void {
  const target = event.target as HTMLSelectElement | null
  if (target?.value) applyPreset(provider, target.value)
}

function normalizeLocalProvider(provider: AIProviderConfig): LocalProvider {
  const cloned = JSON.parse(JSON.stringify(provider)) as LocalProvider
  const fallbackName = cloned.model?.trim() || 'default-model'
  const models = cloned.models?.length
    ? cloned.models
    : [{ id: createModelId(cloned.id, fallbackName), name: fallbackName, enabled: true }]
  cloned.models = models.map((model, index) => ({
    id: model.id || createModelId(cloned.id, `${model.name || fallbackName}-${index}`),
    name: model.name?.trim() || fallbackName,
    enabled: model.enabled !== false,
    vision: model.vision ?? 'auto'
  }))
  ensureActiveModel(cloned)
  return cloned
}

function ensureActiveModel(provider: LocalProvider): void {
  if (!provider.models.length) {
    provider.models.push({ id: createModelId(provider.id, provider.model), name: provider.model || 'default-model', enabled: true })
  }
  if (provider.enabled && !provider.models.some((model) => model.enabled)) {
    provider.models[0]!.enabled = true
  }
  const active =
    provider.models.find((model) => model.id === provider.activeModelId && model.enabled) ??
    provider.models.find((model) => model.enabled) ??
    provider.models[0]!
  provider.activeModelId = active.id
  provider.model = active.name
}

function setDefaultModel(provider: LocalProvider, modelId: string): void {
  const model = provider.models.find((item) => item.id === modelId)
  if (!model) return
  model.enabled = true
  provider.activeModelId = model.id
  provider.model = model.name
  provider.enabled = true
  localActiveProviderId.value = provider.id
}

function toggleModel(provider: LocalProvider, modelId: string, enabled: boolean): void {
  const model = provider.models.find((item) => item.id === modelId)
  if (!model) return
  model.enabled = enabled
  ensureActiveModel(provider)
}

function addModel(provider: LocalProvider): void {
  const name = providerPreset(provider).defaultModel
  const base = name
  let next = base
  let index = 2
  while (provider.models.some((model) => model.name === next)) {
    next = `${base}-${index++}`
  }
  const model = { id: createModelId(provider.id, next), name: next, enabled: true, vision: 'auto' as const }
  provider.models.push(model)
  setDefaultModel(provider, model.id)
}

function buildProviderPayload(provider: LocalProvider): AIProviderConfig {
  return {
    id: provider.id,
    type: provider.type,
    vendor: provider.vendor,
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model,
    models: provider.models,
    activeModelId: provider.activeModelId,
    enabled: provider.enabled,
    apiKey: resolveApiKey(provider)
  }
}

function mergeFetchedModels(provider: LocalProvider, names: string[]): number {
  const existing = new Set(provider.models.map((model) => model.name.trim()))
  let added = 0

  for (const rawName of names) {
    const name = rawName.trim()
    if (!name || existing.has(name)) continue
    provider.models.push({
      id: createModelId(provider.id, name),
      name,
      enabled: true,
      vision: 'auto'
    })
    existing.add(name)
    added += 1
  }

  ensureActiveModel(provider)
  return added
}

async function fetchProviderModels(provider: LocalProvider): Promise<void> {
  if (fetchingModelsId.value || !provider.enabled) return
  fetchingModelsId.value = provider.id
  try {
    const result = await unwrap<ProviderModelListResult>(
      ipc.settings.listProviderModels(toIpcPlain(buildProviderPayload(provider)))
    )
    const added = mergeFetchedModels(provider, result.models)
    testResults.value = {
      ...testResults.value,
      [provider.id]: {
        ok: true,
        message: t('settings.config.fetchModelsResult', { count: result.models.length, added })
      }
    }
  } catch (e) {
    testResults.value = {
      ...testResults.value,
      [provider.id]: { ok: false, message: String(e) }
    }
  } finally {
    fetchingModelsId.value = null
  }
}

function removeModel(provider: LocalProvider, modelId: string): void {
  if (provider.models.length <= 1) return
  provider.models = provider.models.filter((model) => model.id !== modelId)
  ensureActiveModel(provider)
}

function removeProvider(id: string): void {
  if (localProviders.value.length <= 1) return
  localProviders.value = localProviders.value.filter((provider) => provider.id !== id)
  delete maskedApiKeys.value[id]
  delete testResults.value[id]
  if (localActiveProviderId.value === id) {
    localActiveProviderId.value = localProviders.value.find((provider) => provider.enabled)?.id ?? localProviders.value[0]?.id ?? ''
  }
}

function addPermissionRule(): void {
  localPermissionRules.value.push({
    id: `policy-${Date.now().toString(36)}`,
    enabled: true,
    target: 'command',
    pattern: 'pnpm test*',
    action: 'allow',
    note: ''
  })
}

function removePermissionRule(id: string): void {
  localPermissionRules.value = localPermissionRules.value.filter((rule) => rule.id !== id)
}

function applyAgentScopePreset(): void {
  settings.professionalMode = true
  localAgentScopeFullPower.value = true
  localMaxAgentSteps.value = Math.max(localMaxAgentSteps.value, 40)
  localMaxContextTokens.value = Math.max(localMaxContextTokens.value, 96000)
  if (!localPermissionRules.value.some((rule) => rule.target === 'tool' && rule.pattern === 'Bash' && rule.action === 'confirm')) {
    localPermissionRules.value.push({
      id: `policy-bash-confirm-${Date.now().toString(36)}`,
      enabled: true,
      target: 'tool',
      pattern: 'Bash',
      action: 'confirm',
      note: t('settings.config.fullPowerBashPolicyNote')
    })
  }
}

function syncModelName(provider: LocalProvider, model: AIModelConfig): void {
  model.name = model.name.trimStart()
  if (!model.name.trim()) return
  if (provider.activeModelId === model.id) provider.model = model.name.trim()
}

function setModelVision(model: AIModelConfig, vision: NonNullable<AIModelConfig['vision']>): void {
  model.vision = vision
}

function modelVisionLabel(vision: NonNullable<AIModelConfig['vision']>): string {
  if (vision === 'on') return t('settings.config.multimodalOn')
  if (vision === 'off') return t('settings.config.multimodalOff')
  return t('settings.config.multimodalAuto')
}

function resolveApiKey(provider: LocalProvider): string | undefined {
  if (!providerRequiresApiKey(provider)) return undefined
  if (provider.apiKey?.trim()) return provider.apiKey.trim()
  if (maskedApiKeys.value[provider.id]) return '***'
  return ''
}

function buildProvidersForSave(): AIProviderConfig[] {
  return localProviders.value.map((provider) => {
    ensureActiveModel(provider)
    const models = provider.models
      .map((model) => ({
        ...model,
        name: model.name.trim()
      }))
      .filter((model) => model.name)
    return {
      id: provider.id,
      type: provider.type,
      vendor: provider.vendor,
      name: provider.name,
      baseUrl: provider.baseUrl,
      model: provider.model,
      models,
      activeModelId: provider.activeModelId,
      enabled: provider.enabled,
      apiKey: resolveApiKey(provider)
    }
  })
}

function applyLocalToStore(): void {
  settings.providers = buildProvidersForSave()
  settings.activeProviderId = localActiveProviderId.value
  settings.maxAgentSteps = clamp(localMaxAgentSteps.value, 1, 50)
  settings.maxContextTokens = clamp(localMaxContextTokens.value, 4000, 200000)
  settings.agentScopeFullPower = localAgentScopeFullPower.value
  settings.skillPaths = splitLines(localSkillPathsText.value)
  settings.skillDirPaths = splitLines(localSkillDirPathsText.value)
  settings.permissionPolicy = {
    rules: localPermissionRules.value
      .map((rule) => ({
        ...rule,
        pattern: rule.pattern.trim(),
        note: rule.note?.trim() || undefined
      }))
      .filter((rule) => rule.pattern)
  }
}

async function save(): Promise<void> {
  if (saving.value) return

  const enabled = localProviders.value.filter((item) => item.enabled)
  if (!enabled.length) {
    await ui.alert(t('settings.config.enableProviderAlert'), t('settings.config.title'))
    return
  }
  if (!enabled.some((item) => item.id === localActiveProviderId.value)) {
    localActiveProviderId.value = enabled[0]!.id
  }
  for (const provider of localProviders.value) ensureActiveModel(provider)

  saving.value = true
  saveError.value = ''
  try {
    applyLocalToStore()
    await settings.save()
    await settings.load()
    syncFromStore()
    saved.value = true
    setTimeout(() => { saved.value = false }, 2000)
  } catch (e) {
    saveError.value = String(e)
    await ui.alert(t('settings.config.saveFailed', { error: saveError.value }), t('settings.config.title'))
  } finally {
    saving.value = false
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}

async function testProvider(provider: LocalProvider): Promise<void> {
  testingId.value = provider.id
  try {
    const result = await unwrap<ProviderTestResult>(
      ipc.settings.testProvider(toIpcPlain(buildProviderPayload(provider)))
    )
    testResults.value = { ...testResults.value, [provider.id]: result }
  } catch (e) {
    testResults.value = {
      ...testResults.value,
      [provider.id]: { ok: false, message: String(e) }
    }
  } finally {
    testingId.value = null
  }
}

function getTestResult(id: string): ProviderTestResult | undefined {
  return testResults.value[id]
}

const probingModelId = ref<string | null>(null)

// ── 项目级 Provider 覆盖（pin 到当前项目）────────────────────
const projects = useProjectStore()
const projectProviderId = ref<string | null>(null)
const projectRootPath = computed(() => projects.activeProject?.rootPath ?? null)

async function loadProjectProvider(): Promise<void> {
  if (!projectRootPath.value) {
    projectProviderId.value = null
    return
  }
  try {
    projectProviderId.value = await unwrap<string | null>(ipc.settings.getProjectProvider(projectRootPath.value))
  } catch {
    projectProviderId.value = null
  }
}

/** pin/取消 pin：让当前项目固定使用该 Provider（覆盖全局默认） */
async function toggleProjectProvider(provider: LocalProvider): Promise<void> {
  if (!projectRootPath.value) return
  const next = projectProviderId.value === provider.id ? null : provider.id
  try {
    await unwrap(ipc.settings.setProjectProvider(projectRootPath.value, next))
    projectProviderId.value = next
  } catch (e) {
    testResults.value = {
      ...testResults.value,
      [provider.id]: { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }
}

/** 实测模型能力档案并落到配置（视觉判定改为档案驱动，不再靠名字猜） */
async function probeModel(provider: LocalProvider, model: AIModelConfig): Promise<void> {
  if (probingModelId.value || !model.name.trim()) return
  probingModelId.value = model.id
  try {
    const profile = await unwrap<ModelCapabilityProfile>(
      ipc.settings.probeModelCapabilities(toIpcPlain(buildProviderPayload(provider)), model.name.trim())
    )
    model.capabilities = profile
    // 档案直接落显式配置，UI 上立即可见
    model.vision = profile.vision ? 'on' : 'off'
  } catch (e) {
    testResults.value = {
      ...testResults.value,
      [provider.id]: { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  } finally {
    probingModelId.value = null
  }
}

/** 能力档案的 tooltip 摘要（含失败原因） */
function capabilitySummary(model: AIModelConfig): string {
  const profile = model.capabilities
  if (!profile?.detectedAt) return t('settings.config.probeModel')
  const mark = (ok: boolean) => (ok ? '✓' : '✗')
  const lines = [
    `${t('settings.config.capVision')} ${mark(profile.vision)} · ${t('settings.config.capTools')} ${mark(profile.tools)} · ${t('settings.config.capStreaming')} ${mark(profile.streaming)} · JSON ${mark(profile.jsonOutput)}`,
    ...Object.values(profile.errors ?? {}).map((reason) => `- ${reason}`)
  ]
  return lines.join('\n')
}

onMounted(() => {
  syncFromStore()
  settings.registerConfigurationFlush(applyLocalToStore)
  void loadProjectProvider()
})

watch(projectRootPath, () => {
  void loadProjectProvider()
})

onBeforeUnmount(() => {
  settings.unregisterConfigurationFlush()
  applyLocalToStore()
})

defineExpose({ save, applyLocalToStore, isDirty })
</script>

<template>
  <div class="settings-panel">
    <div class="panel-header">
      <div>
        <h1 class="panel-title">{{ t('settings.config.title') }}</h1>
        <p class="panel-desc">{{ t('settings.config.description') }}</p>
      </div>
      <button
        type="button"
        class="save-btn"
        :class="{ 'is-enabled': !saved, 'is-saved': saved }"
        :disabled="saving"
        @click="save()"
      >
        {{ saved ? t('settings.config.saved') : saving ? t('settings.config.saving') : t('settings.config.saveChanges') }}
      </button>
    </div>

    <section class="settings-section">
      <h2 class="section-title">{{ t('settings.config.providersTitle') }}</h2>
      <p class="section-desc">{{ t('settings.config.providersDesc') }}</p>

      <div class="provider-add-bar">
        <div class="provider-add-copy">
          <div class="row-title">{{ t('settings.config.addProviderTitle') }}</div>
          <div class="row-desc">{{ t('settings.config.addProviderDesc') }}</div>
        </div>
        <div class="provider-add-actions">
          <select v-model="selectedPresetId" class="preset-select">
            <option
              v-for="preset in MODEL_PROVIDER_PRESETS"
              :key="preset.id"
              :value="preset.id"
            >
              {{ preset.name }}
            </option>
          </select>
          <button type="button" class="preset-btn" @click="addProviderFromPreset">
            <Plus :size="13" />
            <span>{{ t('settings.config.addProvider') }}</span>
          </button>
        </div>
      </div>

      <div class="provider-list">
        <article
          v-for="provider in localProviders"
          :key="provider.id"
          class="provider-card"
          :class="{
            'is-default': localActiveProviderId === provider.id,
            'is-disabled': !provider.enabled
          }"
        >
          <div class="provider-top">
            <button
              type="button"
              class="provider-select"
              @click="setDefaultProvider(provider.id)"
            >
              <span
                class="provider-radio"
                :class="{ 'is-checked': localActiveProviderId === provider.id }"
              >
                <span v-if="localActiveProviderId === provider.id" class="provider-radio-dot" />
              </span>
              <span class="provider-icon-wrap">
                <component
                  :is="providerMeta[provider.type].icon"
                  :size="18"
                  :stroke-width="1.75"
                  class="provider-icon"
                />
              </span>
              <div class="provider-heading">
                <div class="provider-name-row">
                  <span class="provider-name">{{ provider.name }}</span>
                  <span class="provider-badge">{{ providerBadge(provider) }}</span>
                  <span v-if="localActiveProviderId === provider.id" class="default-badge">{{ t('settings.config.default') }}</span>
                </div>
                <p class="provider-desc">{{ providerDescription(provider) }}</p>
              </div>
            </button>

            <div class="provider-controls">
              <span
                v-if="getTestResult(provider.id)"
                class="test-badge"
                :class="{
                  'is-ok': getTestResult(provider.id)?.ok,
                  'is-error': !getTestResult(provider.id)?.ok
                }"
                :title="getTestResult(provider.id)?.message"
              >
                {{ getTestResult(provider.id)?.message }}
              </span>
              <button
                v-if="projectRootPath"
                type="button"
                class="icon-btn"
                :class="{ 'is-pinned': projectProviderId === provider.id }"
                :title="projectProviderId === provider.id
                  ? t('settings.config.unpinProjectProvider')
                  : t('settings.config.pinProjectProvider', { project: projects.activeProject?.name ?? '' })"
                :disabled="!provider.enabled"
                @click="toggleProjectProvider(provider)"
              >
                <Pin :size="15" :stroke-width="1.75" />
              </button>
              <button
                type="button"
                class="icon-btn"
                :title="t('settings.config.testConnection')"
                :disabled="testingId === provider.id || !provider.enabled"
                @click="testProvider(provider)"
              >
                <FlaskConical
                  :size="16"
                  :stroke-width="1.75"
                  :class="{ 'is-spinning': testingId === provider.id }"
                />
              </button>
              <SettingsToggle
                :model-value="provider.enabled"
                @update:model-value="toggleProvider(provider.id, $event)"
              />
              <span class="ctrl-sep" aria-hidden="true" />
              <button
                type="button"
                class="icon-btn danger"
                :title="t('settings.config.removeProvider')"
                :disabled="localProviders.length <= 1"
                @click="removeProvider(provider.id)"
              >
                <Trash2 :size="16" :stroke-width="1.75" />
              </button>
            </div>
          </div>

          <div class="provider-fields" :class="{ 'is-dimmed': !provider.enabled }">
            <div class="field">
              <label class="field-label">{{ t('settings.config.providerPreset') }}</label>
              <select
                class="field-input"
                :value="providerPresetId(provider)"
                :disabled="!provider.enabled"
                @change="handlePresetChange(provider, $event)"
              >
                <option
                  v-for="preset in MODEL_PROVIDER_PRESETS"
                  :key="preset.id"
                  :value="preset.id"
                >
                  {{ preset.name }}
                </option>
              </select>
            </div>
            <div class="field">
              <label class="field-label">{{ t('settings.config.providerName') }}</label>
              <input
                v-model="provider.name"
                class="field-input"
                :placeholder="t('settings.config.providerNamePlaceholder')"
                :disabled="!provider.enabled"
              />
            </div>
            <div class="field">
              <label class="field-label">{{ t('settings.config.baseUrl') }}</label>
              <input
                v-model="provider.baseUrl"
                class="field-input"
                :placeholder="t('settings.config.baseUrlPlaceholder')"
                :disabled="!provider.enabled"
              />
            </div>
            <div v-if="providerRequiresApiKey(provider)" class="field">
              <label class="field-label">{{ t('settings.config.apiKey') }}</label>
              <input
                v-model="provider.apiKey"
                class="field-input"
                type="password"
                :placeholder="maskedApiKeys[provider.id] ? t('settings.config.apiKeySavedPlaceholder') : t('settings.config.apiKeyPlaceholder')"
                :disabled="!provider.enabled"
                autocomplete="off"
              />
            </div>
            <div class="field field-full models-field">
              <div class="models-header">
                <label class="field-label">{{ t('settings.config.models') }}</label>
                <div class="model-actions">
                  <button
                    type="button"
                    class="mini-action"
                    :disabled="!provider.enabled || fetchingModelsId === provider.id"
                    @click="fetchProviderModels(provider)"
                  >
                    <RefreshCw :size="13" :class="{ 'is-spinning': fetchingModelsId === provider.id }" />
                    <span>{{ t('settings.config.fetchModels') }}</span>
                  </button>
                  <button type="button" class="mini-action" :disabled="!provider.enabled" @click="addModel(provider)">
                    <Plus :size="13" />
                    <span>{{ t('settings.config.addModel') }}</span>
                  </button>
                </div>
              </div>
              <div class="model-table">
                <div class="model-table-head">
                  <span aria-hidden="true" />
                  <span>{{ t('settings.config.model') }}</span>
                  <span>{{ t('settings.config.multimodalShort') }}</span>
                  <span>{{ t('settings.config.enabled') }}</span>
                  <span></span>
                </div>
                <div
                  v-for="model in provider.models"
                  :key="model.id"
                  class="model-config-row"
                  :class="{ 'is-active': provider.activeModelId === model.id, 'is-disabled': !model.enabled }"
                >
                  <button
                    type="button"
                    class="model-default"
                    :disabled="!provider.enabled"
                    :title="t('settings.config.setDefaultModel')"
                    @click="setDefaultModel(provider, model.id)"
                  >
                    <span class="provider-radio mini" :class="{ 'is-checked': provider.activeModelId === model.id }">
                      <span v-if="provider.activeModelId === model.id" class="provider-radio-dot" />
                    </span>
                  </button>
                  <input
                    v-model="model.name"
                    class="model-input"
                    :placeholder="t('settings.config.modelPlaceholder')"
                    :disabled="!provider.enabled"
                    @input="syncModelName(provider, model)"
                  />
                  <div class="model-vision-group" :aria-label="t('settings.config.multimodalSupport')">
                    <button
                      v-for="option in modelVisionOptions"
                      :key="option"
                      type="button"
                      class="model-vision-option"
                      :class="{ 'is-selected': model.vision === option }"
                      :disabled="!provider.enabled || !model.enabled"
                      @click="setModelVision(model, option)"
                    >
                      {{ modelVisionLabel(option) }}
                    </button>
                  </div>
                  <SettingsToggle
                    :model-value="model.enabled"
                    :disabled="!provider.enabled"
                    @update:model-value="toggleModel(provider, model.id, $event)"
                  />
                  <button
                    type="button"
                    class="model-remove"
                    :class="{ 'is-probed': model.capabilities?.detectedAt }"
                    :disabled="!provider.enabled || probingModelId !== null"
                    :title="capabilitySummary(model)"
                    @click="probeModel(provider, model)"
                  >
                    <FlaskConical :size="14" :class="{ 'is-spinning': probingModelId === model.id }" />
                  </button>
                  <button
                    type="button"
                    class="model-remove"
                    :disabled="!provider.enabled || provider.models.length <= 1"
                    :title="t('settings.config.removeModel')"
                    @click="removeModel(provider, model.id)"
                  >
                    <Trash2 :size="14" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>

    <section class="settings-section">
      <h2 class="section-title">{{ t('settings.config.agentTitle') }}</h2>
      <p class="section-desc">{{ t('settings.config.agentDesc') }}</p>
      <div class="settings-group">
        <div class="settings-row agent-power-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.config.fullPowerTitle') }}</div>
            <div class="row-desc">{{ t('settings.config.fullPowerDesc') }}</div>
          </div>
          <div class="agent-power-actions">
            <button type="button" class="preset-btn" @click="applyAgentScopePreset">
              <Sparkles :size="13" />
              <span>{{ t('settings.config.applyFullPowerPreset') }}</span>
            </button>
            <SettingsToggle v-model="localAgentScopeFullPower" />
          </div>
        </div>
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.config.maxAgentSteps') }}</div>
            <div class="row-desc">{{ t('settings.config.maxAgentStepsDesc') }}</div>
          </div>
          <input
            v-model.number="localMaxAgentSteps"
            class="number-input"
            type="number"
            min="1"
            max="50"
          />
        </div>
        <div class="settings-row">
          <div class="row-text">
            <div class="row-title">{{ t('settings.config.maxContextTokens') }}</div>
            <div class="row-desc">{{ t('settings.config.maxContextTokensDesc') }}</div>
          </div>
          <input
            v-model.number="localMaxContextTokens"
            class="number-input"
            type="number"
            min="4000"
            max="200000"
            step="1000"
          />
        </div>
      </div>
    </section>

    <section class="settings-section">
      <div class="section-heading-row">
        <div>
          <h2 class="section-title">{{ t('settings.config.policyTitle') }}</h2>
          <p class="section-desc">{{ t('settings.config.policyDesc') }}</p>
        </div>
        <button type="button" class="mini-action policy-add" @click="addPermissionRule">
          <Plus :size="13" />
          <span>{{ t('settings.config.addPolicyRule') }}</span>
        </button>
      </div>
      <div class="policy-card">
        <div v-if="!localPermissionRules.length" class="policy-empty">
          {{ t('settings.config.policyEmpty') }}
        </div>
        <div
          v-for="rule in localPermissionRules"
          :key="rule.id"
          class="policy-row"
          :class="{ 'is-disabled': !rule.enabled }"
        >
          <SettingsToggle v-model="rule.enabled" />
          <select v-model="rule.target" class="policy-select" :aria-label="t('settings.config.policyTarget')">
            <option v-for="target in permissionTargets" :key="target" :value="target">
              {{ t(`settings.config.policyTarget_${target}`) }}
            </option>
          </select>
          <select v-model="rule.action" class="policy-select" :aria-label="t('settings.config.policyAction')">
            <option v-for="action in permissionActions" :key="action" :value="action">
              {{ t(`settings.config.policyAction_${action}`) }}
            </option>
          </select>
          <input
            v-model="rule.pattern"
            class="policy-pattern"
            :placeholder="t('settings.config.policyPatternPlaceholder')"
          />
          <input
            v-model="rule.note"
            class="policy-note"
            :placeholder="t('settings.config.policyNotePlaceholder')"
          />
          <button
            type="button"
            class="model-remove"
            :title="t('settings.config.removePolicyRule')"
            @click="removePermissionRule(rule.id)"
          >
            <Trash2 :size="14" />
          </button>
        </div>
      </div>
    </section>

    <section class="settings-section">
      <h2 class="section-title">{{ t('settings.config.skillsTitle') }}</h2>
      <p class="section-desc">{{ t('settings.config.skillsDesc') }}</p>
      <div class="skills-card">
        <div class="skills-grid">
          <div class="skills-field">
            <label class="field-label">{{ t('settings.config.skillPaths') }}</label>
            <textarea
              v-model="localSkillPathsText"
              class="textarea-field"
              rows="5"
              :placeholder="t('settings.config.skillPathsPlaceholder')"
            />
          </div>
          <div class="skills-field">
            <label class="field-label">{{ t('settings.config.skillDirPaths') }}</label>
            <textarea
              v-model="localSkillDirPathsText"
              class="textarea-field"
              rows="5"
              :placeholder="t('settings.config.skillDirPathsPlaceholder')"
            />
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-panel {
  @apply w-full;
}
.panel-header {
  @apply flex items-start justify-between gap-4 mb-8;
}
.panel-title {
  @apply text-[28px] font-semibold text-codex-text tracking-tight mb-1;
}
.panel-desc {
  @apply text-[13px] text-codex-muted leading-relaxed;
}
.save-btn {
  @apply px-4 py-1.5 text-[13px] font-medium rounded-lg transition-colors shrink-0
         bg-codex-hover text-codex-muted cursor-not-allowed;
}
.save-btn.is-enabled {
  @apply bg-codex-accent cursor-pointer hover:opacity-90;
}
.save-btn:disabled {
  @apply opacity-70 cursor-wait;
}
.save-btn.is-saved {
  @apply bg-emerald-500 cursor-default;
}
.settings-section {
  @apply mb-10;
}
.section-heading-row {
  @apply flex items-start justify-between gap-4 mb-4;
}
.section-title {
  @apply text-[15px] font-semibold text-codex-text mb-1;
}
.section-desc {
  @apply text-[13px] text-codex-muted mb-4 leading-relaxed;
}
.provider-list {
  @apply space-y-3;
}
.provider-add-bar {
  @apply mb-3 flex items-center justify-between gap-4 rounded-xl border border-codex-border
         bg-codex-bg px-4 py-3;
}
.provider-add-copy {
  @apply min-w-0 flex-1;
}
.provider-add-actions {
  @apply flex items-center gap-2 shrink-0;
}
.preset-select {
  @apply h-9 min-w-[220px] rounded-[10px] border border-codex-border bg-codex-hover
         px-3 text-[13px] text-codex-text outline-none;
}
.preset-select:focus {
  border-color: var(--codex-accent);
}
.provider-card {
  @apply relative rounded-2xl border bg-codex-bg overflow-hidden transition-all;
  border-color: color-mix(in srgb, var(--codex-border) 85%, transparent);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}
.provider-card.is-default {
  border-color: color-mix(in srgb, var(--codex-accent) 45%, var(--codex-border));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--codex-accent) 18%, transparent);
}
.provider-card.is-disabled {
  @apply opacity-90;
}
.provider-top {
  @apply flex items-center justify-between gap-4 px-5 py-4;
}
.provider-select {
  @apply flex items-center gap-3 min-w-0 flex-1 text-left;
}
.provider-radio {
  @apply w-[18px] h-[18px] rounded-full border-2 border-codex-border-hover
         flex items-center justify-center shrink-0;
}
.provider-icon-wrap {
  @apply flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px];
  background: color-mix(in srgb, var(--codex-text) 5%, var(--codex-bg));
}
.provider-radio.is-checked {
  @apply border-codex-accent;
}
.provider-radio-dot {
  @apply w-[8px] h-[8px] rounded-full bg-codex-accent;
}
.provider-radio.mini {
  @apply mt-0 h-[15px] w-[15px] border;
}
.provider-radio.mini .provider-radio-dot {
  @apply h-[7px] w-[7px];
}
.provider-icon {
  @apply text-codex-text-secondary shrink-0;
}
.provider-heading {
  @apply min-w-0 flex-1;
}
.provider-name-row {
  @apply flex items-center gap-2 flex-wrap;
}
.provider-name {
  @apply text-[14px] font-semibold text-codex-text;
}
.provider-badge {
  @apply text-[11px] px-2 py-0.5 rounded-full text-codex-muted;
  background: color-mix(in srgb, var(--codex-text) 6%, var(--codex-bg));
}
.default-badge {
  @apply text-[11px] font-semibold px-2 py-0.5 rounded-full text-codex-accent;
  background: color-mix(in srgb, var(--codex-accent) 12%, transparent);
}
.provider-desc {
  @apply text-[12px] text-codex-muted mt-0.5 leading-relaxed;
}
.provider-controls {
  @apply flex items-center gap-1 shrink-0;
}
.ctrl-sep {
  @apply mx-1 h-5 w-px shrink-0 bg-codex-border;
}
.test-badge {
  @apply max-w-[140px] truncate text-[11px] px-2 py-0.5 rounded-md bg-codex-hover text-codex-muted;
}
.test-badge.is-ok {
  @apply bg-emerald-50 text-emerald-700;
}
.test-badge.is-error {
  @apply bg-red-50 text-red-600;
}
.icon-btn {
  @apply inline-flex h-[30px] w-[30px] items-center justify-center rounded-lg text-codex-muted
         hover:bg-codex-hover hover:text-codex-text transition-colors;
}
.icon-btn.is-pinned {
  color: var(--codex-accent, #2563eb);
}
.icon-btn.danger:hover {
  @apply text-red-500;
}
.icon-btn:disabled {
  @apply opacity-40 cursor-not-allowed hover:bg-transparent hover:text-codex-muted;
}
.is-spinning {
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to { transform: rotate(360deg); }
}
.provider-fields {
  @apply grid grid-cols-2 gap-x-4 gap-y-3.5 px-5 pb-5 pt-1;
}
.provider-fields.is-dimmed {
  @apply opacity-60;
}
.field-full {
  @apply col-span-2;
}
.models-field {
  @apply min-w-0;
}
.models-header {
  @apply mb-1.5 flex items-center justify-between gap-2;
}
.model-actions {
  @apply flex items-center gap-1.5;
}
.mini-action {
  @apply inline-flex items-center gap-1.5 rounded-lg border border-codex-border bg-codex-bg
         px-2.5 py-1 text-[11.5px] font-medium text-codex-text-secondary transition-colors
         hover:border-codex-border-hover hover:text-codex-text
         disabled:cursor-not-allowed disabled:opacity-40;
}
.model-table {
  @apply overflow-hidden rounded-xl border;
  border-color: color-mix(in srgb, var(--codex-border) 80%, transparent);
  background: color-mix(in srgb, var(--codex-text) 1.5%, var(--codex-bg));
}
.model-table-head {
  @apply grid grid-cols-[30px_minmax(130px,1fr)_150px_44px_30px_28px] items-center gap-2.5
         border-b border-codex-border px-3.5 py-2.5
         text-[11px] font-medium text-codex-muted;
}
.model-table-head span:last-child {
  grid-column: 5 / span 2;
}
.model-table-head span:nth-child(3),
.model-table-head span:nth-child(4) {
  @apply text-center;
}
.model-config-row {
  @apply grid grid-cols-[30px_minmax(130px,1fr)_150px_44px_30px_28px] items-center gap-2.5
         bg-codex-bg px-3.5 py-2.5 transition-colors;
}
.model-config-row + .model-config-row {
  border-top: 1px solid color-mix(in srgb, var(--codex-border) 70%, transparent);
}
.model-config-row.is-active {
  background-color: color-mix(in srgb, var(--codex-accent) 5%, var(--codex-bg));
}
.model-config-row > :nth-child(4) {
  @apply justify-self-center;
}
.model-config-row.is-disabled {
  @apply opacity-60;
}
.model-default {
  @apply flex justify-center disabled:cursor-not-allowed;
}
.model-input {
  @apply h-8 min-w-0 rounded-md bg-transparent px-1 text-[12.5px] text-codex-text
         outline-none placeholder:text-codex-muted;
  font-family: var(--codex-code-font);
}
.model-input:disabled {
  @apply cursor-not-allowed;
}
.model-vision-group {
  @apply flex h-7 w-full items-center gap-px rounded-lg p-0.5;
  background: color-mix(in srgb, var(--codex-text) 5%, var(--codex-bg));
}
.model-vision-option {
  @apply h-6 flex-1 rounded-md px-1.5 text-[11px] font-medium text-codex-muted transition-colors
         disabled:cursor-not-allowed disabled:opacity-45;
}
.model-vision-option.is-selected {
  @apply bg-codex-bg text-codex-text font-medium shadow-sm;
}
.model-remove {
  @apply inline-flex h-7 w-7 items-center justify-center justify-self-center rounded-md text-codex-muted hover:bg-codex-hover hover:text-red-500
         disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-codex-muted;
}
.field-label {
  @apply block text-[12px] font-medium text-codex-text-secondary mb-1.5;
}
.field-input {
  @apply w-full px-3 py-2 text-[13px] rounded-[10px] border border-codex-border outline-none transition-colors;
  background: color-mix(in srgb, var(--codex-text) 2.5%, var(--codex-bg));
}
.field-input:focus {
  border-color: var(--codex-accent);
}
.field-input:disabled {
  @apply cursor-not-allowed opacity-70;
}
.field-hint {
  @apply text-[11px] text-codex-muted mt-1.5;
}
.settings-group {
  @apply rounded-xl border border-codex-border overflow-hidden bg-codex-bg;
}
.settings-row {
  @apply flex items-center justify-between gap-6 px-4 py-3.5;
}
.settings-row + .settings-row {
  @apply border-t border-codex-border;
}
.agent-power-row {
  background-color: color-mix(in srgb, var(--codex-hover) 35%, transparent);
}
.agent-power-actions {
  @apply flex items-center gap-2 shrink-0;
}
.preset-btn {
  @apply inline-flex items-center gap-1.5 rounded-lg border border-codex-border bg-codex-bg
         px-2.5 py-1.5 text-[12px] font-medium text-codex-text-secondary
         hover:border-codex-border-hover hover:text-codex-text transition-colors;
}
.policy-add {
  @apply mt-0.5 shrink-0;
}
.policy-card {
  @apply rounded-xl border border-codex-border bg-codex-bg overflow-hidden;
}
.policy-empty {
  @apply px-4 py-4 text-[13px] text-codex-muted;
}
.policy-row {
  @apply grid grid-cols-[auto_96px_96px_minmax(150px,1fr)_minmax(120px,0.8fr)_auto]
         items-center gap-2 px-4 py-3;
}
.policy-row + .policy-row {
  @apply border-t border-codex-border;
}
.policy-row.is-disabled {
  @apply opacity-55;
}
.policy-select,
.policy-pattern,
.policy-note {
  @apply h-9 min-w-0 rounded-[9px] border border-codex-border bg-codex-hover
         px-2.5 text-[12px] text-codex-text outline-none;
}
.policy-select:focus,
.policy-pattern:focus,
.policy-note:focus {
  border-color: var(--codex-accent);
}
.row-text {
  @apply flex-1 min-w-0 pr-4;
}
.row-title {
  @apply text-[14px] font-medium text-codex-text;
}
.row-desc {
  @apply text-[12px] text-codex-muted mt-0.5 leading-relaxed;
}
.number-input {
  @apply w-28 px-3 py-1.5 text-[13px] text-right rounded-[10px] border border-codex-border
         bg-codex-hover outline-none tabular-nums shrink-0;
}
.number-input:focus {
  border-color: var(--codex-accent);
}
.skills-card {
  @apply rounded-xl border border-codex-border bg-codex-bg p-4;
}
.skills-grid {
  @apply grid grid-cols-2 gap-4;
}
.skills-field {
  @apply min-w-0;
}
.textarea-field {
  @apply w-full resize-y min-h-[120px] px-3 py-2.5 text-[13px] leading-relaxed
         rounded-xl border border-codex-border outline-none bg-codex-hover
         placeholder:text-codex-muted;
}
.textarea-field:focus {
  border-color: var(--codex-accent);
}
</style>
