/**
 * VS Code API 兼容层（shim）。
 *
 * 扩展在宿主进程（utilityProcess）中通过 `require('vscode')` 拿到本模块构造的对象。
 * 目标是**与 VS Code 的 API 形状对齐**：常用的类（Position/Range/Uri/EventEmitter…）、枚举、
 * 命名空间（commands/window/workspace/languages/env）都按真实 API 的形状实现，让真实扩展能顺利
 * activate 并调用常见 API。需要编辑器 UI 的能力（QuickPick/Webview/装饰器等）以正确形状 no-op；
 * 文件系统（workspace.fs）用 node 真实实现。已实现的桥接能力经 ExtensionRuntimeContext 回主进程。
 */
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { readFile, writeFile, stat, readdir, mkdir, rm, rename, cp } from 'node:fs/promises'
import type { ExtensionManifestSummary } from '../../shared/types/extension.js'

/** 扩展运行时注入的依赖，用于把 shim 的调用桥接回 ExtensionRuntimeService / 宿主命令表。 */
export interface ExtensionRuntimeContext {
  workspaceRoot?: string
  extension: ExtensionManifestSummary
  registerCommand: (command: string, handler: (...args: unknown[]) => unknown) => () => void
  emitMessage: (level: 'info' | 'warn' | 'error', message: string) => void
  /** commands.executeCommand 的路由（宿主侧查已注册 handler 执行） */
  executeCommand?: (command: string, args: unknown[]) => Promise<unknown> | unknown
}

export interface VscodeDisposable {
  dispose: () => void
}

// ============================ 类（class） ====================================

class Disposable {
  static from(...items: Array<{ dispose: () => unknown }>): Disposable {
    return new Disposable(() => { for (const item of items) item.dispose() })
  }
  constructor(private readonly callOnDispose: () => unknown) {}
  dispose(): void { this.callOnDispose() }
}

class Position {
  constructor(readonly line: number, readonly character: number) {}
  isBefore(other: Position): boolean { return this.line < other.line || (this.line === other.line && this.character < other.character) }
  isBeforeOrEqual(other: Position): boolean { return this.isBefore(other) || this.isEqual(other) }
  isAfter(other: Position): boolean { return !this.isBeforeOrEqual(other) }
  isAfterOrEqual(other: Position): boolean { return !this.isBefore(other) }
  isEqual(other: Position): boolean { return this.line === other.line && this.character === other.character }
  compareTo(other: Position): number { return this.isBefore(other) ? -1 : this.isEqual(other) ? 0 : 1 }
  translate(lineDelta = 0, characterDelta = 0): Position { return new Position(this.line + lineDelta, this.character + characterDelta) }
  with(line = this.line, character = this.character): Position { return new Position(line, character) }
}

class Range {
  readonly start: Position
  readonly end: Position
  constructor(startLine: number | Position, startChar: number | Position, endLine?: number, endChar?: number) {
    if (startLine instanceof Position && startChar instanceof Position) {
      this.start = startLine
      this.end = startChar
    } else {
      this.start = new Position(startLine as number, startChar as number)
      this.end = new Position(endLine ?? 0, endChar ?? 0)
    }
  }
  get isEmpty(): boolean { return this.start.isEqual(this.end) }
  get isSingleLine(): boolean { return this.start.line === this.end.line }
  contains(positionOrRange: Position | Range): boolean {
    const range = positionOrRange instanceof Range ? positionOrRange : new Range(positionOrRange, positionOrRange)
    return !range.start.isBefore(this.start) && !range.end.isAfter(this.end)
  }
  isEqual(other: Range): boolean { return this.start.isEqual(other.start) && this.end.isEqual(other.end) }
  with(start = this.start, end = this.end): Range { return new Range(start, end) }
}

