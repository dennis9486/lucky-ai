import { isAbsolute, resolve, dirname } from 'node:path'
import { mkdir, writeFile } from 'node:fs/promises'
import type { Tool } from '@agentscope-ai/agentscope/tool'
import { securityService } from '../../services/security.service.js'
import { evaluateExpression } from '../../services/calc.service.js'
import { timeNow, timeFormat, timeDiff, timeAdd, type TimeUnit } from '../../services/time.service.js'
import { buildTextPdf, renderPdfDocument } from '../../services/pdf.service.js'
import type { BeforeFileMutationHook } from './tool-helpers.js'

/** 无外部副作用的实用工具群：科学计算 / 时间 / PDF 生成 */

/** 科学计算工具：安全求值数学表达式（无 eval），只读、无副作用。 */
export function createCalcTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'Calc',
    description: `Evaluate a scientific math expression and return the numeric result. Safe — no code execution.
Supports: + - * / % , ^ (power, right-assoc), unary minus, parentheses, factorial (n! or fact(n)),
constants (pi, tau, e, phi), and functions: sin cos tan asin acos atan sinh cosh tanh sqrt cbrt exp
ln log2 log10 lg log(x)/log(base,x) pow(x,y) atan2 hypot min max abs floor ceil round trunc sign deg rad.
Angles are in radians (use deg()/rad() to convert). Input: { "expression": string }.`,
    inputSchema: {
      type: 'object',
      properties: {
        expression: { type: 'string', description: 'Math expression, e.g. "sin(pi/6) + sqrt(2)^2"' }
      },
      required: ['expression']
    },
    requireUserConfirm,
    async call(input: { expression: string }): Promise<string> {
      securityService.assertAgentToolAllowed('Calc', input as Record<string, unknown>)
      const value = evaluateExpression(String(input.expression ?? ''))
      return JSON.stringify({ expression: String(input.expression ?? ''), result: value }, null, 2)
    }
  }
}

/** 时间工具：当前时间 / 时区格式化 / 时间差 / 时间加减，均以 UTC 毫秒为准。 */
export function createTimeTool(requireUserConfirm: boolean): Tool {
  return {
    name: 'Time',
    description: `Time utility. "operation" selects the action:
- "now": current time (+ optional timezone).
- "format": format a given "time" (ISO string or epoch ms/seconds) in a timezone.
- "diff": difference between "from" and "to".
- "add": add "amount" of "unit" (ms|second|minute|hour|day|week) to "time".
Timezone is an IANA name like "Asia/Shanghai" (defaults to the host timezone).
Input: { "operation": "now"|"format"|"diff"|"add", "time"?, "from"?, "to"?, "amount"?, "unit"?, "timezone"? }.`,
    inputSchema: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['now', 'format', 'diff', 'add'] },
        time: { type: 'string', description: 'ISO string or epoch (ms or seconds)' },
        from: { type: 'string', description: 'Start time for diff (ISO or epoch)' },
        to: { type: 'string', description: 'End time for diff (ISO or epoch)' },
        amount: { type: 'number', description: 'Amount to add (for "add"; can be negative)' },
        unit: { type: 'string', enum: ['ms', 'second', 'minute', 'hour', 'day', 'week'] },
        timezone: { type: 'string', description: 'IANA timezone, e.g. Asia/Shanghai' }
      },
      required: ['operation']
    },
    requireUserConfirm,
    async call(input: {
      operation: string
      time?: unknown
      from?: unknown
      to?: unknown
      amount?: unknown
      unit?: TimeUnit
      timezone?: string
    }): Promise<string> {
      securityService.assertAgentToolAllowed('Time', input as Record<string, unknown>)
      const timezone = input.timezone
      let result: Record<string, unknown>
      switch (input.operation) {
        case 'now': result = timeNow(timezone); break
        case 'format': result = timeFormat(input.time, timezone); break
        case 'diff': result = timeDiff(input.from, input.to); break
        case 'add': result = timeAdd(input.time, input.amount, (input.unit ?? 'day') as TimeUnit, timezone); break
        default: throw new Error(`未知 operation：${String(input.operation)}（应为 now|format|diff|add）`)
      }
      return JSON.stringify(result, null, 2)
    }
  }
}

