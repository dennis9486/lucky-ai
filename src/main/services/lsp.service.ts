import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { access } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import path from 'node:path'
import type { BrowserWindow } from 'electron'
import { IPC_CHANNELS } from '../../shared/constants/ipc-channels.js'
import type {
  LspDiagnostic,
  LspDiagnosticsPayload,
  LspCodeActionRequest,
  LspDocumentSyncRequest,
  LspLanguageSupport,
  LspPositionRequest,
  LspStartRequest,
  LspStartResult
} from '../../shared/types/lsp.js'
import { lspElapsed, lspError, lspLog, lspWarn, shortLspPath } from '../../shared/utils/lsp-log.js'
import { resolveWorkspaceFilePath, toWorkspaceRelativePath } from '../../shared/utils/workspace-path.js'

interface ServerLaunchContext {
  appRoot: string
  workspaceRoot: string
}

interface ServerExecutable {
  command: string
  extraArgs: string[]
  displayName: string
  /** 通过 Electron 二进制以 Node 模式运行（需设置 ELECTRON_RUN_AS_NODE） */
  runAsNode?: boolean
}

interface LanguageServerSpec {
  command: string
  languageIds: string[]
  buildArgs?: (context: ServerLaunchContext) => string[] | Promise<string[]>
  buildInitOptions?: (context: ServerLaunchContext) => Record<string, unknown> | undefined | Promise<Record<string, unknown> | undefined>
}

interface ActiveLanguageServer {
  languageId: string
  workspaceRoot: string
  spec: LanguageServerSpec
  launchArgs: string[]
  initOptions?: Record<string, unknown>
  process: ChildProcessWithoutNullStreams
  initialized: boolean
  nextRequestId: number
  documents: Map<string, { version: number; content: string }>
  pending: Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>
  stdoutBuffer: Buffer
  tsBridge?: TsServerBridge
}

const SERVER_SPECS: LanguageServerSpec[] = [
  {
    command: 'typescript-language-server',
    languageIds: ['typescript', 'javascript'],
    buildArgs: () => ['--stdio'],
    buildInitOptions: async ({ appRoot, workspaceRoot }) => buildVueTypescriptPluginInitOptions(appRoot, workspaceRoot)
  },
  {
    command: 'vue-language-server',
    languageIds: ['vue'],
    buildArgs: async ({ appRoot, workspaceRoot }) => [
      '--stdio',
      `--tsdk=${await resolveTypescriptLibDir(appRoot, workspaceRoot)}`
    ]
  },
  {
    command: 'pyright-langserver',
    buildArgs: () => ['--stdio'],
    languageIds: ['python']
  },
  {
    command: 'gopls',
    buildArgs: () => ['serve'],
    languageIds: ['go']
  },
  {
    command: 'rust-analyzer',
    buildArgs: () => [],
    languageIds: ['rust']
  }
]

const ALLOWED_LSP_REQUESTS = new Set([
  'textDocument/completion',
  'completionItem/resolve',
  'textDocument/hover',
  'textDocument/definition',
  'textDocument/declaration',
  'textDocument/implementation',
  'textDocument/typeDefinition',
  'textDocument/references',
  'textDocument/rename',
  'textDocument/prepareRename',
  'textDocument/documentSymbol',
  'textDocument/documentHighlight',
  'textDocument/selectionRange',
  'textDocument/codeAction',
  'codeAction/resolve',
  'textDocument/formatting',
  'textDocument/rangeFormatting',
  'textDocument/signatureHelp',
  'textDocument/inlayHint',
  'inlayHint/resolve',
  'textDocument/foldingRange',
  'textDocument/documentLink',
  'documentLink/resolve',
  'textDocument/semanticTokens/full',
  'textDocument/semanticTokens/range',
  'workspace/executeCommand'
])

const OPTIONAL_LSP_EMPTY_RESULTS = new Map<string, unknown>([
  ['completionItem/resolve', null],
  ['textDocument/declaration', []],
  ['textDocument/implementation', []],
  ['textDocument/typeDefinition', []],
  ['textDocument/documentSymbol', []],
  ['textDocument/documentHighlight', []],
  ['textDocument/selectionRange', []],
  ['textDocument/codeAction', []],
  ['codeAction/resolve', null],
  ['textDocument/documentLink', []],
  ['documentLink/resolve', null],
  ['textDocument/inlayHint', []],
  ['inlayHint/resolve', null],
  ['textDocument/foldingRange', []],
  ['textDocument/semanticTokens/full', null],
  ['textDocument/semanticTokens/range', null],
  ['textDocument/signatureHelp', null],
  ['textDocument/formatting', []],
  ['textDocument/rangeFormatting', []]
])

const SEMANTIC_TOKEN_TYPES = [
  'namespace',
  'type',
  'class',
  'enum',
  'interface',
  'struct',
  'typeParameter',
  'parameter',
  'variable',
  'property',
  'enumMember',
  'event',
  'function',
  'method',
  'macro',
  'keyword',
  'modifier',
  'comment',
  'string',
  'number',
  'regexp',
  'operator',
  'decorator'
]

const SEMANTIC_TOKEN_MODIFIERS = [
  'declaration',
  'definition',
  'readonly',
  'static',
  'deprecated',
  'abstract',
  'async',
  'modification',
  'documentation',
  'defaultLibrary'
]

class LspService {
  private servers = new Map<string, ActiveLanguageServer>()
  private senderWindow: BrowserWindow | null = null

  setSenderWindow(win: BrowserWindow | null): void {
    this.senderWindow = win
  }

  resolveSpec(languageId: string): LanguageServerSpec | null {
    return SERVER_SPECS.find((spec) => spec.languageIds.includes(languageId)) ?? null
  }

