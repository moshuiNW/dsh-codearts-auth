/**
 * 腾讯 CodeBuddy 认证常量、凭据结构与纯解析逻辑
 *
 * 逆向自 CodeBuddy CN IDE (genie 扩展 v4.11.2) 的 external-link-v2 轮询式登录：
 * - fetchAuthState → POST /v2/plugin/auth/state?platform=ide 获取 state + authUrl
 * - openAuthUrl    → 打开浏览器到 https://www.codebuddy.cn/login/?platform=ide&state=...
 * - loopGetToken   → GET /v2/plugin/auth/token?state=... 轮询获取 token（1s 间隔，5min 超时）
 * - getAccount     → GET /v2/plugin/login/account?state=... 轮询获取账户信息
 * - refreshToken   → POST /v2/plugin/auth/token/refresh 刷新 token
 *
 * 与 CodeArts 的 PKCE OAuth + 本地回调服务器不同，CodeBuddy 采用**轮询式**：
 * 客户端不起本地服务器，而是定期轮询后端 API 检查登录状态。
 *
 * 本模块只放常量与纯函数（无网络、无存储），网络流程见 buddy-oauth.ts。
 */

// ── API 端点常量（逆向自 genie 扩展 product.json + index.js） ──

/** 主 API 端点（product.json endpoint）。 */
export const API_ENDPOINT = 'https://copilot.tencent.com'
/** API 路径前缀（product.json authentication.attributes.prefixPath）。 */
export const PREFIX_PATH = '/plugin'
/** 平台标识（product.json authentication.attributes.platform）。 */
export const PLATFORM = 'ide'
/** 登录网站首页（copilot.tencent.com → www.codebuddy.cn 映射）。 */
export const WEBSITE_HOME = 'https://www.codebuddy.cn'

/** 获取 auth state 端点：POST /v2/plugin/auth/state?platform=ide */
export const AUTH_STATE_PATH = '/v2/plugin/auth/state'
/** 轮询 token 端点：GET /v2/plugin/auth/token?state=... */
export const AUTH_TOKEN_PATH = '/v2/plugin/auth/token'
/** 轮询账户端点：GET /v2/plugin/login/account?state=... */
export const LOGIN_ACCOUNT_PATH = '/v2/plugin/login/account'
/** 刷新 token 端点：POST /v2/plugin/auth/token/refresh */
export const AUTH_REFRESH_PATH = '/v2/plugin/auth/token/refresh'
/** 账户列表端点：GET /v2/plugin/accounts */
export const ACCOUNTS_PATH = '/v2/plugin/accounts'
/** 云端配置端点：GET /v3/config（获取模型列表、agents、productFeatures） */
export const CONFIG_PATH = '/v3/config'

// ── 轮询参数 ──

/** 登录轮询总超时（5 分钟，对齐 IDE 的 5*60*1e3）。 */
export const LOGIN_TIMEOUT_MS = 5 * 60 * 1000
/** 轮询间隔（1 秒，对齐 IDE 的 setTimeout(o,1e3)）。 */
export const POLL_INTERVAL_MS = 1000
/** auth/state 请求超时（5 秒，对齐 IDE 的 timeout:5e3）。 */
export const STATE_REQUEST_TIMEOUT_MS = 5_000
/** 其余控制面请求超时（token/account/refresh/config）。 */
export const REQUEST_TIMEOUT_MS = 60_000

// ── 错误码（逆向自 IDE catch 分支） ──

/** token 尚未就绪（loopGetToken 中 continue 轮询）。 */
export const CODE_TOKEN_NOT_READY = 11217
/** 账户信息尚未完成（getAccount 中 continue 轮询）。 */
export const CODE_ACCOUNT_NOT_READY = 12151

// ── HTTP Header 常量（逆向自 IDE Jd/jM/qM 定义） ──

