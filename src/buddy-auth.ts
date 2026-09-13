/**
 * Buddy (腾讯 CodeBuddy) 认证服务
 *
 * 管理 external-link-v2 轮询式登录、凭据存储与 RefreshScheduler 静默续期，
 * 结构与 CodeArtsAuth 保持一致（同样的调度语义、同样的登出竞态保护）。
 */

import { Service, type Context } from '@deepseek-ai/cordis'
import { credentialRef, type CredentialRef } from '@deepseek-ai/dsh-credentials'
import {
  credentialExpiresAtMs,
  isExpired,
  isRefreshable,
  normalizeBuddyEdition,
} from './buddy.js'
import {
  RefreshTokenExpiredError,
  fetchModels,
  refreshToken,
  runBuddyLoginFlow,
  type BuddyLoginFlowOptions,
} from './buddy-oauth.js'
import { RefreshScheduler } from './refresh.js'
import type { BuddyCredential, BuddyRemoteModel } from './buddy.js'
import { AccountPool } from './account-pool.js'

/** Buddy 登录结果存储所用的凭据引用。 */
export const BUDDY_CREDENTIAL_REF = 'BUDDY_ACCESS_TOKEN'

/** 一次成功登录的结果。 */
export interface BuddyLoginResult {
  /** 已存储的凭据 JSON 字符串。 */
  access: string
  /** 凭据过期的毫秒时间戳（无法解析时为 0）。 */
  expires: number
  /** 凭据值存储所用的凭据引用。 */
  ref: CredentialRef
  /** 打开的登录 URL。 */
  loginUrl: string
  /** 凭据是否携带 refresh_token。 */
  refreshable: boolean
}

/** 用于配置界面的只读登录状态。 */
export interface BuddyLoginStatus {
  configured: boolean
  source?: string
  expiresAt?: number
  /** 存储的凭据是否可通过刷新令牌静默续期。 */
  refreshable: boolean
  /** 最近一次刷新失败的原因（如有）。 */
  refreshError?: string
  /** 当前凭据所属站点：`cn`（国内站）| `intl`（国际站）。 */
  edition?: string
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    buddyAuth: BuddyAuth
  }
}

/** 从存储值解析凭据 JSON；解析失败返回 undefined。 */
function parseCredential(value: string): BuddyCredential | undefined {
  try {
    const parsed = JSON.parse(value) as BuddyCredential
    return typeof parsed === 'object' && parsed !== null && typeof parsed.access_token === 'string'
      ? parsed
      : undefined
  } catch {
    return undefined
  }
}

/** Buddy 登录服务：轮询式登录 + refresh_token 静默续期。 */
export class BuddyAuth extends Service {
  private readonly scheduler = new RefreshScheduler(
    () => this.refresh(),
    (error) => {
      if (error instanceof RefreshTokenExpiredError) {
        // 失效：停止重试，并向 status() 暴露 refreshable: false 与重新登录提示。
        this.markRefreshTokenInvalid()
        return
      }
      this.lastRefreshError = error instanceof Error ? error.message : String(error)
    },
  )
  /** refresh_token 已被后端判定失效；登录/刷新成功时重置。 */
  private refreshTokenInvalid = false
  private lastRefreshError: string | undefined
  /** 登录会话是否仍处于活跃状态；logout()/stop() 置 false，防止在途刷新回写已登出凭据。 */
  private active = true

  constructor(ctx: Context, private readonly options: { fetcher?: typeof fetch } = {}) {
    super(ctx, 'buddyAuth')
  }

  /** 标记 refresh_token 已失效：停止重试，并向 status() 暴露 refreshable: false 与重新登录提示。 */
  private markRefreshTokenInvalid(): void {
    this.refreshTokenInvalid = true
    this.lastRefreshError = 'refresh_token 已失效，请重新登录'
  }

  /** 运行登录流程并持久化凭据。 */
  async login(flowOptions: { refName?: string; accountId?: string; pool?: AccountPool } & BuddyLoginFlowOptions = {}): Promise<BuddyLoginResult> {
    this.active = true
    const ref = flowOptions.refName ? credentialRef(flowOptions.refName) : credentialRef(BUDDY_CREDENTIAL_REF)
    const flow = await runBuddyLoginFlow({
      ...this.options.fetcher !== undefined ? { fetcher: this.options.fetcher } : {},
      ...flowOptions,
    })
    await this.ctx.credentials.set(ref, flow.access)
    this.refreshTokenInvalid = false
    this.lastRefreshError = undefined
    this.scheduleRefresh()
    const credential = parseCredential(flow.access)
    // 多账号：accountId 提供时自动注册到 pool
    if (flowOptions.accountId && flowOptions.pool) {
      await flowOptions.pool.addAccount({
        id: flowOptions.accountId,
        provider: 'buddy',
        nickname: flowOptions.accountId,
        enabled: true,
        credentialRef: flowOptions.refName ?? BUDDY_CREDENTIAL_REF,
        createdAt: Date.now(),
        expiresAt: credential ? credentialExpiresAtMs(credential) : undefined,
        refreshable: Boolean(credential) && isRefreshable(credential!),
        // 记录站点归属（cn/intl），供账号列表展示与刷新路由核对。
        ...credential?.edition !== undefined ? { edition: credential.edition } : {},
      })
    }
    return {
      access: flow.access,
      expires: flow.expires,
      ref,
      loginUrl: flow.loginUrl,
      refreshable: Boolean(credential) && isRefreshable(credential!),
    }
  }

