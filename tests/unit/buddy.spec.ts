import { describe, expect, it } from 'vitest'
import {
  buildCredential,
  buddyChatUrl,
  buddySiteProfile,
  credentialAuthHeaders,
  credentialExpiresAtMs,
  credentialRequestHeaders,
  displayNameForModel,
  isExpired,
  isRefreshable,
  normalizeBuddyEdition,
  parseAccountData,
  parseModelsFromConfig,
  parseTokenData,
} from '../../src/buddy.js'

const futureMs = Date.now() + 7_200_000
const pastMs = Date.now() - 60_000

/** 构造一个仅用于解析测试的未签名 JWT（payload 可自定义）。 */
function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

describe('buddy credential parsing', () => {
  it('parseTokenData accepts string fields and defaults tokenType to Bearer', () => {
    const token = parseTokenData({
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: '2026-08-30T00:00:00Z',
      refreshExpiresAt: '2026-09-29T00:00:00Z',
      scope: '',
      domain: 'copilot.tencent.com',
    })
    // ISO 绝对时间被归一化为毫秒时间戳字符串（credentialExpiresAtMs 统一解析）。
    expect(token).toEqual({
      accessToken: 'AT',
      refreshToken: 'RT',
      expiresAt: String(Date.parse('2026-08-30T00:00:00Z')),
      refreshExpiresAt: String(Date.parse('2026-09-29T00:00:00Z')),
      tokenType: 'Bearer',
      scope: '',
      domain: 'copilot.tencent.com',
    })
  })

  it('parseTokenData 用 expiresIn 相对秒数换算绝对过期时间（e2e 实证格式）', () => {
    // 真实响应不含 expiresAt/refreshExpiresAt，只有 expiresIn/refreshExpiresIn。
    // JWT 的 iat=1789132433 / exp=1794316433 作为换算基准。
    const accessToken = makeJwt({ iat: 1789132433, exp: 1794316433, nickname: 'Jet' })
    const token = parseTokenData({
      accessToken,
      refreshToken: 'RT',
      expiresIn: 5184000,
      refreshExpiresIn: 7776000,
      tokenType: 'Bearer',
      scope: 'profile offline_access email',
      domain: 'copilot.tencent.com',
    })
    // 基准用 iat：1789132433000 + 5184000 * 1000
    expect(token.expiresAt).toBe(String(1789132433000 + 5184000 * 1000))
    expect(token.refreshExpiresAt).toBe(String(1789132433000 + 7776000 * 1000))
    // 与 JWT exp 一致（5184000s = 60 天）
    expect(Number(token.expiresAt)).toBe(1794316433 * 1000)
  })

  it('parseTokenData 在无 expiresIn 时保持空串，由 credentialExpiresAtMs 从 JWT exp 兜底', () => {
    const accessToken = makeJwt({ exp: 1794316433 })
    const token = parseTokenData({ accessToken, refreshToken: 'RT' })
    expect(token.expiresAt).toBe('')
    const ms = credentialExpiresAtMs({
      access_token: accessToken, refresh_token: 'RT', expires_at: token.expiresAt,
    })
    expect(ms).toBe(1794316433 * 1000)
  })

  it('buildCredential 从 JWT 回填 nickname 与 user_id（login/account 常为空）', () => {
    const accessToken = makeJwt({ sub: 'uid-from-jwt', nickname: 'Jet', preferred_username: '186' })
    const credential = buildCredential(
      parseTokenData({ accessToken, refreshToken: 'RT', expiresIn: 3600 }),
      parseAccountData({ uid: '', nickname: '', type: 'personal' }),
    )
    expect(credential.nickname).toBe('Jet')
    expect(credential.user_id).toBe('uid-from-jwt')
    // 落盘安全性：JSON 必须是单行（多行会被 YAML 当块标量破坏结构）
    expect(/[\r\n]/.test(JSON.stringify(credential))).toBe(false)
  })

  it('parseTokenData 清洗 scope 中的换行（否则破坏 YAML 中的凭据 JSON）', () => {
    const token = parseTokenData({
      accessToken: 'AT', refreshToken: 'RT', scope: 'profile\n    offline_access\n    email',
    })
    expect(token.scope).toBe('profile offline_access email')
    expect(/[\r\n]/.test(JSON.stringify(token))).toBe(false)
  })

  it('parseTokenData stringifies numeric timestamps', () => {
    const token = parseTokenData({ accessToken: 'AT', refreshToken: 'RT', expiresAt: futureMs })
    expect(token.expiresAt).toBe(String(futureMs))
  })

  it('parseTokenData tolerates null/non-object payloads', () => {
    expect(parseTokenData(null).accessToken).toBe('')
    expect(parseTokenData(undefined).tokenType).toBe('Bearer')
  })

  it('parseAccountData defaults type to personal', () => {
    const account = parseAccountData({ uid: 'u1', nickname: 'n1', enterpriseId: '' })
    expect(account).toEqual({ uid: 'u1', nickname: 'n1', enterpriseId: '', accountType: 'personal' })
  })

  it('buildCredential merges token and account', () => {
    const credential = buildCredential(
      parseTokenData({ accessToken: 'AT', refreshToken: 'RT', domain: 'copilot.tencent.com' }),
      parseAccountData({ uid: 'u1', nickname: 'n1', type: 'enterprise', enterpriseId: 'ent-1' }),
    )
    expect(credential).toMatchObject({
      access_token: 'AT',
      refresh_token: 'RT',
      domain: 'copilot.tencent.com',
      user_id: 'u1',
      nickname: 'n1',
      account_type: 'enterprise',
      enterprise_id: 'ent-1',
    })
  })
})

