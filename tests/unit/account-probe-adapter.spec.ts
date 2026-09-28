/**
 * 遗留缺陷回归测试：`account-probe` 的适配器选择必须按**产品配置**判定。
 *
 * 原始实现只判断 `entry.provider === 'buddy'`，于是 `workbuddy` 账号落入
 * else 分支、被交给 `CodeArtsAdapter`（华为云 HMAC 签名 + 错误端点）去发
 * WorkBuddy 凭据，探测必然失败。本文件用被 mock 的 BuddyAdapter 验证：
 * buddy 与 workbuddy 都走 BuddyAdapter，且各自带上自己的 product 配置。
 *
 * 注意：BuddyAdapter 被替换为桩（不发任何网络请求），CodeArtsAdapter 保持
 * 真实但**在本文件内不会被构造** —— 若缺陷复发，workbuddy 分支会构造真实
 * CodeArtsAdapter 并发起网络请求，测试随即失败。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LlmError } from '@deepseek-ai/dsh-llm'
import type { ProbePool } from '../../src/account-probe.js'
import type { ProviderAccountEntry } from '../../src/types.js'

vi.mock('../../src/buddy-adapter.js', () => {
  /** 记录被构造的选项与每次 `stream()` 的入参；流式请求一律以限流错误结束（不发网络请求）。 */
  class MockBuddyAdapter {
    static readonly instances: Array<{ product?: { id: string; productCode: string } }> = []
    /** 每次 `stream()` 收到的 GenerateOptions（用于断言探测请求的形状）。 */
    static readonly streamOptions: Array<{ system?: string; messages?: unknown }> = []
    constructor(options: { product?: { id: string; productCode: string } }) {
      MockBuddyAdapter.instances.push(options)
    }
    // eslint-disable-next-line require-yield
    async *stream(options: { system?: string; messages?: unknown }): AsyncGenerator<never> {
      MockBuddyAdapter.streamOptions.push(options)
      throw new LlmError('频率限制', 'RATE_LIMIT')
    }
  }
  return { BuddyAdapter: MockBuddyAdapter }
})

vi.mock('../../src/trae-adapter.js', () => {
  /** 同款桩：只记录构造与 `stream()` 入参，不发网络请求。 */
  class MockTraeAdapter {
    static readonly instances: Array<{ product?: { id: string } }> = []
    static readonly streamOptions: Array<{ system?: string; messages?: unknown }> = []
    constructor(options: { product?: { id: string } }) {
      MockTraeAdapter.instances.push(options)
    }
    // eslint-disable-next-line require-yield
    async *stream(options: { system?: string; messages?: unknown }): AsyncGenerator<never> {
      MockTraeAdapter.streamOptions.push(options)
      throw new LlmError('频率限制', 'RATE_LIMIT')
    }
  }
  return { TraeAdapter: MockTraeAdapter }
})

vi.mock('../../src/qoder-adapter.js', () => {
  /** 同款桩：只记录构造与 `stream()` 入参，不发网络请求。 */
  class MockQoderAdapter {
    static readonly instances: Array<{ product?: { id: string } }> = []
    static readonly streamOptions: Array<{ system?: string; messages?: unknown }> = []
    constructor(options: { product?: { id: string } }) {
      MockQoderAdapter.instances.push(options)
    }
    // eslint-disable-next-line require-yield
    async *stream(options: { system?: string; messages?: unknown }): AsyncGenerator<never> {
      MockQoderAdapter.streamOptions.push(options)
      throw new LlmError('频率限制', 'RATE_LIMIT')
    }
  }
  return { QoderAdapter: MockQoderAdapter }
})

vi.mock('../../src/cline-adapter.js', () => {
  /** 同款桩：只记录构造与 `stream()` 入参，不发网络请求。 */
  class MockClineAdapter {
    static readonly instances: Array<{ product?: { id: string } }> = []
    static readonly streamOptions: Array<{ system?: string; messages?: unknown }> = []
    constructor(options: { product?: { id: string } }) {
      MockClineAdapter.instances.push(options)
    }
    // eslint-disable-next-line require-yield
    async *stream(options: { system?: string; messages?: unknown }): AsyncGenerator<never> {
      MockClineAdapter.streamOptions.push(options)
      throw new LlmError('频率限制', 'RATE_LIMIT')
    }
  }
  return { ClineAdapter: MockClineAdapter }
})

