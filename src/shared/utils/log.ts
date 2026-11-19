export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface LoggerOptions {
  enabled?: boolean | (() => boolean)
  debugEnabled?: boolean | (() => boolean)
  defaults?: Record<string, unknown>
}

export interface LogEntry {
  timestamp: string
  scope: string
  level: LogLevel
  message: string
  detail?: Serializable
}

export type LogSink = (entry: LogEntry) => void

type Serializable =
  | null
  | boolean
  | number
  | string
  | Serializable[]
  | { [key: string]: Serializable }

const MAX_DEPTH = 5
const MAX_STRING_LENGTH = 2_000
const sinks = new Set<LogSink>()

export function createLogger(scope: string, options: LoggerOptions = {}) {
  const write = (level: LogLevel, message: string, detail?: unknown): void => {
    if (!isEnabled(options.enabled, true)) return
    if (level === 'debug' && !isEnabled(options.debugEnabled, false)) return

    const mergedDetail = mergeDetail(options.defaults, detail)
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      scope,
      level,
      message,
      detail: mergedDetail
    }

    writeToConsole(entry)
    for (const sink of sinks) sink(entry)
  }

  return {
    debug: (message: string, detail?: unknown) => write('debug', message, detail),
    info: (message: string, detail?: unknown) => write('info', message, detail),
    warn: (message: string, detail?: unknown) => write('warn', message, detail),
    error: (message: string, detail?: unknown) => write('error', message, detail),
    child(childScope: string, childOptions: Omit<LoggerOptions, 'enabled' | 'debugEnabled'> = {}) {
      return createLogger(`${scope}/${childScope}`, {
        enabled: options.enabled,
        debugEnabled: options.debugEnabled,
        defaults: mergeDefaults(options.defaults, childOptions.defaults)
      })
    }
  }
}

export function registerLogSink(sink: LogSink): () => void {
  sinks.add(sink)
  return () => sinks.delete(sink)
}

export function serializeLogDetail(detail: unknown): Serializable | undefined {
  if (detail === undefined) return undefined
  return serializeValue(detail, 0, new WeakSet<object>())
}

function mergeDetail(defaults: Record<string, unknown> | undefined, detail: unknown): Serializable | undefined {
  if (defaults && detail && isPlainObject(detail)) {
    return serializeLogDetail({ ...defaults, ...detail })
  }
  if (defaults && detail === undefined) return serializeLogDetail(defaults)
  if (defaults) return serializeLogDetail({ ...defaults, detail })
  return serializeLogDetail(detail)
}

function mergeDefaults(
  parentDefaults: Record<string, unknown> | undefined,
  childDefaults: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (parentDefaults && childDefaults) return { ...parentDefaults, ...childDefaults }
  return childDefaults ?? parentDefaults
}

function formatDetail(detail: Serializable | undefined): string {
  if (detail === undefined) return ''
  try {
    return ` ${JSON.stringify(detail)}`
  } catch {
    return ' {"detail":"[unserializable]"}'
  }
}

function writeToConsole(entry: LogEntry): void {
  const line = `[${entry.scope}] ${entry.message}${formatDetail(entry.detail)}`
  if (entry.level === 'error') console.error(line)
  else if (entry.level === 'warn') console.warn(line)
  else if (entry.level === 'info') console.info(line)
  else console.debug(line)
}

function isEnabled(option: boolean | (() => boolean) | undefined, fallback: boolean): boolean {
  if (typeof option === 'function') return option()
  if (typeof option === 'boolean') return option
  return fallback
}

function serializeValue(value: unknown, depth: number, seen: WeakSet<object>): Serializable {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return truncate(value)
  if (typeof value === 'number' || typeof value === 'boolean') return value
  if (typeof value === 'bigint') return String(value)
  if (typeof value === 'symbol') return String(value)
  if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`
  if (value instanceof Error) return serializeError(value, depth, seen)
  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return '[Array]'
    return value.map((item) => serializeValue(item, depth + 1, seen))
  }
  if (typeof value === 'object') {
    if (depth >= MAX_DEPTH) return '[Object]'
    if (seen.has(value)) return '[Circular]'
    seen.add(value)

    if (value instanceof Date) return value.toISOString()
    if (value instanceof URL) return value.toString()
    if (value instanceof Map) {
      return {
        type: 'Map',
        entries: [...value.entries()].map(([key, item]) => ([
          serializeValue(key, depth + 1, seen),
          serializeValue(item, depth + 1, seen)
        ]))
      }
    }
    if (value instanceof Set) {
      return {
        type: 'Set',
        values: [...value.values()].map((item) => serializeValue(item, depth + 1, seen))
      }
    }

    const result: { [key: string]: Serializable } = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      result[key] = serializeValue(item, depth + 1, seen)
    }
    return result
  }

  return String(value)
}

function serializeError(error: Error, depth: number, seen: WeakSet<object>): Serializable {
  const base: Record<string, Serializable> = {
    name: error.name,
    message: truncate(error.message)
  }
  if (error.stack) base.stack = truncate(error.stack)

  const errorWithCause = error as Error & { cause?: unknown }
  if (errorWithCause.cause !== undefined && depth < MAX_DEPTH) {
    base.cause = serializeValue(errorWithCause.cause, depth + 1, seen)
  }

  const extraFields = error as unknown as Record<string, unknown>
  for (const key of Object.keys(extraFields)) {
    if (key in base) continue
    base[key] = serializeValue(extraFields[key], depth + 1, seen)
  }

  return base
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function truncate(value: string): string {
  return value.length <= MAX_STRING_LENGTH ? value : `${value.slice(0, MAX_STRING_LENGTH)}...`
}