  /**
   * 保存凭据并注册到账号池（供后台登录流程使用）。
   * 账号池已预先创建占位条目时，只做凭据写入和更新。
   */
  async saveCredential(credentialJson: string, refName: string, accountId: string, pool: AccountPool): Promise<void> {
    this.active = true
    const ref = credentialRef(refName)
    await this.ctx.credentials.set(ref, credentialJson)
    this.refreshTokenInvalid = false
    this.lastRefreshError = undefined
    this.scheduleRefresh()
    const credential = parseCredential(credentialJson)
    if (accountId && pool) {
      await pool.updateAccount(accountId, {
        nickname: credential?.nickname ?? accountId,
        expiresAt: credential ? credentialExpiresAtMs(credential) : undefined,
        refreshable: Boolean(credential) && isRefreshable(credential!),
        ...credential?.edition !== undefined ? { edition: credential.edition } : {},
      })
    }
  }

  /** 报告凭据是否已配置、过期时间、是否可刷新以及最近刷新错误。 */
  async status(): Promise<BuddyLoginStatus> {
    const ref = credentialRef(BUDDY_CREDENTIAL_REF)
    const info = await this.ctx.credentials.describe(ref)
    if (!info.configured) return { configured: false, refreshable: false }
    let expiresAt: number | undefined
    let refreshable = false
    let edition: string | undefined
    const resolved = await this.ctx.credentials.resolve(ref)
    if (resolved) {
      const credential = parseCredential(resolved.value)
      if (credential) {
        expiresAt = credentialExpiresAtMs(credential)
        refreshable = isRefreshable(credential) && !this.refreshTokenInvalid
        edition = normalizeBuddyEdition(credential.edition)
      }
    }
    return {
      configured: true,
      source: info.source,
      expiresAt,
      refreshable,
      ...edition === undefined ? {} : { edition },
      ...this.lastRefreshError === undefined ? {} : { refreshError: this.lastRefreshError },
    }
  }

  /**
   * 静默续期。
   *
   * 优先刷新**账号池中当前生效的那个账号**：纯账号池部署下只有
   * `BUDDY_ACCOUNT_*` 凭据，单凭据 ref（`BUDDY_ACCESS_TOKEN`）并不存在，
   * 旧实现会直接抛「未配置凭据，请先登录」，导致池内 token 过期后无法续期。
   * 池内没有可刷新账号时回退到单凭据 ref。
   *
   * @param pool - 账号池；提供时优先按池内账号续期。
   */
  async refresh(pool?: AccountPool): Promise<void> {
    if (pool) {
      const refreshed = await this.refreshPoolAccount(pool)
      if (refreshed) return
    }
    const ref = credentialRef(BUDDY_CREDENTIAL_REF)
    const resolved = await this.ctx.credentials.resolve(ref)
    if (!resolved) throw new Error('未配置凭据，请先登录')
    const credential = parseCredential(resolved.value)
    if (!credential) throw new Error('凭据解析失败')
    if (!isRefreshable(credential)) {
      throw new RefreshTokenExpiredError('无 refresh_token，请重新登录')
    }
    try {
      await this.refreshInto(ref, credential)
    } catch (error) {
      // 手动 refresh()（或 llm-adapter 触发）遇 refresh_token 失效同样更新状态，
      // 供 /buddy-status 展示 refreshable: false 与重新登录提示。
      if (error instanceof RefreshTokenExpiredError) this.markRefreshTokenInvalid()
      throw error
    }
  }

  /**
   * 刷新账号池中"下一个可用账号"的凭据，并写回该账号自身的 credentialRef。
   *
   * @returns 是否刷新了某个池内账号（false 表示池内无可用/可刷新账号）。
   */
  private async refreshPoolAccount(pool: AccountPool): Promise<boolean> {
    const available = await pool.getAvailableAccount('buddy', '')
    if (!available) return false
    const credential = available.credential as BuddyCredential
    if (!isRefreshable(credential)) return false
    const ref = credentialRef(available.entry.credentialRef)
    try {
      await this.refreshInto(ref, credential)
      const expiresAt = credentialExpiresAtMs(credential)
      await pool.updateAccount(available.entry.id, {
        refreshable: true,
        ...expiresAt === undefined ? {} : { expiresAt },
      })
    } catch (error) {
      if (error instanceof RefreshTokenExpiredError) {
        this.markRefreshTokenInvalid()
        try {
          await pool.updateAccount(available.entry.id, { refreshable: false })
        } catch { /* 忽略池更新失败，不掩盖原始错误 */ }
      }
      throw error
    }
    return true
  }

