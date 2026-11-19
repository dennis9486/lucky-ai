/**
 * site-permission.service.ts — 内嵌浏览器的按站点权限管理
 *
 * 之前 webview 分区的权限是静态全局集合（剪贴板放行、其余全拒）。现在改为
 * Chrome 式按站点决策：摄像头/麦克风/定位/通知/剪贴板读取首次请求时弹原生
 * 对话框询问用户，选择被记住（按 origin × permission），后续同站点请求
 * 直接按记录放行/拒绝。未纳入询问集的权限一律拒绝（保守默认）。
 *
 * 存储：app_preferences 单键 JSON（{ origin: { permission: 'allow'|'deny' } }），
 * 站点量级小，无需独立表。并发去重：同一 origin×permission 的并发请求共享
 * 一次询问结果，避免弹框风暴。
 */

import { dialog, type BrowserWindow } from 'electron'
import type Database from 'better-sqlite3'
import { DatabaseService } from '../db/database.service.js'
import { createLogger } from '../../shared/utils/log.js'

const PREF_KEY = 'browser.sitePermissions'
const logger = createLogger('main/site-permission')

/** 需要询问用户的权限（其余一律拒绝） */
const ASKABLE_PERMISSIONS = new Set([
  'media',            // 摄像头 + 麦克风
  'geolocation',
  'notifications',
  'clipboard-read'
])

/** 无需询问、直接放行的低风险权限 */
const AUTO_ALLOWED_PERMISSIONS = new Set([
  'clipboard-sanitized-write',
  'fullscreen'
])

const PERMISSION_LABELS: Record<string, string> = {
  media: '摄像头 / 麦克风',
  geolocation: '地理位置',
  notifications: '通知',
  'clipboard-read': '读取剪贴板'
}

export type SitePermissionDecision = 'allow' | 'deny'
export type SitePermissionMap = Record<string, Record<string, SitePermissionDecision>>

/**
 * 站点级 AI 操作授权：
 * - 'auto'  该站点允许 AI 自动操作（点击/填表/按键跳过逐次确认）
 * - 'ask'   默认——按全局审批模式逐次确认（无记录即此值）
 * - 'block' 禁止 AI 在该站点执行任何操作（工具调用被硬拒）
 */
export type AgentSitePolicy = 'auto' | 'ask' | 'block'

const AGENT_POLICY_PREF_KEY = 'browser.agentSitePolicies'

export class SitePermissionService {
  private getWindow: (() => BrowserWindow | null) | null = null
  /** 并发去重：origin|permission → 进行中的询问 */
  private readonly pendingAsks = new Map<string, Promise<boolean>>()

  constructor(private readonly resolveDb: () => Database.Database = () => DatabaseService.getInstance().db) {}

  init(getWindow: () => BrowserWindow | null): void {
    this.getWindow = getWindow
  }

  /**
   * 权限请求决策入口（permission handler 调用）。
   * 记录优先 → 询问集内弹框问并记住 → 其余拒绝。
   */
  async decide(origin: string, permission: string): Promise<boolean> {
    if (AUTO_ALLOWED_PERMISSIONS.has(permission)) return true
    if (!ASKABLE_PERMISSIONS.has(permission)) {
      logger.debug('deny non-askable permission', { origin, permission })
      return false
    }
    const stored = this.get(origin, permission)
    if (stored) return stored === 'allow'

    const key = `${origin}|${permission}`
    const pending = this.pendingAsks.get(key)
    if (pending) return pending

    const ask = this.askUser(origin, permission).finally(() => this.pendingAsks.delete(key))
    this.pendingAsks.set(key, ask)
    return ask
  }

  get(origin: string, permission: string): SitePermissionDecision | null {
    return this.readAll()[origin]?.[permission] ?? null
  }

  set(origin: string, permission: string, decision: SitePermissionDecision): void {
    const all = this.readAll()
    all[origin] = { ...all[origin], [permission]: decision }
    this.writeAll(all)
  }

  list(): SitePermissionMap {
    return this.readAll()
  }

  clearSite(origin: string): void {
    const all = this.readAll()
    delete all[origin]
    this.writeAll(all)
  }

  clearAll(): void {
    this.writeAll({})
  }

  // ── 站点级 AI 操作授权 ───────────────────────────────────

  /** 某站点的 AI 操作策略（无记录 = 'ask'，跟随全局审批模式） */
  getAgentPolicy(origin: string): AgentSitePolicy {
    if (!origin) return 'ask'
    const policy = this.readAgentPolicies()[origin]
    return policy === 'auto' || policy === 'block' ? policy : 'ask'
  }

  /** 设置/清除某站点的 AI 操作策略（'ask' 即清除记录，回到默认） */
  setAgentPolicy(origin: string, policy: AgentSitePolicy): void {
    if (!origin) return
    const all = this.readAgentPolicies()
    if (policy === 'ask') delete all[origin]
    else all[origin] = policy
    this.writeAgentPolicies(all)
    logger.info('agent site policy set', { origin, policy })
  }

  /** 全部非默认的 AI 操作策略（管理 UI 用） */
  listAgentPolicies(): Record<string, AgentSitePolicy> {
    return this.readAgentPolicies()
  }

  private readAgentPolicies(): Record<string, AgentSitePolicy> {
    try {
      const row = this.resolveDb()
        .prepare('SELECT value FROM app_preferences WHERE key = ?')
        .get(AGENT_POLICY_PREF_KEY) as { value: string } | undefined
      const parsed = row?.value ? JSON.parse(row.value) as Record<string, AgentSitePolicy> : {}
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  private writeAgentPolicies(map: Record<string, AgentSitePolicy>): void {
    this.resolveDb()
      .prepare(
        `INSERT INTO app_preferences (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(AGENT_POLICY_PREF_KEY, JSON.stringify(map))
  }

  private async askUser(origin: string, permission: string): Promise<boolean> {
    const win = this.getWindow?.()
    // 无窗口可挂对话框（后台/退出中）：保守拒绝且不记录，下次前台再问
    if (!win || win.isDestroyed()) return false
    try {
      const { response } = await dialog.showMessageBox(win, {
        type: 'question',
        message: `允许 ${origin} 使用「${PERMISSION_LABELS[permission] ?? permission}」吗？`,
        detail: '你的选择会被记住，可稍后在浏览器设置中清除。',
        buttons: ['允许', '拒绝'],
        defaultId: 1,
        cancelId: 1
      })
      const decision: SitePermissionDecision = response === 0 ? 'allow' : 'deny'
      this.set(origin, permission, decision)
      logger.info('site permission decided', { origin, permission, decision })
      return decision === 'allow'
    } catch (error) {
      logger.warn('permission dialog failed, denying', { origin, permission, error: String(error) })
      return false
    }
  }

  private readAll(): SitePermissionMap {
    try {
      const row = this.resolveDb()
        .prepare('SELECT value FROM app_preferences WHERE key = ?')
        .get(PREF_KEY) as { value: string } | undefined
      const parsed = row?.value ? JSON.parse(row.value) as SitePermissionMap : {}
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  private writeAll(map: SitePermissionMap): void {
    this.resolveDb()
      .prepare(
        `INSERT INTO app_preferences (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(PREF_KEY, JSON.stringify(map))
  }
}

export const sitePermissionService = new SitePermissionService()
