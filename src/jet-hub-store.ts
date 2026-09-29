/**
 * Jet Hub 状态持久化（账号索引 + 模型黑名单）。
 *
 * ## 为什么不能再用 settings namespace
 *
 * DSH ≤0.1.6：`ctx.settings` 是 SettingsProvider，插件用
 * `settings.register(ns, schema)` 拿到 owner scope（`get()` / `replace()`），
 * 数据落在 `$DSH_HOME/settings.yaml` 的 `jet-hub:` 段。
 *
 * DSH 0.1.7-rc.1：`ctx.settings` 换成 **SettingsForms** —— **没有 `register`**。
 * 表单命名空间只能是 **profile 条目 id**，且只投影该条目 Config 中标了
 * `.volatile()` 的字段（见 `@deepseek-ai/dsh-settings` 的 `SettingsForms`）。
 * 于是早期写法 `settings.register(...)` 在 0.1.7 上恒走
 * `typeof settings.register !== 'function'` 分支，账号列表与模型黑名单
 * **退化为纯内存**（真实缺陷：Gitee issue IKI7WT ——「DSH 0.1.7 移除
 * `settings.register()` 后，账号列表与模型黑名单无法持久化」；启动日志实证
 * `[jet-hub] settings 服务不可用，账号列表仅存在于内存中`）。
 *
 * ## 现在的策略：按能力探测两条后端
 *
 * 1. `settings.register` 可用（老 DSH）→ **沿用旧契约**，行为与数据位置完全不变；
 * 2. 否则（0.1.7+）→ 插件自有 JSON 文档 `$DSH_HOME/jet-hub/state.json`，
 *    同步读 + 原子写（tmp + rename）。
 * 3. 两者都不可用（headless / 单测替身缺服务）→ 仅内存，并**显式告警**。
 *
 * ## 为什么不把状态塞进插件 Config
 *
 * 0.1.7 的 settings 表单确实能持久化「本条目 Config 的 volatile 字段」，但
 * 账号索引与**限流重置时间戳**是运行时状态：限流每命中一次就要写一次，
 * 而写 Config 会改写 profile 的 `cordis.patch.yml` 并触发 Loader 协调 ——
 * 把易变的运行时数据混进用户手写的配置层，代价与风险都不划算。
 * 这里与 `src/models.ts` 的 `~/.cache/deveco/*.json` 是同一思路（本插件既有的
 * 文件持久化惯例）。
 */

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type { ProviderAccountEntry } from './types.js'
import { hasLegacyNamespaceRegistration, readService, settingsOf } from './settings-compat.js'

/** Jet Hub schema namespace（老契约的 settings 命名空间名）。 */
export const JET_HUB_NS = 'jet-hub'

/**
 * 模型黑名单：provider id → **被关闭**的模型 id → true。
 *
 * **黑名单制**：只有键存在且为 `true` 的模型被隐藏，未记录的模型默认打开。
 */
export type ModelDisableMap = Record<string, Record<string, boolean>>

/** 各 provider 的「锁定永久积分」开关：provider id → 已锁定。 */
export type PermanentLockMap = Record<string, boolean>

/** 持久化文档结构（两种后端共用）。 */
export interface JetHubState {
  accounts: ProviderAccountEntry[]
  disabledModels: ModelDisableMap
  /**
   * Loomy「锁定永久积分」开关 —— **镜像字段，不是权威**。
   *
   * 权威值在 `$DSH_HOME/jet-hub/permanent-locks.json`（见
   * `src/permanent-lock-store.ts`）。本字段仍**继续同源写出**，理由有两条：
   *
   * 1. **同机多 profile**：`state.json` 是 dsh home 级共享文档，另一条工作区里
   *    的**旧版本代码**只认这一个字段（它读它、也原样写回它）。镜像保持一致，
   *    web / tui / headless 侧的 Loomy 锁定才不会与 desktop 侧脱节；
   * 2. **升级前的磁盘状态只有本字段**：新文档不存在时要靠它把老用户的锁定
   *    迁移进来（迁移判据见 `permanent-lock-store.ts` —— 只在**新文档不存在**时
   *    生效，避免把已解除的锁定重新打开）。
   *
   * ⚠️ 反过来，**新字段绝不能只住在这里**：本文档是整体替换语义，旧代码全量
   * 重写时不会携带它不认识的任何键 —— 把锁定表放这儿会被静默抹掉，而解锁的
   * 后果是真把永久积分烧掉（不可撤回）。这正是把表拆到独立文档的原因。
   */
  loomyPermanentLocked?: boolean
}

