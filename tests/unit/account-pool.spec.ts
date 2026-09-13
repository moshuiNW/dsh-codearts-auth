import { describe, it, expect, beforeEach } from 'vitest'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { AccountPool } from '../../src/account-pool.js'
import type { ProviderAccountEntry } from '../../src/types.js'

/**
 * 伪造的 MockContext。
 *
 * `staleReads` 选项模拟 DSH settings 服务的真实行为：`scope.get()` 返回的是
 * 服务内部的 resolved 快照，`replace()` 之后该快照未必立即更新。开启后
 * get() 会返回上一次 replace() 之前的值——用于复现"连续记录限流互相覆盖"。
 */
function createMockContext(
  initialAccounts: ProviderAccountEntry[] = [],
  options: { staleReads?: boolean } = {},
) {
  let stored: { accounts?: ProviderAccountEntry[] } = { accounts: initialAccounts }
  // 滞后读：get() 返回的这个值只在"下一次 replace 之后"才追平
  let visible: { accounts?: ProviderAccountEntry[] } = stored
  const replaceCalls: Array<ProviderAccountEntry[]> = []
  const mockSettings = {
    register: (_ns: string, _schema: unknown) => ({
      get: () => (options.staleReads ? visible : stored),
      replace: async (value: { accounts?: ProviderAccountEntry[] }) => {
        if (options.staleReads) {
          // 模拟滞后：get() 始终慢一拍，本次写入要等下一次 replace 才可见
          visible = stored
        }
        stored = value
        replaceCalls.push(value.accounts ?? [])
      },
    }),
    describe: () => [{ ns: 'jet-hub', value: stored }],
  }
  const mockCredentials = new Map<string, string>()
  return {
    replaceCalls,
    logger: { warn: () => {}, info: () => {} },
    get: (key: string) => key === 'settings' ? mockSettings : undefined,
    credentials: {
      describe: async (ref: ReturnType<typeof credentialRef>) => {
        const key = typeof ref === 'string' ? ref : String(ref)
        return { configured: mockCredentials.has(key), source: 'test' as const, writable: true }
      },
      resolve: async (ref: ReturnType<typeof credentialRef>) => {
        const key = typeof ref === 'string' ? ref : String(ref)
        const value = mockCredentials.get(key)
        return value ? { value, source: 'test' as const } : undefined
      },
      set: async (ref: ReturnType<typeof credentialRef>, value: string) => {
        const key = typeof ref === 'string' ? ref : String(ref)
        mockCredentials.set(key, value)
      },
      unset: async (ref: ReturnType<typeof credentialRef>) => {
        const key = typeof ref === 'string' ? ref : String(ref)
        mockCredentials.delete(key)
      },
    },
  }
}

