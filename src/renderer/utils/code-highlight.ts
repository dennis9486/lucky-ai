import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'

const ALIASES: Record<string, string> = {
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  md: 'markdown',
  markdown: 'markdown',
  htm: 'xml',
  html: 'xml',
  vue: 'xml',
  xml: 'xml',
  text: 'plaintext',
  txt: 'plaintext',
  log: 'plaintext'
}

let registered = false

function ensureRegistered(): void {
  if (registered) return
  for (const lang of [
    bash, css, go, java, javascript, json, markdown, python, rust, sql, typescript, xml, yaml
  ]) {
    hljs.registerLanguage(lang.name, lang)
  }
  registered = true
}

export function normalizeHighlightLanguage(lang?: string): string | undefined {
  const normalized = lang?.trim().toLowerCase()
  if (!normalized) return undefined
  return ALIASES[normalized] ?? normalized
}

export function highlightCode(text: string, lang?: string): string {
  ensureRegistered()
  const resolved = normalizeHighlightLanguage(lang)

  if (resolved === 'plaintext') {
    return escapeHtml(text)
  }

  if (resolved && hljs.getLanguage(resolved)) {
    return hljs.highlight(text, { language: resolved }).value
  }

  if (text.length < 12_000) {
    const auto = hljs.highlightAuto(text)
    if (auto.relevance > 5) return auto.value
  }

  return escapeHtml(text)
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
