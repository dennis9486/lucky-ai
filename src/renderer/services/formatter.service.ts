import type * as Monaco from 'monaco-editor'
import type { FormatFileResult } from '../../shared/types/ipc.js'
import { resolveWorkspaceFilePath } from '../../shared/utils/workspace-path.js'
import { ipc, unwrap } from './ipc-client.js'

export async function formatDocumentContent(
  path: string,
  content: string,
  workspaceRoot: string | null | undefined,
  preferredFormatter?: FormatFileResult['formatter'] | 'auto'
): Promise<FormatFileResult> {
  const absPath = resolveWorkspaceFilePath(path, workspaceRoot)
  const root = workspaceRoot?.replace(/\\/g, '/').replace(/\/$/, '') ?? ''
  if (!root) return { content, formatter: 'none' }
  return unwrap<FormatFileResult>(ipc.formatter.format({
    path: absPath,
    content,
    workspaceRoot: root,
    preferredFormatter
  }))
}

export function registerFormatterProviders(
  monaco: typeof Monaco,
  getWorkspaceRoot: () => string | null | undefined,
  getPreferredFormatter: () => 'auto' | 'prettier' | 'eslint' | 'lsp'
): Monaco.IDisposable {
  const selector = { pattern: '**/*' }
  return monaco.languages.registerDocumentFormattingEditProvider(selector, {
    provideDocumentFormattingEdits: async (model) => {
      const workspaceRoot = getWorkspaceRoot()
      if (!workspaceRoot) return []
      const preferredFormatter = getPreferredFormatter()
      if (preferredFormatter === 'lsp') return []
      const fsPath = model.uri.fsPath.replace(/\\/g, '/')
      const root = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '')
      const tabPath = fsPath.startsWith(`${root}/`) ? fsPath.slice(root.length + 1) : fsPath
      const result = await formatDocumentContent(tabPath, model.getValue(), workspaceRoot, preferredFormatter)
      if (result.formatter === 'none' || result.content === model.getValue()) return []
      return [{ range: model.getFullModelRange(), text: result.content }]
    }
  })
}