export const HTTP_HEADER_DOMAIN = 'X-Domain'
export const HTTP_HEADER_ENTERPRISE_ID = 'X-Enterprise-Id'
export const HTTP_HEADER_TENANT_ID = 'X-Tenant-Id'
export const HTTP_HEADER_NO_AUTHORIZATION = 'X-No-Authorization'
export const HTTP_HEADER_NO_USER_ID = 'X-No-User-Id'
export const HTTP_HEADER_NO_ENTERPRISE_ID = 'X-No-Enterprise-Id'
export const HTTP_HEADER_NO_DEPARTMENT_INFO = 'X-No-Department-Info'
export const HTTP_HEADER_REFRESH_TOKEN = 'X-Refresh-Token'
export const HTTP_HEADER_AUTH_REFRESH_SOURCE = 'X-Auth-Refresh-Source'
export const HTTP_HEADER_PRODUCT = 'X-Product'
export const HTTP_HEADER_PRODUCT_CODE = 'X-Product-Code'

/**
 * User-Agent 标识（对齐 IDE 的 getUserAgent() → CodeBuddyIDE/${platformVersion}）。
 * platformVersion 来自 IDE product.json version 字段（1.106.1），非 genie 版本。
 */
export const BUDDY_USER_AGENT = 'CodeBuddyIDE/1.106.1'
/** X-Product-Code 值（对齐 IDE headers 设置）。 */
export const BUDDY_PRODUCT_CODE = 'codebuddy'
/** X-Product 默认值（deploymentType，对齐 ProductEndpointHttpInterceptor）。 */
export const BUDDY_DEPLOYMENT_TYPE = 'SaaS'
/** 刷新来源标识（对齐 IDE 的 ide-main）。 */
export const AUTH_REFRESH_SOURCE = 'ide-main'

/** API 端点的裸域名（X-Domain 头的值）。 */
export const API_DOMAIN = 'copilot.tencent.com'

// ── 站点 Profile（国内站 / 国际站） ──
//
// 国际站 www.workbuddy.ai 与国内站 copilot.tencent.com 走**同一套** /v2/plugin/*
// 与 /v2/chat/completions 协议（路径与响应包络完全一致），差异仅在：
//   - 上游域名与 Web Origin（国际站位于腾讯 EdgeOne 国际 CDN）
//   - auth/state 的 platform 参数（workbuddy-ai 而非 ide）
//   - 登录在浏览器内完成（邮箱 / 验证码 / SSO），等待授权比扫码慢
//   - 会话结构校验更严格：首条消息必须是 system（见 buddy-adapter 的归一化）
// 站点标识随凭据持久化在 `edition` 字段，据此路由刷新与对话请求。

/** 站点标识：`cn` = 国内站（copilot.tencent.com）；`intl` = 国际站（www.workbuddy.ai）。 */
export type BuddyEdition = 'cn' | 'intl'

/** 单个站点的上游参数。 */
export interface BuddySiteProfile {
  /** 站点标识（持久化到凭据的 edition 字段）。 */
  key: BuddyEdition
  /** 控制台/UI 展示名。 */
  label: string
  /** API 基础地址（无尾斜杠）。 */
  base: string
  /** 裸域名（X-Domain 头的兜底值）。 */
  host: string
  /** Origin / Referer 伪装来源（各站 Web 控制台）。 */
  origin: string
  /** auth/state 的 platform 参数。 */
  platform: string
  /** 登录命令等待授权完成的超时。 */
  loginTimeoutMs: number
}

/** 国内站 copilot.tencent.com。 */
export const BUDDY_SITE_CN: BuddySiteProfile = {
  key: 'cn',
  label: '国内站',
  base: API_ENDPOINT,
  host: API_DOMAIN,
  origin: WEBSITE_HOME,
  platform: PLATFORM,
  loginTimeoutMs: LOGIN_TIMEOUT_MS,
}

/** 国际站 www.workbuddy.ai。 */
export const BUDDY_SITE_INTL: BuddySiteProfile = {
  key: 'intl',
  label: '国际站',
  base: 'https://www.workbuddy.ai',
  host: 'www.workbuddy.ai',
  origin: 'https://www.workbuddy.ai',
  platform: 'workbuddy-ai',
  // 浏览器内登录（邮箱/验证码/SSO）比扫码慢，放宽等待窗口。
  loginTimeoutMs: 15 * 60 * 1000,
}

