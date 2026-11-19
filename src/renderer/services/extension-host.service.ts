import type * as Monaco from 'monaco-editor'
import type { HighlighterCore, LanguageRegistration } from 'shiki/core'
import { textmateThemeToMonacoTheme } from '@shikijs/monaco'
import type {
  ExtensionActivationResult,
  ExtensionCommandPayload,
  ExtensionRuntimeResult
} from '../../shared/types/extension.js'
import type { EditorSettings } from '../../shared/types/ipc.js'
import { DEFAULT_EDITOR_SETTINGS } from '../../shared/types/ipc.js'
import { createLogger } from '../../shared/utils/log.js'
import { ipc, unwrap } from './ipc-client.js'
import { MONACO_THEME_DARK, MONACO_THEME_LIGHT } from './monaco.service.js'

export interface MonacoThemeOption {
  id: string
  label: string
  uiTheme: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light' | 'light' | 'dark'
  source: 'builtin' | 'extension'
}

const extensionLanguageByExtension = new Map<string, string>()
const extensionFilenameLanguage = new Map<string, string>()
const activatedExtensionIds = new Set<string>()
const extensionCommands = new Map<string, ExtensionCommandPayload>()
const extensionThemes = new Map<string, MonacoThemeOption>()
const runtimeCommands = new Set<string>()
let runtimeSummary: ExtensionRuntimeResult | null = null

let activationPromise: Promise<ExtensionActivationResult | null> | null = null
let bindLanguages: ((monaco: typeof Monaco, highlighter: HighlighterCore, languageIds: string[]) => void) | null = null
const logger = createLogger('renderer/extension-host')

const BUILTIN_THEMES: MonacoThemeOption[] = [
  { id: MONACO_THEME_LIGHT, label: 'GitHub Light', uiTheme: 'vs', source: 'builtin' },
  { id: MONACO_THEME_DARK, label: 'GitHub Dark', uiTheme: 'vs-dark', source: 'builtin' }
]

export function registerExtensionLanguageBinding(
  binder: (monaco: typeof Monaco, highlighter: HighlighterCore, languageIds: string[]) => void
): void {
  bindLanguages = binder
}

export function listExtensionThemes(): MonacoThemeOption[] {
  return [...BUILTIN_THEMES, ...extensionThemes.values()]
}

export function listThemesForMode(mode: 'light' | 'dark'): MonacoThemeOption[] {
  const lightUi = new Set(['vs', 'hc-light', 'light'])
  return listExtensionThemes().filter((theme) => (
    mode === 'light' ? lightUi.has(theme.uiTheme) : !lightUi.has(theme.uiTheme)
  ))
}

export function resolveMonacoThemeId(mode: 'light' | 'dark', editor?: EditorSettings): string {
  const settings = { ...DEFAULT_EDITOR_SETTINGS, ...editor }
  const selected = mode === 'dark' ? settings.monacoThemeDark : settings.monacoThemeLight
  if (selected && listExtensionThemes().some((theme) => theme.id === selected)) return selected
  return mode === 'dark' ? MONACO_THEME_DARK : MONACO_THEME_LIGHT
}

export function applyEditorMonacoTheme(
  monaco: typeof Monaco,
  mode: 'light' | 'dark',
  editor?: EditorSettings
): void {
  monaco.editor.setTheme(resolveMonacoThemeId(mode, editor))
}

export function getExtensionActivationSummary(): {
  activated: string[]
  commands: ExtensionCommandPayload[]
  themes: MonacoThemeOption[]
  runtime: ExtensionRuntimeResult | null
} {
  return {
    activated: [...activatedExtensionIds],
    commands: [...extensionCommands.values()],
    themes: listExtensionThemes(),
    runtime: runtimeSummary
  }
}

export function resolveExtensionBackedLanguage(path: string): string | null {
  const fileName = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  if (!fileName) return null

  const byFilename = extensionFilenameLanguage.get(fileName)
  if (byFilename) return byFilename

  const ext = fileName.includes('.') ? fileName.split('.').pop() ?? '' : fileName
  return extensionLanguageByExtension.get(ext) ?? null
}

