/** 将编辑器/文件树路径规范为工作区下的绝对路径 */
export function resolveWorkspaceFilePath(filePath: string, workspaceRoot?: string | null): string {
  const normalized = filePath.replace(/\\/g, '/').trim()
  if (!normalized) return normalized

  const root = workspaceRoot?.replace(/\\/g, '/').replace(/\/$/, '') ?? ''
  if (!root) return normalized

  if (normalized === root || normalized.startsWith(`${root}/`)) {
    return normalized
  }

  // Windows 绝对路径
  if (/^[a-zA-Z]:\//.test(normalized)) return normalized

  // macOS / Linux 用户目录下的真实绝对路径
  if (
    normalized.startsWith('/Users/')
    || normalized.startsWith('/home/')
    || normalized.startsWith('/var/')
    || normalized.startsWith('/private/')
  ) {
    return normalized
  }

  // Monaco Uri.file('src/...') 在 Unix 上会变成 /src/...，需拼回工作区根
  if (normalized.startsWith('/')) {
    return `${root}/${normalized.slice(1)}`
  }

  return `${root}/${normalized.replace(/^\.\/+/, '')}`
}

/** 绝对路径 → 工作区相对路径（供 Tab / Problems 面板使用） */
export function toWorkspaceRelativePath(filePath: string, workspaceRoot?: string | null): string {
  const normalized = filePath.replace(/\\/g, '/').trim()
  if (!normalized) return normalized

  const root = workspaceRoot?.replace(/\\/g, '/').replace(/\/$/, '') ?? ''
  if (root && (normalized === root || normalized.startsWith(`${root}/`))) {
    return normalized === root ? '' : normalized.slice(root.length + 1)
  }

  return normalized.replace(/^\.\/+/, '').replace(/^\//, '')
}
