import type * as Monaco from 'monaco-editor'
import type { HighlighterCore, LanguageRegistration, ThemeRegistration } from 'shiki/core'
import { ipc, unwrap } from './ipc-client.js'
import type { EditorSettings } from '../../shared/types/ipc.js'
import { resolveWorkspaceFilePath } from '../../shared/utils/workspace-path.js'
import { editorContentEquals } from '../utils/editor-content.js'
import { resolveBuiltinEditorLanguage } from '../utils/editor-language.js'
import { registerExtensionLanguageBinding, resolveExtensionBackedLanguage, listExtensionThemes, resolveMonacoThemeId } from './extension-host.service.js'
import { registerEditorAgentContextMenu } from './editor-context-menu.service.js'

import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import JsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import CssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import HtmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import TsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'

export const MONACO_THEME_LIGHT = 'github-light'
export const MONACO_THEME_DARK = 'github-dark'

export function resolveMonacoEditorTheme(mode: 'light' | 'dark', editor?: EditorSettings): string {
  return resolveMonacoThemeId(mode, editor)
}

export { listExtensionThemes as listMonacoThemeOptions }

const SHIKI_LANGUAGES = [
  'bash',
  'c',
  'cpp',
  'csharp',
  'css',
  'dockerfile',
  'go',
  'html',
  'ini',
  'java',
  'javascript',
  'json',
  'markdown',
  'php',
  'powershell',
  'python',
  'rust',
  'scss',
  'shellscript',
  'sql',
  'toml',
  'typescript',
  'vue',
  'xml',
  'yaml'
] as const