/**
 * 归一化站点标识；空值/未知值回退国内站（与旧凭据兼容）。
 * 接受别名 international / global / workbuddy.ai。
 */
export function normalizeBuddyEdition(value: unknown): BuddyEdition {
  if (typeof value !== 'string') return 'cn'
  switch (value.toLowerCase().trim()) {
    case 'intl':
    case 'international':
    case 'global':
    case 'workbuddy.ai':
      return 'intl'
    default:
      return 'cn'
  }
}

/** 取得站点 Profile；未知/空值回退国内站。 */
export function buddySiteProfile(edition: unknown): BuddySiteProfile {
  return normalizeBuddyEdition(edition) === 'intl' ? BUDDY_SITE_INTL : BUDDY_SITE_CN
}

/** chat/completions 的完整 URL（按凭据所属站点路由）。 */
export function buddyChatUrl(edition: unknown): string {
  return `${buddySiteProfile(edition).base}/v2/chat/completions`
}

// ── 凭据数据结构 ──

/**
 * 持久化的 CodeBuddy 凭据。
 *
 * 对齐 IDE 的 auth 对象结构（accessToken/refreshToken/expiresAt/...）
 * 加上 account 对象（uid/nickname/enterpriseId/type）。除两个令牌外的字段
 * 均为可选，以便稳妥解析来自磁盘的旧版/部分凭据。
 */
export interface BuddyCredential {
  /** 访问令牌（Authorization: Bearer <access_token>）。 */
  access_token: string
  /** 刷新令牌（X-Refresh-Token header）。 */
  refresh_token: string
  /** token 过期时间（原始值，可能为毫秒时间戳或 ISO 字符串）。 */
  expires_at?: string
  /** refresh_token 过期时间。 */
  refresh_expires_at?: string
  /** token 类型（"Bearer"）。 */
  token_type?: string
  /** OAuth scope（通常为空）。 */
  scope?: string
  /** API 域名（"copilot.tencent.com"）。 */
  domain?: string
  /** 用户 ID（account.uid）。 */
  user_id?: string
  /** 用户昵称（account.nickname）。 */
  nickname?: string
  /** 企业 ID（account.enterpriseId，个人版为空）。 */
  enterprise_id?: string
  /** 账户类型（"personal" / "enterprise"）。 */
  account_type?: string
  /**
   * 站点标识：`cn`（国内站，默认）| `intl`（国际站 www.workbuddy.ai）。
   *
   * 缺失/未知值一律按国内站处理，因此旧凭据无需迁移即可继续使用。
   * 刷新令牌、拉取模型与对话请求都据此路由到对应上游。
   */
  edition?: string
}

/** auth/token 与 auth/token/refresh 响应的令牌数据。 */
export interface BuddyToken {
  accessToken: string
  refreshToken: string
  expiresAt: string
  refreshExpiresAt: string
  tokenType: string
  scope: string
  domain: string
}

/** login/account 响应的账户数据。 */
export interface BuddyAccount {
  uid: string
  nickname: string
  enterpriseId: string
  accountType: string
}

/**
 * 从凭据 expires_at 解析毫秒时间戳（兼容毫秒时间戳 / 秒级时间戳 / ISO 8601）。
 * 无法解析或缺失时返回 undefined。
 *
 * 后备来源（e2e 实证 2026-09-11）：CodeBuddy 的 `/v2/plugin/auth/token`
 * **不返回绝对的 `expiresAt`**，只返回相对的 `expiresIn`。若凭据里的
 * `expires_at` 为空（历史写入或后端变更），回退到解析 access_token 这个
 * JWT 的 `exp` 声明——它同样是权威的过期时刻。
 */
