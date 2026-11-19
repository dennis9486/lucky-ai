import { describe, expect, it } from 'vitest'
import { buildAgentRunSummary } from './agent-run-summary.js'
import type { MessagePart } from '../../shared/types/ai.js'

describe('agent run summary', () => {
  it('collects changed files, verification commands, and failure reasons', () => {
    const parts: MessagePart[] = [
      {
        type: 'tool',
        id: 'edit-1',
        name: 'Edit',
        input: { file_path: 'src/App.vue' },
        output: '',
        status: 'success'
      },
      {
        type: 'tool',
        id: 'bash-1',
        name: 'Bash',
        input: { command: 'pnpm test' },
        output: 'ok',
        status: 'success'
      },
      {
        type: 'tool',
        id: 'read-1',
        name: 'Read',
        input: { file_path: 'missing.ts' },
        output: 'Error: file not found',
        status: 'error',
        errorSummary: 'Error: file not found'
      }
    ]

    expect(buildAgentRunSummary(parts)).toEqual({
      toolCount: 3,
      failedToolCount: 1,
      changedFiles: ['src/App.vue'],
      verificationCommands: [{ command: 'pnpm test', status: 'success' }],
      failureReasons: ['Error: file not found']
    })
  })
})
