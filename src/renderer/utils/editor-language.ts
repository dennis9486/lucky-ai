/**
 * 纯粹的「文件 → 语言 id」映射与解析（无任何 monaco / shiki 依赖）。
 *
 * 拆成叶子模块的目的：像 CodeDiffPanel 这类只需要“语言名”的轻组件（聊天消息里的 diff 卡片），
 * 不应因一个纯函数而把整个 monaco.service 模块图（workers / 上下文菜单的 monaco-ESM / @shikijs/monaco）
 * 拉进启动包。monaco.service 仍在此基础上叠加扩展贡献的语言解析。
 */

const EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  bat: 'bat',
  c: 'c',
  cc: 'cpp',
  conf: 'ini',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  csv: 'csv',
  cxx: 'cpp',
  dockerfile: 'dockerfile',
  env: 'dotenv',
  go: 'go',
  h: 'c',
  hpp: 'cpp',
  html: 'html',
  htm: 'html',
  ini: 'ini',
  java: 'java',
  js: 'javascript',
  jsx: 'javascript',
  json: 'json',
  jsonc: 'json',
  lock: 'plaintext',
  log: 'log',
  md: 'markdown',
  mdx: 'markdown',
  mjs: 'javascript',
  php: 'php',
  pnpmfile: 'javascript',
  properties: 'ini',
  ps1: 'powershell',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  scss: 'scss',
  sh: 'shellscript',
  sql: 'sql',
  svg: 'xml',
  toml: 'toml',
  ts: 'typescript',
  tsx: 'typescript',
  txt: 'plaintext',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'shellscript'
}

const FILE_LANGUAGE_MAP: Record<string, string> = {
  '.env': 'dotenv',
  '.env.example': 'dotenv',
  '.env.local': 'dotenv',
  '.gitignore': 'ignore',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  'package.json': 'json',
  'pnpm-lock.yaml': 'yaml',
  'tsconfig.json': 'json',
  'vite.config.ts': 'typescript',
  'vitest.config.ts': 'typescript'
}

/** 内建（不含扩展贡献）文件语言解析。 */
export function resolveBuiltinEditorLanguage(path: string): string {
  const fileName = path.split(/[\\/]/).pop()?.toLowerCase() ?? ''
  if (FILE_LANGUAGE_MAP[fileName]) return FILE_LANGUAGE_MAP[fileName]

  if (fileName.startsWith('.env')) return 'dotenv'
  if (fileName === 'dockerfile' || fileName.endsWith('.dockerfile')) return 'dockerfile'
  if (fileName.endsWith('.d.ts')) return 'typescript'

  const ext = fileName.includes('.') ? fileName.split('.').pop() ?? '' : fileName
  return EXTENSION_LANGUAGE_MAP[ext] ?? 'plaintext'
}
