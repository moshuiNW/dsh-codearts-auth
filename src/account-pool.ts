import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import Schema from '@deepseek-ai/schemastery'
import type { BuddyCredential } from './buddy.js'
import type {
  CodeArtsCredential,
  ProviderAccountEntry,
  ProviderAccountStatus,
} from './types.js'

declare module '@deepseek-ai/cordis' {
  interface Context {
    accountPool: AccountPool
  }
}

/** Jet Hub schema namespace（必须在 ctx.settings 中注册后才能读写） */
export const JET_HUB_NS = 'jet-hub'

/** 账号池在 settings 中存储的值结构。 */
interface JetHubSettingsValue {
  accounts?: ProviderAccountEntry[]
}

/** ctx.settings.register() 返回的 owner scope（只用到 get/replace）。 */
interface SettingsScopeLike {
  get(): unknown
  replace(section: object): Promise<void>
}

/** ctx.settings 服务的最小接口。schema 必须是 schemastery schema。 */
interface SettingsServiceLike {
  register(ns: string, schema: unknown): SettingsScopeLike
  describe(options?: { redactSecrets?: boolean }): Array<{ ns: string; value: unknown }>
}

/**
 * Jet Hub 的 settings schema。
 *
 * 必须是 **schemastery schema**，不能是裸函数。schemastery 对象既可调用
 * （`schema(value)` 解析，满足 SettingsProvider.resolve 的用法），又有
 * `toJSON()` 与 `redactSecrets()` 所需的结构；而裸函数只有前者 ——
 * `settings.describe()` 会对每个注册项无条件调用 `schema.toJSON()`，
 * 裸函数会让整条 describe() 抛
 * `TypeError: registration.schema.toJSON is not a function`，
 * 进而使模型设置页、主题设置，以及 sidebar 的
 * `/sidebar/api/settings.get`、`/api/shell.get` 全部 500。
 *
 * 账号列表是动态结构，此处用 `Schema.array(Schema.any())` 承接，
 * 单项字段由 AccountPool 自身在读写时保证。
 */
const jetHubSchema = Schema.object({
  accounts: Schema.array(Schema.any()).default([]),
})

/**
 * AccountPool —— 多账号管理核心
 *
 * 职责：
 * - 账号列表 CRUD（索引存于 ctx.settings namespace jet-hub
 *   → 配置文件，凭据存于 ctx.credentials，各自独立）
 * - 获取指定 provider + 模型的下一个可用账号
 *   算法：enabled=true 且模型不在重置期内 → 取第一个
 * - 更新模型重置时间（收到限流错误后调用）
 *
 * 注意：DSH 的 settings 服务要求 namespace 先注册再读写，
 * 因此构造时调用 ctx.settings.register(JET_HUB_NS, schema)。
 * 注册失败（服务缺失）时退化为内存态，保证不抛错。
 */
export class AccountPool {
  /** 已注册的 settings scope；未注册成功时为 undefined。 */
  private scope: SettingsScopeLike | undefined
  /**
   * 账号列表的**权威进程内副本**。
   *
   * 不直接依赖 `scope.get()`：settings 服务的 resolved 快照在 replace() 后
   * 未必立即更新，而本类的每次写入都是「读 → 改 → 整体 replace」。
   * 若以滞后快照为读源，并发/连续的 updateModelRateLimit 会互相覆盖
   * （典型表现：多个账号触发限流后，settings.yaml 里一条 modelRateLimits
   * 都没有）。因此首次从 scope 载入后，这份副本即为唯一读源。
   */
  private cache: ProviderAccountEntry[] = []
  /** 是否已从 settings scope 完成首次载入。 */
  private loaded = false

