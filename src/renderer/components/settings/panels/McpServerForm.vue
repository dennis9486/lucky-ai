<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ArrowLeft, ExternalLink, Trash2 } from 'lucide-vue-next'
import SettingsSegmented from '../SettingsSegmented.vue'
import McpKeyValueEditor from '../McpKeyValueEditor.vue'
import { useSettingsStore } from '../../../stores/settings.store.js'
import {
  DEFAULT_MCP_FORM,
  configToForm,
  formToConfig,
  uniqueMcpId,
  type McpServerFormState
} from '../../../../shared/types/mcp.js'

const props = defineProps<{
  serverId?: string | null
}>()

const emit = defineEmits<{ back: []; saved: [] }>()

const { t } = useI18n()
const settings = useSettingsStore()
const form = ref<McpServerFormState>(structuredClone(DEFAULT_MCP_FORM))
const error = ref('')
const saving = ref(false)

const typeOptions = computed(() => [
  { value: 'stdio', label: t('settings.mcpForm.typeStdio') },
  { value: 'http', label: t('settings.mcpForm.typeHttp') }
])

watch(
  () => props.serverId,
  () => syncForm(),
  { immediate: true }
)

function syncForm(): void {
  error.value = ''
  if (!props.serverId) {
    form.value = structuredClone(DEFAULT_MCP_FORM)
    return
  }
  const existing = settings.mcpServers.find((server) => server.id === props.serverId)
  form.value = existing ? configToForm(existing) : structuredClone(DEFAULT_MCP_FORM)
}

function patch(partial: Partial<McpServerFormState>): void {
  form.value = { ...form.value, ...partial }
}

function updateArg(index: number, value: string): void {
  const args = [...form.value.args]
  args[index] = value
  patch({ args })
}

function removeArg(index: number): void {
  const args = form.value.args.filter((_, i) => i !== index)
  patch({ args: args.length ? args : [''] })
}

function addArg(): void {
  patch({ args: [...form.value.args, ''] })
}

function updateEnvForward(index: number, value: string): void {
  const envForward = [...form.value.envForward]
  envForward[index] = value
  patch({ envForward })
}

function removeEnvForward(index: number): void {
  patch({ envForward: form.value.envForward.filter((_, i) => i !== index) })
}

function addEnvForward(): void {
  patch({ envForward: [...form.value.envForward, ''] })
}

function validateForm(): string | null {
  if (!form.value.name.trim()) return t('settings.mcpForm.validationName')
  if (form.value.type === 'stdio') {
    if (!form.value.command.trim()) return t('settings.mcpForm.validationCommand')
    return null
  }
  if (!form.value.url.trim()) return t('settings.mcpForm.validationUrl')
  try {
    new URL(form.value.url.trim())
  } catch {
    return t('settings.mcpForm.validationUrlInvalid')
  }
  return null
}