class Selection extends Range {
  readonly anchor: Position
  readonly active: Position
  constructor(anchorLine: number | Position, anchorChar: number | Position, activeLine?: number, activeChar?: number) {
    const anchor = anchorLine instanceof Position ? anchorLine : new Position(anchorLine as number, anchorChar as number)
    const active = anchorChar instanceof Position ? anchorChar : new Position(activeLine ?? 0, activeChar ?? 0)
    super(anchor.isBeforeOrEqual(active) ? anchor : active, anchor.isBeforeOrEqual(active) ? active : anchor)
    this.anchor = anchor
    this.active = active
  }
  get isReversed(): boolean { return this.anchor.isAfter(this.active) }
}

class Location {
  constructor(readonly uri: Uri, readonly rangeOrPosition: Range | Position) {}
}

class Uri {
  private constructor(
    readonly scheme: string,
    readonly authority: string,
    readonly path: string,
    readonly query = '',
    readonly fragment = ''
  ) {}
  get fsPath(): string { return this.path }
  static file(path: string): Uri { return new Uri('file', '', path) }
  static parse(value: string): Uri {
    const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(value)
    if (!match) return new Uri('file', '', value)
    return new Uri(match[1] ?? 'file', match[2] ?? '', match[3] ?? '', match[4] ?? '', match[5] ?? '')
  }
  static joinPath(base: Uri, ...segments: string[]): Uri {
    return new Uri(base.scheme, base.authority, join(base.path, ...segments), base.query, base.fragment)
  }
  with(change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri {
    return new Uri(change.scheme ?? this.scheme, change.authority ?? this.authority, change.path ?? this.path, change.query ?? this.query, change.fragment ?? this.fragment)
  }
  toString(): string {
    const auth = this.authority || this.scheme === 'file' ? `//${this.authority}` : ''
    return `${this.scheme}:${auth}${this.path}${this.query ? `?${this.query}` : ''}${this.fragment ? `#${this.fragment}` : ''}`
  }
  toJSON(): Record<string, string> { return { scheme: this.scheme, authority: this.authority, path: this.path, query: this.query, fragment: this.fragment } }
}

/** 与 VS Code Event/EventEmitter 对齐：event(listener) 订阅、fire(data) 触发、dispose 清理。 */
class EventEmitter<T> {
  private readonly listeners = new Set<(value: T) => unknown>()
  readonly event = (listener: (value: T) => unknown): VscodeDisposable => {
    this.listeners.add(listener)
    return { dispose: () => this.listeners.delete(listener) }
  }
  fire(value: T): void { for (const listener of [...this.listeners]) listener(value) }
  dispose(): void { this.listeners.clear() }
}

class CancellationTokenSource {
  private readonly emitter = new EventEmitter<void>()
  private cancelled = false
  readonly token = {
    get isCancellationRequested(): boolean { return false },
    onCancellationRequested: this.emitter.event
  }
  constructor() {
    Object.defineProperty(this.token, 'isCancellationRequested', { get: () => this.cancelled })
  }
  cancel(): void { if (!this.cancelled) { this.cancelled = true; this.emitter.fire() } }
  dispose(): void { this.emitter.dispose() }
}

class ThemeColor { constructor(readonly id: string) {} }
class ThemeIcon { static readonly File = new ThemeIcon('file'); static readonly Folder = new ThemeIcon('folder'); constructor(readonly id: string, readonly color?: ThemeColor) {} }
class MarkdownString {
  value: string
  isTrusted = false
  supportThemeIcons = false
  constructor(value = '') { this.value = value }
  appendText(value: string): this { this.value += value; return this }
  appendMarkdown(value: string): this { this.value += value; return this }
  appendCodeblock(code: string, lang = ''): this { this.value += `\n\`\`\`${lang}\n${code}\n\`\`\`\n`; return this }
}
class SnippetString { value: string; constructor(value = '') { this.value = value } appendText(v: string): this { this.value += v; return this } appendTabstop(): this { return this } appendPlaceholder(): this { return this } }
class RelativePattern { constructor(readonly base: unknown, readonly pattern: string) {} }
class Diagnostic { source?: string; code?: string | number; constructor(readonly range: Range, readonly message: string, readonly severity = 0) {} }
class CompletionItem { insertText?: unknown; detail?: string; documentation?: unknown; constructor(readonly label: string, readonly kind?: number) {} }
class CodeAction { command?: unknown; edit?: unknown; diagnostics?: unknown[]; isPreferred?: boolean; constructor(readonly title: string, readonly kind?: unknown) {} }
class Hover { constructor(readonly contents: unknown, readonly range?: Range) {} }
class TextEdit {
  static replace(range: Range, newText: string): TextEdit { return new TextEdit(range, newText) }
  static insert(position: Position, newText: string): TextEdit { return new TextEdit(new Range(position, position), newText) }
  static delete(range: Range): TextEdit { return new TextEdit(range, '') }
  constructor(readonly range: Range, readonly newText: string) {}
}
class WorkspaceEdit {
  private readonly edits = new Map<string, TextEdit[]>()
  replace(uri: Uri, range: Range, newText: string): void { this.push(uri, TextEdit.replace(range, newText)) }
  insert(uri: Uri, position: Position, newText: string): void { this.push(uri, TextEdit.insert(position, newText)) }
  delete(uri: Uri, range: Range): void { this.push(uri, TextEdit.delete(range)) }
  private push(uri: Uri, edit: TextEdit): void { const key = uri.toString(); this.edits.set(key, [...(this.edits.get(key) ?? []), edit]) }
  get size(): number { return this.edits.size }
}
class CodeActionKind {
  static readonly Empty = new CodeActionKind('')
  static readonly QuickFix = new CodeActionKind('quickfix')
  static readonly Refactor = new CodeActionKind('refactor')
  static readonly Source = new CodeActionKind('source')
  constructor(readonly value: string) {}
  append(part: string): CodeActionKind { return new CodeActionKind(this.value ? `${this.value}.${part}` : part) }
}

// ============================ 枚举（enum） ===================================

const enums = {
  ExtensionMode: { Production: 1, Development: 2, Test: 3 },
  ExtensionKind: { UI: 1, Workspace: 2 },
  ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
  StatusBarAlignment: { Left: 1, Right: 2 },
  ViewColumn: { Active: -1, Beside: -2, One: 1, Two: 2, Three: 3, Four: 4, Five: 5, Six: 6, Seven: 7, Eight: 8, Nine: 9 },
  DiagnosticSeverity: { Error: 0, Warning: 1, Information: 2, Hint: 3 },
  CompletionItemKind: { Text: 0, Method: 1, Function: 2, Constructor: 3, Field: 4, Variable: 5, Class: 6, Interface: 7, Module: 8, Property: 9, Unit: 10, Value: 11, Enum: 12, Keyword: 13, Snippet: 14, Color: 15, File: 16, Reference: 17, Folder: 18, EnumMember: 19, Constant: 20, Struct: 21, Event: 22, Operator: 23, TypeParameter: 24 },
  SymbolKind: { File: 0, Module: 1, Namespace: 2, Package: 3, Class: 4, Method: 5, Property: 6, Field: 7, Constructor: 8, Enum: 9, Interface: 10, Function: 11, Variable: 12, Constant: 13, String: 14, Number: 15, Boolean: 16, Array: 17, Object: 18, Key: 19, Null: 20, EnumMember: 21, Struct: 22, Event: 23, Operator: 24, TypeParameter: 25 },
  TextEditorRevealType: { Default: 0, InCenter: 1, InCenterIfOutsideViewport: 2, AtTop: 3 },
  EndOfLine: { LF: 1, CRLF: 2 },
  FileType: { Unknown: 0, File: 1, Directory: 2, SymbolicLink: 64 },
  UIKind: { Desktop: 1, Web: 2 },
  ProgressLocation: { SourceControl: 1, Window: 10, Notification: 15 },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  OverviewRulerLane: { Left: 1, Center: 2, Right: 4, Full: 7 },
  TextDocumentSaveReason: { Manual: 1, AfterDelay: 2, FocusOut: 3 }
}

function noopDisposable(): VscodeDisposable { return { dispose: () => undefined } }

// ============================ workspace.fs（node 实现） =======================

function createFileSystem() {
  const toPath = (uri: { fsPath?: string; path?: string }): string => uri.fsPath ?? uri.path ?? ''
  return {
    readFile: async (uri: { fsPath?: string; path?: string }): Promise<Uint8Array> => new Uint8Array(await readFile(toPath(uri))),
    writeFile: async (uri: { fsPath?: string; path?: string }, content: Uint8Array): Promise<void> => { await writeFile(toPath(uri), content) },
    stat: async (uri: { fsPath?: string; path?: string }) => {
      const s = await stat(toPath(uri))
      return { type: s.isDirectory() ? enums.FileType.Directory : s.isSymbolicLink() ? enums.FileType.SymbolicLink : enums.FileType.File, ctime: s.ctimeMs, mtime: s.mtimeMs, size: s.size }
    },
    readDirectory: async (uri: { fsPath?: string; path?: string }): Promise<Array<[string, number]>> => {
      const entries = await readdir(toPath(uri), { withFileTypes: true })
      return entries.map((e) => [e.name, e.isDirectory() ? enums.FileType.Directory : enums.FileType.File])
    },
    createDirectory: async (uri: { fsPath?: string; path?: string }): Promise<void> => { await mkdir(toPath(uri), { recursive: true }) },
    delete: async (uri: { fsPath?: string; path?: string }, options?: { recursive?: boolean }): Promise<void> => { await rm(toPath(uri), { recursive: options?.recursive ?? false, force: true }) },
    rename: async (source: { fsPath?: string; path?: string }, target: { fsPath?: string; path?: string }): Promise<void> => { await rename(toPath(source), toPath(target)) },
    copy: async (source: { fsPath?: string; path?: string }, target: { fsPath?: string; path?: string }): Promise<void> => { await cp(toPath(source), toPath(target), { recursive: true }) }
  }
}

async function findFilesUnder(root: string, matcher: RegExp, exclude: RegExp | null, max: number): Promise<Uri[]> {
  const out: Uri[] = []
  async function walk(dir: string): Promise<void> {
    if (out.length >= max) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (out.length >= max) return
      const full = join(dir, entry.name)
      const rel = relative(root, full).split(sep).join('/')
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        await walk(full)
      } else if (matcher.test(rel) && !(exclude && exclude.test(rel))) {
        out.push(Uri.file(full))
      }
    }
  }
  await walk(root)
  return out
}