export function credentialExpiresAtMs(credential: BuddyCredential): number | undefined {
  const raw = credential.expires_at
  if (typeof raw === 'string' && raw.length > 0) {
    // 纯数字：视为时间戳。> 1e12 为毫秒，否则为秒。
    if (/^\d+$/.test(raw)) {
      const value = Number(raw)
      return value > 1_000_000_000_000 ? value : value * 1000
    }
    const parsed = Date.parse(raw)
    if (!Number.isNaN(parsed)) return parsed
  }
  return jwtExpiresAtMs(credential.access_token)
}

/**
 * 从 JWT 的 payload 读取 `exp`（秒）并换算为毫秒；非 JWT 或解析失败返回 undefined。
 * 仅做 base64url 解码，不验签——该值只用于展示与续期调度。
 */
export function jwtExpiresAtMs(token: string): number | undefined {
  if (typeof token !== 'string' || token.length === 0) return undefined
  const parts = token.split('.')
  if (parts.length < 2) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { exp?: unknown }
    return typeof payload.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp * 1000 : undefined
  } catch {
    return undefined
  }
}

/**
 * 从 JWT payload 读取 `nickname`（CodeBuddy 的 login/account 响应不含昵称，
 * 昵称只在 access_token 的声明里）。解析失败返回空串。
 */
export function jwtNickname(token: string): string {
  if (typeof token !== 'string' || token.length === 0) return ''
  const parts = token.split('.')
  if (parts.length < 2) return ''
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
    const nickname = payload.nickname ?? payload.preferred_username ?? payload.name
    return typeof nickname === 'string' ? stripControlChars(nickname) : ''
  } catch {
    return ''
  }
}

/** 凭据是否已过期；无法解析过期时间时不判定过期（对齐 Rust is_expired）。 */
export function isExpired(credential: BuddyCredential): boolean {
  const expiresAt = credentialExpiresAtMs(credential)
  return expiresAt === undefined ? false : Date.now() >= expiresAt
}

/** 凭据是否携带可静默续期的 refresh_token。 */
export function isRefreshable(credential: BuddyCredential): boolean {
  return credential.refresh_token.length > 0
}

/**
 * 取生效的 X-Domain：凭据自带的 domain 优先，缺失或空串时回退站点域名。
 *
 * 必须按**长度**判断而非 `??`/`||` 混用：后端在部分响应里把 domain 返回为
 * 空串，`'' ?? fallback` 仍得到 `''`，会让 X-Domain 变成非法空值。
 */
export function domainOrDefault(credential: BuddyCredential): string {
  const domain = typeof credential.domain === 'string' ? credential.domain.trim() : ''
  return domain.length > 0 ? domain : buddySiteProfile(credential.edition).host
}

/** 构造基础请求头（X-Domain + User-Agent + 可选企业头）。 */
export function credentialRequestHeaders(credential: BuddyCredential): Record<string, string> {
  const headers: Record<string, string> = {
    // X-Domain 缺失时回退到凭据所属站点的域名（国际站是 workbuddy.ai，
    // 不能一律回退 copilot.tencent.com，否则国际站账号会被判为跨站）。
    // 注意用长度判断而非 `??`：后端会把 domain 返回为**空串**，
    // `'' ?? x` 仍是 ''，会让 X-Domain 变成空值。
    [HTTP_HEADER_DOMAIN]: domainOrDefault(credential),
    'User-Agent': BUDDY_USER_AGENT,
  }
  if (credential.enterprise_id !== undefined && credential.enterprise_id.length > 0) {
    headers[HTTP_HEADER_ENTERPRISE_ID] = credential.enterprise_id
    headers[HTTP_HEADER_TENANT_ID] = credential.enterprise_id
  }
  return headers
}

/** 构造带 Bearer 令牌的认证请求头。 */
export function credentialAuthHeaders(credential: BuddyCredential): Record<string, string> {
  return {
    ...credentialRequestHeaders(credential),
    Authorization: `Bearer ${credential.access_token}`,
  }
}