async function save(): Promise<void> {
  const validationError = validateForm()
  if (validationError) {
    error.value = validationError
    return
  }

  saving.value = true
  error.value = ''
  try {
    const existing = props.serverId
      ? settings.mcpServers.find((server) => server.id === props.serverId)
      : undefined
    const id = props.serverId
      ?? uniqueMcpId(form.value.name, settings.mcpServers.map((server) => server.id))
    const config = formToConfig(form.value, id, existing)
    await settings.upsertMcpServer(config)
    emit('saved')
  } catch (e) {
    error.value = String(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="settings-panel">
    <button type="button" class="back-link" @click="emit('back')">
      <ArrowLeft :size="14" :stroke-width="1.75" />
      <span>{{ t('settings.mcpForm.back') }}</span>
    </button>

    <div class="form-header">
      <div>
        <h1 class="panel-title">{{ t('settings.mcpForm.title') }}</h1>
        <a href="#" class="doc-link" @click.prevent>
          <span>{{ t('settings.mcpForm.docs') }}</span>
          <ExternalLink :size="13" :stroke-width="1.75" />
        </a>
      </div>
    </div>

    <div class="form-card">
      <div class="form-field">
        <label class="field-label">{{ t('settings.mcpForm.name') }}</label>
        <input
          v-model="form.name"
          class="field-input"
          :placeholder="t('settings.mcpForm.namePlaceholder')"
        />
      </div>

      <div class="form-field">
        <SettingsSegmented
          :model-value="form.type"
          variant="dark"
          :options="typeOptions"
          @update:model-value="patch({ type: $event as 'stdio' | 'http' })"
        />
      </div>

      <template v-if="form.type === 'stdio'">
        <div class="form-field">
          <label class="field-label">{{ t('settings.mcpForm.command') }}</label>
          <input
            v-model="form.command"
            class="field-input"
            :placeholder="t('settings.mcpForm.commandPlaceholder')"
          />
        </div>

        <div class="form-field">
          <label class="field-label">{{ t('settings.mcpForm.args') }}</label>
          <div class="arg-list">
            <div v-for="(arg, index) in form.args" :key="index" class="arg-row">
              <input
                :value="arg"
                class="field-input"
                :placeholder="t('settings.mcpForm.argPlaceholder')"
                @input="updateArg(index, ($event.target as HTMLInputElement).value)"
              />
              <button type="button" class="icon-btn" @click="removeArg(index)">
                <Trash2 :size="15" :stroke-width="1.75" />
              </button>
            </div>
            <button type="button" class="add-row-btn" @click="addArg">{{ t('settings.mcpForm.addArg') }}</button>
          </div>
        </div>

        <div class="form-field">
          <label class="field-label">{{ t('settings.mcpForm.env') }}</label>
          <McpKeyValueEditor
            :items="form.env"
            :add-label="t('settings.mcpForm.addEnv')"
            @update:items="patch({ env: $event })"
          />
        </div>

        <div class="form-field">
          <label class="field-label">{{ t('settings.mcpForm.envForward') }}</label>
          <div class="arg-list">
            <div v-for="(item, index) in form.envForward" :key="index" class="arg-row">
              <input
                :value="item"
                class="field-input"
                :placeholder="t('settings.mcpForm.envForwardPlaceholder')"
                @input="updateEnvForward(index, ($event.target as HTMLInputElement).value)"
              />
              <button type="button" class="icon-btn" @click="removeEnvForward(index)">
                <Trash2 :size="15" :stroke-width="1.75" />
              </button>
            </div>
            <button type="button" class="add-row-btn" @click="addEnvForward">{{ t('settings.mcpForm.addEnvForward') }}</button>
          </div>
        </div>

        <div class="form-field">
          <label class="field-label">{{ t('settings.mcpForm.cwd') }}</label>
          <input v-model="form.cwd" class="field-input" :placeholder="t('settings.mcpForm.cwdPlaceholder')" />
        </div>
      </template>

      <template v-else>
        <div class="form-field">
          <label class="field-label">{{ t('settings.mcpForm.url') }}</label>
          <input
            v-model="form.url"
            class="field-input"
            :placeholder="t('settings.mcpForm.urlPlaceholder')"
          />
        </div>

        <div class="form-field">
          <label class="field-label">{{ t('settings.mcpForm.bearerTokenEnv') }}</label>
          <input
            v-model="form.bearerTokenEnv"
            class="field-input"
            :placeholder="t('settings.mcpForm.bearerTokenEnvPlaceholder')"
          />
        </div>

        <div class="form-field">
          <label class="field-label">{{ t('settings.mcpForm.headers') }}</label>
          <McpKeyValueEditor
            :items="form.headers"
            :key-placeholder="t('settings.mcpForm.key')"
            :value-placeholder="t('settings.mcpForm.value')"
            :add-label="t('settings.mcpForm.addHeader')"
            @update:items="patch({ headers: $event })"
          />
        </div>

        <div class="form-field">
          <label class="field-label">{{ t('settings.mcpForm.headerEnv') }}</label>
          <McpKeyValueEditor
            :items="form.headerEnv"
            :key-placeholder="t('settings.mcpForm.key')"
            :value-placeholder="t('settings.mcpForm.envVarName')"
            :add-label="t('settings.mcpForm.addHeaderEnv')"
            @update:items="patch({ headerEnv: $event })"
          />
        </div>
      </template>
    </div>

    <p v-if="error" class="error-text">{{ error }}</p>

    <div class="form-footer">
      <button type="button" class="save-btn" :disabled="saving" @click="save()">
        {{ saving ? t('settings.mcpForm.saving') : t('settings.mcpForm.save') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.settings-panel {
  @apply w-full;
}
.back-link {
  @apply flex items-center gap-1.5 mb-4 text-[13px] text-codex-text-secondary
         hover:text-codex-text transition-colors;
}
.form-header {
  @apply mb-6;
}
.panel-title {
  @apply text-[28px] font-semibold text-codex-text tracking-tight mb-1;
}
.doc-link {
  @apply inline-flex items-center gap-1 text-[13px] text-codex-accent hover:underline;
}
.form-card {
  @apply rounded-xl border border-codex-border bg-codex-bg p-5 space-y-5;
}
.form-field {
  @apply space-y-2;
}
.field-label {
  @apply block text-[13px] font-medium text-codex-text;
}
.field-input {
  @apply w-full px-3 py-2 text-[13px] rounded-lg border border-codex-border
         bg-codex-hover outline-none focus:border-codex-accent;
}
.arg-list {
  @apply space-y-2;
}
.arg-row {
  @apply flex items-center gap-2;
}
.icon-btn {
  @apply p-2 rounded-lg text-codex-muted hover:bg-codex-hover hover:text-codex-text transition-colors shrink-0;
}
.add-row-btn {
  @apply w-full py-2 text-[13px] rounded-lg border border-codex-border bg-codex-hover
         text-codex-text-secondary hover:bg-codex-bg transition-colors;
}
.form-footer {
  @apply flex justify-end mt-5;
}
.save-btn {
  @apply px-5 py-2 text-[13px] font-medium rounded-lg bg-codex-text text-white
         hover:opacity-90 transition-opacity disabled:opacity-50;
}
.error-text {
  @apply mt-3 text-[12px] text-red-600;
}
</style>
