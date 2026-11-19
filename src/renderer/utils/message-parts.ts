import type { MessagePart, ToolCallPart } from '../../shared/types/ai.js'

/** 将文本增量并入最后一个文本片段；若最后片段非文本则新建一个 */
export function appendText(parts: MessagePart[], text: string): void {
  const last = parts[parts.length - 1]
  if (last && last.type === 'text') {
    last.text += text
  } else {
    parts.push({ type: 'text', text })
  }
}

/** 将思考增量并入最后一个思考片段；若最后片段非思考则新建一个 */
export function appendThinking(parts: MessagePart[], text: string): void {
  const last = parts[parts.length - 1]
  if (last && last.type === 'thinking') {
    last.text += text
  } else {
    parts.push({ type: 'thinking', text })
  }
}

/** 按 id 查找工具片段 */
export function findToolPart(parts: MessagePart[], id: string): ToolCallPart | undefined {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]
    if (p && p.type === 'tool' && p.id === id) return p
  }
  return undefined
}

/** 将结构化片段降级为纯文本，用于搜索 / 记忆 / 回退渲染 */
export function partsToPlainText(parts: MessagePart[]): string {
  const chunks: string[] = []
  for (const part of parts) {
    if (part.type === 'text') {
      if (part.text.trim()) chunks.push(part.text)
    } else if (part.type === 'tool') {
      const arg = summarizeToolInput(part.input)
      chunks.push(`〔工具 ${part.name}${arg ? ` ${arg}` : ''}〕`)
    }
  }
  return chunks.join('\n\n').trim()
}

/** 入参单行摘要 */
function summarizeToolInput(input?: Record<string, unknown>): string {
  if (!input) return ''
  const primary =
    input.command ?? input.file_path ?? input.path ?? input.pattern ?? input.query
  if (typeof primary === 'string') return primary
  return ''
}

/** 深拷贝为可持久化的普通对象（剥离 Vue 响应式代理） */
export function snapshotParts(parts: MessagePart[]): MessagePart[] {
  return JSON.parse(JSON.stringify(parts)) as MessagePart[]
}

/**
 * 为「流式视图」增量装配一份新数组：未变化的片段复用上一帧的对象身份，
 * 仅变化的片段（通常是正在增长的最后一个文本/工具片段）生成新的浅拷贝。
 *
 * 目的：替代每帧 `snapshotParts` 的整树 JSON 深拷贝（长消息下 O(n)/帧、O(n²)/条），
 * 并让 Vue 的 keyed diff 跳过未变化片段的子组件重渲染。文本/工具输出均为「只追加」，
 * 故用长度做廉价脏检查即可（内容变必然长度变），无需逐字符比较。
 */
export function syncViewParts(prev: MessagePart[], working: MessagePart[]): MessagePart[] {
  const next: MessagePart[] = new Array(working.length)
  for (let i = 0; i < working.length; i++) {
    const w = working[i]!
    const p = prev[i]
    next[i] = p && samePartState(p, w) ? p : { ...w }
  }
  return next
}

/** 片段是否与上一帧等价（只追加语义下按长度/引用做 O(1) 判断）。 */
function samePartState(a: MessagePart, b: MessagePart): boolean {
  if (a.type !== b.type) return false
  if (b.type === 'tool') {
    const at = a as ToolCallPart
    return (
      at.status === b.status &&
      at.output.length === b.output.length &&
      at.input === b.input &&
      at.inputText === b.inputText &&
      at.retryAttempted === b.retryAttempted &&
      at.attempt === b.attempt &&
      at.retryOf === b.retryOf &&
      at.errorSummary === b.errorSummary &&
      at.recoverySuggestion === b.recoverySuggestion
    )
  }
  // text / thinking：只追加，长度相等即内容相等
  return (a as { text: string }).text.length === (b as { text: string }).text.length
}
