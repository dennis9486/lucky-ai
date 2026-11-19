/**
 * Lucky — Typed Environment Variable Accessor
 *
 * 集中式类型化环境变量访问层。
 * - Main process:  从 dotenv 加载后的 process.env 中读取
 * - Renderer:      从 Vite 注入的 import.meta.env 中读取（VITE_ 前缀）
 *
 * 所有环境变量名使用 LUCKY_ 前缀，避免与系统变量冲突。
 * 使用 getter 实现惰性读取，保证读取时 env 已加载完毕。
 */

// ─── Helper ────────────────────────────────────────────────────────────────

function str(key: string, fallback: string): string {
  return (process.env[key] as string | undefined) ?? fallback
}

function bool(key: string, fallback: boolean): boolean {
  const val = process.env[key]
  if (val === undefined || val === '') return fallback
  return val === 'true' || val === '1'
}

function list(key: string): string[] {
  const val = process.env[key]
  if (val === undefined || val.trim() === '') return []
  const delimiter = process.platform === 'win32' ? ';' : ':'
  return val.split(delimiter).map((item) => item.trim()).filter(Boolean)
}

// ─── Exported env object ──────────────────────────────────────────────────

export const env = {
  // ── Node Environment ──────────────────────────────────────────────────
  get NODE_ENV(): string {
    return str('NODE_ENV', 'development')
  },

  get IS_DEV(): boolean {
    return this.NODE_ENV === 'development' || this.NODE_ENV === 'dev'
  },

  get IS_PRODUCTION(): boolean {
    return this.NODE_ENV === 'production' || this.NODE_ENV === 'prod'
  },

  // ── Logging ──────────────────────────────────────────────────────────
  get LOG_LEVEL(): string {
    return str('LUCKY_LOG_LEVEL', 'info')
  },

  // ── Dev Tools ────────────────────────────────────────────────────────
  get DEV_TOOLS(): boolean {
    return bool('LUCKY_DEV_TOOLS', true)
  },

  // ── Web Research Engine ──────────────────────────────────────────────
  get WEB_RESEARCH_ENGINE(): string {
    return str('LUCKY_WEB_RESEARCH_ENGINE', 'electron')
  },

  // ── AI Provider 默认地址（settings.json 初始化时的 fallback 值） ────
  get OLLAMA_BASE_URL(): string {
    return str('LUCKY_OLLAMA_BASE_URL', 'http://127.0.0.1:11434')
  },

  get OPENAI_BASE_URL(): string {
    return str('LUCKY_OPENAI_BASE_URL', 'https://api.openai.com/v1')
  },

  // ── Agent Skills ─────────────────────────────────────────────────────
  get AGENT_BUILTIN_SKILLS(): boolean {
    return bool('LUCKY_AGENT_BUILTIN_SKILLS', true)
  },

  get AGENT_EXTRA_SKILL_PATHS(): string[] {
    return list('LUCKY_AGENT_EXTRA_SKILL_PATHS')
  },

  get AGENT_EXTRA_SKILL_DIRS(): string[] {
    return list('LUCKY_AGENT_EXTRA_SKILL_DIRS')
  },

  // ── 数据目录覆盖（可选，默认使用 electron.app.getPath('userData')） ─
  get DATA_DIR(): string | undefined {
    const val = process.env['LUCKY_DATA_DIR']
    return val && val.length > 0 ? val : undefined
  },

  get DB_PATH(): string | undefined {
    const val = process.env['LUCKY_DB_PATH']
    return val && val.length > 0 ? val : undefined
  },
} as const

export type EnvConfig = typeof env
