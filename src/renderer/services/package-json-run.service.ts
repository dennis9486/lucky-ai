import { useTerminalStore } from '../stores/terminal.store.js'
import {
  detectPackageManager,
  formatPackageScriptCommand,
  getPackageJsonDir,
  type PackageJsonScript
} from '../utils/package-json-scripts.js'

export { formatPackageScriptCommand } from '../utils/package-json-scripts.js'

export async function runPackageJsonScript(
  packageJsonPath: string,
  scriptName: string
): Promise<void> {
  const packageDir = getPackageJsonDir(packageJsonPath)
  const packageManager = await detectPackageManager(packageDir)
  const command = formatPackageScriptCommand(packageManager, scriptName)
  const terminal = useTerminalStore()

  await terminal.openAt(packageDir, scriptName)
  await terminal.runInActiveSession(command)
}

export function findScriptAtLine(
  scripts: PackageJsonScript[],
  lineNumber: number
): PackageJsonScript | null {
  return scripts.find((script) => script.line === lineNumber) ?? null
}