/**
 * 从 JSON 安全读取字符串字段（兼容后端把时间戳返回为数字）。
 *
 * 会剔除 CR/LF 等控制字符：CodeBuddy 的 `scope` 字段有时返回多行文本
 * （如 "profile\n    offline_access\n    email"）。这些换行会被凭据的
 * JSON 字符串原样携带，并在落盘到 YAML（`.credentials.yaml`）时被当作
 * 多行标量，破坏 JSON 结构 —— 重新读取时 `JSON.parse` 失败，表现为
 * 有效期/昵称等字段"丢失"（实际是整个凭据无法解析）。
 */
function readStringField(data: Record<string, unknown>, key: string): string {
  const value = data[key]
  if (typeof value === 'string') return stripControlChars(value)
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

/** 去掉字符串中的控制字符（含 CR/LF/Tab），并把连续空白折叠为单个空格。 */
function stripControlChars(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s{2,}/g, ' ').trim()
}

/** 从 JSON 读取数值字段（兼容后端返回数字型字符串）。 */
function readNumberField(data: Record<string, unknown>, key: string): number | undefined {
  const value = data[key]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim())) return Number(value)
  return undefined
}

/**
 * 若令牌本身未携带绝对 `expiresAt`，则用相对秒数（`expiresIn`）换算为绝对毫秒时间戳。
 * 换算基准取 access_token 的 JWT `exp`（优先，权威）或当前时刻。
 */
function absoluteExpiryMs(
  record: Record<string, unknown>,
  absoluteKey: string,
  relativeKey: string,
  accessToken: string,
): string {
  const absolute = readStringField(record, absoluteKey)
  if (absolute.length > 0) {
    // 归一化为毫秒时间戳字符串，交由 credentialExpiresAtMs 统一解析。
    const asNumber = /^\d+$/.test(absolute) ? Number(absolute) : Date.parse(absolute)
    if (Number.isFinite(asNumber)) {
      const ms = asNumber > 1_000_000_000_000 ? asNumber : asNumber * 1000
      return String(ms)
    }
    return absolute
  }
  const relativeSeconds = readNumberField(record, relativeKey)
  if (relativeSeconds === undefined) {
    // 无相对值：交给 JWT exp 兜底（access_token 的 exp 即权威过期时刻）。
    return absoluteKey === 'expiresAt' ? '' : ''
  }
  // 基准：access_token 的签发时刻（iat）优先，缺失时用当前时刻。
  const baseMs = jwtIssuedAtMs(accessToken) ?? Date.now()
  return String(baseMs + relativeSeconds * 1000)
}

/** 从 JWT payload 读取 `iat`（秒）并换算为毫秒。 */
function jwtIssuedAtMs(token: string): number | undefined {
  if (typeof token !== 'string' || token.length === 0) return undefined
  const parts = token.split('.')
  if (parts.length < 2) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { iat?: unknown }
    return typeof payload.iat === 'number' && Number.isFinite(payload.iat) ? payload.iat * 1000 : undefined
  } catch {
    return undefined
  }
}

/**
 * 从 JSON 解析令牌数据（兼容 camelCase 字段名与数字型时间戳）。
 *
 * e2e 实证（2026-09-11）：`/v2/plugin/auth/token` 实际只返回
 * `expiresIn` / `refreshExpiresIn`（相对秒数），**没有** `expiresAt` /
 * `refreshExpiresAt`。因此这里在绝对字段缺失时用相对秒数换算，
 * 否则凭据的 `expires_at` 会一直是空串（UI 显示"有效期未知"）。
 */
export function parseTokenData(data: unknown): BuddyToken {
  const record = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>
  const tokenType = readStringField(record, 'tokenType')
  const accessToken = readStringField(record, 'accessToken')
  return {
    accessToken,
    refreshToken: readStringField(record, 'refreshToken'),
    expiresAt: absoluteExpiryMs(record, 'expiresAt', 'expiresIn', accessToken),
    refreshExpiresAt: absoluteExpiryMs(record, 'refreshExpiresAt', 'refreshExpiresIn', accessToken),
    tokenType: tokenType.length > 0 ? tokenType : 'Bearer',
    scope: readStringField(record, 'scope'),
    domain: readStringField(record, 'domain'),
  }
}

