import type * as Monaco from 'monaco-editor'
import { MenuId, MenuRegistry } from 'monaco-editor/esm/vs/platform/actions/common/actions.js'
import { CommandsRegistry } from 'monaco-editor/esm/vs/platform/commands/common/commands.js'
import { buildReferenceToken } from '../utils/mention.js'
import { tGlobal } from '../i18n/index.js'
import { getActiveMonacoPane, getMonacoPane } from './monaco-runtime.registry.js'
import { openManualInlineEditComposer } from './manual-inline-edit.service.js'
import { useCodeAgentStore } from '../stores/code-agent.store.js'
import { useEditorStore } from '../stores/editor.store.js'
import { useUiStore } from '../stores/ui.store.js'

let agentMenuRegistered = false

/** Register Cursor-style agent items into Monaco's native editor context menu (MenuRegistry). */
export function registerEditorAgentContextMenu(): void {
  if (agentMenuRegistered) return
  agentMenuRegistered = true

  const t = (key: string) => tGlobal(`editor.contextMenu.${key}`)

  CommandsRegistry.registerCommand('lucky.editor.addSymbolToChat', () => {
    const pane = resolveFocusedEditorPane()
    if (!pane) return
    addSymbolToAgent(pane.editor, pane.tabPath(), false)
  })

  CommandsRegistry.registerCommand('lucky.editor.addSymbolToNewChat', () => {
    const pane = resolveFocusedEditorPane()
    if (!pane) return
    addSymbolToAgent(pane.editor, pane.tabPath(), true)
  })

  CommandsRegistry.registerCommand('lucky.editor.inlineEdit', () => {
    openManualInlineEditComposer()
  })

  MenuRegistry.appendMenuItem(MenuId.EditorContext, {
    command: { id: 'lucky.editor.addSymbolToChat', title: t('addSymbolToChat') },
    group: 'lucky_agent',
    order: 1
  })
  MenuRegistry.appendMenuItem(MenuId.EditorContext, {
    command: { id: 'lucky.editor.addSymbolToNewChat', title: t('addSymbolToNewChat') },
    group: 'lucky_agent',
    order: 2
  })
  MenuRegistry.appendMenuItem(MenuId.EditorContext, {
    command: { id: 'lucky.editor.inlineEdit', title: t('inlineEdit') },
    group: '1_modification',
    order: 2.5
  })
}

function resolveFocusedEditorPane() {
  const editor = useEditorStore()
  return getActiveMonacoPane(editor.focusedPane) ?? getMonacoPane('primary')
}

function addSymbolToAgent(
  editor: Monaco.editor.IStandaloneCodeEditor,
  tabPath: string | null,
  createNew: boolean
): void {
  if (!tabPath) return
  const agent = useCodeAgentStore()
  const ui = useUiStore()
  const model = editor.getModel()
  const position = editor.getPosition()
  const word = position && model ? model.getWordAtPosition(position) : null

  if (createNew) agent.newSession()
  ui.currentView = 'code'
  ui.codeAgentVisible = true
  agent.addAttachments([{ path: tabPath, name: tabPath.split(/[\\/]/).pop() ?? tabPath, kind: 'file' }])

  const token = buildReferenceToken('file', tabPath)
  const symbolHint = word && position
    ? ` (${word.word} L${position.lineNumber})`
    : ''
  const next = `${token}${symbolHint}`
  agent.input = agent.input.trim()
    ? `${agent.input.trim()} ${next}`
    : next
}
