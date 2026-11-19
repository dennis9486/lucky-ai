import { describe, expect, it } from 'vitest'
import { normalizeBrowserUrl } from './browser-navigation.service.js'
import { workspaceServiceInternalsForTest } from './workspace.service.js'

describe('browser navigation service', () => {
  it('normalizes http/https URLs', () => {
    expect(normalizeBrowserUrl('https://example.com/path')).toBe('https://example.com/path')
    expect(normalizeBrowserUrl('  https://docs.example.com  ')).toBe('https://docs.example.com/')
  })

  it('rejects unsupported protocols', () => {
    expect(() => normalizeBrowserUrl('file:///etc/passwd')).toThrow(/http\/https/)
    expect(() => normalizeBrowserUrl('javascript:alert(1)')).toThrow(/http\/https/)
  })
})

describe('workspace git graph parser', () => {
  it('parses git log --graph --oneline output', () => {
    const stdout = [
      '* abc1234 (HEAD -> main) feat: add graph',
      '| * def5678 (origin/main) chore: cleanup',
      '|/',
      '* 9998887 init'
    ].join('\n')

    const lines = workspaceServiceInternalsForTest.parseGitGraph(stdout)
    expect(lines).toHaveLength(4)
    expect(lines[0]).toMatchObject({
      hash: 'abc1234',
      subject: '(HEAD -> main) feat: add graph'
    })
    expect(lines[1]?.graph).toContain('|')
  })
})
