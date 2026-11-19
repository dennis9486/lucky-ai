import { describe, expect, it, vi } from 'vitest'
import { createVscodeApi } from './vscode-api.js'
import type { ExtensionManifestSummary } from '../../shared/types/extension.js'

const extension = {
  id: 'pub.ext',
  name: 'ext',
  version: '1.0.0',
  publisher: 'pub',
  path: '/tmp/ext',
  source: 'lucky-ai',
  enabled: true,
  managed: true
} as ExtensionManifestSummary

function makeApi(overrides: Partial<Parameters<typeof createVscodeApi>[0]> = {}) {
  const api = createVscodeApi({
    workspaceRoot: '/ws',
    extension,
    registerCommand: () => () => undefined,
    emitMessage: () => undefined,
    executeCommand: () => undefined,
    ...overrides
  })
  // 类以属性形式暴露在 vscode 对象上，测试里取出来用
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return api as unknown as Record<string, any>
}

describe('vscode-api shim — 与 VS Code 形状对齐', () => {
  it('Position: isBefore / translate / isEqual', () => {
    const { Position } = makeApi()
    const a = new Position(1, 2)
    const b = new Position(1, 5)
    expect(a.isBefore(b)).toBe(true)
    expect(b.isAfter(a)).toBe(true)
    expect(a.translate(1, 0).isEqual(new Position(2, 2))).toBe(true)
    expect(a.isEqual(new Position(1, 2))).toBe(true)
  })

  it('Range: contains position + isEmpty', () => {
    const { Range, Position } = makeApi()
    const range = new Range(1, 0, 3, 10)
    expect(range.contains(new Position(2, 5))).toBe(true)
    expect(range.contains(new Position(4, 0))).toBe(false)
    expect(new Range(new Position(1, 1), new Position(1, 1)).isEmpty).toBe(true)
  })

  it('Selection: 归一化 start/end 并保留方向', () => {
    const { Selection, Position } = makeApi()
    const sel = new Selection(new Position(3, 0), new Position(1, 0))
    expect(sel.start.isEqual(new Position(1, 0))).toBe(true) // start 总是靠前
    expect(sel.isReversed).toBe(true)
  })

  it('Uri: file / parse / joinPath / fsPath', () => {
    const { Uri } = makeApi()
    expect(Uri.file('/a/b.txt').fsPath).toBe('/a/b.txt')
    const parsed = Uri.parse('https://example.com/p?q=1#f')
    expect(parsed.scheme).toBe('https')
    expect(parsed.authority).toBe('example.com')
    expect(parsed.path).toBe('/p')
    expect(Uri.joinPath(Uri.file('/a'), 'b', 'c.txt').fsPath).toBe('/a/b/c.txt')
  })

  it('EventEmitter: event/fire/dispose', () => {
    const { EventEmitter } = makeApi()
    const emitter = new EventEmitter()
    const seen: number[] = []
    const sub = emitter.event((v: number) => seen.push(v))
    emitter.fire(1)
    sub.dispose()
    emitter.fire(2)
    expect(seen).toEqual([1])
  })

  it('commands.executeCommand 路由到宿主 executeCommand', async () => {
    const executeCommand = vi.fn(() => 'result')
    const api = makeApi({ executeCommand })
    const value = await api.commands.executeCommand('foo', 1, 2)
    expect(executeCommand).toHaveBeenCalledWith('foo', [1, 2])
    expect(value).toBe('result')
  })

  it('枚举值与 VS Code 数值对齐', () => {
    const api = makeApi()
    expect(api.DiagnosticSeverity.Error).toBe(0)
    expect(api.DiagnosticSeverity.Warning).toBe(1)
    expect(api.StatusBarAlignment.Left).toBe(1)
    expect(api.CompletionItemKind.Function).toBe(2)
    expect(api.ConfigurationTarget.Global).toBe(1)
  })

  it('workspace: 单根工作区 + asRelativePath', () => {
    const api = makeApi()
    expect(api.workspace.workspaceFolders?.[0]?.name).toBe('ws')
    expect(api.workspace.asRelativePath('/ws/src/a.ts')).toBe('src/a.ts')
    expect(api.workspace.rootPath).toBe('/ws')
  })
})