/** 持久化后端的能力标识，供调用方决定要不要告警。 */
export type JetHubStoreKind = 'settings' | 'file' | 'memory'

/** Jet Hub 状态存取接口（同步读、异步写）。 */
export interface JetHubStore {
  readonly kind: JetHubStoreKind
  /** 同步载入；文档不存在时返回 `undefined`（等价于"空"）。 */
  load(): JetHubState | undefined
  /** 整体写入（账号与黑名单必须同时携带，见 AccountPool 的说明）。 */
  save(state: JetHubState): Promise<void>
}

/** settings scope 的最小接口（只用到 get/replace）。 */
interface SettingsScopeLike {
  get(): unknown
  replace(section: object): Promise<void>
}

/** 老契约的 schema：必须是 schemastery（`plainSchema` 会调 `toJSON()`）。 */
const jetHubSchema = Schema.object({
  accounts: Schema.array(Schema.any()).default([]),
  disabledModels: Schema.dict(Schema.any()).default({}),
  loomyPermanentLocked: Schema.boolean().default(false),
})

/**
 * 归一化「锁定永久积分」开关表。
 *
 * 与 `sanitizeDisabledModels` 同款口径：**只保留显式 `true`**，其余值（`false` /
 * 字符串 / 对象）一律丢弃 —— 于是「缺键」与「值为 false」在语义上完全一致
 * （未锁定），文档也不会随开关操作累积噪音。
 * ⚠️ 单测专门覆盖「`{ loomy: 'yes' }` 不得判成已锁定」这一类脏数据。
 */
export function sanitizePermanentLocks(raw: unknown): PermanentLockMap {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const result: PermanentLockMap = {}
  for (const [provider, value] of Object.entries(raw as Record<string, unknown>)) {
    if (value === true && provider.length > 0) result[provider] = true
  }
  return result
}

/**
 * 把**老的单字段**并进锁定表 —— 仅用于「独立文档尚不存在」的那一次迁移。
 *
 * 背景：锁定开关早于 `permanent-locks.json` 存在，住在 state.json 的
 * `loomyPermanentLocked` 里，老用户磁盘上只有它。不并进来的话，升级后 Loomy 的
 * 锁定会**静默消失**（用户看到的是「永久积分被烧掉了」且毫无提示）——
 * 那是最坏的一类回归。
 *
 * ⚠️ 调用方**只能在新文档不存在时**用它（`PermanentLockStore.load()` 的
 * `exists: false`）。新文档一旦存在就以它为准：否则用户在 desktop 里解锁 Loomy
 * 之后（表里没有 `loomy` 键 = 未锁定），只要镜像字段因为任何原因还留着
 * `true`，锁定就会被重新打开 —— 那种"解不掉"的开关比丢状态更难排查。
 */
export function mergeLegacyLoomyLock(
  locks: PermanentLockMap,
  legacyLoomyLocked: unknown,
): PermanentLockMap {
  if (locks.loomy === undefined && legacyLoomyLocked === true) return { ...locks, loomy: true }
  return locks
}

/**
 * 把读到的原始值归一化为 {@link ModelDisableMap}。
 *
 * 文档可能被手工编辑过、或残留老版本格式（如数组），因此逐层校验：任何一层
 * 不是对象就丢弃那一层，只保留「provider → 模型 → true」。**只把显式 `true`
 * 视为关闭**，其余值一律忽略，避免与 `disabledModelsFor` 的判定产生分歧。
 */
export function sanitizeDisabledModels(raw: unknown): ModelDisableMap {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {}
  const result: ModelDisableMap = {}
  for (const [provider, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const perProvider: Record<string, boolean> = {}
    for (const [modelId, flag] of Object.entries(value as Record<string, unknown>)) {
      if (flag === true) perProvider[modelId] = true
    }
    // 空表不保留：不让文档里留下 `{ provider: {} }` 这类无意义噪音。
    if (Object.keys(perProvider).length > 0) result[provider] = perProvider
  }
  return result
}

/**
 * 归一化账号条目数组。
 *
 * 判据刻意保守：只保留同时具备 `id` / `provider` / `credentialRef` 三个非空
 * 字符串的条目 —— 缺任何一个都无法解析凭据，留着只会在选号时反复失败。
 * 其余字段按原样透传（`enabled` / `modelRateLimits` 等由下游各自判空）。
 */
export function sanitizeAccounts(raw: unknown): ProviderAccountEntry[] {
  if (!Array.isArray(raw)) return []
  const accounts: ProviderAccountEntry[] = []
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) continue
    const candidate = entry as Partial<ProviderAccountEntry>
    if (typeof candidate.id !== 'string' || candidate.id.length === 0) continue
    if (typeof candidate.provider !== 'string' || candidate.provider.length === 0) continue
    if (typeof candidate.credentialRef !== 'string' || candidate.credentialRef.length === 0) continue
    accounts.push({
      ...candidate,
      enabled: candidate.enabled !== false,
      refreshable: candidate.refreshable !== false,
      nickname: typeof candidate.nickname === 'string' ? candidate.nickname : candidate.id,
      createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now(),
    } as ProviderAccountEntry)
  }
  return accounts
}

