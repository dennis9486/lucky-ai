import type { FileTreeNode } from '../../shared/types/workspace.js'

export function dirname(path: string): string {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  return parts.join('/') || '.'
}

export function joinPath(dir: string, name: string): string {
  return dir === '.' ? name : `${dir.replace(/\/$/, '')}/${name}`
}

export function resolveCreateParentDir(selected: FileTreeNode | null): string {
  if (!selected) return '.'
  if (selected.type === 'directory') return selected.path
  return dirname(selected.path)
}

export function ancestorDirectoryPaths(path: string): string[] {
  const parts = path.split('/').filter(Boolean)
  parts.pop()
  const dirs: string[] = []
  for (let index = 1; index <= parts.length; index += 1) {
    dirs.push(parts.slice(0, index).join('/'))
  }
  return dirs
}

export async function findUniqueSiblingName(
  parentDir: string,
  baseName: string,
  exists: (path: string) => Promise<boolean>,
  options: { counterStyle: 'dash' | 'space' } = { counterStyle: 'dash' }
): Promise<string> {
  let candidate = baseName
  let counter = 1
  while (await exists(joinPath(parentDir, candidate))) {
    const extMatch = /^(.+?)(\.[^./]+)$/.exec(baseName)
    if (extMatch) {
      candidate = `${extMatch[1]}-${counter}${extMatch[2]}`
    } else if (options.counterStyle === 'space') {
      candidate = `${baseName} ${counter + 1}`
    } else {
      candidate = `${baseName}-${counter}`
    }
    counter += 1
  }
  return candidate
}
