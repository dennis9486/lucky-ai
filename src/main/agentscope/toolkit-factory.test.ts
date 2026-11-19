import { describe, expect, it } from 'vitest'
import { createWorkspaceToolkit, resolveApprovalConfirmPolicy } from './toolkit-factory.js'
import { sanitizeWebContent } from './tools/tool-helpers.js'

describe('resolveApprovalConfirmPolicy', () => {
  it('asks for write and Bash actions in ask mode', () => {
    expect(resolveApprovalConfirmPolicy('ask', true, false)).toEqual({
      readRequiresConfirm: false,
      writeRequiresConfirm: true,
      bashRequiresConfirm: true
    })
  })

  it('auto-approves low-risk reads and writes but keeps Bash behind confirmation', () => {
    expect(resolveApprovalConfirmPolicy('auto', true, false)).toEqual({
      readRequiresConfirm: false,
      writeRequiresConfirm: false,
      bashRequiresConfirm: true
    })
  })

  it('keeps read confirmation when auto-approve read-only is disabled', () => {
    expect(resolveApprovalConfirmPolicy('auto', false, false).readRequiresConfirm).toBe(true)
  })

  it('lets full access skip confirmations unless a command policy requires confirmation', () => {
    expect(resolveApprovalConfirmPolicy('full', true, false)).toEqual({
      readRequiresConfirm: false,
      writeRequiresConfirm: false,
      bashRequiresConfirm: false
    })
    expect(resolveApprovalConfirmPolicy('full', true, true).bashRequiresConfirm).toBe(true)
  })
})

describe('createWorkspaceToolkit', () => {
  it('exposes in-app scheduled task tools to the agent', async () => {
    const bundle = await createWorkspaceToolkit({ approvalMode: 'auto' })
    try {
      const toolNames = bundle.toolkit.getJSONSchemas().map((tool) => tool.function.name)
      expect(toolNames).toContain('ListScheduledTasks')
      expect(toolNames).toContain('CreateScheduledTask')
    } finally {
      await bundle.close()
    }
  })
})

describe('sanitizeWebContent', () => {
  it('wraps web payloads in untrusted markers and redacts credentials', () => {
    const output = sanitizeWebContent('page text with token=abcdefghijklmnopqrstuvwx and AKIAIOSFODNN7EXAMPLE')

    expect(output.startsWith('<untrusted-web-content>')).toBe(true)
    expect(output).toContain('</untrusted-web-content>')
    expect(output).toContain('not instructions')
    expect(output).not.toContain('abcdefghijklmnopqrstuvwx')
    expect(output).not.toContain('AKIAIOSFODNN7EXAMPLE')
  })
})
