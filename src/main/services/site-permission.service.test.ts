import { describe, expect, it } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import type Database from 'better-sqlite3'
import { MIGRATIONS, CURRENT_SCHEMA_VERSION } from '../db/migrations.js'
import { SitePermissionService } from './site-permission.service.js'

function createService(): SitePermissionService {
  const db = new DatabaseSync(':memory:')
  for (let v = 1; v <= CURRENT_SCHEMA_VERSION; v++) {
    for (const sql of MIGRATIONS[v] ?? []) db.exec(sql)
  }
  return new SitePermissionService(() => db as unknown as Database.Database)
}

describe('SitePermissionService', () => {
  it('resolves stored decisions without asking', async () => {
    const service = createService()
    service.set('https://meet.example.com', 'media', 'allow')
    service.set('https://ads.example.com', 'notifications', 'deny')

    await expect(service.decide('https://meet.example.com', 'media')).resolves.toBe(true)
    await expect(service.decide('https://ads.example.com', 'notifications')).resolves.toBe(false)
  })

  it('auto-allows low-risk permissions and denies non-askable ones', async () => {
    const service = createService()
    await expect(service.decide('https://x.example.com', 'clipboard-sanitized-write')).resolves.toBe(true)
    await expect(service.decide('https://x.example.com', 'pointerLock')).resolves.toBe(false)
    // 非询问集的拒绝不产生记录
    expect(service.list()).toEqual({})
  })

  it('denies conservatively when no window is available to ask', async () => {
    const service = createService()
    service.init(() => null)
    await expect(service.decide('https://new.example.com', 'geolocation')).resolves.toBe(false)
    // 未询问成功不记录，下次前台还能再问
    expect(service.get('https://new.example.com', 'geolocation')).toBeNull()
  })

  it('lists and clears per-site records', () => {
    const service = createService()
    service.set('https://a.com', 'media', 'allow')
    service.set('https://a.com', 'geolocation', 'deny')
    service.set('https://b.com', 'notifications', 'allow')

    expect(Object.keys(service.list())).toEqual(['https://a.com', 'https://b.com'])
    service.clearSite('https://a.com')
    expect(Object.keys(service.list())).toEqual(['https://b.com'])
    service.clearAll()
    expect(service.list()).toEqual({})
  })
})

describe('agent site policies', () => {
  it('defaults to ask, persists auto/block, and ask clears the record', () => {
    const service = createService()
    expect(service.getAgentPolicy('https://a.com')).toBe('ask')

    service.setAgentPolicy('https://a.com', 'auto')
    service.setAgentPolicy('https://b.com', 'block')
    expect(service.getAgentPolicy('https://a.com')).toBe('auto')
    expect(service.getAgentPolicy('https://b.com')).toBe('block')
    expect(service.listAgentPolicies()).toEqual({ 'https://a.com': 'auto', 'https://b.com': 'block' })

    // 'ask' 即恢复默认:记录被清除
    service.setAgentPolicy('https://a.com', 'ask')
    expect(service.listAgentPolicies()).toEqual({ 'https://b.com': 'block' })
    // 空 origin 保守返回 ask 且不写入
    expect(service.getAgentPolicy('')).toBe('ask')
    service.setAgentPolicy('', 'auto')
    expect(service.listAgentPolicies()).toEqual({ 'https://b.com': 'block' })
  })
})
