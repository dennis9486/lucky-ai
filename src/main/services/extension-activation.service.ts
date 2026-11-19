import { join } from 'node:path'
import type {
  ExtensionActivationResult,
  ExtensionCommandPayload,
  ExtensionGrammarPayload,
  ExtensionLanguagePayload,
  ExtensionManifestSummary,
  ExtensionThemePayload
} from '../../shared/types/extension.js'
import { createLogger } from '../../shared/utils/log.js'
import { extensionService } from './extension.service.js'
import { isGrammarFile, readGrammarFile, readThemeFile } from './extension-grammar.js'
import { extensionRuntimeService } from './extension-runtime.service.js'

const APP_ENGINE_VERSION = '1.85.0'
const logger = createLogger('main/extension-activation')

export class ExtensionActivationService {
  async activateContributions(workspaceRoot?: string): Promise<ExtensionActivationResult> {
    const [installed, recommendations] = await Promise.all([
      extensionService.listInstalled(),
      extensionService.getRecommendations()
    ])

    const unwanted = new Set(recommendations.unwantedRecommendations)
    const preferred = new Set(recommendations.recommendations)
    const candidates = installed
      .filter((item) => item.enabled && !unwanted.has(item.id))
      .sort((a, b) => scoreExtension(b, preferred, workspaceRoot) - scoreExtension(a, preferred, workspaceRoot))

    const activatedExtensionIds: string[] = []
    const skippedExtensionIds: string[] = []
    const grammars: ExtensionGrammarPayload[] = []
    const themes: ExtensionThemePayload[] = []
    const languages: ExtensionLanguagePayload[] = []
    const commands: ExtensionCommandPayload[] = []

    for (const extension of candidates) {
      if (!isEngineCompatible(extension)) {
        skippedExtensionIds.push(extension.id)
        continue
      }
      if (!shouldActivate(extension, workspaceRoot)) {
        skippedExtensionIds.push(extension.id)
        continue
      }

      activatedExtensionIds.push(extension.id)
      languages.push(...collectLanguages(extension))
      commands.push(...collectCommands(extension))

      const loadedGrammars = await loadGrammars(extension)
      grammars.push(...loadedGrammars)

      const loadedThemes = await loadThemes(extension)
      themes.push(...loadedThemes)
    }

    const runtime = await extensionRuntimeService.activateExtensions(
      candidates.filter((item) => activatedExtensionIds.includes(item.id)),
      workspaceRoot
    )

    logger.info('activate extension contributions', {
      workspaceRoot,
      installedCount: installed.length,
      candidateCount: candidates.length,
      activatedCount: activatedExtensionIds.length,
      skippedCount: skippedExtensionIds.length,
      grammarCount: grammars.length,
      themeCount: themes.length,
      languageCount: languages.length,
      commandCount: commands.length,
      runtimeFailedCount: runtime.failed.length
    })

    return {
      activatedExtensionIds,
      skippedExtensionIds,
      grammars,
      themes,
      languages,
      commands,
      runtime
    }
  }
}

export const extensionActivationService = new ExtensionActivationService()

function scoreExtension(
  extension: ExtensionManifestSummary,
  preferred: Set<string>,
  workspaceRoot?: string
): number {
  let score = 0
  if (preferred.has(extension.id)) score += 100
  if (extension.contributes?.grammars?.length) score += 10
  if (extension.contributes?.themes?.length) score += 5
  if (extension.contributes?.languages?.length) score += 3
  if (shouldActivate(extension, workspaceRoot)) score += 1
  return score
}

function isEngineCompatible(extension: ExtensionManifestSummary): boolean {
  const engine = extension.engines?.vscode
  if (!engine) return true
  return compareSemver(APP_ENGINE_VERSION, engine) >= 0
}

function shouldActivate(extension: ExtensionManifestSummary, workspaceRoot?: string): boolean {
  const events = extension.activationEvents ?? []
  if (!events.length) return true
  if (events.some((event) => event === '*' || event === 'onStartupFinished')) return true
  if (workspaceRoot && events.some((event) => event === 'workspaceContains:**/*')) return true
  if (extension.contributes?.languages?.length && events.some((event) => event.startsWith('onLanguage:'))) {
    return true
  }
  if (extension.contributes?.grammars?.length || extension.contributes?.themes?.length) return true
  return false
}

function collectLanguages(extension: ExtensionManifestSummary): ExtensionLanguagePayload[] {
  const rows = extension.contributes?.languages ?? []
  return rows.map((language) => ({
    extensionId: extension.id,
    id: language.id,
    aliases: language.aliases ?? [],
    extensions: (language.extensions ?? []).map((item) => item.replace(/^\./, '').toLowerCase()),
    filenames: (language.filenames ?? []).map((item) => item.toLowerCase())
  }))
}

function collectCommands(extension: ExtensionManifestSummary): ExtensionCommandPayload[] {
  const rows = extension.contributes?.commands ?? []
  return rows.map((command) => ({
    extensionId: extension.id,
    command: command.command,
    title: command.title ?? command.command,
    category: command.category
  }))
}

async function loadGrammars(extension: ExtensionManifestSummary): Promise<ExtensionGrammarPayload[]> {
  const rows = extension.contributes?.grammars ?? []
  const results: ExtensionGrammarPayload[] = []

  for (const grammar of rows) {
    if (!grammar.path || !grammar.scopeName) continue
    const absPath = join(extension.path, grammar.path)
    if (!isGrammarFile(absPath)) continue
    const parsed = await readGrammarFile(absPath)
    if (!parsed) continue
    const languageId = grammar.language ?? inferLanguageId(parsed, grammar.scopeName)
    if (!languageId) continue
    results.push({
      extensionId: extension.id,
      languageId,
      scopeName: grammar.scopeName,
      grammar: parsed
    })
  }

  return results
}

async function loadThemes(extension: ExtensionManifestSummary): Promise<ExtensionThemePayload[]> {
  const rows = extension.contributes?.themes ?? []
  const results: ExtensionThemePayload[] = []

  for (const theme of rows) {
    if (!theme.path) continue
    const absPath = join(extension.path, theme.path)
    const parsed = await readThemeFile(absPath)
    if (!parsed) continue
    const type = typeof parsed.type === 'string' ? parsed.type : undefined
    results.push({
      extensionId: extension.id,
      id: `${extension.id}:${theme.id}`,
      label: theme.label ?? theme.id,
      uiTheme: theme.uiTheme ?? (type === 'light' ? 'vs' : 'vs-dark'),
      theme: parsed
    })
  }

  return results
}

function inferLanguageId(grammar: Record<string, unknown>, scopeName: string): string | null {
  if (typeof grammar.name === 'string' && grammar.name.trim()) return grammar.name.trim().toLowerCase()
  const tail = scopeName.split('.').pop()
  return tail?.trim() ? tail.toLowerCase() : null
}

function compareSemver(current: string, required: string): number {
  const parse = (value: string): number[] => {
    const cleaned = value.trim().replace(/^[\^~>=<]+/, '').split('-')[0] ?? ''
    return cleaned.split('.').map((part) => Number.parseInt(part, 10) || 0)
  }
  const left = parse(current)
  const right = parse(required)
  const length = Math.max(left.length, right.length, 3)
  for (let index = 0; index < length; index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0)
    if (delta !== 0) return delta
  }
  return 0
}