/**
 * `CodeArtsAdapter` 换成桩，但保留 `isRateLimited` 等**真实导出**。
 *
 * 理由：本文件要验证「非 codearts 的 provider **不会**落入 CodeArtsAdapter 分支」。
 * 若保持真实实现，缺陷复发时它会真的向华为云端点发请求（慢且不稳定），
 * 而桩可让「走错分支」这一事实以**构造记录**直接暴露。
 */
vi.mock('../../src/llm-adapter.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/llm-adapter.js')>()
  class MockCodeArtsAdapter {
    static readonly instances: unknown[] = []
    constructor(options: unknown) {
      MockCodeArtsAdapter.instances.push(options)
    }
    // eslint-disable-next-line require-yield
    async *stream(): AsyncGenerator<never> {
      throw new LlmError('频率限制', 'RATE_LIMIT')
    }
  }
  return { ...actual, CodeArtsAdapter: MockCodeArtsAdapter }
})

/** 取 mock 的构造记录。 */
async function adapterInstances(): Promise<Array<{ product?: { id: string; productCode: string } }>> {
  const mod = await import('../../src/buddy-adapter.js') as unknown as {
    BuddyAdapter: { instances: Array<{ product?: { id: string; productCode: string } }> }
  }
  return mod.BuddyAdapter.instances
}

/** 取 mock 收到的 `stream()` 入参记录。 */
async function streamOptions(): Promise<Array<{ system?: string; messages?: unknown }>> {
  const mod = await import('../../src/buddy-adapter.js') as unknown as {
    BuddyAdapter: { streamOptions: Array<{ system?: string; messages?: unknown }> }
  }
  return mod.BuddyAdapter.streamOptions
}

/** 取 TRAE 桩的构造记录。 */
async function traeInstances(): Promise<Array<{ product?: { id: string } }>> {
  const mod = await import('../../src/trae-adapter.js') as unknown as {
    TraeAdapter: { instances: Array<{ product?: { id: string } }> }
  }
  return mod.TraeAdapter.instances
}

/** 取 TRAE 桩收到的 `stream()` 入参记录。 */
async function traeStreamOptions(): Promise<Array<{ system?: string; messages?: unknown }>> {
  const mod = await import('../../src/trae-adapter.js') as unknown as {
    TraeAdapter: { streamOptions: Array<{ system?: string; messages?: unknown }> }
  }
  return mod.TraeAdapter.streamOptions
}

/** 取 Qoder 桩的构造记录。 */
async function qoderInstances(): Promise<Array<{ product?: { id: string } }>> {
  const mod = await import('../../src/qoder-adapter.js') as unknown as {
    QoderAdapter: { instances: Array<{ product?: { id: string } }> }
  }
  return mod.QoderAdapter.instances
}

/** 取 Cline 桩的构造记录。 */
async function clineInstances(): Promise<Array<{ product?: { id: string } }>> {
  const mod = await import('../../src/cline-adapter.js') as unknown as {
    ClineAdapter: { instances: Array<{ product?: { id: string } }> }
  }
  return mod.ClineAdapter.instances
}

/** 取 CodeArts 桩的构造记录（用于断言「没有走错分支」）。 */
async function codeartsInstances(): Promise<unknown[]> {
  const mod = await import('../../src/llm-adapter.js') as unknown as {
    CodeArtsAdapter: { instances: unknown[] }
  }
  return mod.CodeArtsAdapter.instances
}

function makeEntry(overrides: Partial<ProviderAccountEntry>): ProviderAccountEntry {
  return {
    id: 'wb-1',
    provider: 'workbuddy',
    nickname: '测试号',
    enabled: true,
    credentialRef: 'WORKBUDDY_ACCOUNT_TEST',
    createdAt: 1,
    refreshable: true,
    modelRateLimits: { 'deepseek-v4.1-flash': Date.now() + 3_600_000 },
    ...overrides,
  }
}

/** 只实现探测路径用到的方法。 */
function makePool(entries: ProviderAccountEntry[]): ProbePool {
  const accounts = new Map(entries.map(e => [e.id, e]))
  return {
    findAccount: (id) => accounts.get(id),
    listAccountsByProvider: (provider) => [...accounts.values()].filter(a => a.provider === provider),
    async resolveCredentialForAccount() {
      return { access_token: 'AT', refresh_token: 'RT', expires_at: '2099-01-01T00:00:00Z' }
    },
    async clearModelRateLimits() { return 0 },
  }
}

