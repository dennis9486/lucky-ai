import type * as Monaco from 'monaco-editor'
import { tGlobal } from '../i18n/index.js'
import { ipc, unwrap } from './ipc-client.js'
import {
  fetchDefinitionLocations,
  fetchReferenceLocations,
  goToDefinitionAt,
  triggerEditorAction
} from './lsp-client.service.js'
import { resolveMonacoEditorTheme, resolveEditorLanguage } from './monaco.service.js'
import type { EditorSettings } from '../../shared/types/ipc.js'
import type { FileReadResult } from '../../shared/types/ipc.js'
import { cancelInlineCompletionsForEditor } from './inline-completion.service.js'

export interface DecorationRangeSpec {
  range: Monaco.IRange
  className: string
  hoverMessage?: string | Monaco.IMarkdownString
  isWholeLine?: boolean
}

export interface MonacoRuntimeOptions {
  saveFile: () => Promise<void>
  openLocation: (location: Monaco.languages.Location) => Promise<void>
  getThemeMode: () => 'light' | 'dark'
  getEditorSettings?: () => EditorSettings
}

export interface MonacoRuntime {
  decorations: DecorationController
  viewZones: ViewZoneController
  widgets: WidgetController
  dispose: () => void
}

export function applyMonacoTheme(
  monaco: typeof Monaco,
  mode: 'light' | 'dark',
  editor?: EditorSettings
): void {
  monaco.editor.setTheme(resolveMonacoEditorTheme(mode, editor))
}

export function createMonacoRuntime(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
  options: MonacoRuntimeOptions
): MonacoRuntime {
  const decorations = new DecorationController(editor)
  const viewZones = new ViewZoneController(editor)
  const widgets = new WidgetController(editor)
  const peek = new PeekController(monaco, editor, viewZones, options.openLocation, options.getThemeMode, options.getEditorSettings)
  const disposables: Monaco.IDisposable[] = [
    decorations,
    viewZones,
    widgets,
    peek,
    ...registerEditorCommands(monaco, editor, options, peek)
  ]

  return {
    decorations,
    viewZones,
    widgets,
    dispose: () => {
      for (const disposable of disposables.splice(0)) disposable.dispose()
    }
  }
}

function registerEditorCommands(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor,
  options: MonacoRuntimeOptions,
  peek: PeekController
): Monaco.IDisposable[] {
  const actions: Monaco.IDisposable[] = []
  const add = (
    id: string,
    label: string,
    keybindings: number[],
    run: () => void | Promise<void>,
    group = 'navigation',
    order = 1
  ): void => {
    actions.push(editor.addAction({
      id,
      label,
      keybindings,
      contextMenuGroupId: group,
      contextMenuOrder: order,
      run
    }))
  }

  add('lucky.editor.save', tGlobal('editor.save'), [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS], options.saveFile, '1_modification', 0)
  add('lucky.editor.find', tGlobal('editor.commands.find'), [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF], () => { triggerEditorAction(editor, 'actions.find') }, '1_modification', 1)
  add('lucky.editor.replace', tGlobal('editor.commands.replace'), [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH], () => { triggerEditorAction(editor, 'editor.action.startFindReplaceAction') }, '1_modification', 2)
  add('lucky.editor.rename', tGlobal('editor.commands.rename'), [monaco.KeyCode.F2], () => { triggerEditorAction(editor, 'editor.action.rename') }, '1_modification', 3)
  add('lucky.editor.format', tGlobal('editor.commands.format'), [monaco.KeyMod.Shift | monaco.KeyMod.Alt | monaco.KeyCode.KeyF], () => { triggerEditorAction(editor, 'editor.action.formatDocument') }, '1_modification', 4)
  add('lucky.editor.definition', tGlobal('editor.commands.definition'), [monaco.KeyCode.F12], async () => {
    await goToDefinitionAt(editor)
  }, 'navigation', 1)
  add('lucky.editor.peekDefinition', tGlobal('editor.commands.peekDefinition'), [monaco.KeyMod.Alt | monaco.KeyCode.F12], () => peekDefinition(editor, peek), 'navigation', 1.2)
  add('lucky.editor.references', tGlobal('editor.commands.references'), [monaco.KeyMod.Shift | monaco.KeyCode.F12], () => peekReferences(editor, peek), 'navigation', 1.4)
  add('lucky.editor.cancelAiCompletion', tGlobal('editor.commands.cancelAiCompletion'), [monaco.KeyMod.CtrlCmd | monaco.KeyCode.Escape], () => {
    cancelInlineCompletionsForEditor(editor)
  }, '1_modification', 5)
  add('lucky.editor.closePeek', tGlobal('common.close'), [monaco.KeyCode.Escape], () => peek.close(), 'navigation', 99)

  return actions
}

