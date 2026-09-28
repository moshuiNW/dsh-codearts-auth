/**
 * Jet Hub 持久化后端（`src/jet-hub-store.ts`）回归。
 *
 * 背景（Gitee issue IKI7WT）：DSH 0.1.7-rc.1 把 `ctx.settings` 换成
 * `SettingsForms`（**没有 `register`**），旧写法令账号列表与模型黑名单
 * 退化成纯内存。这里锁死两条后端的选路与落盘行为。
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createJetHubStore,
  sanitizeAccounts,
  sanitizeDisabledModels,
} from '../../src/jet-hub-store.js'
import type { ProviderAccountEntry } from '../../src/types.js'

/** 造一个最小 ctx；`settings` 按用例给（undefined = 服务缺失）。 */
function makeCtx(settings: unknown): never {
  return {
    get: (key: string) => (key === 'settings' ? settings : undefined),
    logger: { warn: () => {}, info: () => {} },
  } as never
}

const ACCOUNT: ProviderAccountEntry = {
  id: 'buddy-abc12345',
  provider: 'buddy',
  nickname: '测试账号',
  enabled: true,
  credentialRef: 'BUDDY_ACCOUNT_ABC12345',
  createdAt: 1,
  refreshable: true,
}

let dir: string
let previousDir: string | undefined

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jet-hub-store-'))
  previousDir = process.env.DSH_JET_HUB_STATE_DIR
  process.env.DSH_JET_HUB_STATE_DIR = dir
})

afterEach(() => {
  if (previousDir === undefined) delete process.env.DSH_JET_HUB_STATE_DIR
  else process.env.DSH_JET_HUB_STATE_DIR = previousDir
  rmSync(dir, { recursive: true, force: true })
})

describe('后端选路', () => {
  it('settings.register 可用时走老契约（数据仍在 settings 文档里）', () => {
    const scope = { get: () => ({ accounts: [] }), replace: async () => {} }
    const store = createJetHubStore(makeCtx({ register: () => scope, describe: () => [] }))
    expect(store.kind).toBe('settings')
  })

  it('settings 无 register（0.1.7 契约）时走文件后端', () => {
    const store = createJetHubStore(makeCtx({ describe: () => [], configure: () => () => {} }))
    expect(store.kind).toBe('file')
  })

  it('settings 服务缺失时仍走文件后端（headless 也可持久化）', () => {
    expect(createJetHubStore(makeCtx(undefined)).kind).toBe('file')
  })
})

describe('老契约后端（SettingsStore）', () => {
  it('整体写入同时携带账号与黑名单', async () => {
    const payloads: Array<Record<string, unknown>> = []
    let stored: unknown = undefined
    const scope = {
      get: () => stored,
      replace: async (value: object) => {
        payloads.push(value as Record<string, unknown>)
        stored = value
      },
    }
    const store = createJetHubStore(makeCtx({ register: () => scope, describe: () => [] }))
    await store.save({ accounts: [ACCOUNT], disabledModels: { buddy: { 'glm-5.2': true } } })

    expect(payloads).toHaveLength(1)
    expect(payloads[0]!.accounts).toEqual([ACCOUNT])
    expect(payloads[0]!.disabledModels).toEqual({ buddy: { 'glm-5.2': true } })
    expect(store.load()).toEqual({
      accounts: [ACCOUNT],
      disabledModels: { buddy: { 'glm-5.2': true } },
      loomyPermanentLocked: false,
    })
  })

  /**
   * ⚠️ 老契约后端也必须持久化锁定开关（用户要求「需要支持持久化」）。
   */
  it('Loomy 永久积分锁定在 settings 后端可读回', async () => {
    let saved: Record<string, unknown> | undefined
    const scope = {
      get: () => saved,
      replace: async (section: object) => { saved = section as Record<string, unknown> },
    }
    const store = createJetHubStore(makeCtx({ register: () => scope, describe: () => [] }))
    await store.save({ accounts: [], disabledModels: {}, loomyPermanentLocked: true })
    expect(saved?.loomyPermanentLocked).toBe(true)
    expect(store.load()?.loomyPermanentLocked).toBe(true)
  })
})

