import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUDDY_CREDENTIAL_REF, BuddyAuth } from '../../src/buddy-auth.js'
import { RefreshTokenExpiredError, runBuddyLoginFlow } from '../../src/buddy-oauth.js'
import type { BuddyCredential } from '../../src/buddy.js'

vi.mock('../../src/buddy-oauth.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/buddy-oauth.js')>()
  return {
    ...actual,
    runBuddyLoginFlow: vi.fn(),
  }
})

const mockedRunBuddyLoginFlow = vi.mocked(runBuddyLoginFlow)

/** 所有已创建的 service；afterEach 统一 stop()，避免刷新定时器泄漏。 */
const services: BuddyAuth[] = []

/** 最小化的内存凭据提供者，形状与 ctx.credentials 一致。 */
class FakeCredentials {
  private store = new Map<string, string>()
  async resolve(ref: string) {
    const value = this.store.get(ref)
    return value === undefined ? undefined : { value, source: 'fake' }
  }
  async describe(ref: string) {
    return { configured: this.store.has(ref), source: this.store.has(ref) ? 'fake' : undefined, writable: true }
  }
  async set(ref: string, value: string) { this.store.set(ref, value) }
  async unset(ref: string) { this.store.delete(ref) }
}

function makeContext(): { ctx: Context; credentials: FakeCredentials } {
  const ctx = new Context()
  const credentials = new FakeCredentials()
  ctx.provide('credentials', credentials as never)
  return { ctx, credentials }
}

function newService(ctx: Context, options: { fetcher?: typeof fetch } = {}): BuddyAuth {
  const service = new BuddyAuth(ctx, options)
  services.push(service)
  return service
}

/** 构造一个可刷新的凭据（默认 2 小时后过期）。 */
function makeCredential(overrides: Partial<BuddyCredential> = {}): BuddyCredential {
  return {
    access_token: 'AT',
    refresh_token: 'RT',
    expires_at: String(Date.now() + 7_200_000),
    refresh_expires_at: String(Date.now() + 2_592_000_000),
    token_type: 'Bearer',
    scope: '',
    domain: 'copilot.tencent.com',
    user_id: 'u1',
    nickname: 'nick',
    enterprise_id: '',
    account_type: 'personal',
    ...overrides,
  }
}

/** 返回刷新成功响应的 fetch stub。 */
function refreshFetcher(): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify({
    code: 0,
    data: {
      accessToken: 'AT2',
      refreshToken: 'RT2',
      expiresAt: String(Date.now() + 7_200_000),
      refreshExpiresAt: String(Date.now() + 2_592_000_000),
      tokenType: 'Bearer',
      scope: '',
      domain: 'copilot.tencent.com',
    },
  }), { status: 200 })) as unknown as typeof fetch
}