describe('account-probe 适配器选择按产品判定', () => {
  beforeEach(async () => {
    ;(await adapterInstances()).length = 0
    ;(await streamOptions()).length = 0
    ;(await traeInstances()).length = 0
    ;(await traeStreamOptions()).length = 0
    ;(await codeartsInstances()).length = 0
  })

  it('workbuddy 账号走 BuddyAdapter 并携带 WorkBuddy 产品配置', async () => {
    const { retestAccount } = await import('../../src/account-probe.js')
    const result = await retestAccount(makePool([makeEntry({})]), 'wb-1')

    // 仍受限（桩抛限流错误），但关键在于是**由 BuddyAdapter** 发起的
    expect(result.tested).toBe(1)
    expect(result.stillLimited).toHaveLength(1)

    const instances = await adapterInstances()
    expect(instances).toHaveLength(1)
    expect(instances[0]?.product?.id).toBe('workbuddy')
    expect(instances[0]?.product?.productCode).toBe('workbuddy')
  })

  it('buddy 账号仍走 BuddyAdapter 且携带 CodeBuddy 产品配置', async () => {
    const { retestAccount } = await import('../../src/account-probe.js')
    await retestAccount(makePool([makeEntry({
      id: 'buddy-1',
      provider: 'buddy',
      credentialRef: 'BUDDY_ACCOUNT_TEST',
    })]), 'buddy-1')

    const instances = await adapterInstances()
    expect(instances).toHaveLength(1)
    expect(instances[0]?.product?.id).toBe('buddy')
    expect(instances[0]?.product?.productCode).toBe('codebuddy')
  })
})

/**
 * 回归：**TRAE 账号的探测必须走 `TraeAdapter`**，不能落入 CodeArts 分支。
 *
 * ## 真实缺陷（与 workbuddy 的历史缺陷同型，2026-09-25 排查时发现）
 *
 * `probeWithAdapter` 的适配器分派依次判定 `productById`（CodeBuddy 系）与
 * `lobsteraiProductById`（LobsterAI），**两者都不含 trae**，于是 TRAE 账号
 * 落入 `else` → 构造 `CodeArtsAdapter`，用**华为云 SDK-HMAC-SHA256 签名**
 * 去发 TRAE 凭据到华为云端点。
 *
 * 实测（`productById('trae')` / `lobsteraiProductById('trae')` 均为 `undefined`）：
 * 请求必然失败，用户在 TRAE 面板点「重测」只会得到与真实限流无关的报错，
 * 重测功能对 TRAE **恒不可用** —— 正是本文件开头记录的 workbuddy 缺陷
 * （`provider === 'buddy'` 判据漏掉 workbuddy）的翻版：**分派表没跟上新增 provider**。
 *
 * ⚠️ 教训：新增 provider 时必须同步 `probeWithAdapter` 的分派分支。判据是
 * 「该 provider 会不会写 `modelRateLimits`」（写了才会有重测按钮）。
 */
describe('account-probe 适配器选择 · TRAE 不得落入 CodeArts 分支', () => {
  beforeEach(async () => {
    ;(await adapterInstances()).length = 0
    ;(await streamOptions()).length = 0
    ;(await traeInstances()).length = 0
    ;(await traeStreamOptions()).length = 0
    ;(await codeartsInstances()).length = 0
  })

  it('trae 账号走 TraeAdapter，而不是 CodeArtsAdapter', async () => {
    const { retestAccount } = await import('../../src/account-probe.js')
    const result = await retestAccount(makePool([makeEntry({
      id: 'trae-1',
      provider: 'trae',
      credentialRef: 'TRAE_ACCOUNT_TEST',
    })]), 'trae-1')

    // 仍受限（桩抛限流错误），但关键在于是**由 TraeAdapter** 发起的
    expect(result.tested).toBe(1)
    expect(result.stillLimited).toHaveLength(1)

    const trae = await traeInstances()
    expect(trae).toHaveLength(1)
    // 刻意**不传** product：TRAE 只有一个产品，TraeAdapter 内部默认用 `TRAE`
    // 常量（与 buddy/lobsterai 需要按 provider 查表不同）。故这里断言
    // 「未显式指定 product」这一既定契约，而不是断言它等于 'trae'。
    expect(trae[0]?.product).toBeUndefined()
    // 核心断言：**没有**构造 CodeArtsAdapter（否则就是用华为云签名发 TRAE 请求）。
    expect(await codeartsInstances()).toHaveLength(0)
  })

  it('trae 探测请求同样带 system（与其它 provider 判据一致）', async () => {
    const { retestAccount } = await import('../../src/account-probe.js')
    await retestAccount(makePool([makeEntry({
      id: 'trae-2',
      provider: 'trae',
      credentialRef: 'TRAE_ACCOUNT_TEST',
    })]), 'trae-2')

    const calls = await traeStreamOptions()
    expect(calls).toHaveLength(1)
    expect(typeof calls[0]?.system).toBe('string')
    expect((calls[0]!.system as string).length).toBeGreaterThan(0)
  })

  it('codearts 账号仍然走 CodeArtsAdapter（分派没有被改坏）', async () => {
    const { retestAccount } = await import('../../src/account-probe.js')
    await retestAccount(makePool([makeEntry({
      id: 'ca-1',
      provider: 'codearts',
      credentialRef: 'CODEARTS_ACCOUNT_TEST',
    })]), 'ca-1')

    expect(await codeartsInstances()).toHaveLength(1)
    expect(await traeInstances()).toHaveLength(0)
    expect(await adapterInstances()).toHaveLength(0)
  })
})

