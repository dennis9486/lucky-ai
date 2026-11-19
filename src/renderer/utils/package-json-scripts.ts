export interface PackageJsonScript {
  name: string
  command: string
  line: number
}

export interface PackageJsonScriptsInfo {
  scriptsLine: number | null
  scripts: PackageJsonScript[]
}

export function isPackageJsonPath(path: string): boolean {
  return path.split(/[/\\]/).pop()?.toLowerCase() === 'package.json'
}

export function getPackageJsonDir(packageJsonPath: string): string {
  const normalized = packageJsonPath.replace(/\\/g, '/')
  const index = normalized.lastIndexOf('/')
  return index >= 0 ? normalized.slice(0, index) : normalized
}

export function formatPackageScriptCommand(
  packageManager: 'pnpm' | 'yarn' | 'npm',
  scriptName: string
): string {
  const quoted = /[\s:"']/.test(scriptName)
    ? `"${scriptName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
    : scriptName
  switch (packageManager) {
    case 'pnpm':
      return `pnpm run ${quoted}`
    case 'yarn':
      return `yarn run ${quoted}`
    default:
      return `npm run ${quoted}`
  }
}

export function parsePackageJsonScripts(content: string): PackageJsonScriptsInfo {
  const scriptsLine = findScriptsBlockLine(content)
  const parsed = tryParseScriptsFromJson(content)
  if (parsed) {
    return {
      scriptsLine,
      scripts: parsed.map(({ name, command }) => ({
        name,
        command,
        line: findLineForScriptKey(content, name) ?? scriptsLine ?? 1
      }))
    }
  }
  return parseScriptsLineByLine(content, scriptsLine)
}

function tryParseScriptsFromJson(content: string): Array<{ name: string; command: string }> | null {
  try {
    const parsed = JSON.parse(content) as { scripts?: unknown }
    if (!parsed.scripts || typeof parsed.scripts !== 'object' || Array.isArray(parsed.scripts)) {
      return []
    }
    return Object.entries(parsed.scripts as Record<string, unknown>)
      .filter(([, command]) => typeof command === 'string')
      .map(([name, command]) => ({ name, command: command as string }))
  } catch {
    return null
  }
}

function parseScriptsLineByLine(content: string, scriptsLine: number | null): PackageJsonScriptsInfo {
  const lines = content.split(/\r?\n/)
  let resolvedScriptsLine = scriptsLine
  let inScripts = scriptsLine !== null
  let braceDepth = 0
  const scripts: PackageJsonScript[] = []

  if (scriptsLine !== null) {
    const headerLine = lines[scriptsLine - 1] ?? ''
    braceDepth = countChar(headerLine, '{') - countChar(headerLine, '}')
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? ''

    if (resolvedScriptsLine === null) {
      if (/^\s*"scripts"\s*:\s*\{/.test(line)) {
        resolvedScriptsLine = index + 1
        inScripts = true
        braceDepth = countChar(line, '{') - countChar(line, '}')
      }
      continue
    }

    if (!inScripts) continue

    braceDepth += countChar(line, '{') - countChar(line, '}')
    if (braceDepth <= 0) break

    const match = line.match(/^\s*"((?:\\.|[^"\\])*)"\s*:\s*"((?:\\.|[^"\\])*)"\s*,?\s*$/)
    if (!match) continue

    scripts.push({
      name: unescapeJsonString(match[1] ?? ''),
      command: unescapeJsonString(match[2] ?? ''),
      line: index + 1
    })
  }

  return { scriptsLine: resolvedScriptsLine, scripts }
}

function findScriptsBlockLine(content: string): number | null {
  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    if (/^\s*"scripts"\s*:\s*\{/.test(lines[index] ?? '')) return index + 1
  }
  return null
}

function findLineForScriptKey(content: string, key: string): number | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(`^\\s*"${escaped.replace(/\\"/g, '\\\\"')}"\\s*:`)
  const lines = content.split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    if (pattern.test(lines[index] ?? '')) return index + 1
  }
  return null
}

export async function detectPackageManager(packageDir: string): Promise<'pnpm' | 'yarn' | 'npm'> {
  const { ipc, unwrap } = await import('../services/ipc-client.js')
  const normalized = packageDir.replace(/\\/g, '/').replace(/\/$/, '')

  if (await unwrap(ipc.file.exists(`${normalized}/pnpm-lock.yaml`))) return 'pnpm'
  if (await unwrap(ipc.file.exists(`${normalized}/yarn.lock`))) return 'yarn'
  if (await unwrap(ipc.file.exists(`${normalized}/package-lock.json`))) return 'npm'
  return 'pnpm'
}

function countChar(value: string, char: string): number {
  return value.split(char).length - 1
}

function unescapeJsonString(value: string): string {
  return value.replace(/\\(["\\/bfnrtu])/g, (_, token: string) => {
    switch (token) {
      case 'b':
        return '\b'
      case 'f':
        return '\f'
      case 'n':
        return '\n'
      case 'r':
        return '\r'
      case 't':
        return '\t'
      default:
        return token
    }
  })
}
