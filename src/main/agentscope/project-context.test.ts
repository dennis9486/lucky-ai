import { describe, expect, it } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readProjectContext } from './project-context.js'

async function withWorkspace(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'proj-ctx-'))
  try {
    await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('readProjectContext', () => {
  it('returns empty when no workspace / no files', async () => {
    expect(await readProjectContext(undefined)).toBe('')
    await withWorkspace(async (dir) => {
      expect(await readProjectContext(dir)).toBe('')
    })
  })

  it('reads AGENTS.md and CLAUDE.md with headers', async () => {
    await withWorkspace(async (dir) => {
      writeFileSync(join(dir, 'AGENTS.md'), 'use pnpm')
      writeFileSync(join(dir, 'CLAUDE.md'), 'run tests before commit')
      const out = await readProjectContext(dir)
      expect(out).toContain('### AGENTS.md')
      expect(out).toContain('use pnpm')
      expect(out).toContain('### CLAUDE.md')
      expect(out).toContain('run tests before commit')
    })
  })

  it('reads nested .lucky/instructions.md', async () => {
    await withWorkspace(async (dir) => {
      mkdirSync(join(dir, '.lucky'))
      writeFileSync(join(dir, '.lucky', 'instructions.md'), 'nested rule')
      expect(await readProjectContext(dir)).toContain('nested rule')
    })
  })

  it('caps total size to protect the context window', async () => {
    await withWorkspace(async (dir) => {
      writeFileSync(join(dir, 'AGENTS.md'), 'x'.repeat(20000))
      const out = await readProjectContext(dir)
      expect(out).toContain('…[truncated]')
      expect(out.length).toBeLessThan(9000)
    })
  })
})