/** 老契约后端：数据仍在 settings 文档里（与 ≤0.1.6 完全一致）。 */
class SettingsStore implements JetHubStore {
  readonly kind = 'settings' as const

  constructor(private readonly scope: SettingsScopeLike) {}

  load(): JetHubState | undefined {
    const value = this.scope.get() as
      | {
        accounts?: unknown
        disabledModels?: unknown
        loomyPermanentLocked?: unknown
      }
      | undefined
    if (value === undefined || value === null) return undefined
    return {
      accounts: sanitizeAccounts(value.accounts),
      disabledModels: sanitizeDisabledModels(value.disabledModels),
      // 只是**镜像**（权威表在 permanent-locks.json）；老文档没这个键 → false。
      loomyPermanentLocked: value.loomyPermanentLocked === true,
    }
  }

  async save(state: JetHubState): Promise<void> {
    await this.scope.replace({
      accounts: state.accounts,
      disabledModels: state.disabledModels,
      // 镜像字段由 AccountPool 与独立文档**同源写出**：同机上只认这个字段的
      // 旧版本代码（其它 profile）读它、也会原样写回它，故两边不会脱节。
      loomyPermanentLocked: state.loomyPermanentLocked === true,
    })
  }
}

/** 仅内存后端：两个持久化后端都不可用时的显式降级。 */
class MemoryStore implements JetHubStore {
  readonly kind = 'memory' as const
  private state: JetHubState | undefined

  load(): JetHubState | undefined {
    return this.state
  }

  async save(state: JetHubState): Promise<void> {
    this.state = state
  }
}

/**
 * provider id ↔ 凭据 ref 前缀的**单一真相源**。
 *
 * 账号凭据一律存 `{PREFIX}_ACCOUNT_{UUID_SHORT}`（本插件的既有约定），故可据
 * ref 名反推 provider；表与正则都由本表派生，避免「加了 provider 却漏改正则」
 * 这类两处漂移。
 *
 * ⚠️ **必须与 `jet-hub-rpc.ts` 的 `account.create` 生成的 ref 前缀保持一致**
 * （那里是 `${provider.toUpperCase()}_ACCOUNT_${suffix}`）。**新增 provider 时
 * 漏加本表会让该 provider 的账号在状态文档丢失后静默消失** —— 真实缺陷：
 * 本表原只有 6 项（注释也写着"六个 provider"），而插件实际有 10 个，
 * `qodercn` / `cline` / `loomy` / `raccoon` 四个 provider 的账号在
 * `state.json` 缺失时**无法从 `.credentials.yaml` 恢复**，用户侧表现为
 * 「重装 / 迁移后这几个面板的账号凭空消失，只能重新登录」。
 *
 * ⚠️ **同一缺陷在 `zcode` 上又犯过一次**（上游新增第 11 个 provider 时）：
 * zcode 账号同样由 `account.create` 生成 `ZCODE_ACCOUNT_{HEX}`
 * （`src/index.ts` 的 zcode 段落亦如此说明），漏登记则重装 / 迁移后
 * zcode 账号静默消失。**新增 provider 时必须同步本表** ——
 * 且注意单凭据回退 ref（如 `ZCODE_CREDENTIAL`）不含 `_ACCOUNT_`，
 * 不会被本表误吞，故本表只需登记账号 ref 前缀。
 *
 * 依据 `src/product.ts` 与各 `*-product.ts` 的 `id` 字段：
 * `codearts` / `buddy` / `workbuddy` / `lobsterai` / `qoder` / `qodercn`
 * / `trae` / `cline` / `loomy` / `raccoon` / `zcode`。
 */
