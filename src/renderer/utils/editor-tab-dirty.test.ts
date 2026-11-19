import { describe, expect, it } from 'vitest'
import { isTabDirty } from './editor-tab-dirty.js'

describe('isTabDirty', () => {
  it('is clean before a pristine baseline exists', () => {
    expect(isTabDirty(null, 3)).toBe(false)
  })

  it('is clean when version matches pristine baseline', () => {
    expect(isTabDirty(5, 5)).toBe(false)
  })

  it('is dirty after the model version changes', () => {
    expect(isTabDirty(5, 6)).toBe(true)
  })
})
