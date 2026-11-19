import { existsSync } from 'node:fs'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { app } from 'electron'
import type { ExtensionInstallResult, ExtensionManifestSummary, ExtensionRecommendations } from '../../shared/types/extension.js'
import { createLogger } from '../../shared/utils/log.js'
import { fileService } from './file.service.js'
import { extractVsix } from './vsix.js'

const EXTENSION_ROOTS = [
  join(homedir(), '.vscode', 'extensions'),
  join(homedir(), '.cursor', 'extensions'),
  join(homedir(), '.lucky-ai', 'extensions')
]

interface ExtensionState {
  disabledExtensionIds: string[]
}

/** 磁盘扫描结果缓存时长：足够合并「面板打开 + 激活贡献」的连发调用，又能较快感知外部新装扩展。 */
const SCAN_CACHE_TTL_MS = 3000

export class ExtensionService {
  private readonly logger = createLogger('main/extension-service')
  private stateLoaded = false
  private state: ExtensionState = { disabledExtensionIds: [] }
  /** 已扫描的扩展清单缓存（不含 enabled，enabled 每次按最新状态叠加）。 */
  private scanCache: { at: number; summaries: ExtensionManifestSummary[] } | null = null

  private get statePath(): string {
    return join(app.getPath('userData'), 'extension-state.json')
  }

