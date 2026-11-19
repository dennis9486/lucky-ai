<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { Pencil, Plus, Trash2 } from 'lucide-vue-next'
import SettingsToggle from '../SettingsToggle.vue'
import { useSettingsStore } from '../../../stores/settings.store.js'
import { ipc, unwrap } from '../../../services/ipc-client.js'
import { toIpcPlain } from '../../../utils/ipc-serialize.js'
import type { ConfiguredSkill } from '../../../../shared/types/skill.js'

const { t } = useI18n()
const settings = useSettingsStore()

const skills = ref<ConfiguredSkill[]>([])
const loading = ref(false)
const saving = ref(false)
const error = ref('')
const editing = ref(false)
const pathText = ref('')
const dirText = ref('')
const pathsSaved = ref(false)
const form = ref({
  id: '',
  name: '',
  description: '',
  content: '',
  enabled: true
})

function splitLines(text: string): string[] {
  return text.split('\n').map((line) => line.trim()).filter(Boolean)
}

async function refresh(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    skills.value = await unwrap(ipc.skills.list())
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

function startCreate(): void {
  form.value = { id: '', name: '', description: '', content: '', enabled: true }
  editing.value = true
  error.value = ''
}

function startEdit(skill: ConfiguredSkill): void {
  form.value = { ...skill }
  editing.value = true
  error.value = ''
}

async function saveSkill(): Promise<void> {
  if (!form.value.name.trim()) {
    error.value = t('settings.skills.nameRequired')
    return
  }
  saving.value = true
  error.value = ''
  try {
    await unwrap(ipc.skills.save(toIpcPlain({
      id: form.value.id || undefined,
      name: form.value.name,
      description: form.value.description,
      content: form.value.content,
      enabled: form.value.enabled
    })))
    editing.value = false
    await refresh()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}

async function toggleSkill(skill: ConfiguredSkill, enabled: boolean): Promise<void> {
  const previous = skill.enabled
  skill.enabled = enabled
  try {
    await unwrap(ipc.skills.setEnabled(skill.id, enabled))
  } catch (e) {
    skill.enabled = previous
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function removeSkill(skill: ConfiguredSkill): Promise<void> {
  if (!window.confirm(t('settings.skills.deleteConfirm', { name: skill.name }))) return
  try {
    await unwrap(ipc.skills.delete(skill.id))
    await refresh()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

async function savePaths(): Promise<void> {
  pathsSaved.value = false
  settings.skillPaths = splitLines(pathText.value)
  settings.skillDirPaths = splitLines(dirText.value)
  try {
    await settings.save()
    pathsSaved.value = true
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  }
}

onMounted(async () => {
  if (!settings.loaded) await settings.load()
  pathText.value = settings.skillPaths.join('\n')
  dirText.value = settings.skillDirPaths.join('\n')
  await refresh()
})
</script>

<template>
  <div class="settings-panel">
    <div class="panel-heading">
      <div>
        <h1 class="panel-title">{{ t('settings.skills.title') }}</h1>
        <p class="panel-desc">{{ t('settings.skills.description') }}</p>
      </div>
      <button v-if="!editing" type="button" class="btn-primary" @click="startCreate">
        <Plus :size="16" />
        {{ t('settings.skills.add') }}
      </button>
    </div>

    <p v-if="error" class="form-error">{{ error }}</p>

    <section v-if="editing" class="settings-section">
      <div class="form-card">
        <label class="field">
          <span>{{ t('settings.skills.name') }}</span>
          <input v-model="form.name" class="text-input" :placeholder="t('settings.skills.namePlaceholder')" />
        </label>
        <label class="field">
          <span>{{ t('settings.skills.descriptionLabel') }}</span>
          <input v-model="form.description" class="text-input" :placeholder="t('settings.skills.descriptionPlaceholder')" />
        </label>
        <label class="field">
          <span>{{ t('settings.skills.content') }}</span>
          <textarea v-model="form.content" class="text-input area" rows="10" :placeholder="t('settings.skills.contentPlaceholder')" />
        </label>
        <div class="form-row">
          <span>{{ t('settings.skills.enabled') }}</span>
          <SettingsToggle :model-value="form.enabled" @update:model-value="form.enabled = $event" />
        </div>
        <div class="form-actions">
          <button type="button" class="btn-ghost" @click="editing = false">{{ t('settings.skills.cancel') }}</button>
          <button type="button" class="btn-primary" :disabled="saving" @click="saveSkill">{{ t('settings.skills.save') }}</button>
        </div>
      </div>
    </section>

    <section v-else class="settings-section">
      <p v-if="loading" class="empty">{{ t('settings.skills.loading') }}</p>
      <p v-else-if="skills.length === 0" class="empty">{{ t('settings.skills.empty') }}</p>
      <div v-else class="skill-list">
        <article v-for="skill in skills" :key="skill.id" class="skill-card">
          <div class="skill-copy">
            <h2>{{ skill.name }}</h2>
            <p>{{ skill.description || t('settings.skills.noDescription') }}</p>
          </div>
          <div class="skill-actions">
            <SettingsToggle :model-value="skill.enabled" @update:model-value="toggleSkill(skill, $event)" />
            <button type="button" class="icon-button" :title="t('settings.skills.edit')" @click="startEdit(skill)">
              <Pencil :size="15" />
            </button>
            <button type="button" class="icon-button danger" :title="t('settings.skills.delete')" @click="removeSkill(skill)">
              <Trash2 :size="15" />
            </button>
          </div>
        </article>
      </div>
    </section>

    <section class="settings-section">
      <h2 class="section-title">{{ t('settings.skills.pathsTitle') }}</h2>
      <p class="panel-desc">{{ t('settings.skills.pathsDesc') }}</p>
      <div class="path-grid">
        <label class="field">
          <span>{{ t('settings.config.skillPaths') }}</span>
          <textarea v-model="pathText" class="text-input area" rows="4" :placeholder="t('settings.config.skillPathsPlaceholder')" />
        </label>
        <label class="field">
          <span>{{ t('settings.config.skillDirPaths') }}</span>
          <textarea v-model="dirText" class="text-input area" rows="4" :placeholder="t('settings.config.skillDirPathsPlaceholder')" />
        </label>
      </div>
      <div class="form-actions">
        <button type="button" class="btn-primary" @click="savePaths">{{ t('settings.skills.savePaths') }}</button>
        <span v-if="pathsSaved" class="saved">{{ t('settings.skills.pathsSaved') }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-panel {
  @apply w-full;
}
.panel-heading {
  @apply mb-8 flex items-start justify-between gap-4;
}
.panel-title {
  @apply text-[28px] font-semibold tracking-tight text-codex-text;
}
.panel-desc,
.empty {
  @apply mt-2 text-sm leading-6 text-codex-muted;
}
.section-title {
  @apply text-base font-semibold text-codex-text;
}
.settings-section {
  @apply mb-10;
}
.form-error {
  @apply mb-4 text-sm text-red-500;
}
.form-card,
.skill-card {
  @apply rounded-xl border border-codex-border bg-codex-bg;
}
.form-card {
  @apply space-y-4 p-4;
}
.field {
  @apply flex flex-col gap-1.5 text-sm text-codex-text;
}
.text-input {
  @apply w-full rounded-lg border border-codex-border bg-transparent px-3 py-2 text-sm text-codex-text outline-none;
}
.text-input:focus {
  @apply border-codex-accent;
}
.area {
  @apply resize-y font-mono;
}
.form-row,
.skill-card,
.form-actions,
.skill-actions {
  @apply flex items-center;
}
.form-row {
  @apply justify-between;
}
.form-actions {
  @apply gap-3;
}
.skill-list {
  @apply space-y-3;
}
.skill-card {
  @apply justify-between gap-4 px-4 py-3;
}
.skill-copy h2 {
  @apply text-sm font-medium text-codex-text;
}
.skill-copy p {
  @apply mt-1 text-sm text-codex-muted;
}
.skill-actions {
  @apply shrink-0 gap-2;
}
.path-grid {
  @apply mt-4 grid gap-4;
}
.icon-button {
  @apply inline-flex items-center justify-center rounded-lg border border-codex-border text-sm text-codex-text;
}
.icon-button {
  @apply h-8 w-8 px-0;
}
.icon-button.danger:hover {
  @apply text-red-500;
}
.saved {
  @apply text-sm text-codex-muted;
}
</style>
