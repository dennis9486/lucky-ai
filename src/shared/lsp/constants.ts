/** 配置了 language server 的语言 ID（与 main SERVER_SPECS 一致） */
export const LSP_LANGUAGE_IDS = [
  'typescript',
  'javascript',
  'vue',
  'python',
  'go',
  'rust'
] as const

export type LspLanguageId = (typeof LSP_LANGUAGE_IDS)[number]

export function isLspLanguageId(languageId: string): languageId is LspLanguageId {
  return (LSP_LANGUAGE_IDS as readonly string[]).includes(languageId)
}

export const LSP_SEMANTIC_TOKEN_TYPES = [
  'namespace', 'type', 'class', 'enum', 'interface', 'struct', 'typeParameter',
  'parameter', 'variable', 'property', 'enumMember', 'event', 'function', 'method',
  'macro', 'keyword', 'modifier', 'comment', 'string', 'number', 'regexp', 'operator', 'decorator'
] as const

export const LSP_SEMANTIC_TOKEN_MODIFIERS = [
  'declaration', 'definition', 'readonly', 'static', 'deprecated', 'abstract',
  'async', 'modification', 'documentation', 'defaultLibrary'
] as const

/** 文档变更 debounce（ms），对齐 VS Code 的节流策略 */
export const LSP_SYNC_DEBOUNCE_MS = 250