  async start(request: LspStartRequest): Promise<LspStartResult> {
    lspLog('main', 'start requested', {
      languageId: request.languageId,
      workspaceRoot: shortLspPath(request.workspaceRoot)
    })

    const existing = this.servers.get(request.languageId)
    if (existing?.initialized && existing.workspaceRoot === request.workspaceRoot) {
      lspLog('main', 'start reused existing session', {
        languageId: request.languageId,
        server: existing.spec.command
      })
      return {
        languageId: request.languageId,
        running: true,
        serverCommand: existing.spec.command
      }
    }

    if (existing) {
      lspLog('main', 'start replacing existing session', { languageId: request.languageId })
      await this.stop(request.languageId)
    }

    const spec = this.resolveSpec(request.languageId)
    if (!spec) {
      lspWarn('main', 'start unavailable: no server spec', { languageId: request.languageId })
      return {
        languageId: request.languageId,
        running: false,
        error: `No language server configured for ${request.languageId}`
      }
    }

    const executable = await findExecutable(spec.command, request.workspaceRoot)
    if (!executable) {
      lspWarn('main', 'start failed: executable not found', {
        languageId: request.languageId,
        command: spec.command
      })
      return {
        languageId: request.languageId,
        running: false,
        serverCommand: spec.command,
        error: `${spec.command} not found in app/workspace node_modules/.bin or PATH`
      }
    }

    lspLog('main', 'spawn language server', {
      languageId: request.languageId,
      command: executable.displayName,
      cwd: shortLspPath(request.workspaceRoot)
    })

    const launchContext: ServerLaunchContext = {
      appRoot: getAppRoot(),
      workspaceRoot: request.workspaceRoot
    }
    const launchArgs = await (spec.buildArgs?.(launchContext) ?? Promise.resolve(['--stdio']))
    const initOptions = await spec.buildInitOptions?.(launchContext)

    try {
      const child = spawn(executable.command, [...executable.extraArgs, ...launchArgs], {
        cwd: request.workspaceRoot,
        stdio: 'pipe',
        env: executable.runAsNode
          ? { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
          : process.env
      })
      if (!child.stdout || !child.stdin || !child.stderr) {
        throw new Error(`Failed to start ${spec.command}`)
      }

      const session: ActiveLanguageServer = {
        languageId: request.languageId,
        workspaceRoot: request.workspaceRoot,
        spec,
        launchArgs,
        initOptions,
        process: child as ChildProcessWithoutNullStreams,
        initialized: false,
        nextRequestId: 1,
        documents: new Map(),
        pending: new Map(),
        stdoutBuffer: Buffer.alloc(0)
      }

      child.stdout.on('data', (chunk: Buffer) => {
        session.stdoutBuffer = Buffer.concat([session.stdoutBuffer, chunk])
        this.drainStdout(session)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        const text = chunk.toString('utf8').trim()
        if (text) lspLog('main', `stderr ${spec.command}`, { text })
      })
      // 未监听 'error' 会让 spawn 失败（ENOENT/EACCES）抛成未捕获异常，进而崩溃主进程
      child.on('error', (error: Error) => {
        lspError('main', `process error ${spec.command}`, { error: error.message })
        this.terminate(request.languageId, error)
      })
      child.on('exit', (code, signal) => {
        const reason = new Error(
          `Language server ${spec.command} exited (code=${code ?? 'null'}, signal=${signal ?? 'null'})`
        )
        lspWarn('main', 'language server exited', {
          languageId: request.languageId,
          command: spec.command,
          code,
          signal
        })
        this.terminate(request.languageId, reason)
      })

      this.servers.set(request.languageId, session)
      await this.initialize(session)

      lspLog('main', 'start completed', {
        languageId: request.languageId,
        server: executable.displayName
      })
      return {
        languageId: request.languageId,
        running: true,
        serverCommand: executable.displayName
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      lspError('main', 'start failed', { languageId: request.languageId, error: message })
      return {
        languageId: request.languageId,
        running: false,
        serverCommand: spec.command,
        error: message
      }
    }
  }

  async stop(languageId: string): Promise<void> {
    lspLog('main', 'stop requested', { languageId })
    this.terminate(languageId)
  }

  /** 统一回收：删除会话、拒绝所有挂起请求、清理文档并结束进程（幂等） */
  private terminate(languageId: string, reason?: Error): void {
    const session = this.servers.get(languageId)
    if (!session) return
    lspLog('main', 'terminate session', {
      languageId,
      command: session.spec.command,
      reason: reason?.message
    })
    this.servers.delete(languageId)
    const error = reason ?? new Error(`Language server ${session.spec.command} stopped`)
    for (const pending of session.pending.values()) pending.reject(error)
    session.pending.clear()
    session.documents.clear()
    session.initialized = false
    session.tsBridge?.dispose()
    try {
      session.process.kill()
    } catch {
      // 进程可能已退出
    }
  }

  async syncDocument(request: LspDocumentSyncRequest): Promise<void> {
    const session = this.servers.get(request.languageId)
    if (!session?.initialized) {
      lspWarn('main', 'syncDocument skipped: session not ready', {
        languageId: request.languageId,
        action: request.action,
        path: shortLspPath(request.path)
      })
      return
    }

    lspLog('main', `document ${request.action}`, {
      languageId: request.languageId,
      path: shortLspPath(request.path),
      version: request.version,
      chars: request.content.length
    })

    const absPath = resolveWorkspaceFilePath(request.path, session.workspaceRoot)
    const uri = pathToFileURL(absPath).href
    if (request.action === 'close') {
      session.documents.delete(absPath)
      session.tsBridge?.closeDocument(absPath)
      await this.notify(session, 'textDocument/didClose', {
        textDocument: { uri }
      })
      return
    }

    const previous = session.documents.get(absPath)
    session.documents.set(absPath, { version: request.version, content: request.content })
    session.tsBridge?.syncDocument(absPath, request.content, request.languageId, previous?.content)

    if (request.action === 'open' || !previous) {
      await this.notify(session, 'textDocument/didOpen', {
        textDocument: {
          uri,
          languageId: request.languageId,
          version: request.version,
          text: request.content
        }
      })
      return
    }

    await this.notify(session, 'textDocument/didChange', {
      textDocument: { uri, version: request.version },
      contentChanges: [{ text: request.content }]
    })
  }

  getStatus(languageId: string): LspLanguageSupport {
    const session = this.servers.get(languageId)
    if (!session) {
      const spec = this.resolveSpec(languageId)
      return {
        languageId,
        status: spec ? 'idle' : 'unavailable'
      }
    }
    return {
      languageId,
      status: session.initialized ? 'running' : 'starting',
      serverCommand: session.spec.command
    }
  }

  async hover(request: LspPositionRequest): Promise<unknown> {
    return this.textDocumentPositionRequest(request, 'textDocument/hover')
  }

  async definition(request: LspPositionRequest): Promise<unknown> {
    return this.textDocumentPositionRequest(request, 'textDocument/definition')
  }

  async references(request: LspPositionRequest & { includeDeclaration?: boolean }): Promise<unknown> {
    return this.textDocumentPositionRequest(request, 'textDocument/references', {
      context: { includeDeclaration: request.includeDeclaration ?? true }
    })
  }

  async lspRequest(languageId: string, method: string, params: unknown): Promise<unknown> {
    if (!ALLOWED_LSP_REQUESTS.has(method)) {
      throw new Error(`Unsupported LSP request: ${method}`)
    }
    lspLog('main', 'request', { languageId, method })
    const session = this.requireSession(languageId)
    // 渲染端用 model.uri.toString() 传 uri，didOpen 用 pathToFileURL(path)。
    // 两者编码可能不一致，导致服务端认为文档未打开而返回空。这里统一规范化为 didOpen 的形式。
    const normalizedParams = normalizeParamUris(params, session.workspaceRoot)
    const result = await this.requestOptional(session, method, normalizedParams)
    if (!isEmptyLspResult(result)) return result
    return await this.tryVueTsBridgeFallback(session, method, normalizedParams) ?? result
  }

  async codeAction(request: LspCodeActionRequest): Promise<unknown> {
    const session = this.requireSession(request.languageId)
    const absPath = resolveWorkspaceFilePath(request.path, session.workspaceRoot)
    const uri = pathToFileURL(absPath).href
    return this.request(session, 'textDocument/codeAction', {
      textDocument: { uri },
      range: {
        start: { line: Math.max(0, request.lineNumber - 1), character: Math.max(0, request.column - 1) },
        end: {
          line: Math.max(0, (request.endLineNumber ?? request.lineNumber) - 1),
          character: Math.max(0, (request.endColumn ?? request.column) - 1)
        }
      },
      context: {
        diagnostics: request.diagnostics ?? []
      }
    })
  }

  private async textDocumentPositionRequest(
    request: LspPositionRequest,
    method: string,
    extraParams: Record<string, unknown> = {}
  ): Promise<unknown> {
    const session = this.requireSession(request.languageId)
    const absPath = resolveWorkspaceFilePath(request.path, session.workspaceRoot)
    const params = {
      textDocument: { uri: pathToFileURL(absPath).href },
      position: {
        line: Math.max(0, request.lineNumber - 1),
        character: Math.max(0, request.column - 1)
      },
      ...extraParams
    }
    const result = await this.requestOptional(session, method, params)
    if (!isEmptyLspResult(result)) return result
    return await this.tryVueTsBridgeFallback(session, method, params) ?? result
  }

  private requireSession(languageId: string): ActiveLanguageServer {
    const session = this.servers.get(languageId)
    if (!session?.initialized) throw new Error(`Language server is not running for ${languageId}`)
    return session
  }

  private async initialize(session: ActiveLanguageServer): Promise<void> {
    const startedAt = Date.now()
    lspLog('main', 'initialize', {
      languageId: session.languageId,
      command: session.spec.command,
      workspaceRoot: shortLspPath(session.workspaceRoot)
    })
    const rootUri = pathToFileURL(session.workspaceRoot).href
    await this.request(session, 'initialize', {
      processId: process.pid,
      rootUri,
      workspaceFolders: [{
        uri: rootUri,
        name: path.basename(session.workspaceRoot)
      }],
      ...(session.initOptions ? { initializationOptions: session.initOptions } : {}),
      capabilities: {
        workspace: {
          applyEdit: true,
          workspaceEdit: {
            documentChanges: true,
            resourceOperations: ['create', 'rename', 'delete'],
            failureHandling: 'textOnlyTransactional'
          },
          symbol: { dynamicRegistration: false },
          executeCommand: { dynamicRegistration: false }
        },
        textDocument: {
          synchronization: { dynamicRegistration: false },
          publishDiagnostics: { relatedInformation: true },
          completion: {
            dynamicRegistration: false,
            completionItem: {
              snippetSupport: true,
              commitCharactersSupport: true,
              documentationFormat: ['markdown', 'plaintext'],
              deprecatedSupport: true,
              preselectSupport: true,
              insertReplaceSupport: true,
              labelDetailsSupport: true
            },
            contextSupport: true
          },
          hover: { contentFormat: ['markdown', 'plaintext'] },
          signatureHelp: {
            dynamicRegistration: false,
            signatureInformation: {
              documentationFormat: ['markdown', 'plaintext'],
              parameterInformation: { labelOffsetSupport: true }
            }
          },
          definition: { dynamicRegistration: false, linkSupport: true },
          declaration: { dynamicRegistration: false, linkSupport: true },
          implementation: { dynamicRegistration: false, linkSupport: true },
          typeDefinition: { dynamicRegistration: false, linkSupport: true },
          references: { dynamicRegistration: false },
          rename: { prepareSupport: true },
          documentSymbol: {
            dynamicRegistration: false,
            hierarchicalDocumentSymbolSupport: true
          },
          documentHighlight: { dynamicRegistration: false },
          selectionRange: { dynamicRegistration: false },
          codeAction: {
            dynamicRegistration: false,
            dataSupport: true,
            resolveSupport: {
              properties: ['edit', 'command']
            },
            codeActionLiteralSupport: {
              codeActionKind: {
                valueSet: [
                  '',
                  'quickfix',
                  'refactor',
                  'refactor.extract',
                  'refactor.inline',
                  'refactor.rewrite',
                  'source',
                  'source.organizeImports'
                ]
              }
            },
            isPreferredSupport: true,
            disabledSupport: true
          },
          formatting: { dynamicRegistration: false },
          rangeFormatting: { dynamicRegistration: false },
          foldingRange: {
            dynamicRegistration: false,
            lineFoldingOnly: true
          },
          documentLink: { dynamicRegistration: false, tooltipSupport: true },
          inlayHint: {
            dynamicRegistration: false,
            resolveSupport: {
              properties: ['tooltip', 'textEdits', 'label.tooltip', 'label.location', 'label.command']
            }
          },
          semanticTokens: {
            dynamicRegistration: false,
            tokenTypes: SEMANTIC_TOKEN_TYPES,
            tokenModifiers: SEMANTIC_TOKEN_MODIFIERS,
            formats: ['relative'],
            requests: {
              full: { delta: true },
              range: true
            },
            overlappingTokenSupport: false,
            multilineTokenSupport: true
          }
        }
      }
    })
    await this.notify(session, 'initialized', {})
    session.initialized = true
    lspLog('main', 'initialize completed', {
      languageId: session.languageId,
      ms: lspElapsed(startedAt)
    })
  }

  private drainStdout(session: ActiveLanguageServer): void {
    while (true) {
      const headerEnd = session.stdoutBuffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return

      const header = session.stdoutBuffer.subarray(0, headerEnd).toString('ascii')
      const match = /Content-Length:\s*(\d+)/i.exec(header)
      if (!match) {
        session.stdoutBuffer = session.stdoutBuffer.subarray(headerEnd + 4)
        continue
      }

      const length = Number(match[1])
      const bodyStart = headerEnd + 4
      if (session.stdoutBuffer.length < bodyStart + length) return

      const body = session.stdoutBuffer.subarray(bodyStart, bodyStart + length).toString('utf8')
      session.stdoutBuffer = session.stdoutBuffer.subarray(bodyStart + length)

      try {
        const message = JSON.parse(body) as Record<string, unknown>
        this.handleServerMessage(session, message)
      } catch (error) {
        lspWarn('main', 'ignored malformed LSP payload', {
          languageId: session.languageId,
          error: error instanceof Error ? error.message : String(error)
        })
      }
    }
  }

  private handleServerMessage(session: ActiveLanguageServer, message: Record<string, unknown>): void {
    const method = typeof message.method === 'string' ? message.method : null
    const hasId = typeof message.id === 'number' || typeof message.id === 'string'

    // 服务端发起的请求（同时带 id 与 method）：必须回复，否则部分服务端会阻塞后续能力
    if (hasId && method) {
      this.handleServerRequest(session, message.id as number | string, method, message.params)
      return
    }

    // 对我们请求的响应（带 id、无 method）
    if (hasId) {
      const pendingKey = typeof message.id === 'number' ? message.id : Number(message.id)
      const pending = session.pending.get(pendingKey)
      if (pending) {
        session.pending.delete(pendingKey)
        if (message.error) {
          const payload = message.error as { message?: string }
          lspWarn('main', 'response error', {
            languageId: session.languageId,
            id: message.id,
            error: payload.message ?? 'LSP request failed'
          })
          pending.reject(new Error(payload.message ?? 'LSP request failed'))
        } else {
          pending.resolve(message.result)
        }
      }
      return
    }

    // Volar 3 通过 tsserver/request 通知把 Vue 相关 TS 请求转交给客户端。
    // 如果不响应，hover / definition / codeAction 会一直等待到超时。
    if (method === 'tsserver/request') {
      void this.handleTsServerRequest(session, message.params)
      return
    }

    // 服务端通知（仅 method）
    if (method !== 'textDocument/publishDiagnostics') {
      if (method) {
        lspLog('main', 'notification', { languageId: session.languageId, method })
      }
      return
    }
    const params = message.params as {
      uri?: string
      diagnostics?: Array<{
        message?: string
        severity?: number
        source?: string
        code?: string | number
        range?: {
          start?: { line?: number; character?: number }
          end?: { line?: number; character?: number }
        }
      }>
    } | undefined
    if (!params?.uri) return

    const absPath = resolveWorkspaceFilePath(fileURLToPathSafe(params.uri), session.workspaceRoot)
    const filePath = toWorkspaceRelativePath(absPath, session.workspaceRoot) || absPath
    const diagnostics: LspDiagnostic[] = (params.diagnostics ?? []).map((item) => ({
      message: item.message ?? '',
      severity: normalizeSeverity(item.severity),
      startLineNumber: (item.range?.start?.line ?? 0) + 1,
      startColumn: (item.range?.start?.character ?? 0) + 1,
      endLineNumber: (item.range?.end?.line ?? 0) + 1,
      endColumn: (item.range?.end?.character ?? 0) + 1,
      source: item.source,
      code: item.code
    }))

    this.emitDiagnostics({
      languageId: session.languageId,
      path: filePath,
      diagnostics
    })
    lspLog('main', 'publishDiagnostics', {
      languageId: session.languageId,
      path: shortLspPath(filePath),
      count: diagnostics.length
    })
  }

  private emitDiagnostics(payload: LspDiagnosticsPayload): void {
    const win = this.senderWindow
    if (!win || win.isDestroyed()) {
      lspWarn('main', 'diagnostics dropped: no sender window', {
        path: shortLspPath(payload.path),
        count: payload.diagnostics.length
      })
      return
    }
    lspLog('main', 'emit diagnostics to renderer', {
      path: shortLspPath(payload.path),
      count: payload.diagnostics.length
    })
    win.webContents.send(IPC_CHANNELS.LSP_DIAGNOSTICS, payload)
  }

  private forwardApplyEdit(session: ActiveLanguageServer, params: unknown): void {
    const win = this.senderWindow
    if (!win || win.isDestroyed()) {
      lspWarn('main', 'applyEdit dropped: no sender window', { languageId: session.languageId })
      return
    }
    const edit = params && typeof params === 'object' && 'edit' in params
      ? (params as { edit?: unknown }).edit
      : params
    lspLog('main', 'forward applyEdit to renderer', { languageId: session.languageId })
    win.webContents.send(IPC_CHANNELS.LSP_APPLY_EDIT, {
      languageId: session.languageId,
      edit
    })
  }

  private async handleTsServerRequest(session: ActiveLanguageServer, params: unknown): Promise<void> {
    const request = normalizeTsServerRequest(params)
    if (!request) {
      lspWarn('main', 'invalid tsserver/request payload', { languageId: session.languageId })
      return
    }

    try {
      const bridge = await this.ensureTsBridge(session)
      const result = await bridge.request(request.command, request.args)
      await this.notify(session, 'tsserver/response', [request.requestId, result])
    } catch (error) {
      lspWarn('main', 'tsserver/request failed', {
        languageId: session.languageId,
        command: request.command,
        error: error instanceof Error ? error.message : String(error)
      })
      await this.notify(session, 'tsserver/response', [request.requestId, null])
    }
  }

  private async ensureTsBridge(session: ActiveLanguageServer): Promise<TsServerBridge> {
    if (session.tsBridge) return session.tsBridge
    const bridge = new TsServerBridge({
      workspaceRoot: session.workspaceRoot,
      appRoot: getAppRoot()
    })
    session.tsBridge = bridge
    for (const [filePath, document] of session.documents.entries()) {
      bridge.syncDocument(filePath, document.content, session.languageId)
    }
    await bridge.start()
    return bridge
  }

  private async tryVueTsBridgeFallback(
    session: ActiveLanguageServer,
    method: string,
    params: unknown
  ): Promise<unknown | undefined> {
    if (session.languageId !== 'vue') return undefined
    const position = extractTsPositionParams(params, session.workspaceRoot)
    if (!position) return undefined

    try {
      const bridge = await this.ensureTsBridge(session)
      if (method === 'textDocument/hover') {
        const info = await bridge.request('quickinfo', position)
        return tsQuickInfoToLspHover(info)
      }
      if (method === 'textDocument/definition') {
        const definition = await bridge.request('definition', position)
        return tsDefinitionsToLspLocations(definition)
      }
      if (method === 'textDocument/implementation') {
        const implementation = await bridge.request('implementation', position)
        return tsDefinitionsToLspLocations(implementation)
      }
      if (method === 'textDocument/typeDefinition') {
        const typeDefinition = await bridge.request('typeDefinition', position)
        return tsDefinitionsToLspLocations(typeDefinition)
      }
      if (method === 'textDocument/references') {
        const references = await bridge.request('references', position)
        return tsReferencesToLspLocations(references)
      }
      if (method === 'textDocument/completion') {
        const completion = await bridge.request('completionInfo', {
          ...position,
          includeExternalModuleExports: true,
          includeInsertTextCompletions: true
        })
        return tsCompletionInfoToLspCompletionList(completion)
      }
    } catch (error) {
      lspWarn('main', 'vue tsserver fallback failed', {
        method,
        error: error instanceof Error ? error.message : String(error)
      })
    }

    return undefined
  }

  private async requestOptional(session: ActiveLanguageServer, method: string, params: unknown): Promise<unknown> {
    try {
      return await this.request(session, method, params)
    } catch (error) {
      if (isOptionalLspUnsupported(method, error)) {
        lspLog('main', 'optional request unsupported', { languageId: session.languageId, method })
        return OPTIONAL_LSP_EMPTY_RESULTS.get(method)
      }
      throw error
    }
  }

  /** 回应服务端发起的请求；未知请求按 JSON-RPC 规范返回 method-not-found，避免服务端无限等待 */
  private handleServerRequest(
    session: ActiveLanguageServer,
    id: number | string,
    method: string,
    params: unknown
  ): void {
    lspLog('main', 'server request', {
      languageId: session.languageId,
      id,
      method
    })
    switch (method) {
      case 'workspace/configuration': {
        const items = Array.isArray((params as { items?: unknown[] })?.items)
          ? (params as { items: unknown[] }).items
          : []
        // 暂不提供按项配置，返回与请求数量一致的 null 表示使用默认值
        this.respond(session, id, items.map(() => null))
        return
      }
      case 'workspace/workspaceFolders': {
        const uri = pathToFileURL(session.workspaceRoot).href
        this.respond(session, id, [{ uri, name: path.basename(session.workspaceRoot) }])
        return
      }
      case 'workspace/applyEdit':
        this.forwardApplyEdit(session, params)
        this.respond(session, id, { applied: true })
        return
      case 'window/showDocument':
        this.respond(session, id, { success: false })
        return
      case 'client/registerCapability':
      case 'client/unregisterCapability':
      case 'window/workDoneProgress/create':
      case 'window/showMessageRequest':
      case 'workspace/semanticTokens/refresh':
      case 'workspace/inlayHint/refresh':
      case 'workspace/codeLens/refresh':
      case 'workspace/diagnostic/refresh':
        this.respond(session, id, null)
        return
      default:
        lspWarn('main', 'unhandled server request', {
          languageId: session.languageId,
          id,
          method
        })
        this.respondError(session, id, -32601, `Unhandled server request: ${method}`)
    }
  }

  private respond(session: ActiveLanguageServer, id: number | string, result: unknown): void {
    this.writeMessage(session, { jsonrpc: '2.0', id, result })
  }

  private respondError(session: ActiveLanguageServer, id: number | string, code: number, message: string): void {
    this.writeMessage(session, { jsonrpc: '2.0', id, error: { code, message } })
  }

  private request(session: ActiveLanguageServer, method: string, params: unknown): Promise<unknown> {
    const id = session.nextRequestId++
    const startedAt = Date.now()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        session.pending.delete(id)
        lspError('main', 'request timeout', {
          languageId: session.languageId,
          method,
          id,
          ms: lspElapsed(startedAt)
        })
        reject(new Error(`LSP request timeout: ${method}`))
      }, 15000)
      session.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout)
          lspLog('main', 'request completed', {
            languageId: session.languageId,
            method,
            id,
            ms: lspElapsed(startedAt)
          })
          resolve(value)
        },
        reject: (error) => {
          clearTimeout(timeout)
          lspError('main', 'request rejected', {
            languageId: session.languageId,
            method,
            id,
            ms: lspElapsed(startedAt),
            error: error.message
          })
          reject(error)
        }
      })
      this.writeMessage(session, { jsonrpc: '2.0', id, method, params })
    })
  }

  private notify(session: ActiveLanguageServer, method: string, params: unknown): Promise<void> {
    lspLog('main', 'notify', { languageId: session.languageId, method })
    const normalizedParams = method === 'tsserver/response' ? [params] : params
    this.writeMessage(session, { jsonrpc: '2.0', method, params: normalizedParams })
    return Promise.resolve()
  }

  private writeMessage(session: ActiveLanguageServer, message: Record<string, unknown>): void {
    const stdin = session.process.stdin
    if (!stdin || stdin.destroyed || !stdin.writable) return
    const body = JSON.stringify(message)
    try {
      stdin.write(`Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n${body}`)
    } catch (error) {
      lspError('main', 'failed to write stdin', {
        languageId: session.languageId,
        error: error instanceof Error ? error.message : String(error)
      })
    }
  }
}

