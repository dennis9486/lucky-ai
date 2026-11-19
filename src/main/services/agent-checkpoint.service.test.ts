import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MIGRATIONS, CURRENT_SCHEMA_VERSION } from '../db/migrations.js'
import { AgentCheckpointService } from './agent-checkpoint.service.js'
import { securityService } from './security.service.js'

function createTestDb(): Database.Database {
  const db = new DatabaseSync(':memory:')
  for (let v = 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    for (const sql of MIGRATIONS[v] ?? []) db.exec(sql)
  }
  return db as unknown as Database.Database
}

describe('AgentCheckpointService', () => {
  let workspace: string
  let service: AgentCheckpointService

  beforeEach(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'ckpt-'))
    securityService.setWorkspaceRoot(workspace)
    // 每个用例独享一个内存库实例
    const db = createTestDb()
    service = new AgentCheckpointService(() => db)
  })

  afterEach(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  it('captures pre-image once per turn and restores it on revert', async () => {
    const filePath = join(workspace, 'a.txt')
    await writeFile(filePath, 'original')

    service.beginTurn('conv', 'turn-1')
    await service.captureBeforeWrite('conv', filePath)
    await writeFile(filePath, 'modified-1')
    // 同轮第二次写同一文件：仍只保留首次前像
    await service.captureBeforeWrite('conv', filePath)
    await writeFile(filePath, 'modified-2')
    service.endTurn('conv', 'turn-1')

    const files = service.listTurnFiles('turn-1')
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({ path: filePath, existedBefore: true })

    const result = await service.revertTurn('turn-1')
    expect(result.restored).toEqual([filePath])
    expect(await readFile(filePath, 'utf-8')).toBe('original')
  })

  it('deletes files that did not exist before the turn', async () => {
    const created = join(workspace, 'new', 'file.txt')

    service.beginTurn('conv', 'turn-1')
    await service.captureBeforeWrite('conv', created)
    await mkdir(join(workspace, 'new'), { recursive: true })
    await writeFile(created, 'agent-created')
    service.endTurn('conv', 'turn-1')

    const result = await service.revertTurn('turn-1')
    expect(result.deleted).toEqual([created])
    expect(existsSync(created)).toBe(false)
  })

  it('is a no-op without an active turn', async () => {
    const filePath = join(workspace, 'b.txt')
    await writeFile(filePath, 'data')

    await service.captureBeforeWrite('conv', filePath)

    expect(service.listTurnFiles('turn-x')).toEqual([])
  })

  it('revert is idempotent (snapshots are kept)', async () => {
    const filePath = join(workspace, 'c.txt')
    await writeFile(filePath, 'v0')

    service.beginTurn('conv', 'turn-1')
    await service.captureBeforeWrite('conv', filePath)
    await writeFile(filePath, 'v1')
    service.endTurn('conv', 'turn-1')

    await service.revertTurn('turn-1')
    await writeFile(filePath, 'v2')
    await service.revertTurn('turn-1')

    expect(await readFile(filePath, 'utf-8')).toBe('v0')
  })

  it('skips paths outside the current workspace on revert', async () => {
    const filePath = join(workspace, 'd.txt')
    await writeFile(filePath, 'v0')

    service.beginTurn('conv', 'turn-1')
    await service.captureBeforeWrite('conv', filePath)
    await writeFile(filePath, 'v1')
    service.endTurn('conv', 'turn-1')

    // 模拟用户切换了工作区：原路径不再合法
    const otherWorkspace = await mkdtemp(join(tmpdir(), 'ckpt-other-'))
    try {
      securityService.setWorkspaceRoot(otherWorkspace)
      const result = await service.revertTurn('turn-1')
      expect(result.restored).toEqual([])
      expect(result.skipped).toHaveLength(1)
      expect(result.skipped[0].path).toBe(filePath)
      expect(await readFile(filePath, 'utf-8')).toBe('v1')
    } finally {
      await rm(otherWorkspace, { recursive: true, force: true })
    }
  })

  it('scopes turns per conversation and cleans up by conversation', async () => {
    const fileA = join(workspace, 'a.txt')
    const fileB = join(workspace, 'b.txt')
    await writeFile(fileA, 'a0')
    await writeFile(fileB, 'b0')

    service.beginTurn('conv-a', 'turn-a')
    service.beginTurn('conv-b', 'turn-b')
    await service.captureBeforeWrite('conv-a', fileA)
    await service.captureBeforeWrite('conv-b', fileB)
    service.endTurn('conv-a', 'turn-a')
    service.endTurn('conv-b', 'turn-b')

    expect(service.listTurnFiles('turn-a').map((f) => f.path)).toEqual([fileA])
    expect(service.listTurnFiles('turn-b').map((f) => f.path)).toEqual([fileB])

    service.deleteConversationCheckpoints('conv-a')
    expect(service.listTurnFiles('turn-a')).toEqual([])
    expect(service.listTurnFiles('turn-b')).toHaveLength(1)
  })
})