const REF_PREFIX_TO_PROVIDER: ReadonlyArray<readonly [string, string]> = [
  ['CODEARTS', 'codearts'],
  ['BUDDY', 'buddy'],
  ['WORKBUDDY', 'workbuddy'],
  ['LOBSTERAI', 'lobsterai'],
  ['QODER', 'qoder'],
  ['QODERCN', 'qodercn'],
  ['TRAE', 'trae'],
  ['CLINE', 'cline'],
  ['LOOMY', 'loomy'],
  ['RACCOON', 'raccoon'],
  ['ZCODE', 'zcode'],
]

/** 账号凭据 ref 形态：`{PREFIX}_ACCOUNT_{HEX}`（前缀由单一真相源派生）。 */
const ACCOUNT_REF_RE = new RegExp(
  // ⚠️ 按长度**降序**排列：`QODERCN` 必须以 `QODER` 之前尝试，否则正则的
  // 回溯虽然最终仍能匹配成功，但一旦将来加入更多同前缀的 provider（如
  // `QODERX`），顺序错误会让匹配结果取决于运气而非规则。
  `^(${REF_PREFIX_TO_PROVIDER
    .map(([prefix]) => prefix)
    .sort((a, b) => b.length - a.length)
    .join('|')})_ACCOUNT_([0-9A-Fa-f]{6,})$`,
)

/**
 * 从 `.credentials.yaml` 的 `refs:` 段提取 ref 名（**只取键名，不读值**）。
 *
 * 判据用「缩进 ≥2 且以大写标识符开头」，并在回到顶格键时结束 —— 凭据文件是
 * 本插件**只能读不能依赖**的外部文档，故这里只做最小、保守的文本扫描，
 * 不引入 YAML 依赖（运行时不保证可解析，实证：`yaml`/`js-yaml` 从本包
 * 均不可解析）。
 */
function extractCredentialRefNames(text: string): string[] {
  const names: string[] = []
  let inRefs = false
  for (const line of text.split(/\r?\n/)) {
    if (/^refs:\s*$/.test(line)) {
      inRefs = true
      continue
    }
    if (!inRefs) continue
    if (/^\S/.test(line)) break
    const match = /^\s{2,}([A-Z][A-Z0-9_]*):/.exec(line)
    if (match?.[1] !== undefined) names.push(match[1])
  }
  return names
}

/** 由一个账号凭据 ref 合成账号条目（昵称缺失时退回账号 id）。 */
function accountFromCredentialRef(ref: string): ProviderAccountEntry | undefined {
  const match = ACCOUNT_REF_RE.exec(ref)
  if (match === null) return undefined
  const prefix = match[1]
  const suffix = match[2]
  if (prefix === undefined || suffix === undefined) return undefined
  const provider = REF_PREFIX_TO_PROVIDER.find(([candidate]) => candidate === prefix)?.[1]
  if (provider === undefined) return undefined
  const id = `${provider}-${suffix.toLowerCase()}`
  return {
    id,
    provider,
    nickname: id,
    enabled: true,
    credentialRef: ref,
    createdAt: Date.now(),
    refreshable: true,
  }
}

/** 文件后端：`$DSH_HOME/jet-hub/state.json`（原子写）。 */
class FileStore implements JetHubStore {
  readonly kind = 'file' as const

  constructor(
    /** DSH home（状态目录与旧凭据文件都相对它定位）。 */
    private readonly home: string,
    /** 状态文档绝对路径。 */
    private readonly path: string,
    private readonly logger: { warn(message: string): void; info(message: string): void } | undefined,
  ) {}

  load(): JetHubState | undefined {
    try {
      if (!existsSync(this.path)) return this.bootstrapFromCredentialRefs()
      const parsed = JSON.parse(readFileSync(this.path, 'utf-8')) as unknown
      if (typeof parsed !== 'object' || parsed === null) return undefined
      const value = parsed as {
        accounts?: unknown
        disabledModels?: unknown
        loomyPermanentLocked?: unknown
      }
      return {
        accounts: sanitizeAccounts(value.accounts),
        disabledModels: sanitizeDisabledModels(value.disabledModels),
        // 只是镜像（权威表在 permanent-locks.json）；老文档没这个键 → false。
        loomyPermanentLocked: value.loomyPermanentLocked === true,
      }
    } catch (error) {
      this.logger?.warn(`[jet-hub] 读取 ${this.path} 失败，本次以空列表启动: ${String(error)}`)
      return undefined
    }
  }

  async save(state: JetHubState): Promise<void> {
    this.write(state)
  }

