import { describe, expect, it } from 'vitest'
import {
  formatPackageScriptCommand,
  getPackageJsonDir,
  isPackageJsonPath,
  parsePackageJsonScripts
} from './package-json-scripts.js'

const SAMPLE = `{
  "name": "demo",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "pnpm type-check && electron-vite build",
    "type-check": "vue-tsc --noEmit"
  }
}`

describe('isPackageJsonPath', () => {
  it('matches package.json basename', () => {
    expect(isPackageJsonPath('/workspace/package.json')).toBe(true)
    expect(isPackageJsonPath('package.json')).toBe(true)
    expect(isPackageJsonPath('/workspace/package-lock.json')).toBe(false)
  })
})

describe('parsePackageJsonScripts', () => {
  it('parses scripts with line numbers', () => {
    const info = parsePackageJsonScripts(SAMPLE)
    expect(info.scriptsLine).toBe(3)
    expect(info.scripts.map((script) => script.name)).toEqual(['dev', 'build', 'type-check'])
    expect(info.scripts[0]?.line).toBe(4)
    expect(info.scripts[2]?.line).toBe(6)
  })

  it('falls back while json is incomplete', () => {
    const partial = `{
  "scripts": {
    "dev": "vite"
`
    const info = parsePackageJsonScripts(partial)
    expect(info.scripts).toEqual([{ name: 'dev', command: 'vite', line: 3 }])
  })
})

describe('formatPackageScriptCommand', () => {
  it('quotes script names with special characters', () => {
    expect(formatPackageScriptCommand('pnpm', 'type-check')).toBe('pnpm run type-check')
    expect(formatPackageScriptCommand('npm', 'build:prod')).toBe('npm run "build:prod"')
  })
})

describe('getPackageJsonDir', () => {
  it('returns parent directory', () => {
    expect(getPackageJsonDir('/Users/demo/project/package.json')).toBe('/Users/demo/project')
  })
})
