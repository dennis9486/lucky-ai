/**
 * pdf.service.ts — PDF 生成。
 *
 * 主路径 `renderPdfDocument`：用应用内置的 Chromium（Electron `printToPDF`）把 HTML 渲染成 PDF，
 * 天然支持中文/CJK、Unicode、字体与排版——无需内嵌字体、无第三方依赖。
 *
 * 兜底 `buildTextPdf`：零依赖手写的最简 PDF（A4 + Helvetica + WinAnsi），仅覆盖 Latin-1，
 * 中文会变 '?'。仅在 Chromium 不可用时使用；同时作为纯函数便于单测。
 */

import { BrowserWindow } from 'electron'
import { marked } from 'marked'
import { randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createLogger } from '../../shared/utils/log.js'

const logger = createLogger('main/pdf')

/** PDF 内容格式：markdown（默认，支持表格/标题/内嵌 HTML+SVG）/ html（完全自定义）/ text（纯文本按行保留）。 */
export type PdfContentFormat = 'markdown' | 'html' | 'text'

const PAGE_W = 595
const PAGE_H = 842
const MARGIN = 56
const BODY_SIZE = 11
const BODY_LEADING = 15
const TITLE_SIZE = 18
const TITLE_LEADING = 26
const MAX_BODY_CHARS = 88
const MAX_TITLE_CHARS = 58

export interface BuildPdfOptions {
  title?: string
  content: string
}

export interface BuildPdfResult {
  bytes: Buffer
  pages: number
  /** 是否有非 Latin-1 字符被替换为 '?'。 */
  replacedNonLatin: boolean
}

interface DisplayLine {
  text: string
  font: 1 | 2 // 1 = Helvetica, 2 = Helvetica-Bold
  size: number
  leading: number
}

/** WinAnsi 转义：转义 () \\，替换 >255 的字符为 '?'，控制字符转空格。 */
function encodeText(input: string): { text: string; replaced: boolean } {
  let out = ''
  let replaced = false
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0
    if (code > 255) { out += '?'; replaced = true; continue }
    if (ch === '\\') out += '\\\\'
    else if (ch === '(') out += '\\('
    else if (ch === ')') out += '\\)'
    else if (code < 32) out += ' '
    else out += ch
  }
  return { text: out, replaced }
}

/** 按最大字符数换行；优先在空格断行，超长单词硬切。 */
function wrapLine(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]
  const words = text.split(' ')
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if (word.length > maxChars) {
      if (current) { lines.push(current); current = '' }
      for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars))
      continue
    }
    if (!current) current = word
    else if ((current + ' ' + word).length <= maxChars) current += ' ' + word
    else { lines.push(current); current = word }
  }
  if (current) lines.push(current)
  return lines.length ? lines : ['']
}

function pad10(value: number): string {
  return value.toString().padStart(10, '0')
}

