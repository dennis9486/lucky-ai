import { describe, expect, it } from 'vitest'
import { parseReferences } from './references.js'

describe('parseReferences', () => {
  it('parses @file and @folder references', () => {
    const refs = parseReferences('Check @file /tmp/a.ts and @folder src/components')
    expect(refs).toEqual([
      { type: 'file', path: '/tmp/a.ts' },
      { type: 'folder', path: 'src/components' }
    ])
  })

  it('parses @terminal and @browser markers', () => {
    const refs = parseReferences('Use @terminal output and @browser history')
    expect(refs).toContainEqual({ type: 'terminal', path: '' })
    expect(refs).toContainEqual({ type: 'browser', path: '' })
  })
})
