import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertWriteAllowed,
  clearFileReads,
  hashFileContent,
  recordFileRead,
  updateFileSnapshot
} from './file-read-tracker.js'

describe('file-read-tracker', () => {
  let dir = ''

  afterEach(async () => {
    clearFileReads('conv-1')
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  it('blocks write to existing file without prior read', async () => {
    dir = await mkdtemp(join(tmpdir(), 'lucky-tracker-'))
    const filePath = join(dir, 'a.ts')
    await writeFile(filePath, 'v1', 'utf-8')

    await expect(assertWriteAllowed('conv-1', filePath)).rejects.toThrow(/read/i)
  })

  it('blocks write when file changed after read', async () => {
    dir = await mkdtemp(join(tmpdir(), 'lucky-tracker-'))
    const filePath = join(dir, 'b.ts')
    await writeFile(filePath, 'v1', 'utf-8')
    recordFileRead('conv-1', filePath, 'v1')

    await writeFile(filePath, 'v2', 'utf-8')
    await expect(assertWriteAllowed('conv-1', filePath)).rejects.toThrow(/conflict/i)
  })

  it('allows write when snapshot matches disk', async () => {
    dir = await mkdtemp(join(tmpdir(), 'lucky-tracker-'))
    const filePath = join(dir, 'c.ts')
    const content = 'unchanged'
    await writeFile(filePath, content, 'utf-8')
    recordFileRead('conv-1', filePath, content)

    await expect(assertWriteAllowed('conv-1', filePath)).resolves.toBeUndefined()
  })

  it('allows write to new file and updates snapshot after write', async () => {
    dir = await mkdtemp(join(tmpdir(), 'lucky-tracker-'))
    const filePath = join(dir, 'new.ts')

    await expect(assertWriteAllowed('conv-1', filePath)).resolves.toBeUndefined()
    await writeFile(filePath, 'fresh', 'utf-8')
    updateFileSnapshot('conv-1', filePath, 'fresh')

    await writeFile(filePath, 'mutated externally', 'utf-8')
    await expect(assertWriteAllowed('conv-1', filePath)).rejects.toThrow(/conflict/i)
    expect(await readFile(filePath, 'utf-8')).toBe('mutated externally')
  })

  it('hashes content deterministically', () => {
    expect(hashFileContent('abc')).toBe(hashFileContent('abc'))
    expect(hashFileContent('abc')).not.toBe(hashFileContent('abcd'))
  })
})