  constructor(private readonly ctx: Context) {
    const settings = this.ctx.get('settings') as SettingsServiceLike | undefined
    if (!settings || typeof settings.register !== 'function') {
      this.ctx.logger?.warn?.('[jet-hub] settings 服务不可用，账号列表仅存在于内存中')
      return
    }
    try {
      this.scope = settings.register(JET_HUB_NS, jetHubSchema)
    } catch (error) {
      // 重复注册（如插件热重载）时降级为内存态。
      this.ctx.logger?.warn?.(`[jet-hub] settings namespace 注册失败，降级运行: ${String(error)}`)
    }
  }

  /** 首次访问时从 settings scope 载入账号列表。 */
  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    if (!this.scope) return
    const value = this.scope.get() as JetHubSettingsValue | undefined
    const accounts = value?.accounts
    if (Array.isArray(accounts)) {
      this.cache = accounts as ProviderAccountEntry[]
    } else {
      this.ctx.logger?.warn?.(
        `[jet-hub] 账号列表首次载入为空（scope 返回 ${JSON.stringify(value)}）`,
      )
    }
  }

  /** 读取账号列表（进程内权威副本）。 */
  private readAccounts(): ProviderAccountEntry[] {
    this.ensureLoaded()
    return this.cache
  }

  /** 持久化账号列表（同时更新进程内权威副本）。 */
  private async writeAccounts(accounts: ProviderAccountEntry[]): Promise<void> {
    this.cache = accounts
    this.loaded = true
    if (!this.scope) {
      this.ctx.logger?.warn?.('[jet-hub] 无 settings scope，账号变更未持久化')
      return
    }
    await this.scope.replace({ accounts })
  }

  /** 列出某个 provider 的所有账号（含状态信息） */
  async listAccounts(provider: string): Promise<ProviderAccountStatus[]> {
    const filtered = this.readAccounts().filter(a => a.provider === provider)
    const results: ProviderAccountStatus[] = []
    for (const entry of filtered) {
      const status: ProviderAccountStatus = { ...entry }
      try {
        const info = await this.ctx.credentials.describe(credentialRef(entry.credentialRef))
        status.source = info.source
      } catch {
        // 凭据可能已被外部删除
      }
      results.push(status)
    }
    return results
  }

  /** 列出所有 provider 的账号 */
  async listAllAccounts(): Promise<ProviderAccountEntry[]> {
    return this.readAccounts()
  }

  /** 添加新账号（登录成功后调用） */
  async addAccount(entry: ProviderAccountEntry): Promise<void> {
    const accounts = [...this.readAccounts(), entry]
    await this.writeAccounts(accounts)
  }

  /** 更新账号部分字段 */
  async updateAccount(
    id: string,
    patch: Partial<Pick<ProviderAccountEntry, 'nickname' | 'enabled' | 'expiresAt' | 'refreshable' | 'edition'>>,
  ): Promise<void> {
    const accounts = this.readAccounts()
    const idx = accounts.findIndex(a => a.id === id)
    if (idx === -1) throw new Error(`Account ${id} not found`)
    const next = [...accounts]
    next[idx] = { ...next[idx], ...patch }
    await this.writeAccounts(next)
  }

  /** 删除账号（同时清理凭据） */
  async removeAccount(id: string): Promise<void> {
    const accounts = this.readAccounts()
    const entry = accounts.find(a => a.id === id)
    if (!entry) return
    try {
      await this.ctx.credentials.unset(credentialRef(entry.credentialRef))
    } catch { /* 凭据可能已被删除 */ }
    await this.writeAccounts(accounts.filter(a => a.id !== id))
  }

  /**
   * 按凭据内容反查账号 id（供适配器记录"当前用的是哪个账号"）。
   *
   * 适配器不持有 ctx，也不该直接访问本类的私有凭据存储，
   * 因此这里集中做「遍历已启用账号 → 解析凭据 → 比对标识字段」。
   * @param provider - provider 名称（'buddy' | 'codearts'）。
   * @param identity - 比对用的标识值：buddy 传 access_token，codearts 传 access_key_id。
   * @returns 匹配到的账号 id；无匹配返回空串。
   */
  async findAccountIdByCredential(provider: string, identity: string): Promise<string> {
    if (identity.length === 0) return ''
    const identifierKey = provider === 'buddy' ? 'access_token' : 'access_key_id'
    for (const entry of this.readAccounts()) {
      if (entry.provider !== provider || !entry.enabled) continue
      const resolved = await this.resolveCredentialByRef(entry.credentialRef)
      if (resolved === undefined) continue
      if (resolved[identifierKey] === identity) return entry.id
    }
    return ''
  }

  /** 解析某个 credentialRef 下的凭据 JSON；不可用时返回 undefined。 */
  private async resolveCredentialByRef(refName: string): Promise<Record<string, unknown> | undefined> {
    try {
      const resolved = await this.ctx.credentials.resolve(credentialRef(refName))
      if (!resolved) return undefined
      const parsed = JSON.parse(resolved.value) as unknown
      return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
    } catch {
      return undefined
    }
  }

  /**
   * 按凭据内容反查账号**条目**（含 credentialRef），供调用方刷新该账号自身。
   *
   * 与 {@link findAccountIdByCredential} 的区别：后者只返回 id，无法定位到
   * 需要刷新写入的 credentialRef；而单凭据 ref（BUDDY_ACCESS_TOKEN）在纯
   * 账号池部署下并不存在，必须知道池内该账号自己的 ref 才能续期。
   */
  async findAccountByCredential(
    provider: string,
    identity: string,
  ): Promise<ProviderAccountEntry | undefined> {
    if (identity.length === 0) return undefined
    const identifierKey = provider === 'buddy' ? 'access_token' : 'access_key_id'
    for (const entry of this.readAccounts()) {
      if (entry.provider !== provider || !entry.enabled) continue
      const resolved = await this.resolveCredentialByRef(entry.credentialRef)
      if (resolved === undefined) continue
      if (resolved[identifierKey] === identity) return entry
    }
    return undefined
  }

  /**
   * 从凭据的 expires_at 解析毫秒时间戳。
   * 兼容毫秒/秒级时间戳与 ISO 8601；无法解析返回 undefined（不判定为过期）。
   */
  private expiryOf(credential: Record<string, unknown>): number | undefined {
    const value = credential.expires_at
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value > 1_000_000_000_000 ? value : value * 1000
    }
    if (typeof value !== 'string' || value.length === 0) return undefined
    if (/^\d+$/.test(value)) {
      const n = Number(value)
      return n > 1_000_000_000_000 ? n : n * 1000
    }
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? undefined : parsed
  }

  /** 获取指定 provider + 模型的下一个可用账号 */
  async getAvailableAccount(
    provider: string,
    modelId: string,
  ): Promise<{ entry: ProviderAccountEntry; credential: CodeArtsCredential | BuddyCredential } | null> {
    const now = Date.now()
    const candidates = this.readAccounts()
      .filter(a => a.provider === provider && a.enabled)
      .filter(a => {
        // modelId 为空时无法做限流过滤（历史调用方不知道模型）；
        // 正确的调用方应传入真实模型 id，否则会选中已限流的账号。
        if (modelId.length === 0 || !a.modelRateLimits) return true
        const resetAt = a.modelRateLimits[modelId]
        return resetAt === undefined || resetAt === 0 || now >= resetAt
      })
    if (candidates.length === 0) return null
    // 排序优先级：无限制 > 限制最早到期。相同则保持原顺序（稳定）。
    candidates.sort((a, b) => {
      const ra = a.modelRateLimits?.[modelId] ?? 0
      const rb = b.modelRateLimits?.[modelId] ?? 0
      return ra - rb
    })
    // 逐个尝试解析凭据，跳过占位/损坏条目（并记录原因，避免静默失败）
    const failures: string[] = []
    let firstUsable: { entry: ProviderAccountEntry; credential: CodeArtsCredential | BuddyCredential } | undefined
    for (const entry of candidates) {
      let resolved
      try {
        resolved = await this.ctx.credentials.resolve(credentialRef(entry.credentialRef))
      } catch (error) {
        failures.push(`${entry.id}: 读取凭据失败 (${String(error)})`)
        continue
      }
      if (!resolved) {
        failures.push(`${entry.id}: 凭据未配置`)
        continue
      }
      let credential: CodeArtsCredential | BuddyCredential
      try {
        credential = JSON.parse(resolved.value) as CodeArtsCredential | BuddyCredential
      } catch (error) {
        failures.push(`${entry.id}: 凭据 JSON 损坏 (${String(error)})`)
        continue
      }
      const usable = { entry, credential }
      // 优先返回**未过期**的账号：凭据过期的账号需要先刷新，能避开就避开，
      // 避免每轮请求都先撞一次过期再走刷新（refresh 只对单凭据 ref 有效，
      // 纯账号池部署下会直接失败）。
      if (firstUsable === undefined) firstUsable = usable
      const expiresAt = this.expiryOf(credential as unknown as Record<string, unknown>)
      if (expiresAt === undefined || now < expiresAt) {
        if (failures.length > 0) {
          this.ctx.logger?.warn?.(
            `[jet-hub] ${failures.length} 个 ${provider} 账号不可用，已跳过：${failures.join('; ')}`,
          )
        }
        return usable
      }
    }
    if (firstUsable !== undefined) {
      this.ctx.logger?.warn?.(
        `[jet-hub] ${provider} 账号均已过期，回退到 ${firstUsable.entry.id}（等待刷新）`,
      )
      return firstUsable
    }
    if (failures.length > 0) {
      this.ctx.logger?.warn?.(
        `[jet-hub] 没有可用的 ${provider} 账号：${failures.join('; ')}`,
      )
    }
    return null
  }

  /**
   * 更新某账号某模型的重置时间。
   *
   * 关键：基于**读取到的最新账号列表**做局部合并，再把整个列表写回。
   * settings scope 的 get() 返回的是服务内部快照，可能滞后于磁盘；
   * 但 replace() 是整体替换，因此这里每次都在最新快照上合并，
   * 避免"写 A 的限流 → 读旧快照 → 写 B 的限流"把 A 的记录抹掉。
   */
  async updateModelRateLimit(accountId: string, modelId: string, resetAtMs: number): Promise<void> {
    const accounts = this.readAccounts()
    const idx = accounts.findIndex(a => a.id === accountId)
    if (idx === -1) {
      this.ctx.logger?.warn?.(
        `[jet-hub] updateModelRateLimit: 账号 ${accountId} 不在账号列表中（已知: ${accounts.map(a => a.id).join(', ') || '空'}）`,
      )
      return
    }
    const next = [...accounts]
    const entry = { ...next[idx] }
    entry.modelRateLimits = { ...entry.modelRateLimits, [modelId]: resetAtMs }
    next[idx] = entry
    await this.writeAccounts(next)
    this.ctx.logger?.info?.(
      `[jet-hub] 已记录限流: 账号 ${accountId} 模型 ${modelId} 重置于 ${new Date(resetAtMs).toISOString()}`,
    )
  }

  /** 清理已过期的重置时间记录 */
  async sweepExpiredRateLimits(): Promise<void> {
    const accounts = this.readAccounts()
    let changed = false
    const next = accounts.map((entry) => {
      if (!entry.modelRateLimits) return entry
      const limits = { ...entry.modelRateLimits }
      for (const [modelId, resetAtMs] of Object.entries(limits)) {
        if (resetAtMs > 0 && Date.now() >= resetAtMs) {
          delete limits[modelId]
          changed = true
        }
      }
      return { ...entry, modelRateLimits: limits }
    })
    if (changed) await this.writeAccounts(next)
  }
}