describe('AccountPool', () => {
  let ctx: ReturnType<typeof createMockContext>
  let pool: AccountPool

  /** 每次通过工厂返回新对象，避免测试间 Object.assign 污染共享引用 */
  function makeMockAccount(overrides: Partial<ProviderAccountEntry> = {}): ProviderAccountEntry {
    return {
      id: 'buddy-001',
      provider: 'buddy',
      nickname: 'test-user',
      enabled: true,
      credentialRef: 'BUDDY_ACCOUNT_T1',
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      refreshable: true,
      ...overrides,
    }
  }

  beforeEach(() => {
    ctx = createMockContext()
    pool = new AccountPool(ctx as any)
  })

  it('should add and list accounts', async () => {
    await pool.addAccount(makeMockAccount())
    const list = await pool.listAccounts('buddy')
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('buddy-001')
  })

  it('should filter by provider', async () => {
    await pool.addAccount(makeMockAccount())
    await pool.addAccount(makeMockAccount({ id: 'codearts-001', provider: 'codearts', credentialRef: 'CODEARTS_ACCOUNT_C1' }))
    const buddyAccounts = await pool.listAccounts('buddy')
    const codeartsAccounts = await pool.listAccounts('codearts')
    expect(buddyAccounts).toHaveLength(1)
    expect(codeartsAccounts).toHaveLength(1)
  })

  it('should update account', async () => {
    await pool.addAccount(makeMockAccount())
    await pool.updateAccount('buddy-001', { enabled: false })
    const list = await pool.listAccounts('buddy')
    expect(list[0].enabled).toBe(false)
  })

  it('should throw on update for non-existent account', async () => {
    await expect(pool.updateAccount('nonexistent', { enabled: false })).rejects.toThrow('Account nonexistent not found')
  })

  it('should remove account and credential', async () => {
    await pool.addAccount(makeMockAccount())
    // 先设一个凭据，确认删除时清理
    await ctx.credentials.set(credentialRef('BUDDY_ACCOUNT_T1'), JSON.stringify({ access_token: 'test' }))
    await pool.removeAccount('buddy-001')
    const list = await pool.listAccounts('buddy')
    expect(list).toHaveLength(0)
    const resolved = await ctx.credentials.resolve(credentialRef('BUDDY_ACCOUNT_T1'))
    expect(resolved).toBeUndefined()
  })

  it('should return available account for model', async () => {
    // 为两个账号都设置凭据
    await ctx.credentials.set(credentialRef('BUDDY_ACCOUNT_T1'), JSON.stringify({ access_token: 'test1' }))
    await pool.addAccount(makeMockAccount())
    // 为第二个账号设置模型限流
    await ctx.credentials.set(credentialRef('BUDDY_ACCOUNT_T2'), JSON.stringify({ access_token: 'test2' }))
    await pool.addAccount(makeMockAccount({
      id: 'buddy-002',
      credentialRef: 'BUDDY_ACCOUNT_T2',
      modelRateLimits: { 'deepseek-v4-flash': Date.now() + 3600000 },
    }))
    const result = await pool.getAvailableAccount('buddy', 'deepseek-v4-flash')
    expect(result).not.toBeNull()
    expect(result!.entry.id).toBe('buddy-001')
  })

  it('should return null when all accounts rate-limited', async () => {
    await ctx.credentials.set(credentialRef('BUDDY_ACCOUNT_T1'), JSON.stringify({ access_token: 'test' }))
    await pool.addAccount(makeMockAccount({
      modelRateLimits: { 'deepseek-v4-flash': Date.now() + 3600000 },
    }))
    const result = await pool.getAvailableAccount('buddy', 'deepseek-v4-flash')
    expect(result).toBeNull()
  })

  it('should return null when no accounts at all', async () => {
    const result = await pool.getAvailableAccount('buddy', 'deepseek-v4-flash')
    expect(result).toBeNull()
  })

  it('should return null when credential resolve fails', async () => {
    await pool.addAccount(makeMockAccount())
    const result = await pool.getAvailableAccount('buddy', 'deepseek-v4-flash')
    expect(result).toBeNull()
  })

  it('should return null when credential JSON parse fails', async () => {
    await ctx.credentials.set(credentialRef('BUDDY_ACCOUNT_T1'), 'not-json')
    await pool.addAccount(makeMockAccount())
    const result = await pool.getAvailableAccount('buddy', 'deepseek-v4-flash')
    expect(result).toBeNull()
  })

  it('should update model rate limit', async () => {
    await pool.addAccount(makeMockAccount())
    const resetAt = Date.now() + 7200000
    await pool.updateModelRateLimit('buddy-001', 'deepseek-v4-flash', resetAt)
    const list = await pool.listAccounts('buddy')
    expect(list[0].modelRateLimits?.['deepseek-v4-flash']).toBe(resetAt)
  })

  it('should sweep expired rate limits', async () => {
    await pool.addAccount(makeMockAccount({
      modelRateLimits: { 'deepseek-v4-flash': Date.now() - 1000, 'deepseek-v4-pro': Date.now() + 3600000 },
    }))
    await pool.sweepExpiredRateLimits()
    const list = await pool.listAccounts('buddy')
    expect(list[0].modelRateLimits?.['deepseek-v4-flash']).toBeUndefined()
    expect(list[0].modelRateLimits?.['deepseek-v4-pro']).toBeDefined()
  })

  it('should list all accounts', async () => {
    await pool.addAccount(makeMockAccount())
    await pool.addAccount(makeMockAccount({ id: 'codearts-001', provider: 'codearts', credentialRef: 'CODEARTS_ACCOUNT_C1' }))
    const all = await pool.listAllAccounts()
    expect(all).toHaveLength(2)
  })

  it('should handle removeAccount of non-existent account gracefully', async () => {
    await pool.removeAccount('nonexistent')
    const list = await pool.listAllAccounts()
    expect(list).toHaveLength(0)
  })

  it('should handle updateModelRateLimit for non-existent account gracefully', async () => {
    await pool.updateModelRateLimit('nonexistent', 'deepseek-v4-flash', Date.now() + 3600000)
    // 不会抛出
  })

  /**
   * 回归：settings scope 的 get() 滞后于 replace() 时，连续记录多个账号的
   * 限流不能互相覆盖。
   *
   * 曾经的实现每次都以 scope.get() 为读源，若快照滞后，第二次写入会基于
   * 不含第一次记录的旧快照整体 replace，把前一条限流抹掉——表现为
   * "多个账号都触发过限流，settings.yaml 里却一条 modelRateLimits 都没有"。
   */
  it('keeps earlier rate limits when recording several accounts under a stale scope', async () => {
    const staleCtx = createMockContext([], { staleReads: true })
    const stalePool = new AccountPool(staleCtx as never)

    await stalePool.addAccount(makeMockAccount({ id: 'acct-1', credentialRef: 'BUDDY_ACCOUNT_T1' }))
    await stalePool.addAccount(makeMockAccount({ id: 'acct-2', credentialRef: 'BUDDY_ACCOUNT_T2' }))
    await stalePool.addAccount(makeMockAccount({ id: 'acct-3', credentialRef: 'BUDDY_ACCOUNT_T3' }))

    const t1 = Date.now() + 3_600_000
    const t2 = Date.now() + 7_200_000
    const t3 = Date.now() + 10_800_000
    await stalePool.updateModelRateLimit('acct-1', 'deepseek-v4.1-flash', t1)
    await stalePool.updateModelRateLimit('acct-2', 'deepseek-v4.1-flash', t2)
    await stalePool.updateModelRateLimit('acct-3', 'deepseek-v4.1-flash', t3)

    const list = await stalePool.listAllAccounts()
    const limits = list.map(a => a.modelRateLimits?.['deepseek-v4.1-flash'])
    // 三条记录都必须留存（fix 前这里会是 [undefined, undefined, t3] 或类似）
    expect(limits).toEqual([t1, t2, t3])
  })

  /**
   * 限流避让与凭据过期处理。
   *
   * 回归背景：适配器此前用 `getAvailableAccount(provider, '')` 做**首次**选号
   * （模型参数为空串），而限流过滤按 `modelRateLimits[modelId]` 查表——空串
   * 恒为 undefined，于是已限流账号照样被选中，每个请求都要先撞一次 429 再
   * 切换。修复后适配器透传真实模型 id，这里锁定该语义。
   */
  describe('限流避让与过期处理', () => {
  it('传入真实模型时跳过该模型已限流的账号（首次选号）', async () => {
    await ctx.credentials.set(credentialRef('BUDDY_ACCOUNT_T1'), JSON.stringify({ access_token: 'test1' }))
    await pool.addAccount(makeMockAccount({ modelRateLimits: { 'hy4-preview': Date.now() + 3600_000 } }))
    await ctx.credentials.set(credentialRef('BUDDY_ACCOUNT_T2'), JSON.stringify({ access_token: 'test2' }))
    await pool.addAccount(makeMockAccount({ id: 'buddy-002', credentialRef: 'BUDDY_ACCOUNT_T2' }))

    const picked = await pool.getAvailableAccount('buddy', 'hy4-preview')
    expect(picked!.entry.id).toBe('buddy-002')
    // 同一账号在**另一个**模型上并未限流，仍应可被选中
    const other = await pool.getAvailableAccount('buddy', 'glm-5.3')
    expect(other!.entry.id).toBe('buddy-001')
  })

  it('limit on one model does not block a different model', async () => {
    await ctx.credentials.set(credentialRef('BUDDY_ACCOUNT_T1'), JSON.stringify({ access_token: 'test1' }))
    await pool.addAccount(makeMockAccount({ modelRateLimits: { 'glm-5.3': Date.now() + 3600_000 } }))
    expect((await pool.getAvailableAccount('buddy', 'glm-5.3'))).toBeNull()
    expect((await pool.getAvailableAccount('buddy', 'hy4-preview'))!.entry.id).toBe('buddy-001')
  })

  /** 过期账号应让位给未过期的账号（避免每轮都先撞过期再走刷新）。 */
  it('prefers a non-expired account over an expired one', async () => {
    await ctx.credentials.set(
      credentialRef('BUDDY_ACCOUNT_T1'),
      JSON.stringify({ access_token: 'expired', expires_at: String(Date.now() - 60_000) }),
    )
    await pool.addAccount(makeMockAccount())
    await ctx.credentials.set(
      credentialRef('BUDDY_ACCOUNT_T2'),
      JSON.stringify({ access_token: 'fresh', expires_at: String(Date.now() + 3600_000) }),
    )
    await pool.addAccount(makeMockAccount({ id: 'buddy-002', credentialRef: 'BUDDY_ACCOUNT_T2' }))

    const picked = await pool.getAvailableAccount('buddy', 'm')
    expect(picked!.entry.id).toBe('buddy-002')
  })

  /** 全部过期时仍返回一个账号（交由刷新），而不是判定"无可用账号"。 */
  it('still returns an account when every account is expired', async () => {
    await ctx.credentials.set(
      credentialRef('BUDDY_ACCOUNT_T1'),
      JSON.stringify({ access_token: 'expired', expires_at: String(Date.now() - 60_000) }),
    )
    await pool.addAccount(makeMockAccount())
    const picked = await pool.getAvailableAccount('buddy', 'm')
    expect(picked!.entry.id).toBe('buddy-001')
  })

  /** 无 expires_at（无法判定）不应被当作过期。 */
  it('does not treat a credential without expires_at as expired', async () => {
    await ctx.credentials.set(credentialRef('BUDDY_ACCOUNT_T1'), JSON.stringify({ access_token: 'no-expiry' }))
    await pool.addAccount(makeMockAccount())
    expect((await pool.getAvailableAccount('buddy', 'm'))!.entry.id).toBe('buddy-001')
  })

  /**
   * findAccountByCredential 需要拿到 credentialRef —— 纯账号池部署下
   * `BUDDY_ACCESS_TOKEN` 这个单凭据 ref 并不存在，刷新必须写回账号自己的 ref。
   */
  it('findAccountByCredential locates the pool entry (for per-account refresh)', async () => {
    await ctx.credentials.set(credentialRef('BUDDY_ACCOUNT_T1'), JSON.stringify({ access_token: 'AT_X' }))
    await pool.addAccount(makeMockAccount())
    const found = await pool.findAccountByCredential('buddy', 'AT_X')
    expect(found?.id).toBe('buddy-001')
    expect(found?.credentialRef).toBe('BUDDY_ACCOUNT_T1')
    // 未匹配到时不返回条目
    expect(await pool.findAccountByCredential('buddy', 'nope')).toBeUndefined()
    expect(await pool.findAccountByCredential('buddy', '')).toBeUndefined()
  })

  it('findAccountByCredential ignores disabled accounts', async () => {
    await ctx.credentials.set(credentialRef('BUDDY_ACCOUNT_T1'), JSON.stringify({ access_token: 'AT_X' }))
    await pool.addAccount(makeMockAccount({ enabled: false }))
    expect(await pool.findAccountByCredential('buddy', 'AT_X')).toBeUndefined()
  })
  })
})