/** 每种语法按需动态导入（参考 VS Code：TextMate 语法按语言懒加载，而非一次性全量装载）。 */
const SHIKI_LANG_LOADERS: Record<string, () => Promise<{ default: LanguageRegistration[] }>> = {
  bash: () => import('shiki/langs/bash.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  shellscript: () => import('shiki/langs/shellscript.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  typescript: () => import('shiki/langs/typescript.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs')
}

/** 首屏即加载的高频语言（覆盖绝大多数打开的文件），其余语法在空闲/按需加载。 */
const SHIKI_CORE_LANGS = [
  'javascript',
  'typescript',
  'json',
  'html',
  'css',
  'scss',
  'markdown',
  'vue',
  'yaml',
  'bash',
  'python'
] as const

/** 每种语言的语法加载去重表，避免空闲预载与按需加载重复装载同一语法。 */
const shikiLangLoads = new Map<string, Promise<void>>()

const LANGUAGE_ALIASES = new Map<string, string[]>([
  ['bash', ['sh', 'zsh']],
  ['csharp', ['cs']],
  ['cpp', ['c++']],
  ['dockerfile', ['docker']],
  ['javascript', ['js', 'jsx']],
  ['markdown', ['md', 'mdx']],
  ['powershell', ['ps1']],
  ['python', ['py']],
  ['shellscript', ['shell']],
  ['typescript', ['ts', 'tsx']],
  ['yaml', ['yml']]
])

let monacoPromise: Promise<typeof Monaco> | null = null
let shikiPromise: Promise<HighlighterCore> | null = null
let initialized = false
let diffEditorValidationDepth = 0
let monacoHighlighter: HighlighterCore | null = null

interface TypeScriptDiagnosticsOptions {
  noSemanticValidation?: boolean
  noSyntaxValidation?: boolean
  noSuggestionDiagnostics?: boolean
}

let savedTypeScriptDiagnostics: TypeScriptDiagnosticsOptions[] | null = null

export async function loadMonaco(): Promise<typeof Monaco> {
  if (!monacoPromise) {
    monacoPromise = (async () => {
      const monaco = await import('monaco-editor/esm/vs/editor/editor.api') as typeof Monaco
      await Promise.all([
        // TS/JS 语言服务 API（typescriptDefaults 等）
        import('monaco-editor/esm/vs/language/typescript/monaco.contribution.js'),
        // 查找 / 替换
        import('monaco-editor/esm/vs/editor/contrib/find/browser/findController.js'),
        // 格式化、重命名
        import('monaco-editor/esm/vs/editor/contrib/format/browser/formatActions.js'),
        import('monaco-editor/esm/vs/editor/contrib/rename/browser/rename.js'),
        // Cmd/Ctrl+悬停下划线 + 定义预览、跳转
        import('monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/goToCommands.js'),
        import('monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/link/goToDefinitionAtPosition.js'),
        import('monaco-editor/esm/vs/editor/contrib/gotoSymbol/browser/peek/referencesController.js'),
        import('monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js'),
        import('monaco-editor/esm/vs/editor/contrib/codeAction/browser/codeActionContributions.js'),
        import('monaco-editor/esm/vs/editor/contrib/multicursor/browser/multicursor.js'),
        import('monaco-editor/esm/vs/editor/standalone/browser/quickAccess/standaloneCommandsQuickAccess.js'),
        import('monaco-editor/esm/vs/editor/contrib/hover/browser/hoverContribution.js'),
        import('monaco-editor/esm/vs/editor/contrib/links/browser/links.js'),
        import('monaco-editor/esm/vs/editor/contrib/codelens/browser/codelensController.js'),
        import('monaco-editor/esm/vs/editor/contrib/contextmenu/browser/contextmenu.js'),
        // Inline ghost-text completions (Tab to accept) — no upstream .d.ts for this ESM entry
        import('monaco-editor/esm/vs/editor/contrib/inlineCompletions/browser/controller/inlineCompletionsController.js'),
        import('monaco-editor/esm/vs/editor/contrib/suggest/browser/suggestController.js')
      ])
      configureMonacoWorkers()
      registerShikiLanguages(monaco)
      registerEditorAgentContextMenu()
      return monaco
    })()
  }
  return monacoPromise
}

export async function initializeMonacoHighlighting(monaco: typeof Monaco): Promise<void> {
  if (initialized) return

  const [{ shikiToMonaco }, highlighter] = await Promise.all([
    import('@shikijs/monaco'),
    getShikiHighlighter()
  ])
  monacoHighlighter = highlighter

  shikiToMonaco(highlighter, monaco as Parameters<typeof shikiToMonaco>[1], {
    tokenizeMaxLineLength: 30000,
    tokenizeTimeLimit: 700
  })
  registerExtensionLanguageBinding((monacoApi, shiki, languageIds) => {
    bindShikiTokenProviders(monacoApi, shiki, languageIds)
  })
  monaco.editor.setTheme(MONACO_THEME_LIGHT)
  initialized = true

  // 首屏只装载核心语法；其余语法在空闲时后台补齐，保证最终所有语言都有高亮，
  // 又不把 20+ 语法的解析放进首次打开编辑器的关键路径。
  scheduleBackgroundShikiLanguages(monaco)
}

/** 空闲时后台补齐非核心语法，全部就绪后统一重绑一次。 */
function scheduleBackgroundShikiLanguages(monaco: typeof Monaco): void {
  const core = SHIKI_CORE_LANGS as readonly string[]
  const rest = Object.keys(SHIKI_LANG_LOADERS).filter((id) => !core.includes(id))
  if (!rest.length) return
  runWhenIdle(() => {
    const highlighter = monacoHighlighter
    if (!highlighter) return
    void Promise.all(rest.map((id) => loadOneShikiLanguage(highlighter, id))).then(() => {
      if (monacoHighlighter) bindShikiTokenProviders(monaco, monacoHighlighter, rest)
    })
  })
}

/** 装载单个语法（去重）；不重绑，交由调用方决定重绑时机。 */
function loadOneShikiLanguage(highlighter: HighlighterCore, langId: string): Promise<void> {
  const loader = SHIKI_LANG_LOADERS[langId]
  if (!loader) return Promise.resolve()
  if (highlighter.getLoadedLanguages().includes(langId)) return Promise.resolve()
  let pending = shikiLangLoads.get(langId)
  if (!pending) {
    pending = loader()
      .then((mod) => highlighter.loadLanguage(...mod.default))
      .catch((error) => {
        shikiLangLoads.delete(langId)
        throw error
      })
    shikiLangLoads.set(langId, pending)
  }
  return pending
}

/**
 * 按需确保某语言的 shiki 语法已装载并绑定到 Monaco。
 * 打开某个非核心语言文件时调用可优先补齐它的高亮（不必等后台批量完成）。
 */
export async function ensureShikiLanguage(monaco: typeof Monaco, langId: string): Promise<void> {
  const highlighter = monacoHighlighter
  if (!highlighter || !SHIKI_LANG_LOADERS[langId]) return
  if (highlighter.getLoadedLanguages().includes(langId)) return
  try {
    await loadOneShikiLanguage(highlighter, langId)
    bindShikiTokenProviders(monaco, highlighter, [langId])
  } catch {
    // 后台批量装载仍会兜底补齐该语言
  }
}

/** 空闲执行（requestIdleCallback 优先，回退 setTimeout）。 */
function runWhenIdle(callback: () => void): void {
  const scope = globalThis as typeof globalThis & {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
  }
  if (typeof scope.requestIdleCallback === 'function') {
    scope.requestIdleCallback(callback, { timeout: 2000 })
  } else {
    setTimeout(callback, 200)
  }
}

/**
 * 空闲预热 Monaco 运行时（含高亮），使首次打开编辑器接近即时。
 * 复用 loadMonaco/initializeMonacoHighlighting 的记忆化，幂等且不改变行为，仅提前时机。
 */
export function prefetchMonacoRuntime(): void {
  runWhenIdle(() => {
    void loadMonaco()
      .then((monaco) => initializeMonacoHighlighting(monaco))
      .catch(() => undefined)
  })
}

export function getMonacoHighlighter(): HighlighterCore | null {
  return monacoHighlighter
}

export function bindShikiTokenProviders(
  monaco: typeof Monaco,
  highlighter: HighlighterCore,
  // shikiToMonaco 一次性绑定 highlighter 中所有已装载语言；此参数仅表意“哪些语言触发了本次重绑”。
  _languageIds: string[]
): void {
  void import('@shikijs/monaco').then(({ shikiToMonaco }) => {
    shikiToMonaco(highlighter, monaco as Parameters<typeof shikiToMonaco>[1], {
      tokenizeMaxLineLength: 30000,
      tokenizeTimeLimit: 700
    })
  })
}

export function resolveEditorLanguage(path: string): string {
  const extensionLanguage = resolveExtensionBackedLanguage(path)
  if (extensionLanguage) return extensionLanguage
  return resolveBuiltinEditorLanguage(path)
}

export function createEditorModel(monaco: typeof Monaco, path: string, content: string): Monaco.editor.ITextModel {
  const uri = monaco.Uri.file(path)
  const existing = monaco.editor.getModel(uri)
  const language = resolveEditorLanguage(path)

  // 按需优先补齐该文件语言的 shiki 语法（非核心语言首次打开时立即高亮，不必等后台批量）
  void ensureShikiLanguage(monaco, language)

  if (existing) {
    if (existing.getLanguageId() !== language) {
      monaco.editor.setModelLanguage(existing, language)
    }
    if (!editorContentEquals(existing.getValue(), content)) {
      existing.setValue(content)
    }
    return existing
  }

  return monaco.editor.createModel(content, language, uri)
}

export function isEditorModelForPath(
  model: Monaco.editor.ITextModel,
  tabPath: string,
  workspaceRoot?: string | null
): boolean {
  const expected = resolveWorkspaceFilePath(tabPath, workspaceRoot).replace(/\\/g, '/')
  const modelPath = model.uri.fsPath.replace(/\\/g, '/')
  return modelPath === expected
}

export function disposeEditorModel(monaco: typeof Monaco, path: string): void {
  const model = monaco.editor.getModel(monaco.Uri.file(path))
  model?.dispose()
}

function toDiffModelKey(path: string): string {
  const normalized = (path || 'untitled').replace(/\\/g, '/')
  if (!normalized.includes('/')) return encodeURIComponent(normalized)

  let hash = 5381
  for (let i = 0; i < normalized.length; i += 1) {
    hash = (hash * 33) ^ normalized.charCodeAt(i)
  }
  const base = normalized.split('/').filter(Boolean).pop() ?? 'untitled'
  return `${encodeURIComponent(base)}-${(hash >>> 0).toString(36)}`
}

function buildDiffModelUri(
  monaco: typeof Monaco,
  instanceId: string,
  side: 'original' | 'modified',
  path: string
): Monaco.Uri {
  const key = toDiffModelKey(path)
  return monaco.Uri.from({
    scheme: 'inmemory',
    authority: `diff-${instanceId}`,
    path: `/${side}/${key}`
  })
}

/** Diff 快照 URI 不在 tsconfig 内，需暂时关闭 TS/JS 校验避免 worker 报错。 */
export function pushDiffEditorValidationScope(monaco: typeof Monaco): void {
  const ts = monaco.languages.typescript
  if (!ts?.typescriptDefaults || !ts.javascriptDefaults) return

  if (diffEditorValidationDepth === 0) {
    savedTypeScriptDiagnostics = [ts.typescriptDefaults, ts.javascriptDefaults].map((setting) => ({
      noSemanticValidation: setting.getDiagnosticsOptions().noSemanticValidation,
      noSyntaxValidation: setting.getDiagnosticsOptions().noSyntaxValidation,
      noSuggestionDiagnostics: setting.getDiagnosticsOptions().noSuggestionDiagnostics
    }))
    for (const setting of [ts.typescriptDefaults, ts.javascriptDefaults]) {
      setting.setDiagnosticsOptions({
        noSemanticValidation: true,
        noSyntaxValidation: true,
        noSuggestionDiagnostics: true
      })
    }
  }
  diffEditorValidationDepth += 1
}

export function popDiffEditorValidationScope(monaco: typeof Monaco): void {
  const ts = monaco.languages.typescript
  if (!ts?.typescriptDefaults || !ts.javascriptDefaults) return
  if (diffEditorValidationDepth <= 0) return

  diffEditorValidationDepth -= 1
  if (diffEditorValidationDepth !== 0 || !savedTypeScriptDiagnostics) return

  const settings = [ts.typescriptDefaults, ts.javascriptDefaults]
  settings.forEach((setting, index) => {
    const saved = savedTypeScriptDiagnostics?.[index]
    if (!saved) return
    setting.setDiagnosticsOptions(saved)
  })
  savedTypeScriptDiagnostics = null
}

export function createDiffModels(
  monaco: typeof Monaco,
  path: string,
  original: string,
  modified: string,
  instanceId: string
): { original: Monaco.editor.ITextModel; modified: Monaco.editor.ITextModel } {
  const language = resolveEditorLanguage(path)
  return {
    original: monaco.editor.createModel(
      original,
      language,
      buildDiffModelUri(monaco, instanceId, 'original', path)
    ),
    modified: monaco.editor.createModel(
      modified,
      language,
      buildDiffModelUri(monaco, instanceId, 'modified', path)
    )
  }
}

const BUILTIN_TS_MODE_CONFIGURATION: Monaco.languages.typescript.ModeConfiguration = {
  completionItems: true,
  hovers: true,
  documentSymbols: true,
  definitions: true,
  references: true,
  documentHighlights: true,
  rename: true,
  diagnostics: true,
  documentRangeFormattingEdits: true,
  signatureHelp: true,
  onTypeFormattingEdits: true,
  codeActions: true,
  inlayHints: true
}

const EXTERNAL_LSP_TS_MODE_CONFIGURATION: Monaco.languages.typescript.ModeConfiguration = {
  completionItems: false,
  hovers: false,
  documentSymbols: false,
  definitions: false,
  references: false,
  documentHighlights: false,
  rename: false,
  diagnostics: false,
  documentRangeFormattingEdits: false,
  signatureHelp: false,
  onTypeFormattingEdits: false,
  codeActions: false,
  inlayHints: false
}

/** 为工作区配置 Monaco 内置 TS/JS 语言服务（tsconfig 感知） */
export async function configureWorkspaceLanguageServices(
  monaco: typeof Monaco,
  workspaceRoot: string | null | undefined,
  externalLspActive = false
): Promise<void> {
  const ts = monaco.languages.typescript
  if (!ts?.typescriptDefaults || !ts.javascriptDefaults) return

  const defaults = [ts.typescriptDefaults, ts.javascriptDefaults]
  const modeConfiguration = externalLspActive
    ? EXTERNAL_LSP_TS_MODE_CONFIGURATION
    : BUILTIN_TS_MODE_CONFIGURATION

  for (const setting of defaults) {
    setting.setModeConfiguration(modeConfiguration)
    setting.setCompilerOptions({
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      allowNonTsExtensions: true,
      allowJs: true,
      checkJs: false,
      jsx: ts.JsxEmit.React,
      esModuleInterop: true,
      resolveJsonModule: true,
      noEmit: true
    })
    setting.setDiagnosticsOptions({
      noSemanticValidation: externalLspActive,
      noSyntaxValidation: externalLspActive,
      noSuggestionDiagnostics: externalLspActive
    })
    setting.setEagerModelSync(true)
  }

  if (!workspaceRoot) return

  const tsconfigPaths = ['tsconfig.json', 'jsconfig.json']
  for (const name of tsconfigPaths) {
    const filePath = `${workspaceRoot.replace(/\\/g, '/')}/${name}`
    try {
      const file = await unwrap<{ content: string }>(ipc.file.read(filePath))
      const config = JSON.parse(file.content) as {
        compilerOptions?: Record<string, unknown>
      }
      if (config.compilerOptions) {
        for (const setting of defaults) {
          setting.setCompilerOptions({
            ...config.compilerOptions,
            noEmit: true
          } as Monaco.languages.typescript.CompilerOptions)
        }
      }
      break
    } catch {
      // try next config file
    }
  }
}

function configureMonacoWorkers(): void {
  const globalScope = globalThis as typeof globalThis & { MonacoEnvironment?: Monaco.Environment }
  if (globalScope.MonacoEnvironment?.getWorker) return

  globalScope.MonacoEnvironment = {
    getWorker(_workerId: string, label: string) {
      if (label === 'json') return new JsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new CssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new HtmlWorker()
      if (label === 'typescript' || label === 'javascript') return new TsWorker()
      return new EditorWorker()
    }
  }
}

function registerShikiLanguages(monaco: typeof Monaco): void {
  const existing = new Set(monaco.languages.getLanguages().map((language) => language.id))

  for (const id of SHIKI_LANGUAGES) {
    if (!existing.has(id)) {
      monaco.languages.register({
        id,
        aliases: [id, ...(LANGUAGE_ALIASES.get(id) ?? [])]
      })
      existing.add(id)
    }
  }
}

function getShikiHighlighter(): Promise<HighlighterCore> {
  shikiPromise ??= Promise.all([
    import('shiki/core'),
    import('shiki/engine/oniguruma'),
    import('shiki/wasm'),
    loadShikiLanguages(SHIKI_CORE_LANGS),
    loadShikiThemes()
  ]).then(async ([{ createHighlighterCore }, { createOnigurumaEngine }, wasm, langs, themes]) => {
    return createHighlighterCore({
      engine: await createOnigurumaEngine(wasm.default),
      langs,
      themes
    })
  })
  return shikiPromise
}

async function loadShikiLanguages(ids: readonly string[]): Promise<LanguageRegistration[]> {
  const loaders = ids
    .map((id) => SHIKI_LANG_LOADERS[id])
    .filter((loader): loader is () => Promise<{ default: LanguageRegistration[] }> => Boolean(loader))
  const languageModules = await Promise.all(loaders.map((load) => load()))
  return languageModules.flatMap((mod) => mod.default)
}

async function loadShikiThemes(): Promise<ThemeRegistration[]> {
  const [light, dark] = await Promise.all([
    import('shiki/themes/github-light.mjs'),
    import('shiki/themes/github-dark.mjs')
  ])

  return [light.default, dark.default]
}