describe('文件后端（FileStore）', () => {
  it('写入后可被新实例读回（跨重启持久化）', async () => {
    const writer = createJetHubStore(makeCtx(undefined))
    await writer.save({ accounts: [ACCOUNT], disabledModels: { buddy: { 'glm-5.2': true } } })

    const statePath = join(dir, 'jet-hub', 'state.json')
    expect(existsSync(statePath)).toBe(true)

    const reader = createJetHubStore(makeCtx(undefined))
    expect(reader.load()).toEqual({
      accounts: [ACCOUNT],
      disabledModels: { buddy: { 'glm-5.2': true } },
      // 新字段缺省 false（解锁）—— 与既有行为一致
      loomyPermanentLocked: false,
    })
  })

  /**
   * ⚠️ Loomy「锁定永久积分」必须**跨重启持久化**（用户明确要求）。
   */
  it('Loomy 永久积分锁定可跨实例读回', async () => {
    const writer = createJetHubStore(makeCtx(undefined))
    await writer.save({ accounts: [], disabledModels: {}, loomyPermanentLocked: true })

    const reader = createJetHubStore(makeCtx(undefined))
    expect(reader.load()?.loomyPermanentLocked).toBe(true)
  })

  it('老文档没有该字段时缺省为 false（不误锁）', () => {
    mkdirSync(join(dir, 'jet-hub'), { recursive: true })
    // 手工写入一份「没有 loomyPermanentLocked」的旧文档
    writeFileSync(
      join(dir, 'jet-hub', 'state.json'),
      JSON.stringify({ accounts: [], disabledModels: {} }),
      'utf-8',
    )
    expect(createJetHubStore(makeCtx(undefined)).load()?.loomyPermanentLocked).toBe(false)
  })

  it('该字段非布尔值时不误判为锁定', () => {
    mkdirSync(join(dir, 'jet-hub'), { recursive: true })
    writeFileSync(
      join(dir, 'jet-hub', 'state.json'),
      JSON.stringify({ accounts: [], disabledModels: {}, loomyPermanentLocked: 'yes' }),
      'utf-8',
    )
    // 只认显式 true（与 disabledModels 的「只认显式 true」同一约定）
    expect(createJetHubStore(makeCtx(undefined)).load()?.loomyPermanentLocked).toBe(false)
  })

  it('文档损坏时不抛错，按空状态启动', () => {
    mkdirSync(join(dir, 'jet-hub'), { recursive: true })
    writeFileSync(join(dir, 'jet-hub', 'state.json'), '{ not json', 'utf-8')
    const store = createJetHubStore(makeCtx(undefined))
    expect(store.load()).toBeUndefined()
  })

  it('首次启动可从 .credentials.yaml 的 refs 恢复账号（0.1.7 迁移路径）', () => {
    writeFileSync(
      join(dir, '.credentials.yaml'),
      [
        'version: 1',
        'refs:',
        '  BUDDY_ACCESS_TOKEN: <irrelevant>',
        '  BUDDY_ACCOUNT_ABC12345: {"access_token":"x"}',
        '  CODEARTS_ACCOUNT_DEADBEEF: {"access_key_id":"y"}',
        '  NOT_AN_ACCOUNT_REF: 1',
        'records: {}',
      ].join('\n'),
      'utf-8',
    )

    const store = createJetHubStore(makeCtx(undefined))
    const state = store.load()
    expect(state?.accounts.map(a => [a.id, a.provider, a.credentialRef])).toEqual([
      ['buddy-abc12345', 'buddy', 'BUDDY_ACCOUNT_ABC12345'],
      ['codearts-deadbeef', 'codearts', 'CODEARTS_ACCOUNT_DEADBEEF'],
    ])
    // 恢复结果必须立即落盘，否则每次启动都会重复恢复。
    expect(existsSync(join(dir, 'jet-hub', 'state.json'))).toBe(true)
  })

  /**
   * 回归：**全部 10 个 provider** 的账号 ref 都必须能恢复。
   *
   * 真实缺陷：恢复表原先只有 6 项（注释也写着「六个 provider」），而插件实际
   * 有 10 个 —— `qodercn` / `cline` / `loomy` / `raccoon` 的账号在状态文档
   * 缺失时**静默消失**（用户侧表现：「重装 / 迁移后这几个面板的账号凭空不见，
   * 只能重新登录」）。凭据本体一直在 `.credentials.yaml` 里，只是索引建不出来。
   *
   * ⚠️ 上一条用例只覆盖 `buddy` 与 `codearts`，正是这个覆盖缺口让缺陷溜过。
   * 本用例按 `jet-hub-rpc.ts` 的 `account.create` 前缀规则逐个断言，
   * **新增 provider 时若忘记登记，这里会红**。
   */
  it('十个 provider 的账号 ref 全部可恢复（新增 provider 必须同步登记）', () => {
    const cases: Array<[string, string]> = [
      ['CODEARTS_ACCOUNT_AAAAAA', 'codearts'],
      ['BUDDY_ACCOUNT_BBBBBB', 'buddy'],
      ['WORKBUDDY_ACCOUNT_CCCCCC', 'workbuddy'],
      ['LOBSTERAI_ACCOUNT_DDDDDD', 'lobsterai'],
      ['QODER_ACCOUNT_EEEEEE', 'qoder'],
      ['QODERCN_ACCOUNT_FFFFFF', 'qodercn'],
      ['TRAE_ACCOUNT_111111', 'trae'],
      ['CLINE_ACCOUNT_222222', 'cline'],
      ['LOOMY_ACCOUNT_333333', 'loomy'],
      ['RACCOON_ACCOUNT_444444', 'raccoon'],
    ]
    writeFileSync(
      join(dir, '.credentials.yaml'),
      ['version: 1', 'refs:', ...cases.map(([ref]) => `  ${ref}: '{}'`), 'records: {}'].join('\n'),
      'utf-8',
    )

    const recovered = createJetHubStore(makeCtx(undefined)).load()?.accounts ?? []
    expect(recovered.map(a => [a.credentialRef, a.provider])).toEqual(cases)
  })

  /**
   * 回归：`QODERCN` 不能被 `QODER` 前缀抢先匹配。
   *
   * 恢复表由单一真相源派生正则，若把 `QODER` 排在 `QODERCN` 之前，`QODERCN_*`
   * 会因回溯仍匹配成功而**暂时**看不出问题 —— 但这取决于正则引擎的尝试顺序，
   * 一旦将来加入更多同前缀 provider 就会变成静默错归属（账号挂到 `qoder` 面板，
   * 而其凭据是 CN 的，请求必然失败）。故按长度降序排列并在此锁死。
   */
  it('QODERCN 前缀不被 QODER 抢先匹配', () => {
    writeFileSync(
      join(dir, '.credentials.yaml'),
      ['refs:', '  QODERCN_ACCOUNT_ABCDEF: \'{}\'', '  QODER_ACCOUNT_123ABC: \'{}\''].join('\n'),
      'utf-8',
    )

    const recovered = createJetHubStore(makeCtx(undefined)).load()?.accounts ?? []
    expect(recovered.map(a => [a.credentialRef, a.provider, a.id])).toEqual([
      ['QODERCN_ACCOUNT_ABCDEF', 'qodercn', 'qodercn-abcdef'],
      ['QODER_ACCOUNT_123ABC', 'qoder', 'qoder-123abc'],
    ])
  })

  it('已有状态文档时不再从凭据恢复（尊重用户删号）', async () => {
    await createJetHubStore(makeCtx(undefined)).save({ accounts: [], disabledModels: {} })
    writeFileSync(
      join(dir, '.credentials.yaml'),
      ['refs:', '  BUDDY_ACCOUNT_ABC12345: {"access_token":"x"}'].join('\n'),
      'utf-8',
    )
    expect(createJetHubStore(makeCtx(undefined)).load()).toEqual({
      accounts: [],
      disabledModels: {},
      loomyPermanentLocked: false,
    })
  })
})

