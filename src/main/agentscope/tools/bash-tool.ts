import type { Tool } from '@agentscope-ai/agentscope/tool'
import { securityService } from '../../services/security.service.js'
import { commandSandboxService, formatSandboxResult } from '../../services/command-sandbox.service.js'
import { redactSecrets } from '../../../shared/utils/secret-redactor.js'
import { createSandboxToolResponse } from './tool-helpers.js'

export function createSecureBash(
  requireUserConfirm: boolean,
  redactOutput = false,
  getAbortSignal?: () => AbortSignal | undefined
): Tool {
  return {
    name: 'Bash',
    description: `Executes a bash command inside Lucky's isolated execution sandbox and returns its output.

Commands run with a workspace-scoped working directory, sanitized environment, and OS-level isolation when available (macOS Seatbelt / Linux bubblewrap). Strict mode blocks outbound network and sensitive host paths.

Prefer Read, Write, Edit, Glob, and Grep over shell equivalents. Use absolute paths within the workspace when possible.`,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The bash command to execute' },
        description: { type: 'string', description: 'What this command does in plain language' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default 120000, max 600000)' }
      },
      required: ['command']
    },
    requireUserConfirm,
    async call(input: { command: string; description?: string; timeout?: number }) {
      securityService.assertAgentToolAllowed('Bash', input as Record<string, unknown>)
      if (typeof input.command === 'string') {
        const check = securityService.checkCommand(input.command)
        if (check.dangerLevel === 'confirm') {
          input.description = `[高危] ${check.reason ?? ''} — ${String(input.description ?? input.command)}`
        }
      }

      const result = await commandSandboxService.execute({
        command: String(input.command ?? ''),
        timeoutMs: input.timeout,
        signal: getAbortSignal?.()
      })
      if (result.aborted) {
        return createSandboxToolResponse('Command aborted by user.', 'error')
      }
      const text = formatSandboxResult(result, String(input.command ?? '')).replace(/\r\n/g, '\n')
      const maxOutputLength = 30_000
      let clipped = text.length > maxOutputLength
        ? `${text.slice(0, maxOutputLength)}\n\n[Output truncated - exceeded 30000 characters]`
        : text
      if (redactOutput) clipped = redactSecrets(clipped).text

      return createSandboxToolResponse(clipped, result.exitCode === 0 && !result.timedOut ? 'success' : 'error')
    }
  }
}