/**
 * 从 JSON 解析账户数据。
 *
 * `login/account` 响应不含 `nickname`（e2e 实证：只有 uid/nickname 之外的
 * 字段都为空），昵称实际在 access_token 的 JWT 声明里；调用方通过
 * `buildCredential` 时传入 token 以便回填。
 */
export function parseAccountData(data: unknown): BuddyAccount {
  const record = (typeof data === 'object' && data !== null ? data : {}) as Record<string, unknown>
  const accountType = readStringField(record, 'type')
  return {
    uid: readStringField(record, 'uid'),
    nickname: readStringField(record, 'nickname'),
    enterpriseId: readStringField(record, 'enterpriseId'),
    accountType: accountType.length > 0 ? accountType : 'personal',
  }
}

/**
 * 组合令牌与账户数据为可持久化的凭据。
 *
 * 昵称回填顺序（e2e 实证 2026-09-11：`login/account` 的 `nickname` 常为空，
 * 真正的昵称只在 access_token 的 JWT 声明里）：
 * account.nickname → JWT.nickname → JWT.preferred_username。
 * 过期时间同理：token.expiresAt 为空时由 credentialExpiresAtMs 从 JWT exp 兜底。
 */
export function buildCredential(
  token: BuddyToken,
  account: BuddyAccount,
  edition?: unknown,
): BuddyCredential {
  const nickname = account.nickname.length > 0 ? account.nickname : jwtNickname(token.accessToken)
  return {
    access_token: token.accessToken,
    refresh_token: token.refreshToken,
    expires_at: token.expiresAt,
    refresh_expires_at: token.refreshExpiresAt,
    token_type: token.tokenType,
    scope: token.scope,
    domain: token.domain,
    user_id: account.uid.length > 0 ? account.uid : jwtSubject(token.accessToken),
    nickname,
    enterprise_id: account.enterpriseId,
    account_type: account.accountType,
    edition: normalizeBuddyEdition(edition),
  }
}

/** 从 JWT payload 读取 `sub`（用户 id）；解析失败返回空串。 */
function jwtSubject(token: string): string {
  if (typeof token !== 'string' || token.length === 0) return ''
  const parts = token.split('.')
  if (parts.length < 2) return ''
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as Record<string, unknown>
    return typeof payload.sub === 'string' ? payload.sub : ''
  } catch {
    return ''
  }
}

// ── 模型列表 ──

/** 已知模型 ID → 展示名（/v3/config 不返回展示名，本地兜底映射）。 */
const MODEL_DISPLAY_NAMES: Readonly<Record<string, string>> = {
  'deepseek-v4-flash': 'DeepSeek V4 Flash',
  'deepseek-v4-pro': 'DeepSeek V4 Pro',
  'hy4-preview': 'Hy4 Preview',
  'hy4-preview-x': 'Hy4 Preview X',
  'hy3': 'Hy3',
  'hy3-x': 'Hy3 X',
  'glm-5.3': 'GLM-5.3',
  'glm-5.3-flash': 'GLM-5.3 Flash',
  'glm-5.2': 'GLM-5.2',
  'glm-5.1': 'GLM-5.1',
  'glm-5v-turbo': 'GLM-5V Turbo',
  'kimi-k3-1': 'Kimi K3-1',
  'kimi-k2.7': 'Kimi K2.7',
  'kimi-k2.6': 'Kimi K2.6',
  'minimax-m3': 'MiniMax M3',
}

/** 模型 ID → 人类可读显示名称；未知模型回退为 ID 本身。 */
export function displayNameForModel(id: string): string {
  return MODEL_DISPLAY_NAMES[id] ?? id
}

