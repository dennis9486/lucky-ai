import { describe, expect, it } from 'vitest'
import { buildAgentSystemPrompt } from './system-prompt.js'

describe('buildAgentSystemPrompt', () => {
  it('uses English execution rules and includes verification guidance', () => {
    const prompt = buildAgentSystemPrompt({
      workspaceRoot: '/workspace/demo',
      agentMode: 'code',
      personalityPrompt: 'Be concise.',
      customPrompt: 'Prefer minimal changes.',
      mcpWarnings: ['demo server failed']
    })

    expect(prompt).toContain("You are Lucky's embedded")
    expect(prompt).toContain('When a tool fails')
    expect(prompt).toContain('review the diff')
    expect(prompt).toContain('run the most relevant verification command')
    expect(prompt).toContain("Answer in the user's language")
    expect(prompt).toContain("Put the user's latest request above inferred workflow hints")
    expect(prompt).toContain('Workspace root: /workspace/demo')
    expect(prompt).toContain('MCP connection warnings')
  })

  it('injects mode-specific built-in skills', () => {
    const codePrompt = buildAgentSystemPrompt({
      workspaceRoot: '/workspace/demo',
      agentMode: 'code',
      personalityPrompt: 'Be concise.'
    })
    const chatPrompt = buildAgentSystemPrompt({
      workspaceRoot: '/workspace/demo',
      agentMode: 'chat',
      personalityPrompt: 'Be concise.'
    })

    expect(codePrompt).toContain('Lucky Code Agent Workflow')
    expect(codePrompt).toContain('inspect the diff')
    expect(chatPrompt).toContain('Lucky Chat Agent Workflow')
    expect(chatPrompt).toContain('general-purpose assistant')
    expect(chatPrompt).toContain('CreateScheduledTask')
  })

  it('can disable built-in skills from environment settings', () => {
    const prompt = buildAgentSystemPrompt({
      workspaceRoot: '/workspace/demo',
      agentMode: 'code',
      personalityPrompt: 'Be concise.',
      builtInSkills: false
    })

    expect(prompt).not.toContain('Lucky Code Agent Workflow')
  })
})