function normalizeSeverity(value: number | undefined): LspDiagnostic['severity'] {
  if (value === 1 || value === 2 || value === 3 || value === 4) return value
  return 2
}

function fileURLToPathSafe(uri: string): string {
  try {
    const url = new URL(uri)
    if (url.protocol === 'file:') {
      return decodeURIComponent(url.pathname)
    }
    return uri
  } catch {
    return uri
  }
}

/** 把 file: URI 规范化为与 didOpen 一致的 pathToFileURL 形式（消除渲染端/主进程编码差异） */
function canonicalFileUri(uri: string, workspaceRoot?: string): string {
  if (!uri.startsWith('file:')) return uri
  try {
    const absPath = resolveWorkspaceFilePath(fileURLToPathSafe(uri), workspaceRoot)
    return pathToFileURL(absPath).href
  } catch {
    return uri
  }
}

/** 递归规范化参数对象里所有 `uri` 字段，确保功能请求命中已打开的文档 */
function normalizeParamUris(value: unknown, workspaceRoot?: string): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeParamUris(item, workspaceRoot))
  if (value && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = key === 'uri' && typeof item === 'string'
        ? canonicalFileUri(item, workspaceRoot)
        : normalizeParamUris(item, workspaceRoot)
    }
    return result
  }
  return value
}

