import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RefreshTokenExpiredError,
  fetchAuthState,
  fetchModels,
  getAccount,
  loopGetToken,
  refreshToken,
  runBuddyLoginFlow,
} from '../../src/buddy-oauth.js'
import type { BuddyCredential } from '../../src/buddy.js'

const STATE = 'state-abc'
const AUTH_URL = 'https://www.codebuddy.cn/login/?platform=ide&state=state-abc'

/** 构造凭据（默认 2 小时后过期）。 */
function makeCredential(overrides: Partial<BuddyCredential> = {}): BuddyCredential {
  return {
    access_token: 'AT',
    refresh_token: 'RT',
    expires_at: String(Date.now() + 7_200_000),
    token_type: 'Bearer',
    scope: '',
    domain: 'copilot.tencent.com',
    ...overrides,
  }
}

/** 把若干个 [matcher, response] 规则组装为 stub fetch。 */
function routeFetch(routes: Array<{ when: (url: string) => boolean; respond: () => Response }>): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    for (const route of routes) {
      if (route.when(url)) return route.respond()
    }
    return new Response('not found', { status: 404 })
  }) as unknown as typeof fetch
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('buddy fetchAuthState', () => {
  it('returns state and authUrl', async () => {
    const fetcher = routeFetch([{
      when: (url) => url.includes('/v2/plugin/auth/state'),
      respond: () => new Response(JSON.stringify({ code: 0, data: { state: STATE, authUrl: AUTH_URL } }), { status: 200 }),
    }])
    const result = await fetchAuthState(fetcher)
    expect(result).toEqual({ state: STATE, authUrl: AUTH_URL })
    // 必须带 platform=ide 查询参数与免鉴权头。
    const [url, init] = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
    expect(url).toContain('platform=ide')
    expect((init.headers as Record<string, string>)['X-No-Authorization']).toBe('true')
  })

  it('throws when the response is missing state or authUrl', async () => {
    const fetcher = routeFetch([{
      when: () => true,
      respond: () => new Response(JSON.stringify({ code: 0, data: {} }), { status: 200 }),
    }])
    await expect(fetchAuthState(fetcher)).rejects.toThrow('state')
  })

  it('throws on a non-200 response', async () => {
    const fetcher = routeFetch([{ when: () => true, respond: () => new Response('boom', { status: 500 }) }])
    await expect(fetchAuthState(fetcher)).rejects.toThrow('auth/state HTTP 500')
  })
})

describe('buddy loopGetToken', () => {
  it('polls until the token is ready', async () => {
    let attempts = 0
    const fetcher = routeFetch([{
      when: () => true,
      respond: () => {
        attempts++
        // 前两次返回 11217（token 未就绪），第三次成功。
        return attempts < 3
          ? new Response(JSON.stringify({ code: 11217, message: 'not ready' }), { status: 400 })
          : new Response(JSON.stringify({
            code: 0,
            data: { accessToken: 'AT', refreshToken: 'RT', expiresAt: '2026-08-30T00:00:00Z', tokenType: 'Bearer', scope: '', domain: 'copilot.tencent.com' },
          }), { status: 200 })
      },
    }])
    const token = await loopGetToken(STATE, { fetcher, pollIntervalMs: 0 })
    expect(token.accessToken).toBe('AT')
    expect(attempts).toBe(3)
  })

  it('aborts other errors immediately', async () => {
    const fetcher = routeFetch([{
      when: () => true,
      respond: () => new Response(JSON.stringify({ code: 99999, message: 'fatal' }), { status: 400 }),
    }])
    await expect(loopGetToken(STATE, { fetcher, pollIntervalMs: 0 })).rejects.toThrow('fatal')
  })

  it('times out when the token never becomes ready', async () => {
    const fetcher = routeFetch([{
      when: () => true,
      respond: () => new Response(JSON.stringify({ code: 11217 }), { status: 400 }),
    }])
    await expect(loopGetToken(STATE, { fetcher, pollIntervalMs: 0, timeoutMs: 5 })).rejects.toThrow('超时')
  })
})