/**
 * 回归：**Qoder 系（qoder / qodercn）与 Cline 不得落入 CodeArts 分支**。
 *
 * ## 真实缺陷（本分派表第三次复发）
 *
 * 前两次是 `workbuddy` 与 `trae`（见上文两节）。补上 trae 之后，表里仍缺
 * `qoder` / `qodercn` / `cline` —— 三者会一路落到 `else`，被交给
 * `CodeArtsAdapter`（华为云 `SDK-HMAC-SHA256` 签名 + 华为云端点）去发
 * Qoder / Cline 的凭据，探测**必然失败**。
 *
 * 与 workbuddy / trae 那两次不同的是，这三个 provider 的失败是**用户可见
 * 且必然触发**的：
 *
 * - 前端 `RATE_LIMIT_CAPABILITIES` 对未登记的 provider **默认视为有限流**
 *   （刻意的，避免新增 provider 时凭空丢掉按钮），故它们的「重测 / 重置」
 *   按钮**确实会渲染**；
 * - 且 Qoder 的额度受限**每次都会**写 `modelRateLimits`
 *   （`QoderAdapter.switchAccountOnQuota` 按 UTC+8 当日 24:00 标记该模型），
 *   于是「点了重测 → 报签名错误 → 标记还在」成为稳定可复现的死循环。
 *
 * ⚠️ 这三个 provider 的查表函数**本来就存在**（`qoderProductById` /
 * `clineProductById`），只是没被接上 —— 与 trae「压根没有查表函数」不同，
 * 所以修复只需接线，不需要新增数据。
 */
describe('account-probe 适配器选择 · qoder / qodercn / cline 不得落入 CodeArts 分支', () => {
  beforeEach(async () => {
    ;(await adapterInstances()).length = 0
    ;(await streamOptions()).length = 0
    ;(await traeInstances()).length = 0
    ;(await traeStreamOptions()).length = 0
    ;(await codeartsInstances()).length = 0
    ;(await qoderInstances()).length = 0
    ;(await clineInstances()).length = 0
  })

  it.each([
    ['qoder', 'QODER_ACCOUNT_TEST'],
    ['qodercn', 'QODERCN_ACCOUNT_TEST'],
  ])('%s 账号走 QoderAdapter 而不是 CodeArtsAdapter', async (provider, credentialRef) => {
    const { retestAccount } = await import('../../src/account-probe.js')
    const id = `${provider}-1`
    const result = await retestAccount(makePool([makeEntry({ id, provider, credentialRef })]), id)

    // 仍受限（桩抛限流错误），但关键在于是**由 QoderAdapter** 发起的
    expect(result.tested).toBe(1)
    expect(result.stillLimited).toHaveLength(1)

    const qoder = await qoderInstances()
    expect(qoder).toHaveLength(1)
    // 产品必须随 provider 正确分派：国际版与 CN 共用同一个适配器类，
    // 若这里带上错误的产品配置，请求会发到错的区域/端点。
    expect(qoder[0]?.product?.id).toBe(provider)
    // 核心断言：**没有**构造 CodeArtsAdapter（否则就是用华为云签名发 Qoder 请求）。
    expect(await codeartsInstances()).toHaveLength(0)
  })

  it('cline 账号走 ClineAdapter 而不是 CodeArtsAdapter', async () => {
    const { retestAccount } = await import('../../src/account-probe.js')
    const result = await retestAccount(makePool([makeEntry({
      id: 'cline-1',
      provider: 'cline',
      credentialRef: 'CLINE_ACCOUNT_TEST',
    })]), 'cline-1')

    expect(result.tested).toBe(1)
    expect(result.stillLimited).toHaveLength(1)

    const cline = await clineInstances()
    expect(cline).toHaveLength(1)
    expect(cline[0]?.product?.id).toBe('cline')
    expect(await codeartsInstances()).toHaveLength(0)
  })
})

