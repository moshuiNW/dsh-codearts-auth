import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CommandDefinition } from '@deepseek-ai/dsh-commands'
import { apply } from '../../src/index.js'
import { runLoginFlow, runOAuthFlow } from '../../src/login.js'
import { runBuddyLoginFlow } from '../../src/buddy-oauth.js'
import { CodeArtsAuth } from '../../src/service.js'
import { BuddyAuth } from '../../src/buddy-auth.js'

vi.mock('../../src/login.js', () => ({
  runLoginFlow: vi.fn(),
  runOAuthFlow: vi.fn(),
}))

// Buddy 登录会真实发起轮询网络请求：插件层测试只关心命令/路由注册，故 mock 整个流程。
// RefreshTokenExpiredError 必须保留真实实现：buddy-auth 的 RefreshScheduler
// onError 回调以 `error instanceof RefreshTokenExpiredError` 判定续期是否
// 彻底失效；mock 缺少该导出会让判定路径抛出 unhandled rejection。
vi.mock('../../src/buddy-oauth.js', async (importOriginal) => ({
  ...await importOriginal(),
  runBuddyLoginFlow: vi.fn(),
}))

const mockedRunLoginFlow = vi.mocked(runLoginFlow)
const mockedRunOAuthFlow = vi.mocked(runOAuthFlow)
const mockedRunBuddyLoginFlow = vi.mocked(runBuddyLoginFlow)

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

class FakeCommands {
  readonly definitions: CommandDefinition[] = []
  register(definition: CommandDefinition): () => void {
    this.definitions.push(definition)
    return () => {}
  }
}

class FakeLlm {
  readonly providers: string[] = []
  readonly adapters: string[] = []
  registerConfigurableProviders(entries: Array<{ provider: string }>): { replace: () => void } {
    for (const entry of entries) this.providers.push(entry.provider)
    return { replace: () => {} }
  }
  registerAdapter(providers: string[], _adapter: unknown): { replace: () => void } {
    this.adapters.push(...providers)
    return { replace: () => {} }
  }
}