async function findExecutable(command: string, workspaceRoot?: string): Promise<ServerExecutable | null> {
  // 优先把已安装的 JS 语言服务器解析为入口文件，并用 Electron 的 Node 模式运行。
  // 这样不依赖系统 PATH 中的 node —— 从 Finder / 打包应用启动时 PATH 往往不含 node，
  // 直接执行 node_modules/.bin 的 shim（其 shebang 为 `#!/usr/bin/env node`）会失败。
  const packageBin = await resolvePackageBin(command, workspaceRoot)
  if (packageBin) {
    return {
      command: process.execPath,
      extraArgs: [packageBin],
      displayName: `node ${packageBin}`,
      runAsNode: true
    }
  }

  // 原生可执行（gopls / rust-analyzer 等）回退到 .bin 与 PATH 查找
  const pathEnv = process.env.PATH ?? ''
  const segments = [
    ...localBinSegments(workspaceRoot),
    ...localBinSegments(getAppRoot()),
    ...pathEnv.split(path.delimiter).filter(Boolean)
  ]
  const extensions = process.platform === 'win32' ? ['', '.cmd', '.exe', '.bat'] : ['']

  for (const segment of [...new Set(segments)]) {
    for (const extension of extensions) {
      const candidate = path.join(segment, `${command}${extension}`)
      try {
        await access(candidate)
        return { command: candidate, extraArgs: [], displayName: candidate }
      } catch {
        // continue
      }
    }
  }

  return null
}

