import { describe, expect, it } from 'vitest'
import { resolveBuiltinEditorLanguage } from './editor-language.js'

describe('resolveBuiltinEditorLanguage', () => {
  it('resolves by extension', () => {
    expect(resolveBuiltinEditorLanguage('src/a.ts')).toBe('typescript')
    expect(resolveBuiltinEditorLanguage('a.tsx')).toBe('typescript')
    expect(resolveBuiltinEditorLanguage('a.py')).toBe('python')
    expect(resolveBuiltinEditorLanguage('a.rs')).toBe('rust')
  })

  it('prefers exact filename mappings', () => {
    expect(resolveBuiltinEditorLanguage('/p/package.json')).toBe('json')
    expect(resolveBuiltinEditorLanguage('Dockerfile')).toBe('dockerfile')
    expect(resolveBuiltinEditorLanguage('.gitignore')).toBe('ignore')
    expect(resolveBuiltinEditorLanguage('pnpm-lock.yaml')).toBe('yaml')
  })

  it('handles special cases', () => {
    expect(resolveBuiltinEditorLanguage('.env.production')).toBe('dotenv')
    expect(resolveBuiltinEditorLanguage('types/foo.d.ts')).toBe('typescript')
    expect(resolveBuiltinEditorLanguage('service.dockerfile')).toBe('dockerfile')
  })

  it('falls back to plaintext for unknown', () => {
    expect(resolveBuiltinEditorLanguage('mystery.xyz')).toBe('plaintext')
    expect(resolveBuiltinEditorLanguage('noext')).toBe('plaintext')
  })
})