function makeContext(): { ctx: Context; commands: FakeCommands; llm: FakeLlm } {
  const ctx = new Context()
  ctx.provide('credentials', new FakeCredentials() as never)
  const commands = new FakeCommands()
  ctx.provide('commands', commands as never)
  const llm = new FakeLlm()
  ctx.provide('llm', llm as never)
  return { ctx, commands, llm }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('plugin entry', () => {
  it('registers the codeartsAuth service and the codearts-login command', () => {
    const { ctx, commands } = makeContext()
    apply(ctx)
    expect(ctx.codeartsAuth).toBeInstanceOf(CodeArtsAuth)
    expect(commands.definitions.map((d) => d.name)).toContain('codearts-login')
  })

  it('command handler reports success with ref and expiry', async () => {
    mockedRunOAuthFlow.mockResolvedValue({ access: 'cred', expires: 1234, loginUrl: 'https://login' })
    const { ctx, commands } = makeContext()
    apply(ctx)
    const login = commands.definitions.find((d) => d.name === 'codearts-login')!
    const result = await login.handler({
      commandId: 'cid' as never,
      agent: undefined as never,
      rawInput: '',
      signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ kind: 'success' })
    expect((result as { text?: string }).text).toContain('CODEARTS_ACCESS_TOKEN')
  })

  it('command handler reports a failure as an error result', async () => {
    mockedRunOAuthFlow.mockRejectedValue(new Error('CodeArts login timed out'))
    const { ctx, commands } = makeContext()
    apply(ctx)
    const login = commands.definitions.find((d) => d.name === 'codearts-login')!
    const result = await login.handler({
      commandId: 'cid' as never,
      agent: undefined as never,
      rawInput: '',
      signal: new AbortController().signal,
    })
    expect(result).toEqual({ kind: 'error', text: 'CodeArts login timed out' })
  })

  it('注册 buddy LLM 路由与 codearts 状态/刷新命令（codearts provider 已停用）', () => {
    const { ctx, commands, llm } = makeContext()
    apply(ctx)
    // CodeArts provider 已在 src/index.ts 中停用（账户未配置），不应出现在模型选择器。
    // 恢复该 provider 时，需同步把下面两行断言改回 toContain('codearts')。
    expect(llm.providers).not.toContain('codearts')
    expect(llm.adapters).not.toContain('codearts')
    expect(llm.providers).toContain('buddy')
    // 服务与命令保留，账号池亦保留（buddy 适配器依赖它）
    const names = commands.definitions.map((d) => d.name)
    expect(names).toContain('codearts-status')
    expect(names).toContain('codearts-refresh')
  })

  it('codearts-status reports refreshability', async () => {
    mockedRunOAuthFlow.mockResolvedValue({ access: 'cred', expires: 1234, loginUrl: 'https://login' })
    const { ctx, commands } = makeContext()
    apply(ctx)
    const status = commands.definitions.find((d) => d.name === 'codearts-status')!
    const result = await status.handler({
      commandId: 'cid' as never,
      agent: undefined as never,
      rawInput: '',
      signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ kind: 'success' })
  })

  it('stops the refresh scheduler when the plugin context is disposed', async () => {
    const { ctx } = makeContext()
    apply(ctx)
    const stopSpy = vi.spyOn(ctx.codeartsAuth, 'stop')
    await ctx.fiber.dispose()
    expect(stopSpy).toHaveBeenCalled()
  })
})

describe('buddy plugin entry', () => {
  it('registers the buddyAuth service and the buddy login/status/refresh commands', () => {
    const { ctx, commands } = makeContext()
    apply(ctx)
    expect(ctx.buddyAuth).toBeInstanceOf(BuddyAuth)
    const names = commands.definitions.map((d) => d.name)
    expect(names).toContain('buddy-login')
    expect(names).toContain('buddy-status')
    expect(names).toContain('buddy-refresh')
  })

  it('registers the buddy LLM route', () => {
    const { ctx, commands, llm } = makeContext()
    apply(ctx)
    expect(llm.providers).toContain('buddy')
    expect(llm.adapters).toContain('buddy')
    expect(commands.definitions.map((d) => d.name)).toContain('buddy-login')
  })

  it('buddy-login stores the credential and reports success', async () => {
    mockedRunBuddyLoginFlow.mockResolvedValue({
      access: '{"access_token":"AT","refresh_token":"RT","expires_at":"2026-08-30T00:00:00Z"}',
      expires: Date.parse('2026-08-30T00:00:00Z'),
      loginUrl: 'https://www.codebuddy.cn/login/?platform=ide&state=s',
      refreshable: true,
    })
    const { ctx, commands } = makeContext()
    apply(ctx)
    const login = commands.definitions.find((d) => d.name === 'buddy-login')!
    const result = await login.handler({
      commandId: 'cid' as never,
      agent: undefined as never,
      rawInput: '',
      signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ kind: 'success' })
    expect((result as { text?: string }).text).toContain('BUDDY_ACCESS_TOKEN')
    expect(await ctx.credentials.resolve('BUDDY_ACCESS_TOKEN')).toBeDefined()
  })

  it('buddy-login reports a failure as an error result', async () => {
    mockedRunBuddyLoginFlow.mockRejectedValue(new Error('获取 token 超时（5 分钟）'))
    const { ctx, commands } = makeContext()
    apply(ctx)
    const login = commands.definitions.find((d) => d.name === 'buddy-login')!
    const result = await login.handler({
      commandId: 'cid' as never,
      agent: undefined as never,
      rawInput: '',
      signal: new AbortController().signal,
    })
    expect(result).toEqual({ kind: 'error', text: '获取 token 超时（5 分钟）' })
  })

  it('buddy-status reports configured/refreshable state', async () => {
    const { ctx, commands } = makeContext()
    apply(ctx)
    await ctx.credentials.set('BUDDY_ACCESS_TOKEN', JSON.stringify({
      access_token: 'AT', refresh_token: 'RT', expires_at: String(Date.now() + 7_200_000),
    }))
    const status = commands.definitions.find((d) => d.name === 'buddy-status')!
    const result = await status.handler({
      commandId: 'cid' as never,
      agent: undefined as never,
      rawInput: '',
      signal: new AbortController().signal,
    })
    expect(result).toMatchObject({ kind: 'success' })
    expect((result as { text: string }).text).toContain('已配置: true')
    expect((result as { text: string }).text).toContain('可刷新: true')
  })

  it('stops the buddy refresh scheduler when the plugin context is disposed', async () => {
    const { ctx } = makeContext()
    apply(ctx)
    const stopSpy = vi.spyOn(ctx.buddyAuth, 'stop')
    await ctx.fiber.dispose()
    expect(stopSpy).toHaveBeenCalled()
  })
})