/** 极简 glob→RegExp（覆盖 `**`、`*`、`{a,b}`、`?`），够常见 findFiles 用。 */
function globToRegExp(glob: string): RegExp {
  const re = glob
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\{([^}]+)\}/g, (_m, inner: string) => `(${inner.split(',').join('|')})`)
    .replace(/\*\*\//g, '§§')
    .replace(/\*\*/g, '§')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/§§/g, '(?:.*/)?')
    .replace(/§/g, '.*')
  return new RegExp(`^${re}$`)
}

// ============================ 组装 vscode 对象 ================================

export function createVscodeApi(context: ExtensionRuntimeContext): Record<string, unknown> {
  const subscriptions: VscodeDisposable[] = []
  const workspaceRoot = context.workspaceRoot

  const workspaceFolders = workspaceRoot
    ? [{ uri: Uri.file(workspaceRoot), name: basename(workspaceRoot), index: 0 }]
    : undefined

  const onDidChangeConfiguration = new EventEmitter<unknown>()
  const onDidChangeWorkspaceFolders = new EventEmitter<unknown>()
  const onDidOpenTextDocument = new EventEmitter<unknown>()
  const onDidCloseTextDocument = new EventEmitter<unknown>()
  const onDidSaveTextDocument = new EventEmitter<unknown>()
  const onDidChangeTextDocument = new EventEmitter<unknown>()
  const onDidChangeActiveTextEditor = new EventEmitter<unknown>()

  return {
    version: '1.90.0',

    // 类
    Disposable, Position, Range, Selection, Location, Uri, EventEmitter, CancellationTokenSource,
    ThemeColor, ThemeIcon, MarkdownString, SnippetString, RelativePattern, Diagnostic,
    CompletionItem, CodeAction, CodeActionKind, Hover, TextEdit, WorkspaceEdit,

    // 枚举
    ...enums,

    commands: {
      registerCommand: (command: string, callback: (...args: unknown[]) => unknown) => {
        const dispose = context.registerCommand(command, callback)
        const disposable = { dispose }
        subscriptions.push(disposable)
        return disposable
      },
      registerTextEditorCommand: (command: string, callback: (...args: unknown[]) => unknown) => {
        const dispose = context.registerCommand(command, callback)
        const disposable = { dispose }
        subscriptions.push(disposable)
        return disposable
      },
      executeCommand: async (command: string, ...args: unknown[]) => {
        if (context.executeCommand) return context.executeCommand(command, args)
        return undefined
      },
      getCommands: async () => [] as string[]
    },

    window: {
      activeTextEditor: undefined,
      visibleTextEditors: [] as unknown[],
      terminals: [] as unknown[],
      activeTerminal: undefined,
      onDidChangeActiveTextEditor: onDidChangeActiveTextEditor.event,
      onDidChangeTextEditorSelection: () => noopDisposable(),
      onDidChangeVisibleTextEditors: () => noopDisposable(),
      onDidChangeActiveColorTheme: () => noopDisposable(),
      showInformationMessage: async (message: string) => { context.emitMessage('info', message); return undefined },
      showWarningMessage: async (message: string) => { context.emitMessage('warn', message); return undefined },
      showErrorMessage: async (message: string) => { context.emitMessage('error', message); return undefined },
      showQuickPick: async () => undefined,
      showInputBox: async () => undefined,
      showOpenDialog: async () => undefined,
      showSaveDialog: async () => undefined,
      showTextDocument: async () => undefined,
      setStatusBarMessage: () => noopDisposable(),
      withProgress: async (_options: unknown, task: (progress: unknown, token: unknown) => Promise<unknown>) =>
        task({ report: () => undefined }, new CancellationTokenSource().token),
      createOutputChannel: (name: string) => ({
        name,
        append: (value: string) => context.emitMessage('info', `[${name}] ${value}`),
        appendLine: (value: string) => context.emitMessage('info', `[${name}] ${value}`),
        replace: () => undefined,
        clear: () => undefined,
        show: () => undefined,
        hide: () => undefined,
        dispose: () => undefined
      }),
      createStatusBarItem: () => ({
        text: '', tooltip: '', command: '', color: undefined, alignment: enums.StatusBarAlignment.Left, priority: 0,
        show: () => undefined, hide: () => undefined, dispose: () => undefined
      }),
      createTextEditorDecorationType: () => ({ key: 'decoration', dispose: () => undefined }),
      createTerminal: () => ({ name: 'lucky', processId: Promise.resolve(undefined), sendText: () => undefined, show: () => undefined, hide: () => undefined, dispose: () => undefined }),
      registerTreeDataProvider: () => noopDisposable(),
      createTreeView: () => ({ visible: false, onDidChangeVisibility: () => noopDisposable(), reveal: async () => undefined, dispose: () => undefined }),
      registerWebviewViewProvider: () => noopDisposable(),
      registerUriHandler: () => noopDisposable(),
      createWebviewPanel: () => ({
        webview: { html: '', options: {}, onDidReceiveMessage: () => noopDisposable(), postMessage: async () => false, asWebviewUri: (uri: unknown) => uri, cspSource: '' },
        onDidDispose: () => noopDisposable(), onDidChangeViewState: () => noopDisposable(), reveal: () => undefined, dispose: () => undefined
      })
    },

    workspace: {
      workspaceFolders,
      name: workspaceFolders?.[0]?.name,
      rootPath: workspaceRoot,
      textDocuments: [] as unknown[],
      fs: createFileSystem(),
      getWorkspaceFolder: (uri: { fsPath?: string }) => {
        if (!workspaceRoot || !uri.fsPath?.startsWith(workspaceRoot)) return undefined
        return workspaceFolders?.[0]
      },
      asRelativePath: (pathOrUri: string | { fsPath?: string }, _includeWorkspace?: boolean) => {
        const p = typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.fsPath ?? ''
        return workspaceRoot && isAbsolute(p) ? relative(workspaceRoot, p).split(sep).join('/') : p
      },
      getConfiguration: (_section?: string) => ({
        get: <T>(_key: string, defaultValue?: T) => defaultValue,
        has: () => false,
        inspect: () => undefined,
        update: async () => undefined
      }),
      findFiles: async (include: string | RelativePattern, exclude?: string | null, maxResults = 1000) => {
        if (!workspaceRoot) return [] as Uri[]
        const pattern = typeof include === 'string' ? include : include.pattern
        const excludeRe = typeof exclude === 'string' && exclude ? globToRegExp(exclude) : null
        return findFilesUnder(workspaceRoot, globToRegExp(pattern), excludeRe, maxResults)
      },
      createFileSystemWatcher: () => ({
        onDidCreate: () => noopDisposable(), onDidChange: () => noopDisposable(), onDidDelete: () => noopDisposable(), dispose: () => undefined
      }),
      openTextDocument: async (uriOrPath: string | { fsPath: string }) => {
        const filePath = typeof uriOrPath === 'string' ? uriOrPath : uriOrPath.fsPath
        let text = ''
        try { text = await readFile(filePath, 'utf8') } catch { /* ignore */ }
        const lines = text.split('\n')
        return {
          uri: Uri.file(filePath),
          fileName: filePath,
          languageId: 'plaintext',
          version: 1,
          isDirty: false,
          isUntitled: false,
          eol: enums.EndOfLine.LF,
          lineCount: lines.length,
          getText: () => text,
          lineAt: (line: number) => ({ lineNumber: line, text: lines[line] ?? '', range: new Range(line, 0, line, (lines[line] ?? '').length) }),
          positionAt: (offset: number) => new Position(0, offset),
          offsetAt: () => 0,
          save: async () => true
        }
      },
      applyEdit: async () => true,
      saveAll: async () => true,
      onDidChangeConfiguration: onDidChangeConfiguration.event,
      onDidChangeWorkspaceFolders: onDidChangeWorkspaceFolders.event,
      onDidOpenTextDocument: onDidOpenTextDocument.event,
      onDidCloseTextDocument: onDidCloseTextDocument.event,
      onDidSaveTextDocument: onDidSaveTextDocument.event,
      onDidChangeTextDocument: onDidChangeTextDocument.event,
      registerTextDocumentContentProvider: () => noopDisposable()
    },

    languages: {
      registerCompletionItemProvider: () => noopDisposable(),
      registerHoverProvider: () => noopDisposable(),
      registerDefinitionProvider: () => noopDisposable(),
      registerTypeDefinitionProvider: () => noopDisposable(),
      registerImplementationProvider: () => noopDisposable(),
      registerReferenceProvider: () => noopDisposable(),
      registerDocumentSymbolProvider: () => noopDisposable(),
      registerWorkspaceSymbolProvider: () => noopDisposable(),
      registerCodeActionsProvider: () => noopDisposable(),
      registerCodeLensProvider: () => noopDisposable(),
      registerDocumentFormattingEditProvider: () => noopDisposable(),
      registerDocumentRangeFormattingEditProvider: () => noopDisposable(),
      registerOnTypeFormattingEditProvider: () => noopDisposable(),
      registerSignatureHelpProvider: () => noopDisposable(),
      registerRenameProvider: () => noopDisposable(),
      registerFoldingRangeProvider: () => noopDisposable(),
      registerSelectionRangeProvider: () => noopDisposable(),
      registerDocumentHighlightProvider: () => noopDisposable(),
      registerDocumentLinkProvider: () => noopDisposable(),
      registerColorProvider: () => noopDisposable(),
      registerInlayHintsProvider: () => noopDisposable(),
      registerDocumentSemanticTokensProvider: () => noopDisposable(),
      setLanguageConfiguration: () => noopDisposable(),
      setTextDocumentLanguage: async (document: unknown) => document,
      getLanguages: async () => ['plaintext'],
      match: () => 0,
      getDiagnostics: () => [] as unknown[],
      onDidChangeDiagnostics: () => noopDisposable(),
      createDiagnosticCollection: (name?: string) => ({
        name: name ?? '', set: () => undefined, get: () => [], has: () => false, delete: () => undefined, forEach: () => undefined, clear: () => undefined, dispose: () => undefined
      })
    },

    env: {
      appName: 'Lucky',
      appHost: 'desktop',
      appRoot: '',
      language: 'en',
      machineId: 'lucky-ai-client',
      sessionId: 'lucky-ai-client',
      uriScheme: 'lucky-ai',
      shell: process.env.SHELL ?? '',
      uiKind: enums.UIKind.Desktop,
      isNewAppInstall: false,
      isTelemetryEnabled: false,
      clipboard: {
        readText: async () => '',
        writeText: async () => undefined
      },
      openExternal: async (uri: unknown) => { context.emitMessage('info', `openExternal ${String(uri)}`); return true },
      asExternalUri: async (uri: unknown) => uri
    },

    extensions: {
      all: [{ id: context.extension.id, extensionPath: context.extension.path, isActive: true, packageJSON: {} }],
      getExtension: (extensionId: string) => (
        extensionId === context.extension.id
          ? { id: context.extension.id, extensionPath: context.extension.path, extensionUri: Uri.file(context.extension.path), isActive: true, packageJSON: {}, exports: undefined, activate: async () => undefined }
          : undefined
      ),
      onDidChange: () => noopDisposable()
    }
  }
}

