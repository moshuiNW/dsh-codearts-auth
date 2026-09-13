import type { Context } from '@deepseek-ai/cordis'
import type { CommandResult } from '@deepseek-ai/dsh-commands'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import Schema from '@deepseek-ai/schemastery'
import { registerCodeArtsLlm } from './llm-adapter.js'
import { registerBuddyLlm } from './buddy-adapter.js'
import { CODEARTS_CREDENTIAL_REF, CodeArtsAuth } from './service.js'
import { BUDDY_CREDENTIAL_REF, BuddyAuth } from './buddy-auth.js'
import { buddySiteProfile, normalizeBuddyEdition } from './buddy.js'
import { AccountPool } from './account-pool.js'
import { registerJetHubRpc } from './jet-hub-rpc.js'
import type { CodeArtsCredential, BuddyCredential } from './types.js'

export const name = 'codearts-auth'
export const inject = ['credentials', 'commands', 'llm', 'connection']

/**
 * Provider 配置 namespace 的 schema。
 *
 * `registerConfigurableProviders` 声明的 `settingsNs` 必须真实存在于
 * settings 服务中，否则模型设置页读到 undefined 的 namespace，
 * 在 `refFor → deriveKeyRef(provider)` 处会以
 * `provider.toUpperCase is not a function` 崩溃。
 * 两者都只需承接一个可选的 `providers` 映射，故共用同一宽松 schema。
 *
 * 注意：`settings.register()` 要求 schemastery schema —— `describe()` 会对每个
 * 注册项无条件调用 `schema.toJSON()` 与 `redactSecrets(schema, value)`。
 * 传入裸函数（`(value) => ...`）会让 `describe()` 抛
 * `TypeError: registration.schema.toJSON is not a function`，进而使所有
 * 依赖 settings 的界面（模型设置页、主题、sidebar 的 settings.get/shell.get）
 * 全部失败。因此这里必须用 `Schema.object({...})` 构造。
 */
const providerSettingsSchema = Schema.object({
  providers: Schema.dict(Schema.any()).default({}),
})

/** 注册 provider 配置 namespace（已存在时忽略重复注册错误）。 */
function registerProviderSettings(ctx: Context, ...namespaces: string[]): void {
  const settings = ctx.get('settings') as
    | {
      register: (ns: string, schema: unknown) => unknown
      describe?: (options?: { redactSecrets?: boolean }) => Array<{ ns: string }>
    }
    | undefined
  if (!settings || typeof settings.register !== 'function') {
    ctx.logger.warn('[codearts-auth] settings 服务不可用，provider namespace 未注册')
    return
  }
  for (const ns of namespaces) {
    try {
      settings.register(ns, providerSettingsSchema)
    } catch (error) {
      ctx.logger.warn(`[codearts-auth] settings namespace "${ns}" 注册失败: ${String(error)}`)
    }
  }
  // 回读确认：模型设置页要求 settingsNs 真实存在于 describe() 中。
  // 注意：describe() 会遍历所有已注册 namespace 并调用各自 schema 的
  // toJSON()/redactSecrets()，任一注册项的 schema 不合规都会让整条调用抛错。
  // 因此这里必须把异常打出来，而不是静默吞掉。
  try {
    const descriptors = settings.describe?.({ redactSecrets: true }) ?? []
    const registered = descriptors.map(v => v.ns)
    const missing = namespaces.filter(ns => !registered.includes(ns))
    if (missing.length > 0) {
      ctx.logger.warn(`[codearts-auth] provider namespace 未生效: ${missing.join(', ')}`)
    }
    ctx.logger.info(`[codearts-auth] settings.describe ok, namespaces: ${registered.join(', ')}`)
  } catch (error) {
    ctx.logger.error(
      `[codearts-auth] settings.describe 失败（将导致模型设置页/sidebar settings API 不可用）: `
      + `${error instanceof Error ? error.stack ?? error.message : String(error)}`,
    )
  }
}

