import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const zh = JSON.parse(readFileSync(join(here, 'zh-CN.json'), 'utf-8')) as Record<string, unknown>
const en = JSON.parse(readFileSync(join(here, 'en-US.json'), 'utf-8')) as Record<string, unknown>

/** 递归展平成点分 key 集合（含数组索引），用于比较两个 locale 的结构。 */
function flattenKeys(obj: unknown, prefix = '', out: Set<string> = new Set()): Set<string> {
  if (obj && typeof obj === 'object') {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key
      if (value && typeof value === 'object') flattenKeys(value, path, out)
      else out.add(path)
    }
  }
  return out
}

describe('locale parity (zh-CN ↔ en-US)', () => {
  const zhKeys = flattenKeys(zh)
  const enKeys = flattenKeys(en)

  it('en-US has no keys missing from zh-CN', () => {
    const missing = [...enKeys].filter((k) => !zhKeys.has(k)).sort()
    expect(missing, `zh-CN 缺少这些 key：\n${missing.join('\n')}`).toEqual([])
  })

  it('zh-CN has no keys missing from en-US', () => {
    const missing = [...zhKeys].filter((k) => !enKeys.has(k)).sort()
    expect(missing, `en-US 缺少这些 key：\n${missing.join('\n')}`).toEqual([])
  })

  it('has no empty translation values', () => {
    const empties: string[] = []
    const check = (obj: unknown, prefix: string, locale: string): void => {
      if (obj && typeof obj === 'object') {
        for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
          const path = prefix ? `${prefix}.${key}` : key
          if (typeof value === 'string') {
            if (!value.trim()) empties.push(`${locale}:${path}`)
          } else check(value, path, locale)
        }
      }
    }
    check(zh, '', 'zh-CN')
    check(en, '', 'en-US')
    expect(empties, `存在空翻译：\n${empties.join('\n')}`).toEqual([])
  })
})
