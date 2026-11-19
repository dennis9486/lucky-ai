import type * as Monaco from 'monaco-editor'
import {
  findScriptAtLine,
  runPackageJsonScript
} from './package-json-run.service.js'
import {
  isPackageJsonPath,
  parsePackageJsonScripts,
  type PackageJsonScript
} from '../utils/package-json-scripts.js'

export const PACKAGE_JSON_RUN_COMMAND = 'lucky.packageJson.runScript'
export const PACKAGE_JSON_DEBUG_COMMAND = 'lucky.packageJson.openDebugMenu'

export interface PackageJsonDebugMenuRequest {
  packagePath: string
  scripts: PackageJsonScript[]
  x: number
  y: number
}

let featuresRegistered = false
let menuHandler: ((request: PackageJsonDebugMenuRequest) => void) | null = null
let lastPackageJsonEditor: Monaco.editor.IStandaloneCodeEditor | null = null

export function onPackageJsonDebugMenu(
  handler: (request: PackageJsonDebugMenuRequest) => void
): () => void {
  menuHandler = handler
  return () => {
    if (menuHandler === handler) menuHandler = null
  }
}

export function registerPackageJsonScriptSupport(monaco: typeof Monaco): Monaco.IDisposable {
  if (featuresRegistered) {
    return { dispose: () => undefined }
  }
  featuresRegistered = true

  const runCommand = monaco.editor.registerCommand(
    PACKAGE_JSON_RUN_COMMAND,
    (_accessor, uriString: string, scriptName: string) => {
      const model = monaco.editor.getModel(monaco.Uri.parse(uriString))
      if (!model || !scriptName) return
      void runPackageJsonScript(model.uri.fsPath, scriptName)
    }
  )

  const debugCommand = monaco.editor.registerCommand(
    PACKAGE_JSON_DEBUG_COMMAND,
    (_accessor, uriString: string, scriptsLine: number) => {
      const model = monaco.editor.getModel(monaco.Uri.parse(uriString))
      if (!model || !menuHandler) return

      const editor = lastPackageJsonEditor
      if (editor?.getModel()?.uri.toString() === uriString) {
        openPackageJsonDebugMenu(editor, monaco, model.uri.fsPath, scriptsLine)
        return
      }

      const info = parsePackageJsonScripts(model.getValue())
      if (!info.scripts.length) return
      menuHandler({
        packagePath: model.uri.fsPath,
        scripts: info.scripts,
        x: 0,
        y: 0
      })
    }
  )

  const providerDisposable = monaco.languages.registerCodeLensProvider('json', {
    provideCodeLenses(model) {
      if (!isPackageJsonPath(model.uri.fsPath)) {
        return { lenses: [], dispose: () => undefined }
      }

      const info = parsePackageJsonScripts(model.getValue())
      if (!info.scriptsLine || !info.scripts.length) {
        return { lenses: [], dispose: () => undefined }
      }

      const uri = model.uri.toString()
      const lenses: Monaco.languages.CodeLens[] = [
        {
          range: {
            startLineNumber: info.scriptsLine,
            startColumn: 1,
            endLineNumber: info.scriptsLine,
            endColumn: 1
          },
          command: {
            id: PACKAGE_JSON_DEBUG_COMMAND,
            title: '▷ Debug',
            arguments: [uri, info.scriptsLine]
          }
        }
      ]

      return { lenses, dispose: () => undefined }
    },
    resolveCodeLens(_model, codeLens) {
      return codeLens
    }
  })

  return {
    dispose: () => {
      featuresRegistered = false
      runCommand.dispose()
      debugCommand.dispose()
      providerDisposable.dispose()
    }
  }
}

export function bindPackageJsonScriptEditor(
  monaco: typeof Monaco,
  editor: Monaco.editor.IStandaloneCodeEditor
): Monaco.IDisposable {
  let glyphIds: string[] = []

  const focusDisposable = editor.onDidFocusEditorWidget(() => {
    lastPackageJsonEditor = editor
  })

  const refreshGlyphs = (): void => {
    const model = editor.getModel()
    if (!model || !isPackageJsonPath(model.uri.fsPath)) {
      glyphIds = editor.deltaDecorations(glyphIds, [])
      editor.updateOptions({ glyphMargin: false })
      return
    }

    editor.updateOptions({ glyphMargin: true })
    const info = parsePackageJsonScripts(model.getValue())
    glyphIds = editor.deltaDecorations(
      glyphIds,
      info.scripts.map((script) => ({
        range: new monaco.Range(script.line, 1, script.line, 1),
        options: {
          glyphMarginClassName: 'package-json-run-glyph',
          glyphMarginHoverMessage: { value: `Run Script: ${script.name}` }
        }
      }))
    )
  }

  const mouseDisposable = editor.onMouseDown((event) => {
    if (event.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) return
    const model = editor.getModel()
    const lineNumber = event.target.position?.lineNumber
    if (!model || !lineNumber || !isPackageJsonPath(model.uri.fsPath)) return

    const info = parsePackageJsonScripts(model.getValue())
    const script = findScriptAtLine(info.scripts, lineNumber)
    if (!script) return

    event.event.preventDefault()
    event.event.stopPropagation()
    void runPackageJsonScript(model.uri.fsPath, script.name)
  })

  const contentDisposable = editor.onDidChangeModelContent(refreshGlyphs)
  const modelDisposable = editor.onDidChangeModel(refreshGlyphs)
  refreshGlyphs()

  return {
    dispose: () => {
      focusDisposable.dispose()
      mouseDisposable.dispose()
      contentDisposable.dispose()
      modelDisposable.dispose()
      glyphIds = editor.deltaDecorations(glyphIds, [])
      if (lastPackageJsonEditor === editor) lastPackageJsonEditor = null
    }
  }
}

export function openPackageJsonDebugMenu(
  editor: Monaco.editor.IStandaloneCodeEditor,
  monaco: typeof Monaco,
  packagePath: string,
  scriptsLine: number
): void {
  if (!menuHandler) return
  const model = editor.getModel()
  if (!model) return

  const info = parsePackageJsonScripts(model.getValue())
  if (!info.scripts.length) return

  const coords = editor.getScrolledVisiblePosition({ lineNumber: scriptsLine, column: 1 })
  const editorDom = editor.getDomNode()?.getBoundingClientRect()
  if (!coords || !editorDom) return

  menuHandler({
    packagePath,
    scripts: info.scripts,
    x: editorDom.left + coords.left,
    y: editorDom.top + coords.top + coords.height + 4
  })
}
