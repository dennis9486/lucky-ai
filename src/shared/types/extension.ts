export interface ExtensionGrammarContribution {
  language?: string
  scopeName?: string
  path?: string
  embeddedLanguages?: Record<string, string>
  injectTo?: string[]
}

export interface ExtensionThemeContribution {
  id: string
  label?: string
  path?: string
  uiTheme?: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light'
}

export interface ExtensionLanguageContribution {
  id: string
  aliases?: string[]
  extensions?: string[]
  filenames?: string[]
  firstLine?: string
}

export interface ExtensionCommandContribution {
  command: string
  title?: string
  category?: string
  icon?: string
}

export interface ExtensionManifestSummary {
  id: string
  name: string
  version: string
  publisher: string
  description?: string
  path: string
  source: 'vscode' | 'cursor' | 'lucky-ai'
  enabled: boolean
  managed: boolean
  engines?: Record<string, string>
  activationEvents?: string[]
  main?: string
  browser?: string
  contributes?: {
    languages?: ExtensionLanguageContribution[]
    grammars?: ExtensionGrammarContribution[]
    themes?: ExtensionThemeContribution[]
    commands?: ExtensionCommandContribution[]
  }
}

export interface ExtensionRecommendations {
  recommendations: string[]
  unwantedRecommendations: string[]
}

/** Open VSX 市场检索结果条目。 */
export interface MarketplaceExtension {
  /** publisher.name（与本地 ExtensionManifestSummary.id 同构，便于判断已安装） */
  id: string
  namespace: string
  name: string
  version: string
  displayName: string
  description?: string
  publisher: string
  downloadCount?: number
  averageRating?: number
  iconUrl?: string
}

export interface ExtensionGrammarPayload {
  extensionId: string
  languageId: string
  scopeName: string
  grammar: Record<string, unknown>
}

export interface ExtensionThemePayload {
  extensionId: string
  id: string
  label: string
  uiTheme: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light'
  theme: Record<string, unknown>
}

export interface ExtensionCommandPayload {
  extensionId: string
  command: string
  title: string
  category?: string
}

export interface ExtensionLanguagePayload {
  extensionId: string
  id: string
  aliases: string[]
  extensions: string[]
  filenames: string[]
}

export interface ExtensionActivationResult {
  activatedExtensionIds: string[]
  skippedExtensionIds: string[]
  grammars: ExtensionGrammarPayload[]
  themes: ExtensionThemePayload[]
  languages: ExtensionLanguagePayload[]
  commands: ExtensionCommandPayload[]
  runtime: ExtensionRuntimeResult
}

export interface ExtensionRuntimeResult {
  activatedExtensionIds: string[]
  failed: Array<{ extensionId: string; error: string }>
  registeredCommands: string[]
  messages: Array<{ extensionId: string; level: string; message: string }>
}

export interface ExtensionInstallResult {
  installed: ExtensionManifestSummary
  replacedExtensionId?: string
}