  private write(state: JetHubState): void {
    mkdirSync(join(this.home, 'jet-hub'), { recursive: true })
    const tmp = `${this.path}.tmp`
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
    renameSync(tmp, this.path)
  }

  /**
   * 首次启动的数据恢复（**仅在状态文档不存在时**执行一次）。
   *
   * 背景：0.1.7 启动时 `SettingsForms.importLegacyDocument()` 把
   * `$DSH_HOME/settings.yaml` 改名为 `settings.yaml.imported`，并按「section id
   * = profile 条目 id」逐段导入 —— `jet-hub` 不对应任何条目，该段导入失败、
   * 只留在改名后的文件里。于是老用户的账号索引成了孤儿（凭据本体仍在
   * `.credentials.yaml` 中，完好无损）。
   *
   * 这里据凭据 ref 名重建索引：能恢复「有哪些账号、属于哪个 provider、用哪个
   * credentialRef」，**恢复不了**昵称/顺序/限流时间戳（那三项只在旧 settings
   * 文档里，而本项目没有 YAML 解析依赖）。重建结果立即落盘，故只做一次。
   */
  private bootstrapFromCredentialRefs(): JetHubState | undefined {
    const credentialsPath = join(this.home, '.credentials.yaml')
    try {
      if (!existsSync(credentialsPath)) return undefined
      const accounts = extractCredentialRefNames(readFileSync(credentialsPath, 'utf-8'))
        .flatMap(ref => accountFromCredentialRef(ref) ?? [])
      if (accounts.length === 0) return undefined
      const state: JetHubState = {
        accounts,
        disabledModels: {},
        // 凭据文件里没有任何锁定信息 → 镜像写 false（权威表另有其文档）。
        loomyPermanentLocked: false,
      }
      try {
        this.write(state)
      } catch (error) {
        this.logger?.warn(`[jet-hub] 恢复出的账号未能落盘（仅本次有效）: ${String(error)}`)
      }
      this.logger?.info(
        `[jet-hub] 已从 .credentials.yaml 恢复 ${accounts.length} 个账号`
        + '（昵称/顺序/限流标记无法恢复；旧数据仍在 settings.yaml.imported 的 jet-hub 段）',
      )
      return state
    } catch (error) {
      this.logger?.warn(`[jet-hub] 账号恢复失败（忽略）: ${String(error)}`)
      return undefined
    }
  }
}

/**
 * 解析状态文档所在目录。
 *
 * 优先级：`DSH_JET_HUB_STATE_DIR`（单测隔离用）→ `profileContext.home`
 * → `$DSH_HOME` → `~/.dsh`。与 `dsh-home-paths` 的 `resolveDshHome` 同序。
 */
export function resolveJetHubHome(ctx: Context): string | undefined {
  const override = process.env.DSH_JET_HUB_STATE_DIR
  if (override !== undefined && override.trim().length > 0) return override.trim()
  const profileHome = (readService(ctx, 'profileContext') as { home?: unknown } | undefined)?.home
  if (typeof profileHome === 'string' && profileHome.length > 0) return profileHome
  const envHome = process.env.DSH_HOME
  if (envHome !== undefined && envHome.trim().length > 0) return envHome.trim()
  return join(homedir(), '.dsh')
}

/**
 * 按能力探测创建持久化后端（见文件头）。
 *
 * 顺序刻意是「老契约优先」：在 ≤0.1.6 上必须继续把数据写在 settings 文档里，
 * 否则升级/回退版本会看到两套互不相识的数据。
 */
export function createJetHubStore(ctx: Context): JetHubStore {
  const settings = settingsOf(ctx)
  if (hasLegacyNamespaceRegistration(settings) && settings !== undefined) {
    try {
      const scope = (settings.register as NonNullable<typeof settings.register>)(JET_HUB_NS, jetHubSchema)
      return new SettingsStore(scope as SettingsScopeLike)
    } catch (error) {
      // 重复注册（插件热重载）等：退回文件后端，而不是降级为内存。
      ctx.logger?.warn?.(`[jet-hub] settings namespace 注册失败，改用本地状态文档: ${String(error)}`)
    }
  }
  const home = resolveJetHubHome(ctx)
  if (home === undefined) {
    ctx.logger?.warn?.('[jet-hub] 无法定位 DSH home，账号列表与模型黑名单仅存在于内存中')
    return new MemoryStore()
  }
  return new FileStore(home, join(home, 'jet-hub', 'state.json'), ctx.logger)
}