/** PDF 生成工具：Chromium 渲染，支持 Markdown / HTML / 内嵌 SVG 图表、颜色、表格。 */
export function createGeneratePdfTool(requireUserConfirm: boolean, onBeforeFileMutation?: BeforeFileMutationHook): Tool {
  return {
    name: 'GeneratePdf',
    description: `Generate a rich PDF and save it into the workspace. Rendered by the app's browser engine —
full Chinese/CJK/Unicode support, plus real layout: headings, tables, code, colors, images and CHARTS.
"format" controls how "content" is interpreted:
- "markdown" (default): GitHub-flavored Markdown. Tables, lists, code, bold/italic. Single newlines are kept.
  You may embed raw HTML for colors (e.g. <span style="color:#c00">red</span>) and inline <svg>…</svg> for charts.
- "html": a full custom HTML body — use CSS for colors/layout and inline <svg> for bar/line/pie charts.
- "text": plain text, line breaks preserved verbatim.
For charts, generate an inline <svg> (bar/line/pie) with your own axes/labels; it renders vector-crisp.
Remote resources and scripts are blocked; embed images as data: URIs.
Input: { "path": string (workspace-relative, e.g. "reports/q3.pdf"), "content": string, "title"?: string, "format"?: "markdown"|"html"|"text" }.`,
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Output path relative to the workspace root (a .pdf is appended if missing)' },
        title: { type: 'string', description: 'Optional document title rendered as a large bold header' },
        content: { type: 'string', description: 'Document body in the chosen format' },
        format: { type: 'string', enum: ['markdown', 'html', 'text'], description: 'How to interpret content (default: markdown)' }
      },
      required: ['path', 'content']
    },
    requireUserConfirm,
    async call(input: { path: string; title?: string; content: string; format?: 'markdown' | 'html' | 'text' }): Promise<string> {
      securityService.assertAgentToolAllowed('GeneratePdf', input as Record<string, unknown>)
      const raw = String(input.path ?? '').trim()
      if (!raw) throw new Error('path 不能为空')
      const base = isAbsolute(raw) ? raw : resolve(securityService.getWorkspaceRoot() ?? process.cwd(), raw)
      const absPath = securityService.resolveSafePath(base.toLowerCase().endsWith('.pdf') ? base : `${base}.pdf`)
      await onBeforeFileMutation?.(absPath)
      const title = input.title
      const content = String(input.content ?? '')
      const format = input.format ?? 'markdown'

      try {
        // 主路径：Chromium 渲染，支持中文/Unicode/Markdown/SVG 图表
        const rendered = await renderPdfDocument({ title, content, outputPath: absPath, format })
        return JSON.stringify({ created: true, path: rendered.path, bytes: rendered.bytes, engine: rendered.engine, format }, null, 2)
      } catch (error) {
        // 兜底：内置 Latin-only 生成器（Chromium 不可用时）
        const pdf = buildTextPdf({ title, content })
        await mkdir(dirname(absPath), { recursive: true })
        await writeFile(absPath, pdf.bytes)
        // 无损兜底：非 Latin 内容会被替换为 "?"，故把完整原文另存为同名 .txt，避免内容丢失
        let sidecarPath: string | undefined
        if (pdf.replacedNonLatin) {
          sidecarPath = absPath.replace(/\.pdf$/i, '') + '.txt'
          await onBeforeFileMutation?.(sidecarPath)
          await writeFile(sidecarPath, `${title ? `${title}\n\n` : ''}${content}`, 'utf-8')
        }
        return JSON.stringify({
          created: true,
          path: absPath,
          pages: pdf.pages,
          bytes: pdf.bytes.length,
          engine: 'builtin',
          sidecarTextPath: sidecarPath,
          note: pdf.replacedNonLatin
            ? `Chromium 渲染不可用，已用内置字体生成；非 Latin 字符（如中文）在 PDF 里显示为 "?"，完整原文已另存为 ${sidecarPath}。`
            : `Chromium 渲染不可用，已用内置字体生成（原因：${error instanceof Error ? error.message : String(error)}）。`
        }, null, 2)
      }
    }
  }
}
