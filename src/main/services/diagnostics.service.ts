import { app, crashReporter } from 'electron'
import { appendFile, mkdir, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { createLogger, registerLogSink, serializeLogDetail, type LogEntry } from '../../shared/utils/log.js'

const logger = createLogger('main/diagnostics')

/** 单个日志文件大小上限，超出则轮转到带序号的历史文件。 */
const MAX_LOG_BYTES = 5 * 1024 * 1024
/** 保留的历史日志天数。 */
const LOG_RETENTION_DAYS = 14

export interface RendererErrorReport {
  kind: 'error' | 'unhandledrejection'
  message: string
  source?: string
  line?: number
  column?: number
  stack?: string
}

/**
 * 可观测性：把 warn/error 级日志、渲染进程/GPU 崩溃、未捕获异常持久化到本地文件，
 * 并启用本地原生崩溃转储（minidump，不上传）。纯本地，无第三方 telemetry。
 */
export class DiagnosticsService {
  private initialized = false
  private writeChain: Promise<void> = Promise.resolve()

  private get logDir(): string {
    return join(app.getPath('userData'), 'logs')
  }

  private get logFile(): string {
    return join(this.logDir, `app-${new Date().toISOString().slice(0, 10)}.log`)
  }

  init(): void {
    if (this.initialized) return
    this.initialized = true

    try {
      // 本地原生崩溃转储（不上传服务器），dump 落在 app.getPath('crashDumps')
      crashReporter.start({ uploadToServer: false, compress: true })
    } catch (error) {
      logger.warn('crashReporter start failed', { error })
    }

    // 把 info 及以上级别日志落盘（debug 太多不落盘）
    registerLogSink((entry) => {
      if (entry.level === 'debug') return
      this.enqueueAppend(this.formatEntry(entry))
    })

    void this.pruneOldLogs()
    logger.info('diagnostics initialized', { logDir: this.logDir, crashDumps: app.getPath('crashDumps') })
  }

  /** 渲染进程上报的未捕获错误。 */
  recordRendererError(report: RendererErrorReport): void {
    this.enqueueAppend(this.formatEntry({
      timestamp: new Date().toISOString(),
      scope: 'renderer',
      level: 'error',
      message: `${report.kind}: ${report.message}`,
      detail: serializeLogDetail({
        source: report.source,
        line: report.line,
        column: report.column,
        stack: report.stack
      })
    }))
  }

  private formatEntry(entry: LogEntry): string {
    let detail = ''
    if (entry.detail !== undefined) {
      try {
        detail = ` ${JSON.stringify(entry.detail)}`
      } catch {
        detail = ' {"detail":"[unserializable]"}'
      }
    }
    return `${entry.timestamp} [${entry.level.toUpperCase()}] [${entry.scope}] ${entry.message}${detail}\n`
  }

  /** 串行化写入，避免并发 append 交错。 */
  private enqueueAppend(line: string): void {
    this.writeChain = this.writeChain
      .then(() => this.appendLine(line))
      .catch(() => undefined)
  }

  private async appendLine(line: string): Promise<void> {
    await mkdir(this.logDir, { recursive: true })
    const file = this.logFile
    await this.rotateIfNeeded(file)
    await appendFile(file, line, 'utf-8')
  }

  private async rotateIfNeeded(file: string): Promise<void> {
    try {
      const info = await stat(file)
      if (info.size < MAX_LOG_BYTES) return
      const rotated = `${file}.${Date.now()}`
      await appendFile(rotated, '', 'utf-8').catch(() => undefined)
      // 直接改名更稳妥
      const { rename } = await import('node:fs/promises')
      await rename(file, rotated)
    } catch {
      // 文件不存在或无法 stat：无需轮转
    }
  }

  private async pruneOldLogs(): Promise<void> {
    try {
      const cutoff = Date.now() - LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000
      const entries = await readdir(this.logDir).catch(() => [] as string[])
      for (const name of entries) {
        if (!name.startsWith('app-')) continue
        const full = join(this.logDir, name)
        const info = await stat(full).catch(() => null)
        if (info && info.mtimeMs < cutoff) await unlink(full).catch(() => undefined)
      }
    } catch {
      // 清理失败不影响运行
    }
  }
}

export const diagnosticsService = new DiagnosticsService()