describe('buddy expiry helpers', () => {
  it('credentialExpiresAtMs reads millisecond timestamps', () => {
    expect(credentialExpiresAtMs({ access_token: 'AT', refresh_token: 'RT', expires_at: String(futureMs) })).toBe(futureMs)
  })

  it('credentialExpiresAtMs converts second timestamps to milliseconds', () => {
    const seconds = Math.floor(futureMs / 1000)
    expect(credentialExpiresAtMs({ access_token: 'AT', refresh_token: 'RT', expires_at: String(seconds) })).toBe(seconds * 1000)
  })

  it('credentialExpiresAtMs parses ISO 8601 strings', () => {
    expect(credentialExpiresAtMs({ access_token: 'AT', refresh_token: 'RT', expires_at: '2026-08-30T00:00:00Z' }))
      .toBe(Date.parse('2026-08-30T00:00:00Z'))
  })

  it('credentialExpiresAtMs returns undefined when absent or unparseable', () => {
    expect(credentialExpiresAtMs({ access_token: 'AT', refresh_token: 'RT' })).toBeUndefined()
    expect(credentialExpiresAtMs({ access_token: 'AT', refresh_token: 'RT', expires_at: 'not-a-date' })).toBeUndefined()
  })

  it('isExpired is false when the expiry is unknown (aligns with Rust is_expired)', () => {
    expect(isExpired({ access_token: 'AT', refresh_token: 'RT' })).toBe(false)
    expect(isExpired({ access_token: 'AT', refresh_token: 'RT', expires_at: String(futureMs) })).toBe(false)
    expect(isExpired({ access_token: 'AT', refresh_token: 'RT', expires_at: String(pastMs) })).toBe(true)
  })

  it('isRefreshable requires a non-empty refresh_token', () => {
    expect(isRefreshable({ access_token: 'AT', refresh_token: 'RT' })).toBe(true)
    expect(isRefreshable({ access_token: 'AT', refresh_token: '' })).toBe(false)
  })
})

describe('buddy request headers', () => {
  it('requestHeaders sends X-Domain and the IDE User-Agent', () => {
    const headers = credentialRequestHeaders({ access_token: 'AT', refresh_token: 'RT', domain: 'copilot.tencent.com' })
    expect(headers['X-Domain']).toBe('copilot.tencent.com')
    expect(headers['User-Agent']).toBe('CodeBuddyIDE/1.106.1')
  })

  it('requestHeaders falls back to the default domain', () => {
    expect(credentialRequestHeaders({ access_token: 'AT', refresh_token: 'RT' })['X-Domain']).toBe('copilot.tencent.com')
  })

  it('requestHeaders adds enterprise headers only for enterprise accounts', () => {
    const personal = credentialRequestHeaders({ access_token: 'AT', refresh_token: 'RT', enterprise_id: '' })
    expect(personal['X-Enterprise-Id']).toBeUndefined()

    const enterprise = credentialRequestHeaders({ access_token: 'AT', refresh_token: 'RT', enterprise_id: 'ent-123' })
    expect(enterprise['X-Enterprise-Id']).toBe('ent-123')
    expect(enterprise['X-Tenant-Id']).toBe('ent-123')
  })

  it('authHeaders adds the Bearer token', () => {
    const headers = credentialAuthHeaders({ access_token: 'tok', refresh_token: 'RT', domain: 'copilot.tencent.com' })
    expect(headers.Authorization).toBe('Bearer tok')
    expect(headers['X-Domain']).toBe('copilot.tencent.com')
  })
})