  private async ensureStateLoaded(): Promise<void> {
    if (this.stateLoaded) return
    try {
      const raw = await readFile(this.statePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<ExtensionState>
      this.state = {
        disabledExtensionIds: Array.isArray(parsed.disabledExtensionIds)
          ? parsed.disabledExtensionIds.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          : []
      }
    } catch {
      this.state = { disabledExtensionIds: [] }
    }
    this.stateLoaded = true
  }

  private async persistState(): Promise<void> {
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeFile(this.statePath, JSON.stringify(this.state, null, 2), 'utf8')
  }

  async listInstalled(): Promise<ExtensionManifestSummary[]> {
    await this.ensureStateLoaded()
    const summaries = await this.scanInstalled()
    // enabled 由本地状态决定，每次按最新的 disabledExtensionIds 叠加，切换启用无需重扫磁盘。
    const disabled = new Set(this.state.disabledExtensionIds)
    return summaries.map((summary) => ({ ...summary, enabled: !disabled.has(summary.id) }))
  }

  /** 扫描磁盘上的扩展清单（含 package.json 解析），带 TTL 缓存以避免重复 IO。 */
  private async scanInstalled(): Promise<ExtensionManifestSummary[]> {
    const cached = this.scanCache
    if (cached && Date.now() - cached.at < SCAN_CACHE_TTL_MS) return cached.summaries

    const seen = new Set<string>()
    const results: ExtensionManifestSummary[] = []

    for (const root of EXTENSION_ROOTS) {
      if (!existsSync(root)) continue
      const entries = await readdir(root, { withFileTypes: true })
      for (const entry of entries) {
        if (!entry.isDirectory()) continue
        const manifestPath = join(root, entry.name, 'package.json')
        if (!existsSync(manifestPath)) continue
        try {
          const raw = await readFile(manifestPath, 'utf8')
          const manifest = JSON.parse(raw) as {
            name?: string
            version?: string
            publisher?: string
            displayName?: string
            description?: string
            engines?: Record<string, string>
            activationEvents?: string[]
            main?: string
            browser?: string
            contributes?: ExtensionManifestSummary['contributes']
          }
          const publisher = manifest.publisher ?? 'unknown'
          const name = manifest.name ?? entry.name
          const id = `${publisher}.${name}`
          if (seen.has(id)) continue
          seen.add(id)
          const source = root.includes('.cursor')
            ? 'cursor'
            : root.includes('.lucky-ai')
              ? 'lucky-ai'
              : 'vscode'
          results.push({
            id,
            name: manifest.displayName ?? name,
            version: manifest.version ?? '0.0.0',
            publisher,
            description: manifest.description,
            path: join(root, entry.name),
            source,
            enabled: true, // 占位；真实 enabled 由 listInstalled 按最新状态叠加
            managed: source === 'lucky-ai',
            engines: manifest.engines,
            activationEvents: manifest.activationEvents,
            main: manifest.main,
            browser: manifest.browser,
            contributes: manifest.contributes
          })
        } catch {
          // skip invalid manifests
        }
      }
    }

    const summaries = results.sort((a, b) => a.name.localeCompare(b.name))
    this.scanCache = { at: Date.now(), summaries }
    return summaries
  }

  async installFromFolder(sourcePath: string): Promise<ExtensionInstallResult> {
    const manifestPath = join(sourcePath, 'package.json')
    if (!existsSync(manifestPath)) throw new Error('扩展目录缺少 package.json')

    const raw = await readFile(manifestPath, 'utf8')
    const manifest = JSON.parse(raw) as {
      name?: string
      version?: string
      publisher?: string
      displayName?: string
      description?: string
      engines?: Record<string, string>
      activationEvents?: string[]
      main?: string
      browser?: string
      contributes?: ExtensionManifestSummary['contributes']
    }
    const publisher = manifest.publisher ?? 'unknown'
    const name = manifest.name?.trim()
    if (!name) throw new Error('扩展 package.json 缺少 name')

    const version = manifest.version ?? '0.0.0'
    const id = `${publisher}.${name}`
    const destinationRoot = join(homedir(), '.lucky-ai', 'extensions')
    const destinationPath = join(destinationRoot, `${id}-${version}`)

    await mkdir(destinationRoot, { recursive: true })
    const installed = await this.listInstalled()
    const previous = installed.find((item) => item.id === id && item.managed)
    if (previous && previous.path !== destinationPath && existsSync(previous.path)) {
      await rm(previous.path, { recursive: true, force: true })
    }
    if (existsSync(destinationPath)) {
      await rm(destinationPath, { recursive: true, force: true })
    }
    await cp(sourcePath, destinationPath, { recursive: true })
    this.scanCache = null // 磁盘已变更，作废扫描缓存，下次 listInstalled 重扫
    await this.setEnabled(id, true)

    const result: ExtensionManifestSummary = {
      id,
      name: manifest.displayName ?? name,
      version,
      publisher,
      description: manifest.description,
      path: destinationPath,
      source: 'lucky-ai',
      enabled: true,
      managed: true,
      engines: manifest.engines,
      activationEvents: manifest.activationEvents,
      main: manifest.main,
      browser: manifest.browser,
      contributes: manifest.contributes
    }

    this.logger.info('install extension from folder', {
      extensionId: id,
      sourcePath,
      destinationPath
    })

    return {
      installed: result,
      replacedExtensionId: previous?.id
    }
  }

  /**
   * 卸载扩展。仅允许卸载由 Lucky 安装的 managed 扩展（装在 ~/.lucky-ai/extensions）；
   * 来自 VS Code / Cursor 的外部扩展不属于本应用管理，只能在对应编辑器里卸载，这里拒绝以免误删。
   */
  async uninstall(extensionId: string): Promise<void> {
    const target = (await this.listInstalled()).find((item) => item.id === extensionId)
    if (!target) throw new Error(`扩展未安装: ${extensionId}`)
    if (!target.managed) {
      throw new Error('仅可卸载由 Lucky 安装的扩展；来自 VS Code / Cursor 的扩展请在对应编辑器中管理')
    }
    if (existsSync(target.path)) {
      await rm(target.path, { recursive: true, force: true })
    }
    // 清理禁用状态里的残留项，避免同名扩展重装后被误判为禁用
    await this.ensureStateLoaded()
    this.state.disabledExtensionIds = this.state.disabledExtensionIds.filter((id) => id !== extensionId)
    await this.persistState()
    this.scanCache = null
    this.logger.info('uninstall extension', { extensionId, path: target.path })
  }

  /** 读取扩展的 README（大小写不敏感，取常见文件名），供详情页渲染；无则返回空串。 */
  async readReadme(extensionId: string): Promise<string> {
    const extension = (await this.listInstalled()).find((item) => item.id === extensionId)
    if (!extension) return ''
    for (const name of ['README.md', 'readme.md', 'Readme.md', 'README.markdown', 'README']) {
      const candidate = join(extension.path, name)
      if (existsSync(candidate)) {
        try {
          return await readFile(candidate, 'utf8')
        } catch {
          return ''
        }
      }
    }
    return ''
  }

  /** 从 .vsix 内容（ZIP buffer）安装：解包到临时目录后走 installFromFolder 落盘。 */
  async installFromVsix(vsix: Buffer): Promise<ExtensionInstallResult> {
    const tempDir = join(tmpdir(), `lucky-vsix-${randomUUID()}`)
    await extractVsix(vsix, tempDir)
    try {
      return await this.installFromFolder(tempDir)
    } finally {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async setEnabled(extensionId: string, enabled: boolean): Promise<void> {
    await this.ensureStateLoaded()
    const disabled = new Set(this.state.disabledExtensionIds)
    if (enabled) disabled.delete(extensionId)
    else disabled.add(extensionId)
    this.state.disabledExtensionIds = [...disabled].sort()
    await this.persistState()
    this.logger.info('set extension enabled state', { extensionId, enabled })
  }

  async getRecommendations(): Promise<ExtensionRecommendations> {
    try {
      const file = await fileService.readFile('.vscode/extensions.json')
      const parsed = JSON.parse(stripJsonComments(file.content)) as {
        recommendations?: unknown
        unwantedRecommendations?: unknown
      }
      return {
        recommendations: toStringList(parsed.recommendations),
        unwantedRecommendations: toStringList(parsed.unwantedRecommendations)
      }
    } catch {
      return { recommendations: [], unwantedRecommendations: [] }
    }
  }
}

export const extensionService = new ExtensionService()

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function stripJsonComments(content: string): string {
  return content
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}
