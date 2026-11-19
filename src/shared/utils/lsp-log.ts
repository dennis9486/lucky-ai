import { createLogger } from './log.js'

export type LspLogLayer = 'main' | 'ipc' | 'preload' | 'client'

export function isLspLoggingEnabled(): boolean {
  try {
    if (typeof process !== 'undefined' && process.env?.LSP_LOG === '0') return false
    if (typeof process !== 'undefined' && process.env?.LSP_LOG === '1') return true
  } catch {
    // ignore
  }
  return true
}

export function shortLspPath(path: string | undefined): string {
  if (!path) return ''
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length <= 3) return normalized
  return `…/${parts.slice(-2).join('/')}`
}

export function summarizeLspValue(value: unknown, maxLength = 160): string {
  if (value === undefined) return ''
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return text.length <= maxLength ? text : `${text.slice(0, maxLength)}…`
  } catch {
    return String(value)
  }
}

function getLspLogger(layer: LspLogLayer) {
  return createLogger(`LSP:${layer}`, {
    enabled: isLspLoggingEnabled
  })
}

export function lspLog(layer: LspLogLayer, message: string, detail?: Record<string, unknown>): void {
  getLspLogger(layer).info(message, detail)
}

export function lspWarn(layer: LspLogLayer, message: string, detail?: Record<string, unknown>): void {
  getLspLogger(layer).warn(message, detail)
}

export function lspError(layer: LspLogLayer, message: string, detail?: Record<string, unknown>): void {
  getLspLogger(layer).error(message, detail)
}

export function lspElapsed(startedAt: number): number {
  return Date.now() - startedAt
}
