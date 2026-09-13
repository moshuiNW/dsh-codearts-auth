import { describe, it, expect } from 'vitest'
import {
  DEFAULT_RATE_LIMIT_COOLDOWN_MS,
  isRateLimited,
  parseRateLimitError,
} from '../../src/llm-adapter.js'

describe('rate limit parser', () => {
  it('should detect rate limit error', () => {
    const body = '{"code":6004,"msg":"您的使用量已超出频率限制，将在 2026-09-11 18:08:17 UTC+8 重置，您也可以切换其他模型继续使用。","requestId":"xyz"}'
    expect(isRateLimited(body)).toBe(true)
  })

  it('should not detect normal error', () => {
    const body = '{"error":{"message":"model not found"}}'
    expect(isRateLimited(body)).toBe(false)
  })

  it('should parse reset time from buddy error', () => {
    const body = '{"code":6004,"msg":"您的使用量已超出频率限制，将在 2026-09-11 18:08:17 UTC+8 重置，您也可以切换其他模型继续使用。","requestId":"xyz"}'
    const result = parseRateLimitError(body, 'deepseek-v4-flash')
    expect(result).not.toBeNull()
    expect(result!.modelId).toBe('deepseek-v4-flash')
    // 验证解析的时间戳大致正确
    const expected = Date.parse('2026-09-11 18:08:17 UTC+8')
    expect(result!.resetTimeMs).toBe(expected)
  })

  /**
   * 国际站（workbuddy.ai）返回英文限流消息。旧实现只匹配中文措辞
   * 「将在 … UTC+8」，英文消息解析不出时刻，被静默降级成"当前时间+1小时"
   * （旧 fallback），把真实的重置时刻丢掉——导致过早放行或过度封禁。
   */
  it('parses the international-site English reset message', () => {
    const body = JSON.stringify({
      code: 6004,
      msg: 'Your usage has exceeded the rate limit. It will reset at 2099-09-05 01:57:00 UTC+8.',
    })
    const result = parseRateLimitError(body, 'hy4-preview')
    expect(result!.resetTimeMs).toBe(Date.parse('2099-09-05 01:57:00 UTC+8'))
  })

  /**
   * 时区必须按消息**声明**的偏移换算。旧实现把捕获到的偏移丢掉、硬编码
   * UTC+8，声明 UTC+0 会算错 8 小时。
   */
  it('honours the declared UTC offset instead of hardcoding UTC+8', () => {
    const at = (zone: string) => parseRateLimitError(
      JSON.stringify({ code: 6004, msg: `您的使用量已超出频率限制，将在 2099-09-05 01:57:00 ${zone} 重置` }),
      'm',
    )!.resetTimeMs
    expect(at('UTC+8')).toBe(Date.parse('2099-09-04T17:57:00Z'))
    expect(at('UTC+0')).toBe(Date.parse('2099-09-05T01:57:00Z'))
    expect(at('UTC-5')).toBe(Date.parse('2099-09-05T06:57:00Z'))
    // 未声明偏移时沿用历史默认（UTC+8）
    expect(parseRateLimitError(
      JSON.stringify({ code: 6004, msg: '将在 2099-09-05 01:57:00 重置' }), 'm',
    )!.resetTimeMs).toBe(Date.parse('2099-09-04T17:57:00Z'))
  })

  /** 429 但响应体为空/非限流措辞：必须仍判定为限流（否则不切账号）。 */
  it('treats any HTTP 429 as rate limited even with an empty or vague body', () => {
    expect(isRateLimited('', 429)).toBe(true)
    expect(isRateLimited('{}', 429)).toBe(true)
    expect(isRateLimited('Too Many Requests')).toBe(true)
    // 同一份空体在非 429 下不应误判
    expect(isRateLimited('', 500)).toBe(false)
    expect(isRateLimited('{}', 500)).toBe(false)
  })

  /** 非 JSON 体（CDN HTML 错误页）也要能拿到一个冷却时刻，而不是 null。 */
  it('returns a default cooldown for non-JSON 429 bodies', () => {
    const now = Date.now()
    const result = parseRateLimitError('<html>429 Too Many Requests</html>', 'm', { status: 429, now })
    expect(result).not.toBeNull()
    expect(result!.modelId).toBe('m')
    expect(result!.resetTimeMs).toBe(now + DEFAULT_RATE_LIMIT_COOLDOWN_MS)
  })

  /** 能判定限流但解析不出时刻：给短冷却（默认 60s），不再盲记 1 小时。 */
  it('falls back to the short default cooldown when no reset time is present', () => {
    const now = Date.now()
    const result = parseRateLimitError(JSON.stringify({ code: 6004, msg: '频率限制' }), 'm', { now })
    expect(result!.resetTimeMs).toBe(now + DEFAULT_RATE_LIMIT_COOLDOWN_MS)
    expect(DEFAULT_RATE_LIMIT_COOLDOWN_MS).toBe(60_000)
  })

  /** 完全不是限流的错误仍返回 null，避免误记限流。 */
  it('returns null for genuinely unrelated errors', () => {
    expect(parseRateLimitError(JSON.stringify({ error: { message: 'model not found' } }), 'm')).toBeNull()
    expect(parseRateLimitError('', 'm', { status: 400 })).toBeNull()
  })
})