const PACKAGE_BIN_MAP: Record<string, string> = {
  'typescript-language-server': 'typescript-language-server',
  'vue-language-server': '@vue/language-server'
}

async function resolvePackageBin(command: string, workspaceRoot?: string): Promise<string | null> {
  const pkgName = PACKAGE_BIN_MAP[command]
  if (!pkgName) return null

  const roots = [...new Set([workspaceRoot, getAppRoot(), process.cwd()].filter(Boolean))] as string[]
  for (const root of roots) {
    const candidate = path.join(root, 'node_modules', pkgName, 'package.json')
    try {
      await access(candidate)
      const require = createRequire(pathToFileURL(candidate).href)
      const pkg = require(candidate) as { bin?: Record<string, string> | string }
      const binRelative = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.[command]
      if (!binRelative) continue
      const binPath = path.join(path.dirname(candidate), binRelative)
      await access(binPath)
      return binPath
    } catch {
      // try next root
    }
  }
  return null
}

function getAppRoot(): string {
  let current = path.dirname(fileURLToPath(import.meta.url))
  while (true) {
    const pkgPath = path.join(current, 'package.json')
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { name?: string }
      if (pkg.name === 'lucky-ai-client') return current
    } catch {
      // keep walking up
    }
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '../../..')
}

async function resolveTypescriptLibDir(appRoot: string, workspaceRoot: string): Promise<string> {
  for (const root of [workspaceRoot, appRoot]) {
    const candidate = path.join(root, 'node_modules/typescript/lib')
    try {
      await access(candidate)
      return candidate
    } catch {
      // try next root
    }
  }
  return path.join(appRoot, 'node_modules/typescript/lib')
}