/** 注册 codeartsAuth 服务、命令以及 codearts LLM 路由。 */
export function apply(ctx: Context): void {
  // provider 的 settingsNs 必须已注册，否则模型设置页会因未注册 namespace 崩溃。
  registerProviderSettings(ctx, 'llm-buddy', 'llm-codearts')
  const service = new CodeArtsAuth(ctx)
  const pool = new AccountPool(ctx)
  ctx.commands.register({
    name: 'codearts-login',
    description: '通过浏览器 OAuth 登录华为云 CodeArts',
    handler: async (): Promise<CommandResult> => {
      try {
        const result = await service.login()
        return {
          kind: 'success',
          text: `CodeArts 登录完成。凭据已存储于 ${String(result.ref)}；过期时间 ${new Date(result.expires).toISOString()}。`,
        }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
  ctx.commands.register({
    name: 'codearts-status',
    description: '显示 CodeArts 登录状态及刷新能力',
    handler: async (): Promise<CommandResult> => {
      const status = await service.status()
      return {
        kind: 'success',
        text: [
          `已配置: ${status.configured}`,
          ...status.source === undefined ? [] : [`来源: ${status.source}`],
          ...status.expiresAt === undefined ? [] : [`过期时间: ${new Date(status.expiresAt).toISOString()}`],
          `可刷新: ${status.refreshable}`,
          ...status.refreshError === undefined ? [] : [`刷新错误: ${status.refreshError}`],
        ].join('\n'),
      }
    },
  })
  ctx.commands.register({
    name: 'codearts-refresh',
    description: '静默刷新 CodeArts 凭据',
    handler: async (): Promise<CommandResult> => {
      try {
        await service.refresh()
        const status = await service.status()
        return {
          kind: 'success',
          text: `CodeArts 凭据已刷新；过期时间 ${status.expiresAt === undefined ? '未知' : new Date(status.expiresAt).toISOString()}。`,
        }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
  // ===== 【已停用】CodeArts (华为云) LLM provider 注册 =====
  //
  // 停用原因：暂未配置华为云 CodeArts 账户，模型选择器中该 provider 无法使用。
  // 停用范围：**仅** 不向模型选择器暴露 `codearts` provider。
  //   - CodeArtsAuth 服务、/codearts-* 命令、AccountPool、JetHub RPC 全部保留；
  //   - `codearts` 账号池仍可用，buddy 适配器依赖的 pool 不受影响。
  //
  // 恢复方式：取消下面整段注释即可（无需其他改动），然后 `pnpm build` + 刷新页面。
  //
  // registerCodeArtsLlm(ctx, {
  //   credentialRef: credentialRef(CODEARTS_CREDENTIAL_REF),
  //   resolveCredential: async () => {
  //     // 优先使用账号池获取可用账号，回退到单凭据解析
  //     if (pool) {
  //       const available = await pool.getAvailableAccount('codearts', '')
  //       if (available) return available.credential as CodeArtsCredential
  //     }
  //     const resolved = await ctx.credentials.resolve(credentialRef(CODEARTS_CREDENTIAL_REF))
  //     if (!resolved) return undefined
  //     try {
  //       return JSON.parse(resolved.value) as CodeArtsCredential
  //     } catch {
  //       return undefined
  //     }
  //   },
  //   refresh: () => service.refresh(),
  //   fetchRemoteModels: () => service.refreshModels(),
  //   accountPool: pool,
  // })
  // 引用保留仅为类型/导入完整性：恢复上面注释块时删掉本行即可。
  void registerCodeArtsLlm

  // ===== Buddy (腾讯 CodeBuddy) 服务 =====
  const buddy = new BuddyAuth(ctx)
  ctx.commands.register({
    name: 'buddy-login',
    description: '通过浏览器登录腾讯 CodeBuddy（附加 intl 参数则登录国际站 workbuddy.ai）',
    handler: async (command): Promise<CommandResult> => {
      // 站点选择：`/buddy-login intl` 登录国际站；默认国内站。
      const edition = normalizeBuddyEdition(command?.rawInput)
      const site = buddySiteProfile(edition)
      try {
        const result = await buddy.login({ edition })
        return {
          kind: 'success',
          text: `CodeBuddy（${site.label}）登录完成。凭据已存储于 ${String(result.ref)}；`
            + `${result.expires > 0 ? `过期时间 ${new Date(result.expires).toISOString()}` : '过期时间未知'}。`,
        }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
  ctx.commands.register({
    name: 'buddy-status',
    description: '显示 CodeBuddy 登录状态及刷新能力',
    handler: async (): Promise<CommandResult> => {
      const status = await buddy.status()
      return {
        kind: 'success',
        text: [
          `已配置: ${status.configured}`,
          ...status.edition === undefined ? [] : [`站点: ${buddySiteProfile(status.edition).label}`],
          ...status.source === undefined ? [] : [`来源: ${status.source}`],
          ...status.expiresAt === undefined ? [] : [`过期时间: ${new Date(status.expiresAt).toISOString()}`],
          `可刷新: ${status.refreshable}`,
          ...status.refreshError === undefined ? [] : [`刷新错误: ${status.refreshError}`],
        ].join('\n'),
      }
    },
  })
  ctx.commands.register({
    name: 'buddy-refresh',
    description: '静默刷新 CodeBuddy 凭据',
    handler: async (): Promise<CommandResult> => {
      try {
        await buddy.refresh()
        const status = await buddy.status()
        return {
          kind: 'success',
          text: `CodeBuddy 凭据已刷新；过期时间 ${status.expiresAt === undefined ? '未知' : new Date(status.expiresAt).toISOString()}。`,
        }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })
  registerBuddyLlm(ctx, {
    credentialRef: credentialRef(BUDDY_CREDENTIAL_REF),
    resolveCredential: async (model?: string) => {
      // 优先使用账号池获取可用账号，回退到单凭据解析。
      // 必须把 model 透传下去：账号池据此跳过**该模型已限流**的账号，
      // 否则每个请求都会先选中已限流账号、白吃一次 429 再切换。
      if (pool) {
        const available = await pool.getAvailableAccount('buddy', model ?? '')
        if (available) return available.credential as BuddyCredential
      }
      const resolved = await ctx.credentials.resolve(credentialRef(BUDDY_CREDENTIAL_REF))
      if (!resolved) return undefined
      try {
        return JSON.parse(resolved.value) as BuddyCredential
      } catch {
        return undefined
      }
    },
    // 续期：优先刷新**当前凭据所属的那个池内账号**（纯账号池部署下
    // BUDDY_ACCESS_TOKEN 并不存在），失败再回退到单凭据刷新。
    refresh: () => buddy.refresh(pool),
    fetchRemoteModels: () => buddy.fetchModels(pool),
    // 图片附件：桥接 ctx.attachments，把持久化图片读成原始字节供适配器内联。
    // 用 ctx.get 而非 inject —— 附件服务缺失时 provider 仍可正常加载，
    // 只是收到图片时报 UNSUPPORTED_CONTENT。
    readImage: async (attachment) => {
      const attachments = ctx.get('attachments') as
        { readImage?: (ref: never) => Promise<{ data: Uint8Array; ref: { mediaType: string } }> } | undefined
      if (attachments?.readImage === undefined) return undefined
      try {
        const stored = await attachments.readImage(attachment as never)
        return { data: stored.data, mediaType: stored.ref.mediaType }
      } catch {
        return undefined
      }
    },
    accountPool: pool,
  })

  // ===== 多账号静默续期调度 =====
  // 替代原有的单账号 scheduleRefresh()，使用 refreshAll() 遍历所有账号续期
  const REFRESH_INTERVAL_MS = 30 * 60 * 1000  // 每 30 分钟检查一次

  async function refreshAllCredentials(): Promise<void> {
    try {
      await service.refreshAll(pool)
    } catch { /* 静默 */ }
    try {
      await buddy.refreshAll(pool)
    } catch { /* 静默 */ }
  }

  // 启动时如果有任何可续期账号，安排定期续期
  pool.listAllAccounts().then(accounts => {
    const hasRefreshable = accounts.some(a => a.refreshable && a.enabled)
    if (hasRefreshable) {
      const refreshTimer = setInterval(() => void refreshAllCredentials(), REFRESH_INTERVAL_MS)
      refreshTimer.unref?.()
      ctx.effect(() => () => {
        clearInterval(refreshTimer)
        service.stop()
        buddy.stop()
      }, 'jet-hub: multi-account refresh scheduler')
    }
  })

  // 保留旧的 stop scheduler（兼容旧命令）
  ctx.effect(() => () => {
    service.stop()
    buddy.stop()
  }, 'codearts-auth.scheduler (legacy)')

  // ===== Jet Hub RPC 注册 =====
  registerJetHubRpc(ctx, pool, service, buddy)
  ctx.provide('accountPool', pool)
}