afterEach(() => {
  for (const service of services) service.stop()
  services.length = 0
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('BuddyAuth', () => {
  it('registers as ctx.buddyAuth on construction', () => {
    const { ctx } = makeContext()
    const service = newService(ctx)
    expect(ctx.buddyAuth).toBeInstanceOf(BuddyAuth)
    expect(ctx.buddyAuth.name).toBe('buddyAuth')
  })

  it('login stores the credential JSON under the fixed ref', async () => {
    const credential = makeCredential()
    mockedRunBuddyLoginFlow.mockResolvedValue({
      access: JSON.stringify(credential),
      expires: Date.now() + 7_200_000,
      loginUrl: 'https://www.codebuddy.cn/login/?platform=ide&state=s',
      refreshable: true,
    })
    const { ctx, credentials } = makeContext()
    const service = newService(ctx, { fetcher: refreshFetcher() })
    const result = await service.login()
    expect(result.refreshable).toBe(true)
    expect(result.loginUrl).toContain('codebuddy.cn/login')
    expect(String(result.ref)).toBe(BUDDY_CREDENTIAL_REF)
    const stored = JSON.parse((await credentials.resolve(BUDDY_CREDENTIAL_REF))!.value) as BuddyCredential
    expect(stored.access_token).toBe('AT')
    expect(stored.user_id).toBe('u1')
  })

  it('login propagates flow failures', async () => {
    mockedRunBuddyLoginFlow.mockRejectedValue(new Error('获取 token 超时（5 分钟）'))
    const { ctx } = makeContext()
    const service = newService(ctx, { fetcher: refreshFetcher() })
    await expect(service.login()).rejects.toThrow('获取 token 超时（5 分钟）')
  })

  it('status reports unconfigured without a stored value', async () => {
    const { ctx } = makeContext()
    const service = newService(ctx)
    expect(await service.status()).toEqual({ configured: false, refreshable: false })
  })

  it('status parses expires_at and reports refreshable', async () => {
    const { ctx, credentials } = makeContext()
    const expires = Date.now() + 7_200_000
    await credentials.set(BUDDY_CREDENTIAL_REF, JSON.stringify(makeCredential({ expires_at: String(expires) })))
    const service = newService(ctx)
    expect(await service.status()).toEqual({
      configured: true,
      source: 'fake',
      expiresAt: expires,
      refreshable: true,
      // 旧凭据无 edition 字段时归一化为国内站（cn）。
      edition: 'cn',
    })
  })

  it('status tolerates a credential without expiry metadata', async () => {
    const { ctx, credentials } = makeContext()
    await credentials.set(BUDDY_CREDENTIAL_REF, JSON.stringify(makeCredential({ expires_at: undefined })))
    const service = newService(ctx)
    const status = await service.status()
    expect(status.configured).toBe(true)
    expect(status.expiresAt).toBeUndefined()
  })

  it('logout removes the stored credential', async () => {
    const { ctx, credentials } = makeContext()
    await credentials.set(BUDDY_CREDENTIAL_REF, JSON.stringify(makeCredential()))
    const service = newService(ctx)
    await service.logout()
    expect(await credentials.resolve(BUDDY_CREDENTIAL_REF)).toBeUndefined()
  })
})

describe('BuddyAuth silent refresh', () => {
  it('refresh exchanges the refresh_token and rewrites the credential', async () => {
    const { ctx, credentials } = makeContext()
    await credentials.set(BUDDY_CREDENTIAL_REF, JSON.stringify(makeCredential()))
    const fetcher = refreshFetcher()
    const service = newService(ctx, { fetcher })

    await service.refresh()

    const stored = JSON.parse((await credentials.resolve(BUDDY_CREDENTIAL_REF))!.value) as BuddyCredential
    expect(stored.access_token).toBe('AT2')
    expect(stored.refresh_token).toBe('RT2')
    // 账户信息必须保留（刷新响应不含 account 字段）。
    expect(stored.user_id).toBe('u1')
    expect(stored.nickname).toBe('nick')
    expect(stored.account_type).toBe('personal')

    const [url, init] = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
    expect(url).toContain('/v2/plugin/auth/token/refresh')
    const headers = init.headers as Record<string, string>
    expect(headers['X-Refresh-Token']).toBe('RT')
    expect(headers['X-Auth-Refresh-Source']).toBe('ide-main')
    expect(headers.Authorization).toBe('Bearer AT')
  })

  it('refresh reports an explicit error when the credential lacks a refresh_token', async () => {
    const { ctx, credentials } = makeContext()
    await credentials.set(BUDDY_CREDENTIAL_REF, JSON.stringify(makeCredential({ refresh_token: '' })))
    const service = newService(ctx)
    await expect(service.refresh()).rejects.toThrow(RefreshTokenExpiredError)
    expect(await service.status()).toMatchObject({ refreshable: false })
  })

  it('refresh throws when no credential is configured', async () => {
    const { ctx } = makeContext()
    const service = newService(ctx)
    await expect(service.refresh()).rejects.toThrow('未配置凭据，请先登录')
  })

  it('refresh_token expiry stops scheduling and surfaces refreshError', async () => {
    vi.useFakeTimers()
    try {
      const { ctx, credentials } = makeContext()
      // 凭据已过期 → scheduleRefresh 立即武装并触发刷新。
      await credentials.set(BUDDY_CREDENTIAL_REF, JSON.stringify(
        makeCredential({ expires_at: String(Date.now() - 60_000) }),
      ))
      const fetcher = vi.fn(async () => new Response(JSON.stringify({
        code: 401,
        message: 'refresh token expired',
      }), { status: 401 })) as unknown as typeof fetch

      const service = newService(ctx, { fetcher })
      await service.scheduleRefresh()
      await vi.runAllTimersAsync()

      const status = await service.status()
      expect(status.refreshError).toContain('已失效')
      expect(status.refreshable).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('logout during an in-flight refresh prevents credential resurrection', async () => {
    const { ctx, credentials } = makeContext()
    await credentials.set(BUDDY_CREDENTIAL_REF, JSON.stringify(makeCredential()))
    // 可控 Promise：模拟刷新请求在途，直到手动 resolve。
    let release!: () => void
    const fetcher = vi.fn(async () => {
      await new Promise<void>((resolve) => { release = resolve })
      return new Response(JSON.stringify({
        code: 0,
        data: {
          accessToken: 'AT3', refreshToken: 'RT3',
          expiresAt: String(Date.now() + 7_200_000), refreshExpiresAt: '',
          tokenType: 'Bearer', scope: '', domain: 'copilot.tencent.com',
        },
      }), { status: 200 })
    }) as unknown as typeof fetch

    const service = newService(ctx, { fetcher })
    const scheduleSpy = vi.spyOn(service, 'scheduleRefresh')
    const refreshing = service.refresh()
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalled())

    await service.logout()
    release()
    await refreshing

    // 凭据未被在途刷新回写；调度未被重新武装。
    expect(await credentials.resolve(BUDDY_CREDENTIAL_REF)).toBeUndefined()
    expect(scheduleSpy).not.toHaveBeenCalled()
  })

  it('checkExpired reflects the stored expiry', async () => {
    const { ctx, credentials } = makeContext()
    const service = newService(ctx)
    expect(await service.checkExpired()).toBe(true)

    await credentials.set(BUDDY_CREDENTIAL_REF, JSON.stringify(makeCredential({ expires_at: String(Date.now() + 7_200_000) })))
    expect(await service.checkExpired()).toBe(false)

    await credentials.set(BUDDY_CREDENTIAL_REF, JSON.stringify(makeCredential({ expires_at: String(Date.now() - 60_000) })))
    expect(await service.checkExpired()).toBe(true)
  })

  it('fetchModels returns an empty list when not logged in', async () => {
    const { ctx } = makeContext()
    const service = newService(ctx)
    expect(await service.fetchModels()).toEqual([])
  })

  it('fetchModels parses the craft agent list from /v3/config', async () => {
    const { ctx, credentials } = makeContext()
    await credentials.set(BUDDY_CREDENTIAL_REF, JSON.stringify(makeCredential()))
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      data: { agents: [{ name: 'craft', models: ['auto', 'glm-5.3', 'kimi-k3-1'] }] },
    }), { status: 200 })) as unknown as typeof fetch
    const service = newService(ctx, { fetcher })
    expect(await service.fetchModels()).toEqual([
      { id: 'glm-5.3', name: 'GLM-5.3' },
      { id: 'kimi-k3-1', name: 'Kimi K3-1' },
    ])
  })
})