describe('buddy model config parsing', () => {
  it('parses craft agent models and excludes auto', () => {
    const models = parseModelsFromConfig({
      data: {
        agents: [
          { name: 'other', models: ['should-be-ignored'] },
          { name: 'craft', models: ['auto', 'hy4-preview', 'glm-5.3'] },
        ],
      },
    })
    expect(models).toEqual([
      { id: 'hy4-preview', name: 'Hy4 Preview' },
      { id: 'glm-5.3', name: 'GLM-5.3' },
    ])
  })

  it('attaches maxInputTokens from data.models as contextWindow', () => {
    // /v3/config data.models[].maxInputTokens 是模型上下文窗口的权威来源
    // （对齐 deveco-code-rust parse_models_from_config）。
    const models = parseModelsFromConfig({
      data: {
        agents: [{ name: 'craft', models: ['auto', 'glm-5.3-flash', 'kimi-k2.6', 'unknown-model'] }],
        models: [
          { id: 'glm-5.3-flash', maxInputTokens: 1048576 },
          { id: 'kimi-k2.6', maxInputTokens: 262144 },
          { id: 'bad-entry', maxInputTokens: 0 },
        ],
      },
    })
    expect(models).toEqual([
      { id: 'glm-5.3-flash', name: 'GLM-5.3 Flash', contextWindow: 1_048_576 },
      { id: 'kimi-k2.6', name: 'Kimi K2.6', contextWindow: 262_144 },
      { id: 'unknown-model', name: 'unknown-model' },
    ])
  })

  it('parses the capability fields the adapter declares models from', () => {
    const models = parseModelsFromConfig({
      data: {
        agents: [{ name: 'craft', models: ['deepseek-v4.1-flash', 'glm-5.1'] }],
        models: [
          {
            id: 'deepseek-v4.1-flash',
            maxInputTokens: 1_000_000,
            supportsImages: true,
            reasoning: { canDisableThinking: true, defaultEffort: 'high', supportedEfforts: ['low', 'high', 'max'] },
          },
          // 只有固定 effort 的模型没有 supportedEfforts → 不暴露等级选择器
          { id: 'glm-5.1', maxInputTokens: 200_000, supportsImages: true, reasoning: { effort: 'medium' } },
        ],
      },
    })
    expect(models).toEqual([
      {
        id: 'deepseek-v4.1-flash',
        name: 'deepseek-v4.1-flash',
        contextWindow: 1_000_000,
        supportsImages: true,
        reasoningEfforts: ['low', 'high', 'max'],
        defaultReasoningEffort: 'high',
      },
      { id: 'glm-5.1', name: 'GLM-5.1', contextWindow: 200_000, supportsImages: true },
    ])
  })

  it('preserves an explicit supportsImages=false and omits undisclosed fields', () => {
    const models = parseModelsFromConfig({
      data: {
        agents: [{ name: 'craft', models: ['plain', 'bare'] }],
        models: [{ id: 'plain', supportsImages: false }, { id: 'bare' }],
      },
    })
    expect(models[0]?.supportsImages).toBe(false)
    expect(models[1]).toEqual({ id: 'bare', name: 'bare' })
  })

  it('returns an empty list for malformed payloads', () => {
    expect(parseModelsFromConfig(null)).toEqual([])
    expect(parseModelsFromConfig({})).toEqual([])
    expect(parseModelsFromConfig({ data: {} })).toEqual([])
    expect(parseModelsFromConfig({ data: { agents: [{ name: 'craft' }] } })).toEqual([])
    expect(parseModelsFromConfig({ data: { agents: [{ name: 'nope', models: ['a'] }] } })).toEqual([])
  })

  it('displayNameForModel falls back to the raw id', () => {
    expect(displayNameForModel('deepseek-v4-flash')).toBe('DeepSeek V4 Flash')
    expect(displayNameForModel('some-unknown-model')).toBe('some-unknown-model')
  })
})

