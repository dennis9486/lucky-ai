import { describe, expect, it } from 'vitest'
import { classifyGitError, withRepoLock, gitExecInternalsForTest } from './git-exec.js'

describe('classifyGitError', () => {
  const cases: Array<[stderr: string, code: string]> = [
    ['fatal: Authentication failed for https://github.com/x/y.git', 'auth'],
    ['fatal: could not read Username for https://github.com: terminal prompts disabled', 'auth'],
    ['git@github.com: Permission denied (publickey).', 'auth'],
    ['fatal: The current branch feature has no upstream branch.', 'noUpstream'],
    ['CONFLICT (content): Merge conflict in src/a.ts\nAutomatic merge failed; fix conflicts', 'conflict'],
    ['error: Your local changes to the following files would be overwritten by checkout:', 'dirtyWorktree'],
    ['fatal: not a git repository (or any of the parent directories): .git', 'notRepository'],
    ["fatal: Unable to create '/repo/.git/index.lock': File exists.\nAnother git process seems to be running", 'lockExists'],
    ['! [rejected]        master -> master (non-fast-forward)\nerror: failed to push some refs', 'remoteRejected'],
    ['fatal: unable to access https://github.com/x/y.git/: Could not resolve host: github.com', 'network'],
    ['nothing to commit, working tree clean', 'emptyCommit'],
    ['fatal: No stash entries found.', 'noStash'],
    ["error: pathspec 'no-such-branch' did not match any file(s) known to git", 'refNotFound']
  ]

  it.each(cases)('classifies %j as %s', (stderr, code) => {
    expect(classifyGitError(stderr).code).toBe(code)
  })

  it('falls back to unknown with the first stderr line as message (fatal prefix stripped)', () => {
    const error = classifyGitError('fatal: something very specific went wrong\nmore detail', ['status'])
    expect(error.code).toBe('unknown')
    expect(error.message).toBe('something very specific went wrong')
    expect(error.stderr).toContain('more detail')
  })

  it('keeps a usable message when stderr is empty', () => {
    const error = classifyGitError('', ['push'])
    expect(error.code).toBe('unknown')
    expect(error.message).toContain('git push')
  })
})

describe('withRepoLock', () => {
  it('serializes operations on the same repository', async () => {
    const order: string[] = []
    const slow = withRepoLock('/repo', async () => {
      await new Promise((r) => setTimeout(r, 30))
      order.push('slow')
    })
    const fast = withRepoLock('/repo', async () => {
      order.push('fast')
    })
    await Promise.all([slow, fast])
    expect(order).toEqual(['slow', 'fast'])
  })

  it('continues the queue after a failed operation', async () => {
    const order: string[] = []
    const failing = withRepoLock('/repo-b', async () => {
      order.push('failing')
      throw new Error('boom')
    })
    const next = withRepoLock('/repo-b', async () => {
      order.push('next')
    })
    await expect(failing).rejects.toThrow('boom')
    await next
    expect(order).toEqual(['failing', 'next'])
  })

  it('does not block different repositories on each other', async () => {
    const order: string[] = []
    const a = withRepoLock('/repo-c', async () => {
      await new Promise((r) => setTimeout(r, 30))
      order.push('c')
    })
    const b = withRepoLock('/repo-d', async () => {
      order.push('d')
    })
    await Promise.all([a, b])
    expect(order).toEqual(['d', 'c'])
  })
})

describe('git exec option helpers', () => {
  const { resolveTimeout, buildGitEnv } = gitExecInternalsForTest

  it('gives network subcommands the long timeout', () => {
    expect(resolveTimeout(['push'])).toBe(120_000)
    expect(resolveTimeout(['pull', '--rebase=false'])).toBe(120_000)
    expect(resolveTimeout(['status', '--porcelain=v1'])).toBe(30_000)
    expect(resolveTimeout(['fetch'], 5000)).toBe(5000)
  })

  it('disables terminal prompts and sets optional locks only for reads', () => {
    const readEnv = buildGitEnv(true)
    expect(readEnv.GIT_TERMINAL_PROMPT).toBe('0')
    expect(readEnv.GIT_OPTIONAL_LOCKS).toBe('0')
    const writeEnv = buildGitEnv(false)
    expect(writeEnv.GIT_TERMINAL_PROMPT).toBe('0')
    expect(writeEnv.GIT_OPTIONAL_LOCKS).toBeUndefined()
  })
})
