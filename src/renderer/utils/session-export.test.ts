import { describe, expect, it } from 'vitest'
import { buildSessionMarkdown, sessionMarkdownFileName, type SessionMarkdownLabels } from './session-export.js'
import type { SessionDetail } from '../../shared/types/conversation.js'

const labels: SessionMarkdownLabels = {
  project: 'Project',
  workspacePath: 'Workspace path',
  createdAt: 'Created',
  updatedAt: 'Updated',
  exportedAt: 'Exported',
  user: 'User',
  assistant: 'Assistant',
  system: 'System',
  tool: 'Tool',
  images: 'Images',
  thinking: 'Thinking',
  toolCall: 'Tool call',
  toolInput: 'Input',
  toolOutput: 'Output',
  emptyMessage: '(empty)'
}

describe('session markdown export', () => {
  it('sanitizes the default markdown file name', () => {
    expect(sessionMarkdownFileName({ title: 'A/B:C*D?E' })).toBe('A B C D E.md')
  })

  it('renders conversation messages, images, and tool parts', () => {
    const session: SessionDetail = {
      id: 's1',
      title: 'Daily report',
      workspaceName: 'ai',
      workspacePath: '/tmp/ai',
      createdAt: 1710000000000,
      updatedAt: 1710000600000,
      messageCount: 2,
      messages: [
        {
          id: 'm1',
          role: 'user',
          content: 'Please inspect this.',
          timestamp: 1710000000000,
          meta: {
            images: [{ path: '/tmp/a b.png', name: 'a b.png' }]
          }
        },
        {
          id: 'm2',
          role: 'assistant',
          content: '',
          timestamp: 1710000600000,
          parts: [
            { type: 'text', text: 'Done.' },
            { type: 'tool', id: 't1', name: 'Read', input: { path: '/tmp/a.md' }, output: 'ok', status: 'success' }
          ]
        }
      ]
    }

    const markdown = buildSessionMarkdown(session, {
      locale: 'en-US',
      labels,
      exportedAt: 1710001200000
    })

    expect(markdown).toContain('# Daily report')
    expect(markdown).toContain('## User ·')
    expect(markdown).toContain('Please inspect this.')
    expect(markdown).toContain('![a b.png](<file:///tmp/a%20b.png>)')
    expect(markdown).toContain('<details><summary>Tool call: Read · success</summary>')
    expect(markdown).toContain('"path": "/tmp/a.md"')
  })
})
