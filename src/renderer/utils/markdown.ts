import { marked } from 'marked'
import DOMPurify, { type Config as DOMPurifyConfig } from 'dompurify'
import { createLogger } from '../../shared/utils/log.js'
import { tGlobal } from '../i18n/index.js'
import { highlightCode, normalizeHighlightLanguage } from './code-highlight.js'

const logger = createLogger('renderer/markdown')

const LANGUAGE_LABELS: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  java: 'Java',
  bash: 'Bash',
  shell: 'Shell',
  json: 'JSON',
  yaml: 'YAML',
  markdown: 'Markdown',
  sql: 'SQL',
  rust: 'Rust',
  go: 'Go',
  css: 'CSS',
  html: 'HTML',
  xml: 'XML',
  plaintext: 'Plain Text',
  text: 'Text'
}

function formatLanguageLabel(lang: string): string {
  const key = lang.trim().toLowerCase()
  if (LANGUAGE_LABELS[key]) return LANGUAGE_LABELS[key]!
  if (!key) return 'Text'
  return key.charAt(0).toUpperCase() + key.slice(1)
}

function isCommandSnippet(language: string, text: string): boolean {
  const normalized = language.trim().toLowerCase()
  if (!['bash', 'shell', 'sh', 'zsh', 'powershell', 'pwsh'].includes(normalized)) return false
  const lines = text.trim().split(/\r?\n/).filter((line) => line.trim())
  return lines.length > 0 && lines.length <= 3
}

const renderer = new marked.Renderer()

renderer.link = ({ href, title, text }) => {
  const safeHref = href ?? '#'
  const titleAttr = title ? ` title="${escapeAttr(title)}"` : ''
  const external = /^https?:\/\//i.test(safeHref)
  const classAttr = external ? ' class="md-external-link"' : ''
  const externalAttrs = external ? ' target="_blank" rel="noreferrer noopener"' : ''
  return `<a href="${escapeAttr(safeHref)}"${classAttr}${titleAttr}${externalAttrs}>${text}</a>`
}

renderer.code = ({ text, lang }) => {
  const language = normalizeHighlightLanguage(lang)
  const displayLanguage = language ?? 'text'
  const highlighted = highlightCode(text, language)
  const label = `<span class="code-lang">${escapeHtml(formatLanguageLabel(displayLanguage))}</span>`
  const copyLabel = tGlobal('common.copy')
  const copyBtn = [
    `<button type="button" class="code-copy" aria-label="${escapeAttr(copyLabel)}">`,
    '<svg class="code-copy-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">',
    '<rect x="9" y="9" width="11" height="11" rx="1.5" stroke="currentColor" stroke-width="1.5"/>',
    '<path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
    '</svg>',
    '</button>'
  ].join('')
  if (isCommandSnippet(displayLanguage, text)) {
    return `<div class="code-block command-block"><pre><code class="hljs language-${escapeHtml(displayLanguage)}">${highlighted}</code></pre>${copyBtn}</div>`
  }
  return `<div class="code-block"><div class="code-toolbar">${label}${copyBtn}</div><pre><code class="hljs language-${escapeHtml(displayLanguage)}">${highlighted}</code></pre></div>`
}

marked.use({
  gfm: true,
  breaks: true,
  renderer
})

const PURIFY_CONFIG: DOMPurifyConfig = {
  ADD_ATTR: ['class', 'aria-label', 'type', 'target', 'rel'],
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|blob):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i
}

/** 将正文中的裸 URL 转为 Markdown 链接（跳过代码块/行内代码） */
function autolinkPlainUrls(source: string): string {
  const segments = source.split(/(```[\s\S]*?```|`[^`\n]+`)/g)
  const httpPattern = /(?<![\x5B(<'"])(https?:\/\/[^\s<>\x5B\]()]+[^\s<>\x5B\].,;:!?"')\]])/g
  const wwwPattern = /(?<![\x5B(<'"/])(www\.[\w.-]+\.[a-z]{2,}(?:\/[^\s<>\x5B\](),;:!?"']*)?)/gi

  return segments
    .map((segment, index) => {
      if (index % 2 === 1) return segment
      let result = segment.replace(httpPattern, (url) => `[${url}](${url})`)
      result = result.replace(wwwPattern, (url) => `[${url}](https://${url})`)
      return result
    })
    .join('')
}

/** 流式输出时补全未闭合的 Markdown 结构，避免渲染抖动 */
export function prepareStreamingMarkdown(source: string): string {
  let text = source

  const fenceCount = (text.match(/```/g) ?? []).length
  if (fenceCount % 2 === 1) {
    text += '\n```'
  }

  return text
}

export function renderMarkdown(source: string, streaming = false): string {
  if (!source.trim()) return ''

  try {
    const prepared = streaming ? prepareStreamingMarkdown(source) : source
    const linked = autolinkPlainUrls(prepared)
    const html = marked.parse(linked, { async: false }) as string
    return String(DOMPurify.sanitize(html, PURIFY_CONFIG))
  } catch (error) {
    logger.error('render markdown failed', { streaming, error })
    return String(DOMPurify.sanitize(`<pre>${escapeHtml(source)}</pre>`, PURIFY_CONFIG))
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/'/g, '&#39;')
}