/**
 * 国际站（www.workbuddy.ai）支持。
 *
 * 国际站与国内站共用一套 /v2/plugin/* 与 /v2/chat/completions 协议，
 * 差异仅在域名、Origin 与 auth/state 的 platform 参数；站点标识持久化在
 * 凭据的 `edition` 字段，据此路由刷新/对话请求。旧凭据无该字段时必须
 * 回退国内站，否则升级后所有存量账号都会失效。
 */
describe('buddy 站点 profile', () => {
  it('归一化站点标识，未知/空值回退国内站', () => {
    expect(normalizeBuddyEdition('intl')).toBe('intl')
    expect(normalizeBuddyEdition('INTL')).toBe('intl')
    expect(normalizeBuddyEdition(' international ')).toBe('intl')
    expect(normalizeBuddyEdition('global')).toBe('intl')
    expect(normalizeBuddyEdition('workbuddy.ai')).toBe('intl')
    // 旧凭据（无 edition）与未知值都必须回退国内站。
    expect(normalizeBuddyEdition(undefined)).toBe('cn')
    expect(normalizeBuddyEdition('')).toBe('cn')
    expect(normalizeBuddyEdition('cn')).toBe('cn')
    expect(normalizeBuddyEdition('nonsense')).toBe('cn')
    expect(normalizeBuddyEdition(42)).toBe('cn')
  })

  it('国际站与国内站的域名/Origin/platform 各得其值', () => {
    expect(buddySiteProfile('cn')).toMatchObject({
      key: 'cn',
      base: 'https://copilot.tencent.com',
      host: 'copilot.tencent.com',
      origin: 'https://www.codebuddy.cn',
      platform: 'ide',
      loginTimeoutMs: 5 * 60 * 1000,
    })
    expect(buddySiteProfile('intl')).toMatchObject({
      key: 'intl',
      base: 'https://www.workbuddy.ai',
      host: 'www.workbuddy.ai',
      origin: 'https://www.workbuddy.ai',
      platform: 'workbuddy-ai',
      // 浏览器内登录（邮箱/验证码/SSO）比扫码慢，等待窗口放宽到 15 分钟。
      loginTimeoutMs: 15 * 60 * 1000,
    })
  })

  it('buddyChatUrl 按站点路由 chat/completions', () => {
    expect(buddyChatUrl('cn')).toBe('https://copilot.tencent.com/v2/chat/completions')
    expect(buddyChatUrl('intl')).toBe('https://www.workbuddy.ai/v2/chat/completions')
    expect(buddyChatUrl(undefined)).toBe('https://copilot.tencent.com/v2/chat/completions')
  })

  it('buildCredential 记录归一化后的站点标识', () => {
    const token = parseTokenData({ accessToken: 'AT', refreshToken: 'RT' })
    const account = parseAccountData({ uid: 'u1' })
    expect(buildCredential(token, account, 'intl').edition).toBe('intl')
    // 未指定站点时默认国内站，保证旧调用方行为不变。
    expect(buildCredential(token, account).edition).toBe('cn')
  })

  it('X-Domain 缺失时按站点回退，而非一律回退国内站', () => {
    const base = {
      access_token: 'AT', refresh_token: 'RT', expires_at: '', refresh_expires_at: '',
      token_type: 'Bearer', scope: '',
    }
    expect(credentialRequestHeaders({ ...base, edition: 'intl' })['X-Domain']).toBe('www.workbuddy.ai')
    expect(credentialRequestHeaders({ ...base, edition: 'cn' })['X-Domain']).toBe('copilot.tencent.com')
    // 凭据自带 domain 时以它为准（权威来源）。
    expect(credentialRequestHeaders({ ...base, edition: 'intl', domain: 'custom.example' })['X-Domain'])
      .toBe('custom.example')
  })
})