describe('buddy getAccount', () => {
  it('polls until the account is ready', async () => {
    let attempts = 0
    const fetcher = routeFetch([{
      when: () => true,
      respond: () => {
        attempts++
        return attempts < 2
          ? new Response(JSON.stringify({ code: 12151 }), { status: 400 })
          : new Response(JSON.stringify({ code: 0, data: { uid: 'u1', nickname: 'nick', enterpriseId: '', type: 'personal' } }), { status: 200 })
      },
    }])
    const account = await getAccount(STATE, {
      accessToken: 'AT', refreshToken: 'RT', expiresAt: '', refreshExpiresAt: '', tokenType: 'Bearer', scope: '', domain: 'copilot.tencent.com',
    }, { fetcher, pollIntervalMs: 0 })
    expect(account).toEqual({ uid: 'u1', nickname: 'nick', enterpriseId: '', accountType: 'personal' })
  })

  it('times out when the account never becomes ready', async () => {
    const fetcher = routeFetch([{
      when: () => true,
      respond: () => new Response(JSON.stringify({ code: 12151 }), { status: 400 }),
    }])
    const token = {
      accessToken: 'AT', refreshToken: 'RT', expiresAt: '', refreshExpiresAt: '', tokenType: 'Bearer', scope: '', domain: 'copilot.tencent.com',
    }
    await expect(getAccount(STATE, token, { fetcher, pollIntervalMs: 0, timeoutMs: 5 })).rejects.toThrow('超时')
  })
})