/**
 * 回归：**探测请求必须带首条 system 消息**（否则 WorkBuddy 网关 400 拦截）。
 *
 * ## 真实缺陷（用户报障，2026-09-25）
 *
 * 在 Jet Hub 的 WorkBuddy 面板点「重测」/「重测所有」，得到的不是真实结论，
 * 而是一律的错误提示：
 *
 * ```
 * bmwukong · deepseek-v4.1-flash：无法确认：buddy: {"code":11128,
 * "msg":"first message is not system prompt", ... "请求被安全策略拦截，请稍后重试或联系支持。"}
 * ```
 *
 * 该报错**伪装成安全策略拦截**，与真实的限流/可用性完全无关 —— 于是重测
 * 功能在 WorkBuddy 上**恒不可用**：既拿不到「已恢复」，也拿不到「仍受限」。
 *
 * ## 根因（已实发对照实测）
 *
 * `probeWithAdapter` 只传 `messages`、**不传 `options.system`**，而适配器仅在
 * `options.system` 非空时才 `unshift` system 消息（`buddy-adapter.ts`），故 wire
 * 上首条就是 `role:'user'`。
 *
 * 实测（2026-09-25，同一凭据各发一次最小请求）：
 *
 * | 端点 | 无 system | 有 system |
 * |---|---|---|
 * | `www.workbuddy.ai`（WorkBuddy） | **400 + code 11128** | 200 正常 |
 * | `copilot.tencent.com`（CodeBuddy） | 200 正常 | 200 正常 |
 *
 * 即**只有 WorkBuddy 国际版网关**强制要求首条 system。故修复必须让探测请求
 * 无条件带上 system —— 不能依赖「反正 buddy 不要求」而只在 workbuddy 分支加。
 *
 * ⚠️ 本用例断言的是**探测请求的入参形状**（而非适配器产物），因为缺陷在
 * 调用方：适配器行为本来就正确（有 system 就插入），是探测没给它 system。
 * 用 mock 记录 `stream()` 入参，可在**零网络**下锁死该契约。
 */
describe('account-probe 探测请求必须带首条 system（WorkBuddy 11128 回归）', () => {
  beforeEach(async () => {
    ;(await adapterInstances()).length = 0
    ;(await streamOptions()).length = 0
    ;(await traeInstances()).length = 0
    ;(await traeStreamOptions()).length = 0
    ;(await codeartsInstances()).length = 0
  })

  it('workbuddy 探测请求带非空 system（否则网关 400 安全策略拦截）', async () => {
    const { retestAccount } = await import('../../src/account-probe.js')
    await retestAccount(makePool([makeEntry({})]), 'wb-1')

    const calls = await streamOptions()
    expect(calls).toHaveLength(1)
    // 关键断言：system 必须存在且非空 —— 缺失即 wire 首条变成 user → 11128。
    expect(typeof calls[0]?.system).toBe('string')
    expect((calls[0]!.system as string).length).toBeGreaterThan(0)
  })

  it('buddy 探测请求同样带 system（两个 provider 判据一致，不做分支特判）', async () => {
    const { retestAccount } = await import('../../src/account-probe.js')
    await retestAccount(makePool([makeEntry({
      id: 'buddy-1',
      provider: 'buddy',
      credentialRef: 'BUDDY_ACCOUNT_TEST',
    })]), 'buddy-1')

    const calls = await streamOptions()
    expect(calls).toHaveLength(1)
    expect(typeof calls[0]?.system).toBe('string')
    expect((calls[0]!.system as string).length).toBeGreaterThan(0)
  })

  it('探测请求仍然只有一条 user 消息（system 走 options.system，不塞进 messages）', async () => {
    const { retestAccount } = await import('../../src/account-probe.js')
    await retestAccount(makePool([makeEntry({})]), 'wb-1')

    const calls = await streamOptions()
    const messages = calls[0]?.messages as Array<{ role?: string }> | undefined
    expect(messages).toHaveLength(1)
    // system 若也塞进 messages，适配器会插入两次 system（一次来自 messages、
    // 一次来自 options.system），wire 上出现重复 system 消息。
    expect(messages?.[0]?.role).toBe('user')
  })
})
