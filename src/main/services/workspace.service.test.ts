import { describe, expect, it } from 'vitest'
import { workspaceServiceInternalsForTest } from './workspace.service.js'

describe('workspace service git helpers', () => {
  it('parses porcelain -z status without escaping non-ascii paths', () => {
    const status = workspaceServiceInternalsForTest.parseGitStatus('## master\0 M docs/中文路径.md\0')

    expect(status.files).toEqual([
      { path: 'docs/中文路径.md', index: ' ', workingTree: 'M', conflicted: false }
    ])
  })

  it('parses porcelain -z rename records with previous path', () => {
    const status = workspaceServiceInternalsForTest.parseGitStatus('## master...origin/master [ahead 1]\0R  新名字.md\0旧名字.md\0')

    expect(status.ahead).toBe(1)
    expect(status.files).toEqual([
      { path: '新名字.md', previousPath: '旧名字.md', index: 'R', workingTree: ' ', conflicted: false }
    ])
  })

  it('parses stash list output with index, relative time and description', () => {
    const stdout = [
      'stash@{0}|2 hours ago|WIP on master: 1a2b3c fix login',
      'stash@{1}|3 days ago|On feature/x: 带中文|含竖线 的消息',
      ''
    ].join('\n')

    const stashes = workspaceServiceInternalsForTest.parseGitStashList(stdout)

    expect(stashes).toEqual([
      { index: 0, relativeTime: '2 hours ago', description: 'WIP on master: 1a2b3c fix login' },
      { index: 1, relativeTime: '3 days ago', description: 'On feature/x: 带中文|含竖线 的消息' }
    ])
  })
})