/** /v3/config 解析出的单个模型：id、展示名与远端声明的能力。 */
export interface BuddyRemoteModel {
  id: string
  name: string
  /** 上下文窗口（data.models[].maxInputTokens，模型自身配置）；远端未下发时缺省。 */
  contextWindow?: number
  /** 是否接受图片输入（data.models[].supportsImages）。 */
  supportsImages?: boolean
  /** 可选思考等级（data.models[].reasoning.supportedEfforts）；无等级可选的模型缺省。 */
  reasoningEfforts?: string[]
  /** 默认思考等级（data.models[].reasoning.defaultEffort）。 */
  defaultReasoningEffort?: string
}

/**
 * 从 /v3/config 响应解析模型列表（craft agent 的 models）。
 *
 * 响应结构：{data: {agents: [{name: "craft", models: ["auto", "hy4-preview", ...]}, ...],
 *                     models: [{id, name, maxInputTokens, supportsImages, reasoning: {...}}]}}
 * craft agent 的 models 是字符串 id 列表；各模型的上下文窗口与能力从 data.models[]
 * 按 id 查找（权威来源，对齐 deveco-code-rust parse_models_from_config）。
 * 排除 "auto"（自动选择，非真实模型）。解析失败时返回空数组，调用方回退内置列表。
 */
export function parseModelsFromConfig(body: unknown): BuddyRemoteModel[] {
  if (typeof body !== 'object' || body === null) return []
  const data = (body as Record<string, unknown>).data
  if (typeof data !== 'object' || data === null) return []
  // data.models: id → 远端声明的模型元数据
  const metaById = new Map<string, Record<string, unknown>>()
  if (Array.isArray((data as Record<string, unknown>).models)) {
    for (const model of (data as Record<string, unknown>).models as unknown[]) {
      if (typeof model !== 'object' || model === null) continue
      const record = model as Record<string, unknown>
      if (typeof record.id === 'string') metaById.set(record.id, record)
    }
  }
  const agents = (data as Record<string, unknown>).agents
  if (!Array.isArray(agents)) return []
  for (const agent of agents) {
    if (typeof agent !== 'object' || agent === null) continue
    const record = agent as Record<string, unknown>
    if (record.name !== 'craft') continue
    const models = record.models
    if (!Array.isArray(models)) return []
    const parsed: BuddyRemoteModel[] = []
    for (const model of models) {
      if (typeof model !== 'string' || model === 'auto') continue
      parsed.push({ id: model, name: displayNameForModel(model), ...parseModelMeta(metaById.get(model)) })
    }
    return parsed
  }
  return []
}

/**
 * 提取单个 data.models[] 条目的上下文窗口与对话能力。
 *
 * 上下文窗口只保留正数（与 Rust 端一致）。能力字段只在远端**显式**下发时保留：
 * 缺失即 undefined，交由适配器的静态兜底表决定，而不是猜成 false。
 */
function parseModelMeta(record: Record<string, unknown> | undefined): Omit<BuddyRemoteModel, 'id' | 'name'> {
  if (record === undefined) return {}
  const meta: Omit<BuddyRemoteModel, 'id' | 'name'> = {}
  const limit = record.maxInputTokens
  if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) meta.contextWindow = limit
  if (typeof record.supportsImages === 'boolean') meta.supportsImages = record.supportsImages
  const reasoning = record.reasoning
  if (typeof reasoning === 'object' && reasoning !== null) {
    const fields = reasoning as Record<string, unknown>
    // supportedEfforts 是**可枚举**的等级列表，只在模型真正支持多等级时下发；
    // 只有单一默认 effort 的模型（glm-5.1/kimi-*）此处缺省，不暴露等级选择器。
    if (Array.isArray(fields.supportedEfforts)) {
      const efforts = fields.supportedEfforts.filter((e): e is string => typeof e === 'string' && e.length > 0)
      if (efforts.length > 0) meta.reasoningEfforts = efforts
    }
    if (typeof fields.defaultEffort === 'string' && fields.defaultEffort.length > 0) {
      meta.defaultReasoningEffort = fields.defaultEffort
    }
  }
  return meta
}
