export interface ParsedReference {
  type: 'file' | 'folder' | 'terminal' | 'browser'
  path: string
}

export function parseReferences(message: string): ParsedReference[] {
  const refs: ParsedReference[] = []
  const fileRegex = /@file\s+(\S+)/g
  const folderRegex = /@folder\s+(\S+)/g

  let m
  while ((m = fileRegex.exec(message)) !== null) {
    refs.push({ type: 'file', path: m[1]! })
  }
  while ((m = folderRegex.exec(message)) !== null) {
    refs.push({ type: 'folder', path: m[1]! })
  }
  if (message.includes('@terminal')) {
    refs.push({ type: 'terminal', path: '' })
  }
  if (message.includes('@browser')) {
    refs.push({ type: 'browser', path: '' })
  }
  return refs
}