async function buildVueTypescriptPluginInitOptions(
  appRoot: string,
  workspaceRoot: string
): Promise<Record<string, unknown> | undefined> {
  for (const root of [workspaceRoot, appRoot]) {
    const pluginRoot = path.join(root, 'node_modules/@vue/language-server')
    try {
      await access(pluginRoot)
      return {
        plugins: [{
          name: '@vue/typescript-plugin',
          location: pluginRoot,
          languages: ['vue']
        }]
      }
    } catch {
      // try next root
    }
  }
  return undefined
}

function localBinSegments(workspaceRoot?: string): string[] {
  const segments: string[] = []
  for (const root of [workspaceRoot, getAppRoot(), process.cwd()].filter((value): value is string => Boolean(value))) {
    let current = path.resolve(root)
    while (true) {
      segments.push(path.join(current, 'node_modules', '.bin'))
      const parent = path.dirname(current)
      if (parent === current) break
      current = parent
    }
  }
  return segments
}

export const lspService = new LspService()

interface TsServerBridgeOptions {
  workspaceRoot: string
  appRoot: string
}

interface NormalizedTsServerRequest {
  requestId: number | string
  command: string
  args: unknown
}

interface TsServerPendingRequest {
  command: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: ReturnType<typeof setTimeout>
}

class TsServerBridge {
  private process: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = Buffer.alloc(0)
  private nextSeq = 1
  private readonly pending = new Map<number, TsServerPendingRequest>()
  private readonly openDocuments = new Map<string, { content: string; languageId: string }>()
  private startPromise: Promise<void> | null = null

  constructor(private readonly options: TsServerBridgeOptions) {}

