import type { WorkspaceGitFileStatus } from '../../shared/types/workspace.js'

export interface GitDiffHunkLine {
  type: 'context' | 'add' | 'delete'
  text: string
  oldLine: number | null
  newLine: number | null
}

export interface GitDiffHunk {
  header: string
  oldStart: number
  oldLines: number
  newStart: number
  newLines: number
  additions: number
  deletions: number
  lines: GitDiffHunkLine[]
}

export function parseUnifiedDiffHunks(diff: string): GitDiffHunk[] {
  const hunks: GitDiffHunk[] = []
  let current: GitDiffHunk | null = null
  let oldLine = 0
  let newLine = 0

  for (const rawLine of diff.split('\n')) {
    const header = rawLine.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/)
    if (header) {
      current = {
        header: rawLine,
        oldStart: Number(header[1]),
        oldLines: Number(header[2] ?? 1),
        newStart: Number(header[3]),
        newLines: Number(header[4] ?? 1),
        additions: 0,
        deletions: 0,
        lines: []
      }
      oldLine = current.oldStart
      newLine = current.newStart
      hunks.push(current)
      continue
    }

    if (!current || rawLine.startsWith('diff --git ') || rawLine.startsWith('index ') || rawLine.startsWith('--- ') || rawLine.startsWith('+++ ')) {
      continue
    }

    if (rawLine.startsWith('+')) {
      current.additions += 1
      current.lines.push({ type: 'add', text: rawLine.slice(1), oldLine: null, newLine })
      newLine += 1
    } else if (rawLine.startsWith('-')) {
      current.deletions += 1
      current.lines.push({ type: 'delete', text: rawLine.slice(1), oldLine, newLine: null })
      oldLine += 1
    } else {
      const text = rawLine.startsWith(' ') ? rawLine.slice(1) : rawLine
      current.lines.push({ type: 'context', text, oldLine, newLine })
      oldLine += 1
      newLine += 1
    }
  }

  return hunks
}

/** Build a unified diff patch for a single hunk (for git apply). */
export function buildHunkPatch(path: string, hunk: GitDiffHunk, reverse = false): string {
  const lines = hunk.lines.map((line) => {
    if (reverse) {
      if (line.type === 'add') return `-${line.text}`
      if (line.type === 'delete') return `+${line.text}`
      return ` ${line.text}`
    }
    if (line.type === 'add') return `+${line.text}`
    if (line.type === 'delete') return `-${line.text}`
    return ` ${line.text}`
  })
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    hunk.header,
    ...lines,
    ''
  ].join('\n')
}

export function isGitConflict(file: WorkspaceGitFileStatus): boolean {
  const pair = `${file.index}${file.workingTree}`
  return pair === 'UU' || pair === 'AA' || pair === 'DD'
    || pair === 'AU' || pair === 'UA' || pair === 'DU' || pair === 'UD'
}

export function isGitStaged(file: WorkspaceGitFileStatus): boolean {
  return file.index !== ' ' && file.index !== '?'
}

export function isGitUnstaged(file: WorkspaceGitFileStatus): boolean {
  return file.workingTree !== ' ' && file.workingTree !== '?'
}

export function summarizeGitStatus(files: WorkspaceGitFileStatus[]): string {
  const counts = new Map<string, number>()
  for (const file of files) {
    const status = gitStatusCode(file)
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([status, count]) => `${status}:${count}`)
    .join(' ') || 'clean'
}

export function suggestCommitMessageFromStatus(files: WorkspaceGitFileStatus[]): string {
  if (!files.length) return ''
  const byExt = new Map<string, number>()
  for (const file of files) {
    const ext = file.path.split('.').pop()?.toLowerCase() || 'files'
    byExt.set(ext, (byExt.get(ext) ?? 0) + 1)
  }
  const topExt = [...byExt.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
  const hasUi = files.some((file) => /\.(vue|css|scss|html)$/.test(file.path))
  const hasDocs = files.every((file) => /\.(md|mdx|txt)$/.test(file.path))
  const hasTests = files.some((file) => /(^|\/)(test|tests|__tests__)\/|\.test\.|\.spec\./.test(file.path))

  const scope = hasDocs ? 'docs' : hasTests ? 'test' : hasUi ? 'ui' : topExt ? 'code' : 'workspace'
  const verb = files.some((file) => gitStatusCode(file).includes('A')) ? 'add' : 'update'
  return `${scope}: ${verb} ${files.length === 1 ? basename(files[0]?.path ?? 'file') : `${files.length} files`}`
}

function gitStatusCode(file: WorkspaceGitFileStatus): string {
  if (file.index === '?' || file.workingTree === '?') return 'U'
  const code = `${file.index}${file.workingTree}`.trim()
  return code || 'M'
}

function basename(path: string): string {
  return path.split('/').pop() || path
}
