import type { MessagePart, ToolCallPart, ChatMessageImage } from '../../shared/types/ai.js'
import type { SessionDetail } from '../../shared/types/conversation.js'

export interface SessionMarkdownLabels {
  project: string
  workspacePath: string
  createdAt: string
  updatedAt: string
  exportedAt: string
  user: string
  assistant: string
  system: string
  tool: string
  images: string
  thinking: string
  toolCall: string
  toolInput: string
  toolOutput: string
  emptyMessage: string
}

export interface SessionMarkdownOptions {
  locale: string
  labels: SessionMarkdownLabels
  exportedAt?: number
}

const MAX_FILE_NAME_LENGTH = 80

export function sessionMarkdownFileName(session: Pick<SessionDetail, 'title'>): string {
  const safeTitle = session.title
    .replace(/[\\/:*?"<>|#\n\r\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_FILE_NAME_LENGTH)

  return `${safeTitle || 'conversation'}.md`
}

export function buildSessionMarkdown(session: SessionDetail, options: SessionMarkdownOptions): string {
  const lines: string[] = [
    `# ${session.title}`,
    '',
    `- ${options.labels.project}: ${session.workspaceName}`,
    session.workspacePath ? `- ${options.labels.workspacePath}: ${session.workspacePath}` : '',
    `- ${options.labels.createdAt}: ${formatDateTime(session.createdAt, options.locale)}`,
    `- ${options.labels.updatedAt}: ${formatDateTime(session.updatedAt, options.locale)}`,
    `- ${options.labels.exportedAt}: ${formatDateTime(options.exportedAt ?? Date.now(), options.locale)}`,
    '',
    '---',
    ''
  ].filter(Boolean)

  for (const message of session.messages) {
    lines.push(
      `## ${roleLabel(message.role, options.labels)} · ${formatDateTime(message.timestamp, options.locale)}`,
      '',
      renderMessageBody(message.content, message.parts, options.labels),
      ''
    )

    const images = message.meta?.images ?? []
    if (images.length) {
      lines.push(`### ${options.labels.images}`, '', ...images.flatMap(renderImage), '')
    }
  }

  return `${lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trim()}\n`
}

function roleLabel(role: string, labels: SessionMarkdownLabels): string {
  if (role === 'user') return labels.user
  if (role === 'assistant') return labels.assistant
  if (role === 'system') return labels.system
  return labels.tool
}

function renderMessageBody(content: string, parts: MessagePart[] | undefined, labels: SessionMarkdownLabels): string {
  if (!parts?.length) return content.trim() || labels.emptyMessage

  const rendered = parts
    .map((part) => renderPart(part, labels))
    .filter(Boolean)
    .join('\n\n')

  return rendered.trim() || content.trim() || labels.emptyMessage
}

function renderPart(part: MessagePart, labels: SessionMarkdownLabels): string {
  if (part.type === 'text') return part.text.trim()
  if (part.type === 'thinking') {
    return [
      `<details><summary>${labels.thinking}</summary>`,
      '',
      fenced(part.text, 'text'),
      '',
      '</details>'
    ].join('\n')
  }
  return renderToolPart(part, labels)
}

function renderToolPart(part: ToolCallPart, labels: SessionMarkdownLabels): string {
  const title = `${labels.toolCall}: ${part.name}${part.status ? ` · ${part.status}` : ''}`
  const input = part.input ? JSON.stringify(part.input, null, 2) : (part.inputText ?? '')
  const sections = [`<details><summary>${title}</summary>`, '']

  if (input.trim()) {
    sections.push(`**${labels.toolInput}**`, '', fenced(input, part.input ? 'json' : 'text'), '')
  }
  if (part.output.trim()) {
    sections.push(`**${labels.toolOutput}**`, '', fenced(part.output, 'text'), '')
  }

  sections.push('</details>')
  return sections.join('\n')
}

function renderImage(image: ChatMessageImage): string[] {
  return [`- ![${escapeMarkdownInline(image.name)}](<${toMarkdownUrl(image.path)}>)`]
}

function toMarkdownUrl(filePath: string): string {
  if (/^[a-z][a-z\d+.-]*:/i.test(filePath)) return filePath
  if (!filePath.startsWith('/')) return encodeURI(filePath)
  return `file://${filePath.split('/').map((segment) => encodeURIComponent(segment)).join('/')}`
}

function fenced(text: string, language: string): string {
  const longestFence = Math.max(2, ...Array.from(text.matchAll(/`+/g), (match) => match[0].length))
  const fence = '`'.repeat(longestFence + 1)
  return `${fence}${language}\n${text}\n${fence}`
}

function escapeMarkdownInline(value: string): string {
  return value.replace(/[[\]\\]/g, '\\$&')
}

function formatDateTime(value: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(value))
}
