import { describe, expect, it } from 'vitest'
import {
  applyAcceptedDiffHunk,
  applyRejectedDiffHunk,
  buildDiffHunks
} from './editor-diff.js'

describe('editor diff hunks', () => {
  it('accepts a hunk by merging it into the original baseline', () => {
    const original = 'alpha\nbeta'
    const modified = 'alpha\nBETA\n'
    const hunk = buildDiffHunks(original, modified)[0]
    expect(hunk).toBeDefined()

    const nextOriginal = applyAcceptedDiffHunk(original, modified, hunk!)
    expect(nextOriginal).toBe('alpha\nBETA\n')
    expect(buildDiffHunks(nextOriginal, modified)).toHaveLength(0)
  })

  it('rejects a hunk by reverting the modified side', () => {
    const original = 'alpha\nbeta'
    const modified = 'alpha\nBETA\n'
    const hunk = buildDiffHunks(original, modified)[0]
    expect(hunk).toBeDefined()

    const nextModified = applyRejectedDiffHunk(original, modified, hunk!)
    expect(nextModified).toBe('alpha\nbeta')
    expect(buildDiffHunks(original, nextModified)).toHaveLength(0)
  })
})
