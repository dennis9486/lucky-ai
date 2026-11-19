/**
 * 极简 ANSI SGR → HTML 转换器。
 * 仅覆盖终端常见的颜色/加粗/下划线/反显，足以渲染 Bash 工具输出。
 * 先做 HTML 转义，再替换转义序列，避免注入。
 */

const FG: Record<number, string> = {
  30: '#1a1a1a', 31: '#d23f3f', 32: '#1d9e75', 33: '#ba7517',
  34: '#378add', 35: '#8a4baf', 36: '#0f8e8e', 37: '#c7c7c7',
  90: '#6b6b6b', 91: '#e24b4a', 92: '#27a371', 93: '#d09a27',
  94: '#5d9ee8', 95: '#a86fc9', 96: '#34a8a8', 97: '#f0f0f0'
}

const BG: Record<number, string> = {
  41: '#f7c1c1', 42: '#c0dd97', 43: '#fac775', 44: '#b5d4f4',
  45: '#f4c0d1', 46: '#9fe1cb', 47: '#e8e8e8'
}

interface SgrState {
  fg?: string
  bg?: string
  bold?: boolean
  underline?: boolean
  inverse?: boolean
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function styleFor(state: SgrState): string {
  const styles: string[] = []
  const fg = state.inverse ? state.bg : state.fg
  const bg = state.inverse ? state.fg : state.bg
  if (fg) styles.push(`color:${fg}`)
  if (bg) styles.push(`background:${bg}`)
  if (state.bold) styles.push('font-weight:600')
  if (state.underline) styles.push('text-decoration:underline')
  return styles.join(';')
}

function applyCodes(state: SgrState, codes: number[]): void {
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i]!
    if (code === 0) {
      state.fg = state.bg = undefined
      state.bold = state.underline = state.inverse = false
    } else if (code === 1) state.bold = true
    else if (code === 22) state.bold = false
    else if (code === 4) state.underline = true
    else if (code === 24) state.underline = false
    else if (code === 7) state.inverse = true
    else if (code === 27) state.inverse = false
    else if (code === 39) state.fg = undefined
    else if (code === 49) state.bg = undefined
    else if (FG[code]) state.fg = FG[code]
    else if (BG[code]) state.bg = BG[code]
    else if (code === 38 || code === 48) {
      // 256 / truecolor：仅消费参数，回退为默认色
      if (codes[i + 1] === 5) i += 2
      else if (codes[i + 1] === 2) i += 4
    }
  }
}

// SGR 转义序列：ESC [ 参数 m。以 charCode(27) 构造，源码中不出现控制字符。
const ESC = String.fromCharCode(27)
const ANSI_RE = new RegExp(`${ESC}\\[([0-9;]*)m`, 'g')
const HAS_ANSI_RE = new RegExp(`${ESC}\\[`)

/** 将含 ANSI 转义码的文本转为带内联样式的安全 HTML */
export function ansiToHtml(input: string): string {
  // \r 不跟换行时视作换行，避免进度条覆盖丢内容
  const normalized = input.replace(/\r(?!\n)/g, '\n')
  const state: SgrState = {}
  let html = ''
  let lastIndex = 0

  const flushText = (text: string) => {
    if (!text) return
    const style = styleFor(state)
    html += style ? `<span style="${style}">${escapeHtml(text)}</span>` : escapeHtml(text)
  }

  let match: RegExpExecArray | null
  ANSI_RE.lastIndex = 0
  while ((match = ANSI_RE.exec(normalized)) !== null) {
    flushText(normalized.slice(lastIndex, match.index))
    const codes = match[1]!.split(';').filter(Boolean).map(Number)
    applyCodes(state, codes.length ? codes : [0])
    lastIndex = ANSI_RE.lastIndex
  }
  flushText(normalized.slice(lastIndex))
  return html
}

/** 是否含 ANSI 转义码 */
export function hasAnsi(input: string): boolean {
  return HAS_ANSI_RE.test(input)
}