  /** 用 refresh_token 换取新令牌并写回指定 ref（含登出竞态保护）。 */
  private async refreshInto(ref: CredentialRef, credential: BuddyCredential): Promise<void> {
    const token = await refreshToken(credential, this.fetchImpl)
    // 登出竞态保护：在途刷新期间已 logout()/stop() 时，跳过凭据回写与调度武装，
    // 避免已登出的凭据被在途刷新复活。
    if (!this.active) return
    const refreshed: BuddyCredential = {
      ...credential,
      access_token: token.accessToken,
      refresh_token: token.refreshToken,
      expires_at: token.expiresAt,
      refresh_expires_at: token.refreshExpiresAt,
      token_type: token.tokenType,
      scope: token.scope,
      // 后端未返回 domain 时保留原值。
      ...token.domain.length > 0 ? { domain: token.domain } : {},
    }
    await this.ctx.credentials.set(ref, JSON.stringify(refreshed))
    this.refreshTokenInvalid = false
    this.lastRefreshError = undefined
    this.scheduleRefresh()
  }

  /**
   * 批量续期所有 buddy 账号。
   * 遍历 pool 中 enabled + refreshable 的 buddy 账号，逐一续期。
   * 单账号失败不影响其他账号。
   */
  async refreshAll(pool: AccountPool): Promise<void> {
    const accounts = await pool.listAccounts('buddy')
    for (const entry of accounts) {
      if (!entry.enabled || !entry.refreshable) continue
      try {
        const ref = credentialRef(entry.credentialRef)
        const resolved = await this.ctx.credentials.resolve(ref)
        if (!resolved) {
          await pool.updateAccount(entry.id, { refreshable: false })
          continue
        }
        const credential = parseCredential(resolved.value)
        if (!credential || !isRefreshable(credential)) {
          await pool.updateAccount(entry.id, { refreshable: false })
          continue
        }
        const token = await refreshToken(credential, this.fetchImpl)
        const refreshed: BuddyCredential = {
          ...credential,
          access_token: token.accessToken,
          refresh_token: token.refreshToken,
          expires_at: token.expiresAt,
          refresh_expires_at: token.refreshExpiresAt,
          token_type: token.tokenType,
          scope: token.scope,
          ...token.domain.length > 0 ? { domain: token.domain } : {},
        }
        await this.ctx.credentials.set(ref, JSON.stringify(refreshed))
        const expiresAt = credentialExpiresAtMs(refreshed)
        await pool.updateAccount(entry.id, {
          expiresAt: expiresAt ?? undefined,
          refreshable: isRefreshable(refreshed),
        })
      } catch (error) {
        if (error instanceof RefreshTokenExpiredError) {
          try {
            await pool.updateAccount(entry.id, { refreshable: false })
          } catch {
            // 忽略 updateAccount 本身的错误
          }
        }
        // 单账号失败不中断循环
      }
    }
  }

  /** 移除已存储的凭据并停止任何待处理的刷新。 */
  async logout(): Promise<void> {
    // 先置 inactive，再清凭据：在途刷新完成后不得回写/重新武装调度。
    this.active = false
    this.scheduler.stop()
    await this.ctx.credentials.unset(credentialRef(BUDDY_CREDENTIAL_REF))
  }

  /** 停止刷新调度（不清理凭据）。 */
  stop(): void {
    this.active = false
    this.scheduler.stop()
  }

  /** 启动时若已有可刷新凭据则安排续期（由 apply 调用）。 */
  scheduleRefresh(): void {
    void this.ctx.credentials.resolve(credentialRef(BUDDY_CREDENTIAL_REF)).then((resolved) => {
      if (!resolved) return
      const credential = parseCredential(resolved.value)
      if (!credential || !isRefreshable(credential)) return
      const expiresAt = credentialExpiresAtMs(credential)
      if (expiresAt !== undefined) this.scheduler.arm(expiresAt)
    })
  }

  /** 从存储重载凭据，返回是否已过期（供 UI 判断是否需要提示重新登录）。 */
  async checkExpired(): Promise<boolean> {
    const resolved = await this.ctx.credentials.resolve(credentialRef(BUDDY_CREDENTIAL_REF))
    if (!resolved) return true
    const credential = parseCredential(resolved.value)
    return credential === undefined ? true : isExpired(credential)
  }

  /**
   * GET /v3/config → 获取远端模型列表（craft agent 的 models）。
   * 失败或未登录时返回空数组（调用方回退到内置列表）。
   *
   * 优先使用账号池中的可用账号；无账号池或池为空时回退到固定凭据 ref。
   */
  async fetchModels(pool?: AccountPool): Promise<BuddyRemoteModel[]> {
    // 优先账号池
    if (pool) {
      const available = await pool.getAvailableAccount('buddy', '')
      if (available) return fetchModels(available.credential as BuddyCredential, this.fetchImpl)
    }
    const resolved = await this.ctx.credentials.resolve(credentialRef(BUDDY_CREDENTIAL_REF))
    if (!resolved) return []
    const credential = parseCredential(resolved.value)
    if (!credential) return []
    return fetchModels(credential, this.fetchImpl)
  }

  /** 注入的 fetch（测试用）；默认为全局 fetch。 */
  private get fetchImpl(): typeof fetch {
    return this.options.fetcher ?? fetch
  }
}
