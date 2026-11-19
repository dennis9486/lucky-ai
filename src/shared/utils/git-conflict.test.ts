import { describe, expect, it } from 'vitest'
import {
  applyAllConflictResolution,
  applyConflictResolution,
  buildConflictDecorationRanges,
  parseGitConflictMarkers
} from './git-conflict.js'

describe('git conflict markers', () => {
  const sample = [
    'before',
    '<<<<<<< HEAD',
    'ours line',
    '=======',
    'theirs line',
    '>>>>>>> feature',
    'after'
  ].join('\n')

  it('parses a single conflict region', () => {
    const parsed = parseGitConflictMarkers(sample)
    expect(parsed.regions).toHaveLength(1)
    expect(parsed.regions[0]?.ours).toBe('ours line')
    expect(parsed.regions[0]?.theirs).toBe('theirs line')
    expect(parsed.regions[0]?.oursStartLine).toBe(3)
    expect(parsed.regions[0]?.separatorLine).toBe(4)
    expect(parsed.regions[0]?.theirsStartLine).toBe(5)
  })

  it('applies ours resolution', () => {
    const region = parseGitConflictMarkers(sample).regions[0]
    expect(region).toBeTruthy()
    const resolved = applyConflictResolution(sample, region!, 'ours')
    expect(resolved).toBe(['before', 'ours line', 'after'].join('\n'))
  })

  it('applies all theirs resolution', () => {
    const resolved = applyAllConflictResolution(sample, 'theirs')
    expect(resolved).toBe(['before', 'theirs line', 'after'].join('\n'))
  })

  it('builds ours/theirs decoration ranges', () => {
    const region = parseGitConflictMarkers(sample).regions[0]
    expect(region).toBeTruthy()
    const ranges = buildConflictDecorationRanges(region!, true)
    expect(ranges.some((item) => item.className.includes('ours'))).toBe(true)
    expect(ranges.some((item) => item.className.includes('theirs'))).toBe(true)
  })
})
