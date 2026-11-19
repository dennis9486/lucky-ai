import { describe, expect, it } from 'vitest'
import { resolveWorkspaceFilePath, toWorkspaceRelativePath } from './workspace-path.js'

describe('resolveWorkspaceFilePath', () => {
  const root = '/Users/dev/project'

  it('joins relative paths to workspace root', () => {
    expect(resolveWorkspaceFilePath('src/main/window.ts', root)).toBe('/Users/dev/project/src/main/window.ts')
  })

  it('fixes monaco-style /src paths', () => {
    expect(resolveWorkspaceFilePath('/src/main/window.ts', root)).toBe('/Users/dev/project/src/main/window.ts')
  })

  it('keeps absolute paths under workspace', () => {
    expect(resolveWorkspaceFilePath('/Users/dev/project/src/main/window.ts', root))
      .toBe('/Users/dev/project/src/main/window.ts')
  })
})

describe('toWorkspaceRelativePath', () => {
  const root = '/Users/dev/project'

  it('converts absolute to relative', () => {
    expect(toWorkspaceRelativePath('/Users/dev/project/src/main/window.ts', root))
      .toBe('src/main/window.ts')
  })

  it('passes through already relative paths', () => {
    expect(toWorkspaceRelativePath('src/main/window.ts', root)).toBe('src/main/window.ts')
  })
})
