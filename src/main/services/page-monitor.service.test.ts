import { afterEach, describe, expect, it, vi } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import { MIGRATIONS, CURRENT_SCHEMA_VERSION } from '../db/migrations.js'
import { PageMonitorService } from './page-monitor.service.js'
import { webResearchService } from './web-research.service.js'

function createService(): PageMonitorService {
  const db = new DatabaseSync(':memory:')
  for (let v = 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    for (const sql of MIGRATIONS[v] ?? []) db.exec(sql)
  }
  return new PageMonitorService(() => db as unknown as Database.Database)
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PageMonitorService', () => {
  it('creates a monitor, takes a baseline, then detects a content change', async () => {
    const fetchMock = vi.spyOn(webResearchService, 'fetch')
      .mockResolvedValueOnce({ text: '价格: 100 元' } as never)

    const service = createService()
    const monitor = service.create('https://example.com/product', '商品页')
    // create 内部的基线抓取是异步 fire-and-forget，等它落库
    await vi.waitFor(() => {
      expect(service.list()[0]?.lastCheckedAt).not.toBeNull()
    })

    // 基线不算变化
    expect(service.list()[0]?.lastChangedAt).toBeNull()

    // 内容变化 → changed
    fetchMock.mockResolvedValueOnce({ text: '价格: 88 元' } as never)
    const changed = await service.checkOne(monitor.id)
    expect(changed).toBe(true)
    const updated = service.list()[0]!
    expect(updated.lastChangedAt).not.toBeNull()
    expect(updated.lastExcerpt).toContain('88')

    // 仅空白差异不算变化（哈希前规整空白）
    fetchMock.mockResolvedValueOnce({ text: '价格:   88   元' } as never)
    expect(await service.checkOne(monitor.id)).toBe(false)
  })

  it('records fetch failures without breaking the monitor', async () => {
    vi.spyOn(webResearchService, 'fetch').mockRejectedValue(new Error('net down'))
    const service = createService()
    const monitor = service.create('https://example.com/x')
    await vi.waitFor(() => {
      expect(service.list()[0]?.lastError).toContain('net down')
    })
    expect(await service.checkOne(monitor.id)).toBe(false)
    expect(service.list()[0]?.status).toBe('active')
  })

  it('rejects non-http urls and clamps interval', () => {
    const service = createService()
    expect(() => service.create('file:///etc/passwd')).toThrow('http')
    const monitor = service.create('https://example.com', '', 1)
    expect(monitor.intervalMinutes).toBe(5)
  })

  it('persists the aiAnalyze flag', () => {
    const service = createService()
    expect(service.create('https://example.com/a').aiAnalyze).toBe(false)
    expect(service.create('https://example.com/b', '', 30, true).aiAnalyze).toBe(true)
  })

  it('tick only checks due active monitors', async () => {
    const fetchMock = vi.spyOn(webResearchService, 'fetch').mockResolvedValue({ text: 'a' } as never)
    const service = createService()
    const monitor = service.create('https://example.com/a')
    await vi.waitFor(() => expect(service.list()[0]?.lastCheckedAt).not.toBeNull())
    fetchMock.mockClear()

    // 未到期：不抓
    await service.tick(Date.now())
    expect(fetchMock).not.toHaveBeenCalled()

    // 到期：抓
    await service.tick(Date.now() + 31 * 60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 暂停：不抓
    service.setStatus(monitor.id, 'paused')
    fetchMock.mockClear()
    await service.tick(Date.now() + 120 * 60_000)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
