export interface GitConflictRegion {
  id: string
  markerStartLine: number
  markerEndLine: number
  oursStartLine: number
  oursEndLine: number
  separatorLine: number
  theirsStartLine: number
  theirsEndLine: number
  ours: string
  theirs: string
  base?: string
}

export interface ParsedGitConflict {
  regions: GitConflictRegion[]
  hasMarkers: boolean
}

const START = /^<<<<<<<(?:\s+(.+))?$/
const SEP = /^=======\s*$/
const END = /^>>>>>>>(?:\s+(.+))?$/

export function parseGitConflictMarkers(content: string): ParsedGitConflict {
  const lines = content.split('\n')
  const regions: GitConflictRegion[] = []
  let index = 0

  while (index < lines.length) {
    const startMatch = lines[index]?.match(START)
    if (!startMatch) {
      index += 1
      continue
    }

    const markerStartLine = index + 1
    const oursStartLine = index + 2
    const oursLines: string[] = []
    index += 1
    while (index < lines.length && !SEP.test(lines[index] ?? '')) {
      oursLines.push(lines[index] ?? '')
      index += 1
    }
    if (index >= lines.length) break

    const oursEndLine = index
    const separatorLine = index + 1
    const theirsLines: string[] = []
    index += 1
    while (index < lines.length && !END.test(lines[index] ?? '')) {
      theirsLines.push(lines[index] ?? '')
      index += 1
    }
    const theirsStartLine = separatorLine + 1
    const theirsEndLine = index
    const markerEndLine = index + 1
    index += 1

    regions.push({
      id: `conflict-${markerStartLine}`,
      markerStartLine,
      markerEndLine,
      oursStartLine,
      oursEndLine,
      separatorLine,
      theirsStartLine,
      theirsEndLine,
      ours: oursLines.join('\n'),
      theirs: theirsLines.join('\n')
    })
  }

  return { regions, hasMarkers: regions.length > 0 }
}

export function applyConflictResolution(
  content: string,
  region: GitConflictRegion,
  side: 'ours' | 'theirs'
): string {
  const lines = content.split('\n')
  const before = lines.slice(0, Math.max(0, region.markerStartLine - 1))
  const after = lines.slice(region.markerEndLine)
  const chosen = side === 'ours' ? region.ours : region.theirs
  const middle = chosen.length ? chosen.split('\n') : []
  return [...before, ...middle, ...after].join('\n')
}

export function applyAllConflictResolution(content: string, side: 'ours' | 'theirs'): string {
  let next = content
  const parsed = parseGitConflictMarkers(next)
  for (const region of [...parsed.regions].reverse()) {
    next = applyConflictResolution(next, region, side)
  }
  return next
}

export function buildConflictDecorationRanges(region: GitConflictRegion, active: boolean): Array<{
  startLineNumber: number
  endLineNumber: number
  className: string
}> {
  const activeSuffix = active ? '-active' : ''
  return [
    {
      startLineNumber: region.markerStartLine,
      endLineNumber: region.markerStartLine,
      className: `lucky-conflict-marker-start${activeSuffix}`
    },
    {
      startLineNumber: region.oursStartLine,
      endLineNumber: Math.max(region.oursStartLine, region.oursEndLine),
      className: `lucky-conflict-ours${activeSuffix}`
    },
    {
      startLineNumber: region.separatorLine,
      endLineNumber: region.separatorLine,
      className: `lucky-conflict-separator${activeSuffix}`
    },
    {
      startLineNumber: region.theirsStartLine,
      endLineNumber: Math.max(region.theirsStartLine, region.theirsEndLine),
      className: `lucky-conflict-theirs${activeSuffix}`
    },
    {
      startLineNumber: region.markerEndLine,
      endLineNumber: region.markerEndLine,
      className: `lucky-conflict-marker-end${activeSuffix}`
    }
  ]
}
