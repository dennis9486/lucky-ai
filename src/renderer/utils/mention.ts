export type MentionKind = 'file' | 'folder' | 'docs' | 'terminal' | 'chat' | 'branch' | 'browser'

export interface MentionOption {
  kind: MentionKind
  label: string
  insert: string
}

export interface MentionState {
  triggerIndex: number
  query: string
  kind: MentionKind | null;
}

export function buildMentionOptions(
  t: (key: string) => string
): MentionOption[] {
  return [
    { kind: 'file', label: t('mention.file'), insert: '@file ' },
    { kind: 'folder', label: t('mention.folder'), insert: '@folder ' },
    { kind: 'docs', label: t('mention.docs'), insert: '@docs' },
    { kind: 'terminal', label: t('mention.terminal'), insert: '@terminal' },
    { kind: 'chat', label: t('mention.pastChats'), insert: '@chat' },
    { kind: 'branch', label: t('mention.branch'), insert: '@branch' },
    { kind: 'browser', label: t('mention.browser'), insert: '@browser' }
  ]
}

const KIND_PREFIXES: Record<MentionKind, string> = {
  file: '@file',
  folder: '@folder',
  docs: '@docs',
  terminal: '@terminal',
  chat: '@chat',
  branch: '@branch',
  browser: '@browser'
}

/**
 * `@` 是否处于一个合法的触发边界。
 * 仅当其前一个字符为「行首 / 空白 / 中日韩文字 / 标点」时才触发，
 * 避免在邮箱、路径、标识符（如 `user@host`、`a.b@c.com`）中误触发提及菜单。
 */
function isMentionBoundary(prevChar: string): boolean {
  if (prevChar === '') return true
  // 标识符字符（含 . _ - / 等）紧邻 @ 时视为邮箱/路径，不触发
  return !/[A-Za-z0-9._\-/\\]/.test(prevChar)
}

function isReferencePathValue(path: string): boolean {
  return path.includes('/') || path.includes('\\') || path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

/** 检测光标处是否处于 @ 提及输入态 */
export function detectMention(text: string, cursorPos: number): MentionState | null {
  const before = text.slice(0, cursorPos)
  const atIndex = before.lastIndexOf('@')
  if (atIndex === -1) return null
  if (!isMentionBoundary(atIndex > 0 ? (before[atIndex - 1] ?? '') : '')) return null

  const segment = before.slice(atIndex)

  // 已插入的 @file / @folder 引用 token（chip 序列化）：光标在 token 之后或 token 已是完整路径时不再弹窗
  const completedRef = segment.match(/^@(file|folder)\s+(\S+)/)
  if (completedRef) {
    const tokenLen = completedRef[0].length
    const path = completedRef[2]!
    if (segment.length > tokenLen) return null
    if (segment.length === tokenLen && isReferencePathValue(path)) return null
  }

  if (/\s/.test(segment.slice(1, -1)) && !segment.startsWith('@file ') && !segment.startsWith('@folder ')) {
    return null
  }

  // 已完成的即时引用，不再弹出菜单
  if (segment === '@docs' || segment === '@terminal' || segment === '@chat' || segment === '@branch' || segment === '@browser') return null

  const query = segment.slice(1)
  let kind: MentionKind | null = null
  if (segment.startsWith('@file ')) kind = 'file'
  else if (segment.startsWith('@folder ')) kind = 'folder'

  return { triggerIndex: atIndex, query, kind }
}

export function filterMentionOptions(
  query: string,
  kind: MentionKind | null,
  options: MentionOption[]
): MentionOption[] {
  if (kind !== null) return []

  const q = query.toLowerCase()
  return options.filter((opt) => {
    const prefix = KIND_PREFIXES[opt.kind].slice(1)
    return prefix.startsWith(q) || opt.label.toLowerCase().includes(q)
  })
}

export function insertAtCursor(
  text: string,
  cursorPos: number,
  triggerIndex: number,
  replacement: string
): { text: string; cursorPos: number } {
  const next = text.slice(0, triggerIndex) + replacement + text.slice(cursorPos)
  return { text: next, cursorPos: triggerIndex + replacement.length }
}

export function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(path)
}

export function basename(path: string): string {
  const parts = path.split(/[/\\]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1]! : path
}

/** 富文本 chip 序列化为携带完整路径的 token（避免同名歧义）：`@file <path>` / `@folder <path>` */
export function buildReferenceToken(kind: 'file' | 'folder', path: string): string {
  return `@${kind} ${path}`
}

export type MentionSegment =
  | { type: 'text'; value: string }
  | { type: 'reference'; kind: 'file' | 'folder'; path: string; name: string }

/** 把引用 token 还原成简洁可读形式 `@basename`，供标题/预览展示（去掉完整路径噪声） */
export function mentionPlainText(text: string): string {
  return parseMentionSegments(text)
    .map((seg) => (seg.type === 'text' ? seg.value : `@${seg.name}`))
    .join('')
}

/** 把序列化文本拆成「纯文本 / 引用」分段，供消息气泡与编辑器还原内联 chip */
export function parseMentionSegments(text: string): MentionSegment[] {
  const segments: MentionSegment[] = []
  const re = /@(file|folder)\s+(\S+)/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    if (match.index > last) segments.push({ type: 'text', value: text.slice(last, match.index) })
    const kind = match[1] as 'file' | 'folder'
    const path = match[2]!
    segments.push({ type: 'reference', kind, path, name: basename(path) })
    last = match.index + match[0].length
  }
  if (last < text.length) segments.push({ type: 'text', value: text.slice(last) })
  return segments
}

export function isInstantMention(kind: MentionKind): boolean {
  return kind === 'docs' || kind === 'terminal' || kind === 'chat' || kind === 'branch' || kind === 'browser'
}

export interface RankableFile {
  name: string
  path: string
}

/**
 * 对文件搜索结果做 Cursor 风格的轻量模糊排序：
 * 文件名前缀命中 > 词边界命中 > 文件名子串命中 > 路径子串命中；
 * 同档按路径深度、长度升序，越短越靠前。空查询保持原顺序。
 */
export function rankFileResults<T extends RankableFile>(results: T[], query: string): T[] {
  const q = query.trim().toLowerCase()
  if (!q) return results

  const score = (item: T): number => {
    const name = item.name.toLowerCase()
    const path = item.path.toLowerCase()
    if (name === q) return 0
    if (name.startsWith(q)) return 1
    if (new RegExp(`(^|[^a-z0-9])${escapeRegExp(q)}`).test(name)) return 2
    if (name.includes(q)) return 3
    if (path.includes(q)) return 4
    return 5
  }

  return results
    .map((item, index) => ({ item, index, score: score(item) }))
    .sort((a, b) => {
      if (a.score !== b.score) return a.score - b.score
      const depth = pathDepth(a.item.path) - pathDepth(b.item.path)
      if (depth !== 0) return depth
      const len = a.item.path.length - b.item.path.length
      if (len !== 0) return len
      return a.index - b.index
    })
    .map((entry) => entry.item)
}

function pathDepth(path: string): number {
  return (path.match(/[/\\]/g) ?? []).length
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
