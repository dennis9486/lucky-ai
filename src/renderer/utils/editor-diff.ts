export interface DiffHunk {
  id: string
  header: string
  originalStart: number
  originalEnd: number
  modifiedStart: number
  modifiedEnd: number
  additions: number
  deletions: number
}

type DiffOp =
  | { type: 'equal'; originalLine: number; modifiedLine: number }
  | { type: 'add'; modifiedLine: number }
  | { type: 'delete'; originalLine: number }

export function splitTextLines(text: string): string[] {
  return text.split('\n')
}

function buildFallbackHunk(original: string, modified: string): DiffHunk[] {
  if (original === modified) return []
  const originalLines = splitTextLines(original)
  const modifiedLines = splitTextLines(modified)
  return [{
    id: `0:${originalLines.length}:0:${modifiedLines.length}`,
    header: `@@ -1,${originalLines.length} +1,${modifiedLines.length} @@`,
    originalStart: 0,
    originalEnd: originalLines.length,
    modifiedStart: 0,
    modifiedEnd: modifiedLines.length,
    additions: modifiedLines.length,
    deletions: originalLines.length
  }]
}

function buildLineDiffOps(originalLines: string[], modifiedLines: string[]): DiffOp[] {
  const width = modifiedLines.length + 1
  const cells = (originalLines.length + 1) * width
  if (cells > 420_000) return []

  const dp = new Uint16Array(cells)
  for (let i = originalLines.length - 1; i >= 0; i -= 1) {
    for (let j = modifiedLines.length - 1; j >= 0; j -= 1) {
      const originalLine = originalLines[i] ?? ''
      const modifiedLine = modifiedLines[j] ?? ''
      const diagonal = dp[(i + 1) * width + j + 1] ?? 0
      const below = dp[(i + 1) * width + j] ?? 0
      const right = dp[i * width + j + 1] ?? 0
      dp[i * width + j] = originalLine === modifiedLine
        ? diagonal + 1
        : Math.max(below, right)
    }
  }

  const ops: DiffOp[] = []
  let i = 0
  let j = 0
  while (i < originalLines.length && j < modifiedLines.length) {
    const originalLine = originalLines[i] ?? ''
    const modifiedLine = modifiedLines[j] ?? ''
    if (originalLine === modifiedLine) {
      ops.push({ type: 'equal', originalLine: i, modifiedLine: j })
      i += 1
      j += 1
    } else if ((dp[(i + 1) * width + j] ?? 0) >= (dp[i * width + j + 1] ?? 0)) {
      ops.push({ type: 'delete', originalLine: i })
      i += 1
    } else {
      ops.push({ type: 'add', modifiedLine: j })
      j += 1
    }
  }
  while (i < originalLines.length) {
    ops.push({ type: 'delete', originalLine: i })
    i += 1
  }
  while (j < modifiedLines.length) {
    ops.push({ type: 'add', modifiedLine: j })
    j += 1
  }
  return ops
}

export function buildDiffHunks(original: string, modified: string): DiffHunk[] {
  if (original === modified) return []
  const originalLines = splitTextLines(original)
  const modifiedLines = splitTextLines(modified)
  const ops = buildLineDiffOps(originalLines, modifiedLines)
  if (!ops.length) return buildFallbackHunk(original, modified)

  const hunks: DiffHunk[] = []
  let originalCursor = 0
  let modifiedCursor = 0
  let pending: Omit<DiffHunk, 'id' | 'header'> | null = null

  const closePending = (): void => {
    if (!pending) return
    const originalCount = Math.max(1, pending.originalEnd - pending.originalStart)
    const modifiedCount = Math.max(1, pending.modifiedEnd - pending.modifiedStart)
    const header = `@@ -${pending.originalStart + 1},${originalCount} +${pending.modifiedStart + 1},${modifiedCount} @@`
    hunks.push({
      ...pending,
      id: `${pending.originalStart}:${pending.originalEnd}:${pending.modifiedStart}:${pending.modifiedEnd}:${pending.additions}:${pending.deletions}`,
      header
    })
    pending = null
  }

  for (const op of ops) {
    if (op.type === 'equal') {
      closePending()
      originalCursor += 1
      modifiedCursor += 1
      continue
    }

    if (!pending) {
      pending = {
        originalStart: originalCursor,
        originalEnd: originalCursor,
        modifiedStart: modifiedCursor,
        modifiedEnd: modifiedCursor,
        additions: 0,
        deletions: 0
      }
    }

    if (op.type === 'delete') {
      originalCursor += 1
      pending.originalEnd = originalCursor
      pending.deletions += 1
    } else {
      modifiedCursor += 1
      pending.modifiedEnd = modifiedCursor
      pending.additions += 1
    }
  }
  closePending()
  return hunks
}

export function summarizeDiffHunks(hunks: DiffHunk[]): { additions: number; deletions: number; count: number } {
  return {
    count: hunks.length,
    additions: hunks.reduce((sum, hunk) => sum + hunk.additions, 0),
    deletions: hunks.reduce((sum, hunk) => sum + hunk.deletions, 0)
  }
}

export function applyAcceptedDiffHunk(original: string, modified: string, hunk: DiffHunk): string {
  const originalLines = splitTextLines(original)
  const modifiedLines = splitTextLines(modified)
  const replacement = modifiedLines.slice(hunk.modifiedStart, hunk.modifiedEnd)
  originalLines.splice(hunk.originalStart, hunk.originalEnd - hunk.originalStart, ...replacement)
  return originalLines.join('\n')
}

export function applyRejectedDiffHunk(original: string, modified: string, hunk: DiffHunk): string {
  const originalLines = splitTextLines(original)
  const modifiedLines = splitTextLines(modified)
  const replacement = originalLines.slice(hunk.originalStart, hunk.originalEnd)
  modifiedLines.splice(hunk.modifiedStart, hunk.modifiedEnd - hunk.modifiedStart, ...replacement)
  return modifiedLines.join('\n')
}