export async function activateExtensionHost(
  monaco: typeof Monaco,
  highlighter: HighlighterCore,
  workspaceRoot?: string | null
): Promise<ExtensionActivationResult | null> {
  if (!activationPromise) {
    activationPromise = loadAndApply(monaco, highlighter, workspaceRoot ?? undefined)
  }
  return activationPromise
}

export function resetExtensionHostActivation(): void {
  activationPromise = null
}

async function loadAndApply(
  monaco: typeof Monaco,
  highlighter: HighlighterCore,
  workspaceRoot?: string
): Promise<ExtensionActivationResult | null> {
  if (typeof ipc.extension.activateContributions !== 'function') return null

  try {
    const result = await unwrap<ExtensionActivationResult>(ipc.extension.activateContributions(workspaceRoot))
    applyActivationResult(monaco, highlighter, result)
    logger.info('extension host activated', {
      workspaceRoot,
      activatedCount: result.activatedExtensionIds.length,
      skippedCount: result.skippedExtensionIds.length,
      commandCount: result.commands.length,
      languageCount: result.languages.length,
      themeCount: result.themes.length,
      runtimeFailedCount: result.runtime.failed.length
    })
    return result
  } catch (error) {
    logger.warn('extension host activation failed', { workspaceRoot, error })
    return null
  }
}

function applyActivationResult(
  monaco: typeof Monaco,
  highlighter: HighlighterCore,
  result: ExtensionActivationResult
): void {
  for (const id of result.activatedExtensionIds) activatedExtensionIds.add(id)
  runtimeSummary = result.runtime
  for (const command of result.runtime.registeredCommands) runtimeCommands.add(command)

  const languageIds = new Set<string>()
  for (const language of result.languages) {
    languageIds.add(language.id)
    registerMonacoLanguage(monaco, language.id, language.aliases)
    for (const ext of language.extensions) extensionLanguageByExtension.set(ext, language.id)
    for (const filename of language.filenames) extensionFilenameLanguage.set(filename, language.id)
  }

  const grammarLanguageIds: string[] = []
  for (const grammar of result.grammars) {
    languageIds.add(grammar.languageId)
    grammarLanguageIds.push(grammar.languageId)
    registerMonacoLanguage(monaco, grammar.languageId, [grammar.languageId])
    const registration = {
      ...grammar.grammar,
      name: grammar.languageId,
      scopeName: grammar.scopeName
    } as LanguageRegistration
    void highlighter.loadLanguage(registration).catch(() => undefined)
  }

  for (const theme of result.themes) {
    extensionThemes.set(theme.id, {
      id: theme.id,
      label: theme.label,
      uiTheme: theme.uiTheme,
      source: 'extension'
    })
    void highlighter.loadTheme({
      ...theme.theme,
      name: theme.id,
      type: theme.uiTheme === 'vs' || theme.uiTheme === 'hc-light' ? 'light' : 'dark'
    } as Parameters<HighlighterCore['loadTheme']>[0]).then(() => {
      const monacoTheme = textmateThemeToMonacoTheme(highlighter.getTheme(theme.id)) as Monaco.editor.IStandaloneThemeData
      monaco.editor.defineTheme(theme.id, monacoTheme)
    }).catch(() => undefined)
  }

  for (const command of result.commands) {
    extensionCommands.set(command.command, command)
    monaco.editor.addCommand({
      id: `extension.${command.command}`,
      run: () => {
        void runExtensionCommand(command.command)
      }
    })
  }

  bindLanguages?.(monaco, highlighter, [...new Set([...languageIds, ...grammarLanguageIds])])
}

function registerMonacoLanguage(monaco: typeof Monaco, id: string, aliases: string[]): void {
  const existing = monaco.languages.getLanguages().some((language) => language.id === id)
  if (existing) return
  monaco.languages.register({
    id,
    aliases: [id, ...aliases]
  })
}

export async function runExtensionCommand(commandId: string, ...args: unknown[]): Promise<boolean> {
  if (typeof ipc.extension.executeCommand !== 'function') return false
  try {
    await unwrap(ipc.extension.executeCommand(commandId, args))
    return true
  } catch (error) {
    logger.error('extension command failed', { commandId, error })
    return false
  }
}