export function buildTextPdf(options: BuildPdfOptions): BuildPdfResult {
  let replacedNonLatin = false
  const display: DisplayLine[] = []
  const pushLine = (raw: string, font: 1 | 2, size: number, leading: number): void => {
    const enc = encodeText(raw)
    if (enc.replaced) replacedNonLatin = true
    display.push({ text: enc.text, font, size, leading })
  }

  const title = options.title?.trim()
  if (title) {
    for (const line of wrapLine(title, MAX_TITLE_CHARS)) pushLine(line, 2, TITLE_SIZE, TITLE_LEADING)
    display.push({ text: '', font: 1, size: BODY_SIZE, leading: 10 }) // 标题与正文间距
  }

  const paragraphs = (options.content ?? '').replace(/\r\n/g, '\n').split('\n')
  for (const paragraph of paragraphs) {
    if (paragraph === '') { display.push({ text: '', font: 1, size: BODY_SIZE, leading: BODY_LEADING }); continue }
    for (const line of wrapLine(paragraph, MAX_BODY_CHARS)) pushLine(line, 1, BODY_SIZE, BODY_LEADING)
  }
  if (!display.some((line) => line.text.trim())) pushLine('(empty document)', 1, BODY_SIZE, BODY_LEADING)

  // 分页：生成每页的内容流字符串
  const pageStreams: string[] = []
  let stream = ''
  let y = PAGE_H - MARGIN
  for (const line of display) {
    if (y - line.leading < MARGIN) { pageStreams.push(stream); stream = ''; y = PAGE_H - MARGIN }
    y -= line.leading
    if (line.text) {
      stream += `BT /F${line.font} ${line.size} Tf 1 0 0 1 ${MARGIN} ${y.toFixed(2)} Tm (${line.text}) Tj ET\n`
    }
  }
  pageStreams.push(stream)
  const pageCount = pageStreams.length

  // 对象编号：1 catalog / 2 pages / 3 F1 / 4 F2 / 之后每页 pageObj + contentObj
  const objects: string[] = []
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>'
  const kids = pageStreams.map((_, p) => `${5 + 2 * p} 0 R`).join(' ')
  objects[2] =
    `<< /Type /Pages /Kids [${kids}] /Count ${pageCount} /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] ` +
    `/Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> >>`
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
  objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'
  pageStreams.forEach((content, p) => {
    const pageId = 5 + 2 * p
    const contentId = 6 + 2 * p
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /Contents ${contentId} 0 R >>`
    objects[contentId] = `<< /Length ${content.length} >>\nstream\n${content}endstream`
  })
  const maxId = 4 + 2 * pageCount

  // 序列化 + 计算 xref 偏移（latin1 下字符数 === 字节数）
  let pdf = '%PDF-1.4\n%ÿÿÿÿ\n'
  const offsets: number[] = []
  for (let id = 1; id <= maxId; id++) {
    offsets[id] = pdf.length
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`
  }
  const xrefStart = pdf.length
  pdf += `xref\n0 ${maxId + 1}\n0000000000 65535 f \n`
  for (let id = 1; id <= maxId; id++) pdf += `${pad10(offsets[id]!)} 00000 n \n`
  pdf += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`

  return { bytes: Buffer.from(pdf, 'latin1'), pages: pageCount, replacedNonLatin }
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 打印级文档样式：标题层级、表格、代码、引用、图表(SVG/img)、颜色、分页控制。 */
const DOCUMENT_CSS = `
* { box-sizing: border-box; }
body {
  margin: 0;
  color: #1a1a1a;
  font-size: 12pt;
  line-height: 1.65;
  font-family: -apple-system, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei",
    "Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Micro Hei", Arial, sans-serif;
}
.pdf-title { font-size: 22pt; font-weight: 700; margin: 0 0 16px; }
h1 { font-size: 21pt; font-weight: 700; margin: 20px 0 12px; }
h2 { font-size: 16.5pt; font-weight: 700; margin: 20px 0 8px; border-bottom: 1px solid #ebedf0; padding-bottom: 4px; }
h3 { font-size: 14pt; font-weight: 700; margin: 16px 0 6px; }
h4, h5, h6 { font-size: 12.5pt; font-weight: 700; margin: 12px 0 4px; }
p { margin: 0 0 10px; }
a { color: #2563eb; text-decoration: none; }
strong { font-weight: 700; } em { font-style: italic; }
ul, ol { margin: 0 0 10px; padding-left: 24px; }
li { margin: 3px 0; }
blockquote { margin: 0 0 12px; padding: 6px 14px; border-left: 3px solid #d0d7de; color: #57606a; background: #f6f8fa; }
code { font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace; font-size: 10.5pt; background: #eff1f3; padding: 1px 5px; border-radius: 4px; }
pre { background: #f6f8fa; padding: 12px 14px; border-radius: 8px; white-space: pre-wrap; word-break: break-word; margin: 0 0 12px; }
pre code { background: none; padding: 0; font-size: 10.5pt; }
table { border-collapse: collapse; width: 100%; margin: 0 0 14px; font-size: 11pt; }
th, td { border: 1px solid #d6dce1; padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: #f0f3f6; font-weight: 700; }
tbody tr:nth-child(even) td { background: #fafbfc; }
img, svg { max-width: 100%; height: auto; }
figure { margin: 0 0 14px; text-align: center; }
figcaption { color: #6a737d; font-size: 10.5pt; margin-top: 4px; }
hr { border: 0; border-top: 1px solid #e5e7eb; margin: 18px 0; }
/* 分页控制：标题不留在页底，表格/图不被切断 */
h1, h2, h3 { break-after: avoid; }
tr, img, svg, pre, blockquote, figure { break-inside: avoid; }
.page-break { break-before: page; }
`

/** 去除可执行脚本（渲染窗口已 javascript:false，这是纵深防御）。 */
function stripScripts(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
}

/** 按格式把内容转成 body HTML。markdown 支持 GFM 表格 + 单行换行 + 内嵌 HTML/SVG。 */
function contentToBodyHtml(content: string, format: PdfContentFormat): string {
  if (format === 'text') return `<pre>${escapeHtml(content)}</pre>`
  if (format === 'html') return stripScripts(content)
  const rendered = marked.parse(content, { async: false, gfm: true, breaks: true }) as string
  return stripScripts(rendered)
}

/** 组装完整 HTML 文档：严格 CSP(禁脚本/禁远程资源，仅允许 data: 图片与内联样式) + 打印样式。导出以便单测。 */
export function buildPdfHtml(title: string | undefined, content: string, format: PdfContentFormat = 'markdown'): string {
  const heading = title?.trim() ? `<div class="pdf-title">${escapeHtml(title.trim())}</div>` : ''
  const body = contentToBodyHtml(content ?? '', format)
  const csp = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src local; base-uri 'none'"
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">` +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    `<style>${DOCUMENT_CSS}</style></head><body>${heading}${body}</body></html>`
}

export interface RenderPdfResult {
  path: string
  bytes: number
  engine: 'chromium'
}

/**
 * 用 Chromium（Electron printToPDF）把内容渲染成 PDF 写入 `outputPath`。
 * 支持中文/Unicode、Markdown、内嵌 HTML/SVG(图表)、颜色与表格。需在 app ready 后调用。
 */
export async function renderPdfDocument(options: {
  title?: string
  content: string
  outputPath: string
  format?: PdfContentFormat
}): Promise<RenderPdfResult> {
  const html = buildPdfHtml(options.title, options.content ?? '', options.format ?? 'markdown')
  const tmpHtml = join(tmpdir(), `lucky-pdf-${randomUUID()}.html`)
  await writeFile(tmpHtml, html, 'utf-8')

  try {
    // 重试一次，吸收窗口/加载的瞬时故障，尽量不落到仅 Latin 的兜底
    let lastError: unknown
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const pdf = await renderOnce(tmpHtml)
        await mkdir(dirname(options.outputPath), { recursive: true })
        await writeFile(options.outputPath, pdf)
        return { path: options.outputPath, bytes: pdf.length, engine: 'chromium' }
      } catch (error) {
        lastError = error
        logger.warn('printToPDF attempt failed', { attempt, error })
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError))
  } finally {
    await rm(tmpHtml, { force: true }).catch((error) => logger.debug('temp html cleanup failed', { error }))
  }
}

async function renderOnce(tmpHtml: string): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    width: 900,
    height: 1200,
    webPreferences: { javascript: false, sandbox: true, contextIsolation: true }
  })
  try {
    await win.loadFile(tmpHtml)
    return await win.webContents.printToPDF({
      printBackground: true,
      pageSize: 'A4',
      margins: { marginType: 'default' }
    })
  } finally {
    if (!win.isDestroyed()) win.destroy()
  }
}