/**
 * 纯账号池部署下的续期。
 *
 * 回归背景：`refresh()` 旧实现只操作单凭据 ref `BUDDY_ACCESS_TOKEN`，而
 * Jet Hub 多账号部署下实际存的是 `BUDDY_ACCOUNT_*`，该 ref 并不存在——
 * 于是池内 token 过期后刷新直接抛「未配置凭据，请先登录」，无法自愈。
 * 修复后传入 pool 时优先刷新池内账号，并写回该账号**自己的** ref。
 */
describe('BuddyAuth 账号池续期', () => {
  /** 只实现 refresh() 所需子集的账号池替身。 */
  function makePool(overrides: {
    available?: { entry: { id: string; credentialRef: string }; credential: BuddyCredential } | null
  } = {}) {
    const updates: Array<{ id: string; patch: Record<string, unknown> }> = []
    return {
      updates,
      async getAvailableAccount() {
        return overrides.available === undefined
          ? { entry: { id: 'acct-1', credentialRef: 'BUDDY_ACCOUNT_A1' }, credential: makeCredential() }
          : overrides.available
      },
      async updateAccount(id: string, patch: Record<string, unknown>) {
        updates.push({ id, patch })
      },
    }
  }

  it('池内存在账号时刷新该账号自身的 ref（不依赖 BUDDY_ACCESS_TOKEN）', async () => {
    const { ctx, credentials } = makeContext()
    // 关键：只存池内 ref，不存 BUDDY_ACCESS_TOKEN
    await credentials.set('BUDDY_ACCOUNT_A1', JSON.stringify(makeCredential({ access_token: 'POOL_AT' })))
    const fetcher = refreshFetcher()
    const service = newService(ctx, { fetcher })
    const pool = makePool()

    await service.refresh(pool as never)

    // 池内账号的凭据被就地更新
    const stored = JSON.parse((await credentials.resolve('BUDDY_ACCOUNT_A1'))!.value) as BuddyCredential
    expect(stored.access_token).toBe('AT2')
    expect(stored.refresh_token).toBe('RT2')
    // 且刷新的是池内账号，而不是报"未配置凭据"
    expect(pool.updates.some((u) => u.id === 'acct-1')).toBe(true)
  })

  it('池内无可用账号时回退到单凭据 ref', async () => {
    const { ctx, credentials } = makeContext()
    await credentials.set(BUDDY_CREDENTIAL_REF, JSON.stringify(makeCredential()))
    const service = newService(ctx, { fetcher: refreshFetcher() })
    await service.refresh(makePool({ available: null }) as never)
    const stored = JSON.parse((await credentials.resolve(BUDDY_CREDENTIAL_REF))!.value) as BuddyCredential
    expect(stored.access_token).toBe('AT2')
  })

  it('池内账号缺少 refresh_token 时回退到单凭据 ref', async () => {
    const { ctx, credentials } = makeContext()
    await credentials.set(BUDDY_CREDENTIAL_REF, JSON.stringify(makeCredential()))
    const service = newService(ctx, { fetcher: refreshFetcher() })
    const pool = makePool({
      available: {
        entry: { id: 'acct-1', credentialRef: 'BUDDY_ACCOUNT_A1' },
        credential: makeCredential({ refresh_token: '' }),
      },
    })
    await service.refresh(pool as never)
    expect(JSON.parse((await credentials.resolve(BUDDY_CREDENTIAL_REF))!.value).access_token).toBe('AT2')
  })

  it('不传 pool 时保持原行为（操作单凭据 ref）', async () => {
    const { ctx, credentials } = makeContext()
    await credentials.set(BUDDY_CREDENTIAL_REF, JSON.stringify(makeCredential()))
    const service = newService(ctx, { fetcher: refreshFetcher() })
    await service.refresh()
    expect(JSON.parse((await credentials.resolve(BUDDY_CREDENTIAL_REF))!.value).access_token).toBe('AT2')
  })
})
