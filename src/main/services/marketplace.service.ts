import type { ExtensionInstallResult, MarketplaceExtension } from '../../shared/types/extension.js'
import { createLogger } from '../../shared/utils/log.js'
import { extensionService } from './extension.service.js'

/**
 * VSCode 扩展市场 —— 用 Open VSX（open-vsx.org）而非微软官方 Marketplace。
 *
 * 微软 Marketplace 的服务条款只授权其官方产品使用；第三方客户端（VSCodium/Gitpod/Theia/Cursor 等）
 * 一律走厂商中立的 Open VSX 开放注册表。这里只用其公开 REST API：检索 + 取详情（含 .vsix 下载地址）。
 */

const OPEN_VSX_API = 'https://open-vsx.org/api'
const MAX_SIZE = 50

interface OpenVsxSearchItem {
  namespace?: string
  name?: string
  version?: string
  displayName?: string
  description?: string
  downloadCount?: number
  averageRating?: number
  files?: { icon?: string; download?: string }
}

interface OpenVsxDetail {
  namespace?: string
  name?: string
  version?: string
  files?: { download?: string }
}

class MarketplaceService {
  private readonly logger = createLogger('main/marketplace')

  async search(query: string, size = 24): Promise<MarketplaceExtension[]> {
    const q = query.trim()
    if (!q) return []
    const url = `${OPEN_VSX_API}/-/search?query=${encodeURIComponent(q)}&size=${Math.min(size, MAX_SIZE)}&offset=0`
    const response = await fetch(url, { headers: { accept: 'application/json' } })
    if (!response.ok) throw new Error(`市场检索失败（HTTP ${response.status}）`)
    const json = (await response.json()) as { extensions?: OpenVsxSearchItem[] }
    return (json.extensions ?? [])
      .filter((item): item is OpenVsxSearchItem & { namespace: string; name: string } =>
        Boolean(item.namespace && item.name))
      .map((item) => ({
        id: `${item.namespace}.${item.name}`,
        namespace: item.namespace,
        name: item.name,
        version: item.version ?? '',
        displayName: item.displayName || item.name,
        description: item.description,
        publisher: item.namespace,
        downloadCount: item.downloadCount,
        averageRating: item.averageRating,
        iconUrl: item.files?.icon
      }))
  }

  /** 从市场安装：取详情拿 .vsix 下载地址 → 下载 → 交给 extensionService 解包落盘。 */
  async install(namespace: string, name: string, version?: string): Promise<ExtensionInstallResult> {
    const detailUrl = version
      ? `${OPEN_VSX_API}/${namespace}/${name}/${encodeURIComponent(version)}`
      : `${OPEN_VSX_API}/${namespace}/${name}`
    const detailResponse = await fetch(detailUrl, { headers: { accept: 'application/json' } })
    if (!detailResponse.ok) throw new Error(`获取扩展信息失败（HTTP ${detailResponse.status}）`)
    const detail = (await detailResponse.json()) as OpenVsxDetail
    const downloadUrl = detail.files?.download
    if (!downloadUrl) throw new Error('该扩展未提供可下载的 .vsix')

    this.logger.info('download vsix', { namespace, name, version: detail.version, downloadUrl })
    const vsixResponse = await fetch(downloadUrl)
    if (!vsixResponse.ok) throw new Error(`下载 .vsix 失败（HTTP ${vsixResponse.status}）`)
    const vsix = Buffer.from(await vsixResponse.arrayBuffer())
    return extensionService.installFromVsix(vsix)
  }
}

export const marketplaceService = new MarketplaceService()