  async start(): Promise<void> {
    if (this.process) return
    if (this.startPromise) return this.startPromise

    this.startPromise = this.startInternal()
    return this.startPromise
  }

  syncDocument(filePath: string, content: string, languageId: string, previousContent?: string): void {
    this.openDocuments.set(filePath, { content, languageId })
    if (!this.process) return

    if (previousContent === undefined) {
      this.send('open', this.openDocumentArgs(filePath, content, languageId))
      return
    }

    this.send('updateOpen', {
      changedFiles: [{
        fileName: filePath,
        textChanges: [{
          start: { line: 0, offset: 0 },
          end: documentEndPosition(previousContent),
          newText: content
        }]
      }]
    })
  }

  closeDocument(filePath: string): void {
    this.openDocuments.delete(filePath)
    if (!this.process) return
    this.send('updateOpen', { closedFiles: [filePath] })
  }

  async request(command: string, args: unknown): Promise<unknown> {
    await this.start()
    return this.sendRequest(command, args)
  }

  dispose(): void {
    for (const [seq, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout)
      pending.reject(new Error(`TypeScript server stopped before ${pending.command} completed`))
      this.pending.delete(seq)
    }
    this.openDocuments.clear()
    const child = this.process
    this.process = null
    this.startPromise = null
    try {
      child?.kill()
    } catch {
      // ignore
    }
  }

  private async startInternal(): Promise<void> {
    const tsserver = await resolveTsServerPath(this.options.appRoot, this.options.workspaceRoot)
    const vuePluginRoot = await resolveVueTypescriptPluginRoot(this.options.appRoot, this.options.workspaceRoot)
    const args = [
      tsserver,
      '--useInferredProjectPerProjectRoot',
      '--globalPlugins',
      '@vue/typescript-plugin',
      '--pluginProbeLocations',
      vuePluginRoot
    ]

    const child = spawn(process.execPath, args, {
      cwd: this.options.workspaceRoot,
      stdio: 'pipe',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
    })
    this.process = child as ChildProcessWithoutNullStreams

    child.stdout.on('data', (chunk: Buffer) => {
      this.stdoutBuffer = Buffer.concat([this.stdoutBuffer, chunk])
      this.drainStdout()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8').trim()
      if (text) lspLog('main', 'tsserver stderr', { text })
    })
    child.on('error', (error: Error) => {
      lspError('main', 'tsserver bridge process error', { error: error.message })
      this.dispose()
    })
    child.on('exit', (code, signal) => {
      lspWarn('main', 'tsserver bridge exited', { code, signal })
      this.dispose()
    })

    this.send('configure', {
      hostInfo: 'lucky-ai-client',
      preferences: {}
    })
    for (const [filePath, document] of this.openDocuments.entries()) {
      this.send('open', this.openDocumentArgs(filePath, document.content, document.languageId))
    }
  }

  private openDocumentArgs(filePath: string, content: string, languageId: string): Record<string, unknown> {
    return {
      file: filePath,
      fileContent: content,
      projectRootPath: this.options.workspaceRoot,
      scriptKindName: scriptKindNameForLanguage(languageId, filePath)
    }
  }

  private sendRequest(command: string, args: unknown): Promise<unknown> {
    const seq = this.send(command, args)
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(seq)
        reject(new Error(`TypeScript server request timeout: ${command}`))
      }, 15000)
      this.pending.set(seq, { command, resolve, reject, timeout })
    })
  }

  private send(command: string, args: unknown): number {
    const child = this.process
    const seq = this.nextSeq++
    if (!child?.stdin || child.stdin.destroyed || !child.stdin.writable) return seq
    const body = JSON.stringify({
      seq,
      type: 'request',
      command,
      arguments: args
    })
    // tsserver stdin is newline-delimited JSON, while stdout is Content-Length framed.
    child.stdin.write(`${body}\n`)
    return seq
  }

  private drainStdout(): void {
    while (true) {
      const headerEnd = this.stdoutBuffer.indexOf('\r\n\r\n')
      if (headerEnd < 0) return
      const header = this.stdoutBuffer.subarray(0, headerEnd).toString('ascii')
      const match = /Content-Length:\s*(\d+)/i.exec(header)
      if (!match) {
        this.stdoutBuffer = this.stdoutBuffer.subarray(headerEnd + 4)
        continue
      }

      const length = Number(match[1])
      const bodyStart = headerEnd + 4
      if (this.stdoutBuffer.length < bodyStart + length) return

      const body = this.stdoutBuffer.subarray(bodyStart, bodyStart + length).toString('utf8')
      this.stdoutBuffer = this.stdoutBuffer.subarray(bodyStart + length)
      this.handleMessage(body)
    }
  }

  private handleMessage(body: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(body) as Record<string, unknown>
    } catch (error) {
      lspWarn('main', 'ignored malformed tsserver payload', {
        error: error instanceof Error ? error.message : String(error)
      })
      return
    }

    if (message.type !== 'response') return
    const seq = typeof message.request_seq === 'number' ? message.request_seq : null
    if (seq === null) return
    const pending = this.pending.get(seq)
    if (!pending) return
    this.pending.delete(seq)
    clearTimeout(pending.timeout)

    if (message.success === false) {
      pending.reject(new Error(typeof message.message === 'string' ? message.message : `${pending.command} failed`))
      return
    }
    pending.resolve(message.body ?? null)
  }
}

async function resolveTsServerPath(appRoot: string, workspaceRoot: string): Promise<string> {
  for (const root of [workspaceRoot, appRoot]) {
    const candidate = path.join(root, 'node_modules/typescript/lib/tsserver.js')
    try {
      await access(candidate)
      return candidate
    } catch {
      // try next root
    }
  }
  return path.join(appRoot, 'node_modules/typescript/lib/tsserver.js')
}

async function resolveVueTypescriptPluginRoot(appRoot: string, workspaceRoot: string): Promise<string> {
  for (const root of [workspaceRoot, appRoot]) {
    const candidate = path.join(root, 'node_modules/@vue/language-server')
    try {
      await access(candidate)
      return candidate
    } catch {
      // try next root
    }
  }
  return path.join(appRoot, 'node_modules/@vue/language-server')
}

