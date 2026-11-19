import type { ToolCallPart } from '../../shared/types/ai.js'
import { tGlobal } from '../i18n/index.js'

export interface ToolDisplay {
  /** 卡片左侧图标名（lucide 组件 key，见 ToolCallCard 映射） */
  icon: 'file' | 'pencil' | 'plus' | 'search' | 'folder' | 'terminal' | 'plug' | 'wrench' | 'globe'
  /** 动词标签，如 “读取 / 编辑 / 运行” */
  verb: string
  /** 主标的（文件路径 / 命令 / 模式），等宽展示 */
  target: string
  /** 是否默认折叠输出（只读类工具默认折叠） */
  collapsedByDefault: boolean
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** 把绝对路径裁剪为更易读的相对末段 */
export function shortenPath(path: string): string {
  if (!path) return ''
  const parts = path.split('/')
  if (parts.length <= 3) return path
  return `…/${parts.slice(-2).join('/')}`
}

/** 根据工具名 + 入参推导卡片标题展示 */
export function describeTool(part: ToolCallPart): ToolDisplay {
  const input = part.input ?? {}
  const name = part.name || tGlobal('tool.default')

  switch (name) {
    case 'Read':
      return { icon: 'file', verb: tGlobal('tool.read'), target: shortenPath(str(input.file_path)), collapsedByDefault: true }
    case 'Write':
      return { icon: 'plus', verb: tGlobal('tool.write'), target: shortenPath(str(input.file_path)), collapsedByDefault: false }
    case 'Edit':
      return { icon: 'pencil', verb: tGlobal('tool.edit'), target: shortenPath(str(input.file_path)), collapsedByDefault: false }
    case 'Grep':
      return { icon: 'search', verb: tGlobal('tool.search'), target: str(input.pattern), collapsedByDefault: true }
    case 'Glob':
      return { icon: 'folder', verb: tGlobal('tool.match'), target: str(input.pattern), collapsedByDefault: true }
    case 'Bash':
      return { icon: 'terminal', verb: tGlobal('tool.run'), target: str(input.command), collapsedByDefault: false }
    case 'WebSearch':
      return { icon: 'search', verb: 'WebSearch', target: str(input.query), collapsedByDefault: true }
    case 'WebFetch':
      return { icon: 'globe', verb: 'WebFetch', target: str(input.url), collapsedByDefault: true }
    case 'WebCrawl':
      return { icon: 'globe', verb: 'WebCrawl', target: str(input.url), collapsedByDefault: true }
    default:
      return {
        icon: name.includes('mcp') ? 'plug' : 'wrench',
        verb: name,
        target: str(input.command) || str(input.path) || str(input.query) || '',
        collapsedByDefault: true
      }
  }
}

export interface DiffLine {
  kind: 'add' | 'del' | 'ctx'
  text: string
}

/**
 * 为 Edit / Write 构造可视化 diff 行。
 * Edit: old_string → new_string；Write: 全量新增。
 */
export function buildDiff(part: ToolCallPart): DiffLine[] | null {
  const input = part.input ?? {}
  if (part.name === 'Edit') {
    const oldText = str(input.old_string)
    const newText = str(input.new_string)
    if (!oldText && !newText) return null
    const lines: DiffLine[] = []
    for (const l of oldText.split('\n')) lines.push({ kind: 'del', text: l })
    for (const l of newText.split('\n')) lines.push({ kind: 'add', text: l })
    return lines
  }
  if (part.name === 'Write') {
    const content = str(input.content)
    if (!content) return null
    return content.split('\n').map((l) => ({ kind: 'add' as const, text: l }))
  }
  return null
}

/** 工具卡片是否默认展开正文（运行中/报错/有 diff/写操作展开；Read/Grep 等只读折叠） */
export function isToolExpandedByDefault(part: ToolCallPart): boolean {
  if (part.status === 'running' || part.status === 'error') return true
  if (part.errorSummary || part.recoverySuggestion) return true
  if (buildDiff(part)?.length) return true
  return !describeTool(part).collapsedByDefault
}
