import type { LspRequestPayload } from '../../../shared/types/lsp.js'
import { isLspLanguageId } from '../../../shared/lsp/constants.js'
import { lspElapsed, lspLog, lspWarn } from '../../../shared/utils/lsp-log.js'
import { ipc, unwrap } from '../ipc-client.js'
import { getLanguageClientStatus } from './lsp-session.js'

export async function lspRequest(
  languageId: string,
  method: string,
  params?: unknown
): Promise<unknown> {
  if (!isLspLanguageId(languageId)) return null
  if (getLanguageClientStatus(languageId).status !== 'running') return null

  const startedAt = Date.now()
  lspLog('client', 'request', { languageId, method })
  try {
    const payload: LspRequestPayload = { languageId, method, params }
    const result = await unwrap<unknown>(ipc.lsp.request(payload))
    lspLog('client', 'request ok', { languageId, method, ms: lspElapsed(startedAt) })
    return result
  } catch (error) {
    lspWarn('client', 'request failed', {
      languageId,
      method,
      ms: lspElapsed(startedAt),
      error: error instanceof Error ? error.message : String(error)
    })
    return null
  }
}
