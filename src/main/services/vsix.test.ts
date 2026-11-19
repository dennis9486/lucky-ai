import { describe, expect, it } from 'vitest'
import { deflateRawSync } from 'node:zlib'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { extractVsix } from './vsix.js'

interface Entry { name: string; data: Buffer; method: 0 | 8 }

/** 手搓一个最小 ZIP（STORE / DEFLATE），CRC 置 0（解包器不校验 CRC）。 */
function makeZip(entries: Entry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const stored = entry.method === 8 ? deflateRawSync(entry.data) : entry.data
    const name = Buffer.from(entry.name, 'utf8')

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(entry.method, 8)
    local.writeUInt32LE(0, 14) // crc
    local.writeUInt32LE(stored.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, stored)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(entry.method, 10)
    central.writeUInt32LE(0, 16) // crc
    central.writeUInt32LE(stored.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)

    offset += local.length + name.length + stored.length
  }

  const localBlock = Buffer.concat(locals)
  const centralBlock = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBlock.length, 12)
  eocd.writeUInt32LE(localBlock.length, 16)
  return Buffer.concat([localBlock, centralBlock, eocd])
}

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), 'vsix-test-'))
  try {
    return await fn(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('extractVsix', () => {
  it('extracts extension/ files, strips the prefix, and handles STORE + DEFLATE', async () => {
    const zip = makeZip([
      { name: 'extension.vsixmanifest', data: Buffer.from('<meta/>'), method: 0 }, // 非 extension/ 前缀，应忽略
      { name: 'extension/package.json', data: Buffer.from('{"name":"x"}'), method: 0 },
      { name: 'extension/dist/main.js', data: Buffer.from('console.log("hello world hello world")'), method: 8 }
    ])

    await withTempDir(async (dir) => {
      const count = await extractVsix(zip, dir)
      expect(count).toBe(2)
      expect(readFileSync(join(dir, 'package.json'), 'utf8')).toBe('{"name":"x"}')
      expect(readFileSync(join(dir, 'dist', 'main.js'), 'utf8')).toContain('hello world')
    })
  })

  it('rejects path traversal entries', async () => {
    const zip = makeZip([
      { name: 'extension/../../evil.txt', data: Buffer.from('pwned'), method: 0 }
    ])
    await withTempDir(async (dir) => {
      await expect(extractVsix(zip, dir)).rejects.toThrow()
    })
  })

  it('throws when there is no extension/ content', async () => {
    const zip = makeZip([{ name: 'readme.txt', data: Buffer.from('x'), method: 0 }])
    await withTempDir(async (dir) => {
      await expect(extractVsix(zip, dir)).rejects.toThrow()
    })
  })
})