async function peekDefinition(editor: Monaco.editor.IStandaloneCodeEditor, peek: PeekController): Promise<void> {
  const locations = await fetchDefinitionLocations(editor)
  if (!locations.length) {
    triggerEditorAction(editor, 'editor.action.peekDefinition')
    return
  }
  await peek.show(locations)
}

async function peekReferences(editor: Monaco.editor.IStandaloneCodeEditor, peek: PeekController): Promise<void> {
  const locations = await fetchReferenceLocations(editor)
  if (!locations.length) {
    triggerEditorAction(editor, 'editor.action.goToReferences')
    return
  }
  await peek.show(locations, tGlobal('editor.referencesTitle', { count: locations.length }))
}

function toHoverMessage(message: DecorationRangeSpec['hoverMessage']): Monaco.IMarkdownString | undefined {
  if (!message) return undefined
  return typeof message === 'string' ? { value: message } : message
}

function safeDisposePeekModel(model: Monaco.editor.ITextModel | null): void {
  if (!model) return
  try {
    if (!model.isDisposed()) model.dispose()
  } catch {
    // Ignore teardown races.
  }
}

export class DecorationController implements Monaco.IDisposable {
  private readonly owners = new Map<string, string[]>()

  constructor(private readonly editor: Monaco.editor.IStandaloneCodeEditor) {}

  set(owner: string, specs: DecorationRangeSpec[]): void {
    const previous = this.owners.get(owner) ?? []
    const decorations: Monaco.editor.IModelDeltaDecoration[] = specs.map((spec) => ({
      range: spec.range,
      options: {
        className: spec.className,
        inlineClassName: spec.className,
        isWholeLine: spec.isWholeLine,
        hoverMessage: toHoverMessage(spec.hoverMessage)
      }
    }))
    this.owners.set(owner, this.editor.deltaDecorations(previous, decorations))
  }

  clear(owner?: string): void {
    if (owner) {
      const previous = this.owners.get(owner) ?? []
      if (previous.length) this.editor.deltaDecorations(previous, [])
      this.owners.delete(owner)
      return
    }
    for (const previous of this.owners.values()) {
      if (previous.length) this.editor.deltaDecorations(previous, [])
    }
    this.owners.clear()
  }

  dispose(): void {
    this.clear()
  }
}

export class ViewZoneController implements Monaco.IDisposable {
  private readonly zones = new Map<string, string>()
  private seq = 0

  constructor(private readonly editor: Monaco.editor.IStandaloneCodeEditor) {}

  add(spec: {
    id?: string
    afterLineNumber: number
    heightInPx: number
    domNode: HTMLElement
    marginDomNode?: HTMLElement
    suppressMouseDown?: boolean
  }): string {
    const id = spec.id ?? `lucky-zone-${++this.seq}`
    this.remove(id)
    let zoneId = ''
    this.editor.changeViewZones((accessor) => {
      zoneId = accessor.addZone({
        afterLineNumber: spec.afterLineNumber,
        heightInPx: spec.heightInPx,
        domNode: spec.domNode,
        marginDomNode: spec.marginDomNode,
        suppressMouseDown: spec.suppressMouseDown ?? false
      })
    })
    this.zones.set(id, zoneId)
    return id
  }

  remove(id: string): void {
    const zoneId = this.zones.get(id)
    if (!zoneId) return
    this.editor.changeViewZones((accessor) => accessor.removeZone(zoneId))
    this.zones.delete(id)
  }

  dispose(): void {
    for (const id of [...this.zones.keys()]) this.remove(id)
  }
}

export class WidgetController implements Monaco.IDisposable {
  private readonly contentWidgets = new Map<string, Monaco.editor.IContentWidget>()
  private readonly overlayWidgets = new Map<string, Monaco.editor.IOverlayWidget>()

  constructor(private readonly editor: Monaco.editor.IStandaloneCodeEditor) {}

  addContentWidget(widget: Monaco.editor.IContentWidget): void {
    this.removeContentWidget(widget.getId())
    this.editor.addContentWidget(widget)
    this.contentWidgets.set(widget.getId(), widget)
  }