describe('buddy refreshToken', () => {
  it('submits X-Refresh-Token and returns the new token', async () => {
    const fetcher = routeFetch([{
      when: (url) => url.includes('/v2/plugin/auth/token/refresh'),
      respond: () => new Response(JSON.stringify({
        code: 0,
        data: { accessToken: 'AT2', refreshToken: 'RT2', expiresAt: '2026-09-30T00:00:00Z', refreshExpiresAt: '', tokenType: 'Bearer', scope: '', domain: 'copilot.tencent.com' },
      }), { status: 200 }),
    }])
    const token = await refreshToken(makeCredential(), fetcher)
    expect(token.accessToken).toBe('AT2')
    expect(token.refreshToken).toBe('RT2')
    const [, init] = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['X-Refresh-Token']).toBe('RT')
  })

  it('throws RefreshTokenExpiredError on HTTP 401', async () => {
    const fetcher = routeFetch([{
      when: () => true,
      respond: () => new Response(JSON.stringify({ code: 401, message: 'refresh token expired' }), { status: 401 }),
    }])
    await expect(refreshToken(makeCredential(), fetcher)).rejects.toBeInstanceOf(RefreshTokenExpiredError)
  })

  it('throws RefreshTokenExpiredError when the message says expired', async () => {
    const fetcher = routeFetch([{
      when: () => true,
      respond: () => new Response(JSON.stringify({ code: 5000, message: 'token expired' }), { status: 400 }),
    }])
    await expect(refreshToken(makeCredential(), fetcher)).rejects.toThrow('expired')
  })

  it('treats other failures as retryable (plain Error)', async () => {
    const fetcher = routeFetch([{
      when: () => true,
      respond: () => new Response(JSON.stringify({ code: 500, message: 'upstream down' }), { status: 502 }),
    }])
    const error = await refreshToken(makeCredential(), fetcher).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(RefreshTokenExpiredError)
  })

  it('throws RefreshTokenExpiredError when there is no refresh_token', async () => {
    const fetcher = routeFetch([])
    await expect(refreshToken(makeCredential({ refresh_token: '' }), fetcher)).rejects.toBeInstanceOf(RefreshTokenExpiredError)
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('buddy fetchModels', () => {
  it('parses the craft agent models from /v3/config', async () => {
    const fetcher = routeFetch([{
      when: (url) => url.includes('/v3/config'),
      respond: () => new Response(JSON.stringify({
        data: { agents: [{ name: 'craft', models: ['auto', 'hy4-preview', 'glm-5.3'] }] },
      }), { status: 200 }),
    }])
    expect(await fetchModels(makeCredential(), fetcher)).toEqual([
      { id: 'hy4-preview', name: 'Hy4 Preview' },
      { id: 'glm-5.3', name: 'GLM-5.3' },
    ])
  })

  it('returns an empty list without a token or on failure', async () => {
    const fetcher = routeFetch([{ when: () => true, respond: () => new Response('nope', { status: 500 }) }])
    expect(await fetchModels(makeCredential({ access_token: '' }), fetcher)).toEqual([])
    expect(await fetchModels(makeCredential(), fetcher)).toEqual([])
  })
})

describe('buddy runBuddyLoginFlow', () => {
  it('runs state → browser → token → account and returns the serialized credential', async () => {
    const opened: string[] = []
    const fetcher = routeFetch([
      {
        when: (url) => url.includes('/auth/state'),
        respond: () => new Response(JSON.stringify({ code: 0, data: { state: STATE, authUrl: AUTH_URL } }), { status: 200 }),
      },
      {
        when: (url) => url.includes('/auth/token'),
        respond: () => new Response(JSON.stringify({
          code: 0,
          data: { accessToken: 'AT', refreshToken: 'RT', expiresAt: '2026-08-30T00:00:00Z', refreshExpiresAt: '', tokenType: 'Bearer', scope: '', domain: 'copilot.tencent.com' },
        }), { status: 200 }),
      },
      {
        when: (url) => url.includes('/login/account'),
        respond: () => new Response(JSON.stringify({ code: 0, data: { uid: 'u1', nickname: 'nick', enterpriseId: '', type: 'personal' } }), { status: 200 }),
      },
    ])

    const result = await runBuddyLoginFlow({
      fetcher,
      pollIntervalMs: 0,
      openBrowser: (url) => { opened.push(url) },
    })

    expect(opened).toEqual([AUTH_URL])
    expect(result.loginUrl).toBe(AUTH_URL)
    expect(result.refreshable).toBe(true)
    expect(result.expires).toBe(Date.parse('2026-08-30T00:00:00Z'))
    const credential = JSON.parse(result.access) as BuddyCredential
    expect(credential).toMatchObject({
      access_token: 'AT', refresh_token: 'RT', user_id: 'u1', nickname: 'nick', account_type: 'personal',
    })
  })

  it('propagates auth/state failures and never opens the browser', async () => {
    const opened: string[] = []
    const fetcher = routeFetch([{ when: () => true, respond: () => new Response('boom', { status: 500 }) }])
    await expect(runBuddyLoginFlow({
      fetcher,
      pollIntervalMs: 0,
      openBrowser: (url) => { opened.push(url) },
    })).rejects.toThrow('auth/state HTTP 500')
    expect(opened).toEqual([])
  })
})

/**
 * 国际站（www.workbuddy.ai）路由。
 *
 * 国际站与国内站协议相同，但域名、Origin 与 platform 参数不同，
 * 且登录在浏览器内完成（等待窗口 15 分钟）。这些差异必须体现在
 * 实际请求上——否则国际站账号会打到国内站上游而被拒绝。
 */
describe('buddy 国际站路由', () => {
  it('fetchAuthState 打到国际站并使用 platform=workbuddy-ai', async () => {
    const fetcher = routeFetch([{
      when: (url) => url.includes('/v2/plugin/auth/state'),
      respond: () => new Response(JSON.stringify({ code: 0, data: { state: STATE, authUrl: AUTH_URL } }), { status: 200 }),
    }])
    await fetchAuthState(fetcher, undefined, 'intl')
    const [url, init] = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
    expect(url).toContain('https://www.workbuddy.ai/v2/plugin/auth/state')
    expect(url).toContain('platform=workbuddy-ai')
    const headers = init.headers as Record<string, string>
    expect(headers['X-Domain']).toBe('www.workbuddy.ai')
    // Origin/Referer 必须伪装为国际站 Web 控制台，而不是国内站的 codebuddy.cn。
    expect(headers.Origin).toBe('https://www.workbuddy.ai')
    expect(headers.Referer).toBe('https://www.workbuddy.ai/')
  })

  it('默认（无 edition）仍打国内站 platform=ide，旧行为不变', async () => {
    const fetcher = routeFetch([{
      when: (url) => url.includes('/v2/plugin/auth/state'),
      respond: () => new Response(JSON.stringify({ code: 0, data: { state: STATE, authUrl: AUTH_URL } }), { status: 200 }),
    }])
    await fetchAuthState(fetcher)
    const [url, init] = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
    expect(url).toContain('https://copilot.tencent.com/v2/plugin/auth/state')
    expect(url).toContain('platform=ide')
    expect((init.headers as Record<string, string>).Origin).toBe('https://www.codebuddy.cn')
  })

  it('refreshToken 按凭据 edition 路由到国际站刷新接口', async () => {
    const fetcher = routeFetch([{
      when: (url) => url.includes('/v2/plugin/auth/token/refresh'),
      respond: () => new Response(JSON.stringify({ code: 0, data: { accessToken: 'AT2', refreshToken: 'RT2' } }), { status: 200 }),
    }])
    const token = await refreshToken(makeCredential({ edition: 'intl', domain: '' }), fetcher)
    expect(token.accessToken).toBe('AT2')
    const [url, init] = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
    expect(url).toBe('https://www.workbuddy.ai/v2/plugin/auth/token/refresh')
    // 凭据未带 domain 时必须回退国际站域名，而不是国内站。
    expect((init.headers as Record<string, string>)['X-Domain']).toBe('www.workbuddy.ai')
  })

  it('fetchModels 按凭据 edition 路由到国际站 /v3/config', async () => {
    const fetcher = routeFetch([{
      when: (url) => url.includes('/v3/config'),
      respond: () => new Response(JSON.stringify({
        data: { agents: [{ name: 'craft', models: ['hy4-preview'] }] },
      }), { status: 200 }),
    }])
    const models = await fetchModels(makeCredential({ edition: 'intl' }), fetcher)
    expect(models).toHaveLength(1)
    const [url] = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]
    expect(url).toBe('https://www.workbuddy.ai/v3/config')
  })

  it('runBuddyLoginFlow 把站点标识写入凭据并路由轮询', async () => {
    const fetcher = routeFetch([
      {
        when: (url) => url.includes('/v2/plugin/auth/state'),
        respond: () => new Response(JSON.stringify({ code: 0, data: { state: STATE, authUrl: AUTH_URL } }), { status: 200 }),
      },
      {
        when: (url) => url.includes('/v2/plugin/auth/token'),
        respond: () => new Response(JSON.stringify({
          code: 0,
          data: { accessToken: 'AT', refreshToken: 'RT', expiresIn: 3600, domain: '' },
        }), { status: 200 }),
      },
      {
        when: (url) => url.includes('/v2/plugin/login/account'),
        respond: () => new Response(JSON.stringify({ code: 0, data: { uid: 'u1', nickname: 'nick' } }), { status: 200 }),
      },
    ])
    const result = await runBuddyLoginFlow({
      fetcher,
      pollIntervalMs: 0,
      openBrowser: () => {},
      edition: 'intl',
    })
    const credential = JSON.parse(result.access) as BuddyCredential
    // 站点标识必须随凭据持久化，后续刷新/对话据此路由。
    expect(credential.edition).toBe('intl')
    // 三个控制面请求全部落在国际站。
    const urls = (fetcher as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls.map(([url]) => url)
    expect(urls.every((url) => url.startsWith('https://www.workbuddy.ai/'))).toBe(true)
  })
})