/** 构造扩展 activate(context) 收到的 ExtensionContext（形状对齐 VS Code）。 */
export function createExtensionContext(
  extension: ExtensionManifestSummary,
  subscriptions: VscodeDisposable[]
): Record<string, unknown> {
  const extensionUri = Uri.file(extension.path)
  return {
    subscriptions,
    extension: { id: extension.id, extensionPath: extension.path, extensionUri, isActive: true, packageJSON: {} },
    extensionPath: extension.path,
    extensionUri,
    extensionMode: enums.ExtensionMode.Production,
    asAbsolutePath: (relativePath: string) => join(extension.path, relativePath),
    storageUri: undefined,
    storagePath: undefined,
    globalStorageUri: extensionUri,
    globalStoragePath: extension.path,
    logUri: extensionUri,
    logPath: extension.path,
    globalState: createMemento(),
    workspaceState: createMemento(),
    secrets: {
      get: async () => undefined,
      store: async () => undefined,
      delete: async () => undefined,
      onDidChange: () => noopDisposable()
    },
    environmentVariableCollection: {
      persistent: true,
      replace: () => undefined,
      append: () => undefined,
      prepend: () => undefined,
      get: () => undefined,
      forEach: () => undefined,
      delete: () => undefined,
      clear: () => undefined,
      getScoped: () => ({ replace: () => undefined, append: () => undefined, prepend: () => undefined, get: () => undefined, forEach: () => undefined, delete: () => undefined, clear: () => undefined })
    }
  }
}

interface Memento {
  keys: () => readonly string[]
  get: <T>(key: string, defaultValue?: T) => T | undefined
  update: (key: string, value: unknown) => Promise<void>
  setKeysForSync?: (keys: readonly string[]) => void
}

function createMemento(): Memento {
  const data = new Map<string, unknown>()
  return {
    keys: () => [...data.keys()],
    get: <T>(key: string, defaultValue?: T) => (data.has(key) ? (data.get(key) as T) : defaultValue),
    update: async (key: string, value: unknown) => { data.set(key, value) },
    setKeysForSync: () => undefined
  }
}