  removeContentWidget(id: string): void {
    const widget = this.contentWidgets.get(id)
    if (!widget) return
    this.editor.removeContentWidget(widget)
    this.contentWidgets.delete(id)
  }

  addOverlayWidget(widget: Monaco.editor.IOverlayWidget): void {
    this.removeOverlayWidget(widget.getId())
    this.editor.addOverlayWidget(widget)
    this.overlayWidgets.set(widget.getId(), widget)
  }

  removeOverlayWidget(id: string): void {
    const widget = this.overlayWidgets.get(id)
    if (!widget) return
    this.editor.removeOverlayWidget(widget)
    this.overlayWidgets.delete(id)
  }

  dispose(): void {
    for (const id of [...this.contentWidgets.keys()]) this.removeContentWidget(id)
    for (const id of [...this.overlayWidgets.keys()]) this.removeOverlayWidget(id)
  }
}

class PeekController implements Monaco.IDisposable {
  private zoneId: string | null = null
  private peekEditor: Monaco.editor.IStandaloneCodeEditor | null = null
  private peekModel: Monaco.editor.ITextModel | null = null

  constructor(
    private readonly monaco: typeof Monaco,
    private readonly editor: Monaco.editor.IStandaloneCodeEditor,
    private readonly zones: ViewZoneController,
    private readonly openLocation: (location: Monaco.languages.Location) => Promise<void>,
    private readonly getThemeMode: () => 'light' | 'dark',
    private readonly getEditorSettings?: () => EditorSettings
  ) {}

  async show(locations: Monaco.languages.Location[], title?: string): Promise<void> {
    const first = locations[0]
    if (!first) return
    this.close()

    const host = document.createElement('div')
    host.className = 'lucky-monaco-peek'
    const head = document.createElement('div')
    head.className = 'lucky-monaco-peek-head'
    const label = document.createElement('button')
    label.type = 'button'
    label.className = 'lucky-monaco-peek-title'
    label.textContent = title ?? `${first.uri.fsPath}:${first.range.startLineNumber}`
    const close = document.createElement('button')
    close.type = 'button'
    close.className = 'lucky-monaco-peek-close'
    close.textContent = '×'
    close.addEventListener('click', () => this.close())
    label.addEventListener('click', () => {
      void this.openLocation(first)
      this.close()
    })
    head.append(label, close)

    const body = document.createElement('div')
    body.className = 'lucky-monaco-peek-body'
    host.append(head, body)

    const content = await this.readLocation(first)
    this.peekModel = this.monaco.editor.createModel(content, resolveEditorLanguage(first.uri.fsPath), first.uri)
    this.peekEditor = this.monaco.editor.create(body, {
      model: this.peekModel,
      automaticLayout: true,
      readOnly: true,
      domReadOnly: true,
      minimap: { enabled: false },
      lineNumbers: 'on',
      folding: false,
      glyphMargin: false,
      renderLineHighlight: 'line',
      scrollBeyondLastLine: false,
      theme: resolveMonacoEditorTheme(this.getThemeMode(), this.getEditorSettings?.()),
      fontFamily: '"JetBrains Mono", "SFMono-Regular", Consolas, "Liberation Mono", monospace',
      fontSize: 12,
      lineHeight: 20
    })
    this.peekEditor.setSelection(first.range)
    this.peekEditor.revealRangeInCenter(first.range)

    const anchor = this.editor.getPosition()?.lineNumber ?? first.range.startLineNumber
    this.zoneId = this.zones.add({
      id: 'lucky-definition-peek',
      afterLineNumber: anchor,
      heightInPx: 280,
      domNode: host,
      suppressMouseDown: true
    })
  }

  close(): void {
    if (this.zoneId) {
      this.zones.remove(this.zoneId)
      this.zoneId = null
    }
    this.peekEditor?.setModel(null)
    safeDisposePeekModel(this.peekModel)
    this.peekEditor?.dispose()
    this.peekEditor = null
    this.peekModel = null
  }

  dispose(): void {
    this.close()
  }

  private async readLocation(location: Monaco.languages.Location): Promise<string> {
    const current = this.editor.getModel()
    if (current?.uri.toString() === location.uri.toString()) return current.getValue()
    const result = await unwrap<FileReadResult>(ipc.file.read(location.uri.fsPath))
    return result.content
  }
}