describe('归一化', () => {
  it('只把显式 true 当作关闭，并丢弃非法层级', () => {
    expect(sanitizeDisabledModels({
      buddy: { 'glm-5.2': true, 'hy3': false, 'x': 'yes' },
      broken: 'not-an-object',
      empty: {},
    })).toEqual({ buddy: { 'glm-5.2': true } })
  })

  it('丢弃缺 id/provider/credentialRef 的账号条目', () => {
    const raw = [
      { id: 'a', provider: 'buddy', credentialRef: 'BUDDY_ACCOUNT_A' },
      { id: 'b', provider: 'buddy' },
      { provider: 'buddy', credentialRef: 'BUDDY_ACCOUNT_C' },
      'nonsense',
    ]
    const accounts = sanitizeAccounts(raw)
    expect(accounts.map(a => a.id)).toEqual(['a'])
    // 缺省字段被补齐，避免下游判空分散在十几处。
    expect(accounts[0]!.enabled).toBe(true)
    expect(accounts[0]!.refreshable).toBe(true)
    expect(accounts[0]!.nickname).toBe('a')
  })

  it('文件文档里非对象内容按空处理', () => {
    writeFileSync(join(dir, 'raw.json'), '[]', 'utf-8')
    expect(sanitizeAccounts(JSON.parse(readFileSync(join(dir, 'raw.json'), 'utf-8')))).toEqual([])
  })
})