function normalizeTsServerRequest(params: unknown): NormalizedTsServerRequest | null {
  const payload = Array.isArray(params) && Array.isArray(params[0]) ? params[0] : params
  if (Array.isArray(payload)) {
    const [requestId, command, args] = payload
    if ((typeof requestId === 'number' || typeof requestId === 'string') && typeof command === 'string') {
      return { requestId, command, args }
    }
    return null
  }

  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    const requestId = record.requestId ?? record.id
    const command = record.command
    if ((typeof requestId === 'number' || typeof requestId === 'string') && typeof command === 'string') {
      return {
        requestId,
        command,
        args: record.args ?? record.arguments
      }
    }
  }

  return null
}

function isEmptyLspResult(result: unknown): boolean {
  if (result === null || result === undefined) return true
  if (Array.isArray(result)) return result.length === 0
  if (typeof result === 'object') {
    const record = result as Record<string, unknown>
    if (Array.isArray(record.items)) return record.items.length === 0
    if ('contents' in record) return !record.contents
  }
  return false
}

function isOptionalLspUnsupported(method: string, error: unknown): boolean {
  if (!OPTIONAL_LSP_EMPTY_RESULTS.has(method)) return false
  const message = error instanceof Error ? error.message : String(error)
  return /Unhandled method|method not found|not supported|not implemented|unknown request/i.test(message)
}

function extractTsPositionParams(params: unknown, workspaceRoot: string): { file: string; line: number; offset: number } | null {
  if (!params || typeof params !== 'object') return null
  const record = params as Record<string, unknown>
  const textDocument = record.textDocument as { uri?: string } | undefined
  const position = record.position as { line?: number; character?: number } | undefined
  if (!textDocument?.uri || typeof position?.line !== 'number' || typeof position.character !== 'number') return null

  return {
    file: resolveWorkspaceFilePath(fileURLToPathSafe(textDocument.uri), workspaceRoot),
    line: Math.max(1, position.line + 1),
    offset: Math.max(1, position.character + 1)
  }
}

function tsQuickInfoToLspHover(info: unknown): unknown | undefined {
  if (!info || typeof info !== 'object') return undefined
  const record = info as Record<string, unknown>
  const display = typeof record.displayString === 'string' ? record.displayString.trim() : ''
  const documentation = typeof record.documentation === 'string' ? record.documentation.trim() : ''
  if (!display && !documentation) return undefined
  const value = [
    display ? `\`\`\`ts\n${display}\n\`\`\`` : '',
    documentation
  ].filter(Boolean).join('\n\n')
  return {
    contents: {
      kind: 'markdown',
      value
    }
  }
}

function tsDefinitionsToLspLocations(definitions: unknown): unknown | undefined {
  const items = Array.isArray(definitions) ? definitions : []
  if (items.length === 0) return undefined
  return tsLocationItemsToLspLocations(items)
}

function tsReferencesToLspLocations(references: unknown): unknown | undefined {
  const refs = references && typeof references === 'object'
    ? (references as { refs?: unknown[] }).refs
    : undefined
  if (!Array.isArray(refs) || refs.length === 0) return undefined
  return tsLocationItemsToLspLocations(refs)
}

function tsLocationItemsToLspLocations(items: unknown[]): unknown | undefined {
  const locations = items
    .map((item) => {
      if (!item || typeof item !== 'object') return null
      const record = item as Record<string, unknown>
      const file = typeof record.file === 'string' ? record.file : ''
      const start = tsPositionToLspPosition(record.start)
      const end = tsPositionToLspPosition(record.end) ?? start
      if (!file || !start) return null
      return {
        uri: pathToFileURL(file).href,
        range: { start, end }
      }
    })
    .filter(Boolean)
  return locations.length ? locations : undefined
}

function tsCompletionInfoToLspCompletionList(completion: unknown): unknown | undefined {
  if (!completion || typeof completion !== 'object') return undefined
  const entries = (completion as { entries?: unknown[] }).entries
  if (!Array.isArray(entries) || entries.length === 0) return undefined
  const seen = new Set<string>()
  return {
    isIncomplete: Boolean((completion as { isIncomplete?: boolean }).isIncomplete),
    items: entries.map((entry) => {
      const record = entry as Record<string, unknown>
      const label = typeof record.name === 'string' ? record.name : ''
      const kind = typeof record.kind === 'string' ? record.kind : ''
      const source = typeof record.source === 'string' ? record.source : ''
      const key = `${label}:${kind}:${source}`
      if (!label || seen.has(key)) return null
      seen.add(key)
      return {
        label,
        kind: tsCompletionKindToLspKind(record.kind),
        detail: typeof record.source === 'string' ? record.source : undefined,
        sortText: typeof record.sortText === 'string' ? record.sortText : undefined,
        insertText: label
      }
    }).filter(Boolean)
  }
}

function tsPositionToLspPosition(position: unknown): { line: number; character: number } | null {
  if (!position || typeof position !== 'object') return null
  const record = position as { line?: unknown; offset?: unknown }
  if (typeof record.line !== 'number' || typeof record.offset !== 'number') return null
  return {
    line: Math.max(0, record.line - 1),
    character: Math.max(0, record.offset - 1)
  }
}

function tsCompletionKindToLspKind(kind: unknown): number | undefined {
  switch (kind) {
    case 'method':
    case 'function':
      return 3
    case 'constructor':
      return 4
    case 'field':
    case 'property':
      return 10
    case 'variable':
    case 'local var':
      return 6
    case 'class':
      return 7
    case 'interface':
      return 8
    case 'module':
      return 9
    case 'enum':
      return 13
    case 'keyword':
      return 14
    case 'file':
      return 17
    case 'reference':
      return 18
    default:
      return undefined
  }
}

function scriptKindNameForLanguage(languageId: string, filePath: string): string {
  if (languageId === 'vue') return 'TS'
  if (filePath.endsWith('.tsx')) return 'TSX'
  if (filePath.endsWith('.jsx')) return 'JSX'
  if (languageId === 'javascript') return 'JS'
  return 'TS'
}

function documentEndPosition(content: string): { line: number; offset: number } {
  const lines = content.split(/\r\n|\r|\n/)
  return {
    line: lines.length,
    offset: (lines.at(-1)?.length ?? 0) + 1
  }
}
