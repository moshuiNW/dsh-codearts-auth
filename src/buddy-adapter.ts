/**
 * buddy (腾讯 CodeBuddy) LlmAdapter
 *
 * 使用标准 OpenAI Chat Completions 协议 + Bearer access_token 鉴权。
 * 认证由 buddy-auth.ts 服务完成（external-link-v2 轮询式登录 + refresh_token 续期）。
 *
 * 端点：https://copilot.tencent.com/v2/chat/completions
 * 模型列表：静态默认（对齐 /v3/config craft agent models）+ 登录后的动态拉取
 */

import type { Context } from '@deepseek-ai/cordis'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import {
  attributionHeaders,
  LlmAdapter, LlmError,
  ReasoningEffortId,
} from '@deepseek-ai/dsh-llm'
import { AccountPool } from './account-pool.js'
import { isRateLimited, parseRateLimitError } from './llm-adapter.js'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, LlmModelInfo, LlmProviderInfo, LlmResolvedModelInfo, StreamChunk } from '@deepseek-ai/dsh-llm'
import {
  BUDDY_DEPLOYMENT_TYPE,
  BUDDY_PRODUCT_CODE,
  BUDDY_USER_AGENT,
  buddySiteProfile,
  domainOrDefault,
  HTTP_HEADER_DOMAIN,
  HTTP_HEADER_PRODUCT,
  HTTP_HEADER_PRODUCT_CODE,
  credentialExpiresAtMs,
} from './buddy.js'
import type { BuddyCredential, BuddyRemoteModel } from './buddy.js'
import { isTruncatedArguments, normalizeToolArguments, readWithIdleTimeout, resolveToolPairing } from './sse.js'

/**
 * 国内站 chat API 基础地址（**仅作兼容保留**）。
 *
 * 实际请求地址按凭据的 `edition` 动态解析：国内站为该值，国际站为
 * `https://www.workbuddy.ai/v2`（见 buddy.ts 的 {@link buddySiteProfile}）。
 * 请勿用它拼接请求 URL——那会把国际站账号误发到国内站上游。
 */
export const CHAT_API_BASE = 'https://copilot.tencent.com/v2'
export const PROVIDER = 'buddy'

/** 静态默认模型（对齐 /v3/config 返回的 craft agent models；动态拉取失败时的兜底）。 */
const DEFAULT_MODELS: readonly string[] = [
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'hy4-preview',
  'hy4-preview-x',
  'hy3',
  'hy3-x',
  'glm-5.3',
  'glm-5.3-flash',
  'glm-5.2',
  'glm-5.1',
  'glm-5v-turbo',
  'kimi-k3-1',
  'kimi-k2.7',
  'kimi-k2.6',
  'minimax-m3',
]

/** 默认模型（deepseek-v4-flash，对齐 IDE 默认）。 */
export const DEFAULT_MODEL = 'deepseek-v4-flash'

/**
 * 模型上下文窗口（对齐 Rust BuddyProvider::context_limit 的静态 fallback 表；
 * 权威来源是 /v3/config data.models[].maxInputTokens，由 fetchRemoteModels
 * 动态拉取后经 resolveRemoteContextWindow 优先采用，此表仅作远端不可用时的兜底）。
 */
const CONTEXT_WINDOWS: ReadonlyMap<string, number> = new Map([
  ['deepseek-v4-flash', 1_000_000],
  ['deepseek-v4-pro', 1_000_000],
  ['hy4-preview', 1_000_000],
  ['hy4-preview-x', 1_000_000],
  ['hy3', 192_000],
  ['hy3-x', 192_000],
  ['glm-5.3', 1_000_000],
  ['glm-5.3-flash', 1_000_000],
  ['glm-5.2', 1_000_000],
  ['glm-5.1', 200_000],
  ['glm-5v-turbo', 200_000],
  ['kimi-k3-1', 1_000_000],
  ['kimi-k2.7', 256_000],
  ['kimi-k2.6', 256_000],
  ['minimax-m3', 512_000],
])

/**
 * 模型是否接受图片输入（远端 /v3/config `supportsImages` 不可用时的兜底）。
 *
 * 权威来源是远端下发的 `supportsImages`；此表只在远端未下发该字段时使用。
 * 实测（2026-09 /v3/config）craft agent 的对话模型全部 supportsImages=true，
 * 故这里列出全部对话模型，非对话模型（codewise-* 等）不在此表内。
 */
const IMAGE_MODELS: ReadonlySet<string> = new Set([
  'deepseek-v4-flash',
  'deepseek-v4.1-flash',
  'deepseek-v4-pro',
  'hy4-preview',
  'hy4-preview-x',
  'hy3',
  'hy3-x',
  'glm-5.3',
  'glm-5.3-flash',
  'glm-5.2',
  'glm-5.1',
  'glm-5v-turbo',
  'kimi-k3-1',
  'kimi-k2.7',
  'kimi-k2.6',
  'minimax-m3',
])

/**
 * 各模型可选的思考等级（远端 `reasoning.supportedEfforts` 不可用时的兜底）。
 *
 * 只列出**可枚举**等级的模型；仅有固定默认 effort 的模型（glm-5.1/kimi-*）
 * 不在此表内，即不向用户暴露等级选择器。
 */
const REASONING_EFFORTS: ReadonlyMap<string, readonly string[]> = new Map([
  ['deepseek-v4-flash', ['low', 'high', 'max']],
  ['deepseek-v4.1-flash', ['low', 'high', 'max']],
  ['deepseek-v4-pro', ['low', 'high', 'xhigh']],
  ['hy4-preview', ['high']],
  ['hy4-preview-x', ['high']],
  ['hy3', ['low', 'high']],
  ['hy3-x', ['low', 'high']],
  ['glm-5.3', ['low', 'high', 'max']],
  ['glm-5.3-flash', ['low', 'high', 'max']],
  ['glm-5.2', ['high', 'xhigh']],
])

/** 思考等级 id → 展示名（对齐 DeepSeek 官方 provider 的命名）。 */
const EFFORT_NAMES: Readonly<Record<string, string>> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'XHigh',
  max: 'Max',
}

export interface BuddyAdapterOptions {
  credentialRef: CredentialRef
  /** 前缀缓存会话标识（prompt_cache_key）；未提供时随机生成一个。 */
  sessionId?: string
  /**
   * 从凭据存储解析凭据。
   *
   * `model` 为本次请求的模型 id：多账号池据此**跳过该模型已限流的账号**。
   * 不传模型时无法做限流过滤（历史行为），仅用于无模型上下文的场景。
   */
  resolveCredential: (model?: string) => Promise<BuddyCredential | undefined>
  /** 静默续期凭据。 */
  refresh: () => Promise<void>
  /** 动态拉取远端模型列表（含上下文窗口与能力，若远端下发）；失败时调用方回退到静态列表。 */
  fetchRemoteModels?: () => Promise<BuddyRemoteModel[]>
  /**
   * 读取一张图片的原始字节（图片输入必需）。
   *
   * 由调用方桥接 `ctx.attachments.readImage(ref)`；未提供时收到图片会报
   * UNSUPPORTED_CONTENT，而不是把图片静默丢掉。
   */
  readImage?: (attachment: unknown) => Promise<{ data: Uint8Array; mediaType: string } | undefined>
  fetchImpl?: typeof fetch
  /** 多账号池（用于限流时切换账号） */
  accountPool?: AccountPool
}

/** 将消息内容载荷展平为纯文本字符串。 */
function contentToText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { type: string; text: unknown } =>
      typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text')
    .map((block) => String(block.text))
    .join('')
}

/**
 * 将 harness 对话消息序列化为 CodeBuddy chat-completions 的传输格式。
 *
 * 与 openai_chat/codearts 适配器一致：assistant 的 `tool-call` 块转为
 * `tool_calls`，`reasoning` 块折叠为 `reasoning_content`，user 消息中搭载的
 * 工具结果展开为独立的 `{role: 'tool'}` 消息。
 *
 * 两点 CodeBuddy 特有要求（对齐 Rust buddy.rs）：
 * - assistant 消息**始终**携带 `reasoning_content` 字段（推理模型缺失会 400）
 *   ——与 codearts 的 deepseek-v4 校验一致；
 * - 正文为空且带 tool_calls 时 `content` 必须为 `null`（对齐 openai_chat.rs）。
 */
function serializeMessages(
  messages: readonly { role: string; content: unknown }[],
  imageUrls?: ReadonlyMap<string, string>,
): Array<Record<string, unknown>> {
  const wire: Array<Record<string, unknown>> = []

  // ── 孤儿工具调用清理（会话续命的关键）──
  // OpenAI 兼容协议要求：带 `tool_calls` 的 assistant 消息，其**每一个**
  // tool_call id 都必须紧跟一条对应的 `role:'tool'` 结果消息；反之，
  // `role:'tool'` 消息也必须有对应的前置 tool_call。缺任一侧，后端都会以
  // 400 拒绝整个请求。
  //
  // 工具执行失败时（参数非法、超时、工具不存在……）harness 会把 assistant
  // 的 tool_calls 持久化进会话历史，却写不回结果消息。这条坏历史随后被
  // **每次请求原样重放**，于是后端对之后每一条用户消息都返回 400——表现为
  // "任务突然中断，此后发送任何内容都没有回复"，整个会话彻底报废。
  //
  // 适配器是最后一道防线：发出请求前把无法配对的 tool_calls 与 tool 结果
  // 一并剔除，让会话自愈。宁可丢失一轮工具上下文，也好过整条会话死亡。
  const { keepCallIds, keepResultIds } = resolveToolPairing(messages)

  for (const message of messages) {
    if (message.role === 'assistant') {
      const content = Array.isArray(message.content) ? message.content : []
      const toolCallBlocks = content
        .filter((block): block is { type: string; id: unknown; name: unknown; arguments: unknown } =>
          typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'tool-call')
        .filter(block => keepCallIds.has(String(block.id)))
      const toolCalls = toolCallBlocks.map((block) => ({
        id: String(block.id),
        type: 'function' as const,
        function: { name: String(block.name), arguments: normalizeToolArguments(String(block.arguments)) },
      }))
      const reasoning = content
        .filter((block): block is { type: string; text: unknown } =>
          typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'reasoning')
        .map((block) => String(block.text))
        .join('')
      const text = contentToText(content)
      wire.push({
        role: 'assistant',
        // 正文为空且有工具调用时 content 必须为 null（对齐 openai_chat.rs）。
        content: text.length === 0 && toolCalls.length > 0 ? null : text,
        reasoning_content: reasoning,
        ...toolCalls.length > 0 ? { tool_calls: toolCalls } : {},
      })
      continue
    }
    if (message.role === 'system') {
      wire.push({ role: 'system', content: contentToText(message.content) })
      continue
    }
    // user 角色：工具结果搭载在 harness 用户消息中；展开为独立的 role:'tool' 消息。
    const content = Array.isArray(message.content) ? message.content : []
    const toolResults = content.filter((block): block is { type: string; toolCallId: unknown; content: unknown } =>
      typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'tool-result')
    const text = contentToText(message.content)
    // 含图片时 content 升级为 OpenAI 多模态 parts（CodeBuddy 唯一接受的图片
    // 形态；{type:'image'} 会以 `unsupported content type ... image` 400）。
    const parts = imageUrls === undefined || imageUrls.size === 0
      ? undefined
      : userContentParts(content, imageUrls)
    if (parts !== undefined) wire.push({ role: 'user', content: parts })
    else if (text.length > 0 || toolResults.length === 0) wire.push({ role: 'user', content: text })
    for (const result of toolResults) {
      // 丢弃孤儿工具结果：没有对应 assistant tool_call 其结果同样会让后端 400。
      if (!keepResultIds.has(String(result.toolCallId))) continue
      wire.push({
        role: 'tool',
        tool_call_id: String(result.toolCallId),
        content: contentToText(result.content) || '(no output)',
      })
    }
  }
  return wire
}

/**
 * 保证首条消息为 `system`（腾讯上游的会话结构硬性校验）。
 *
 * 上游要求 messages[0].role === 'system'，否则返回 HTTP 400
 * `{"code":11128,"msg":"first message is not system prompt"}`。
 * **国际站（workbuddy.ai）严格校验**，国内站相对宽容——账号池混挂国内/国际
 * 账号时，同一份会话历史会表现为"约一半请求随机失败"，极难排查。
 *
 * harness 正常会下发 system，但以下情况会产生非 system 开头：
 * 用户关闭了系统提示词、以工具结果续写会话、或历史被裁剪掉首条消息。
 * 此处按以下优先级归一化（对齐 workbuddy-gateway 的 ensureLeadingSystemMessage）：
 *   1. 首条已是 system：原样返回；
 *   2. 后续存在 system：提升到首位，其余保持原序；
 *   3. 都没有：注入一条保底 system。
 */
function ensureLeadingSystemMessage(
  messages: Array<Record<string, unknown>>,
): Array<Record<string, unknown>> {
  const roleOf = (message: Record<string, unknown>): string =>
    typeof message.role === 'string' ? message.role.toLowerCase().trim() : ''

  if (messages.length > 0 && roleOf(messages[0]) === 'system') return messages
  const index = messages.findIndex((message) => roleOf(message) === 'system')
  if (index > 0) {
    return [messages[index], ...messages.slice(0, index), ...messages.slice(index + 1)]
  }
  return [{ role: 'system', content: DEFAULT_SYSTEM_PROMPT }, ...messages]
}

/** 缺少 system 提示词时注入的保底内容（对齐 workbuddy-gateway）。 */
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful assistant.'

/** 安全读取 Error.message。 */
function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  try { return String(error) } catch { return 'unknown error' }
}

/** 从错误体提取可读 detail 文本。 */
function errorDetail(body: string): string {
  try {
    const data = JSON.parse(body) as Record<string, unknown>
    const error = typeof data.error === 'object' && data.error !== null
      ? data.error as Record<string, unknown>
      : undefined
    const parts = [
      typeof error?.code === 'string' ? error.code : undefined,
      typeof error?.type === 'string' ? error.type : undefined,
      typeof error?.message === 'string' ? error.message : undefined,
      typeof data.message === 'string' ? data.message : undefined,
    ].filter((value): value is string => value !== undefined)
    if (parts.length > 0) return parts.join(' ')
  } catch {
    // 非 JSON 错误体
  }
  return body
}

/** 将 HTTP 状态码映射为 harness 错误码。 */
function httpErrorCode(status: number): string {
  if (status === 401 || status === 403) return 'AUTH'
  if (status === 429) return 'RATE_LIMIT'
  if (status === 400) return 'INVALID_REQUEST'
  if (status >= 500) return 'SERVER'
  return `HTTP_${status}`
}

/**
 * SSE 流空闲超时。buddy（CodeBuddy）后端对 SSE 连接有空闲断连策略：模型
 * 生成超长推理或大工具调用参数时，两次 chunk 之间可能静默数十秒。原实现
 * 直接 `await reader.read()` 且没有任何超时——连接被服务端掐断后若对端
 * 既不发数据也不关连接（半开连接），read() 会**永久挂起**，generator 永不
 * 返回，harness 当前步骤既不出结果也不报错，会话永久停留在"运行中"：web
 * 端表现为进度停止、发送按钮置灰、后续"继续"指令完全无响应。
 *
 * 主动以略小于后端超时窗口的间隔检测空闲，超时则取消 reader 并抛可重试
 * 的 TIMEOUT，让 harness 重试该步骤并把控制权交还给用户。
 *
 * 分两个阶段，与 codearts 适配器保持一致：
 * - firstTokenTimeout：等待首个 chunk 的窗口（模型排队 / 长思考时较长）；
 * - chunkTimeout：收到首 chunk 后，两次 chunk 之间的最大静默（每次成功
 *   读取后重置）。
 *
 * 两者均可由环境变量覆盖（毫秒，整数），便于测试用短超时触发 TIMEOUT 路径，
 * 或线上针对特定模型调优。在每次 stream() 调用时读取，避免模块顶层常量
 * 在 import 时定型导致测试中设置环境变量不生效。
 */
function resolveFirstTokenTimeoutMs(): number {
  return Number.parseInt(process.env.DSH_BUDDY_SSE_FIRST_TOKEN_TIMEOUT_MS ?? '', 10) || 120_000
}
function resolveChunkTimeoutMs(): number {
  return Number.parseInt(process.env.DSH_BUDDY_SSE_CHUNK_TIMEOUT_MS ?? '', 10) || 120_000
}

/** 判断是否为传输级错误。 */
function isTransportError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const message = error.message.toLowerCase()
  if (message.includes('terminated')) return true
  if (error.name.startsWith('UND_ERR_')) return true
  if (message.includes('fetch failed')) return true
  if (message.includes('econnreset') || message.includes('epipe') || message.includes('socket hang up')) return true
  return false
}

/**
 * 把 user 消息内容块转为 OpenAI 多模态 parts；无图片时返回 undefined，
 * 让调用方保持原有的纯字符串路径（无图请求的线上格式不变，避免破坏前缀缓存）。
 */
function userContentParts(
  content: readonly unknown[],
  imageUrls: ReadonlyMap<string, string>,
): Array<Record<string, unknown>> | undefined {
  const parts: Array<Record<string, unknown>> = []
  let hasImage = false
  for (const raw of content) {
    if (typeof raw !== 'object' || raw === null) continue
    const block = raw as { type?: unknown; text?: unknown; attachment?: { attachmentId?: unknown } }
    if (block.type === 'text') {
      const text = String(block.text ?? '')
      if (text.length > 0) parts.push({ type: 'text', text })
      continue
    }
    if (block.type === 'image') {
      hasImage = true
      const url = block.attachment?.attachmentId === undefined
        ? undefined
        : imageUrls.get(String(block.attachment.attachmentId))
      // 解析不到字节时留占位文本，而不是静默吞掉整张图。
      parts.push(url === undefined
        ? { type: 'text', text: '[image unavailable]' }
        : { type: 'image_url', image_url: { url } })
    }
  }
  return hasImage && parts.length > 0 ? parts : undefined
}

/** 收集 user 消息中的图片附件引用（含工具结果内嵌图片），按 attachmentId 去重。 */
function collectImages(content: readonly unknown[], refs: Map<string, unknown>): void {
  for (const raw of content) {
    if (typeof raw !== 'object' || raw === null) continue
    const block = raw as { type?: unknown; attachment?: { attachmentId?: unknown }; content?: unknown }
    if (block.type === 'image' && typeof block.attachment?.attachmentId === 'string') {
      refs.set(block.attachment.attachmentId, block.attachment)
      continue
    }
    if (block.type === 'tool-result' && Array.isArray(block.content)) collectImages(block.content, refs)
  }
}

/** buddy (腾讯 CodeBuddy) 模型适配器。使用 Bearer access_token 鉴权。 */
export class BuddyAdapter extends LlmAdapter {
  private readonly fetchImpl: typeof fetch
  /**
   * 前缀缓存会话标识（prompt_cache_key）。同一会话内所有请求复用同一 key，
   * 服务端据此把相同前缀的 KV 缓存跨请求复用；缺失时缓存命中恒为 0。
   */
  private readonly sessionId: string
  /** 动态模型缓存（首次 listModels 成功后填充）。 */
  private remoteModels: BuddyRemoteModel[] | undefined
  /** 远端下发的模型元数据（id → 能力），listModels/resolveModel/stream 共用。 */
  private remoteMeta: ReadonlyMap<string, BuddyRemoteModel> = new Map()
  /** 远端下发的模型上下文窗口（/v3/config data.models[].maxInputTokens）。 */
  private remoteContextWindows: ReadonlyMap<string, number> = new Map()

  constructor(private readonly options: BuddyAdapterOptions) {
    super()
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sessionId = options.sessionId ?? crypto.randomUUID().replace(/-/g, '')
  }

  /**
   * 描述本适配器拥有的 provider 路由。
   *
   * DSH 会强制校验 `info.id === provider` 且 `info.name` 为非空字符串；
   * 模型设置页还会用该 id 计算 `deriveKeyRef(provider)`（内部调用
   * `provider.toUpperCase()`）。因此这里对入参做防御性归一化：
   * 一旦 `provider` 不是字符串（例如上游传入了 undefined），
   * 直接回退到本适配器声明时的 PROVIDER 常量，避免
   * `undefined.toUpperCase is not a function` 在客户端炸开。
   */
  providerInfo(provider: string): LlmProviderInfo {
    const id = typeof provider === 'string' && provider.length > 0 ? provider : PROVIDER
    return { id, name: 'CodeBuddy (Tencent)' }
  }

  /**
   * 模型列表：优先使用 /v3/config 动态拉取的远端列表，否则回退静态默认。
   * 动态拉取失败时静默回退（与 Rust fetch_models 的 Vec::new() 语义一致）。
   */
  /**
   * 懒加载远端模型目录（仅拉取一次）。listModels 与 resolveModel 共用：
   * resolveModel 可能先于 listModels 被调用（如直接进入会话），此时同样
   * 触发一次远端拉取，保证 /v3/config 的 maxInputTokens 能生效。
   */
  private async ensureRemoteModels(): Promise<void> {
    if (this.remoteModels !== undefined || this.options.fetchRemoteModels === undefined) return
    try {
      const models = await this.options.fetchRemoteModels()
      if (models.length > 0) {
        this.remoteModels = models
        // /v3/config data.models[] 是权威来源（对齐 Rust TUI buddy_context_limits
        // 注入逻辑）：远端下发的上下文窗口优先于 CONTEXT_WINDOWS 静态 fallback 表；
        // 能力字段（supportsImages / reasoning.supportedEfforts）同理。
        this.remoteMeta = new Map(models.map((model) => [model.id, model]))
        this.remoteContextWindows = new Map(
          models.filter((model) => model.contextWindow !== undefined).map((model) => [model.id, model.contextWindow as number]),
        )
      }
    } catch {
      // 远端不可用：回退静态列表
    }
  }

  /** 模型接受的输入模态：远端 supportsImages 优先，静态表兜底。 */
  private inputModalitiesFor(model: string): readonly ('text' | 'image')[] {
    const supportsImages = this.remoteMeta.get(model)?.supportsImages ?? IMAGE_MODELS.has(model)
    return supportsImages ? ['text', 'image'] : ['text']
  }

  /** 模型可选的思考等级：远端 supportedEfforts 优先，静态表兜底。 */
  private effortsFor(model: string): readonly string[] {
    return this.remoteMeta.get(model)?.reasoningEfforts ?? REASONING_EFFORTS.get(model) ?? []
  }

  async listModels(_provider: string): Promise<readonly LlmModelInfo[]> {
    await this.ensureRemoteModels()
    const source = this.remoteModels ?? DEFAULT_MODELS.map((id) => ({ id, name: id }))
    return source.map((model) => ({
      provider: PROVIDER,
      id: model.id,
      name: model.name,
      inputModalities: this.inputModalitiesFor(model.id),
    }))
  }

  async resolveModel(provider: string, model: string, _signal?: AbortSignal): Promise<LlmResolvedModelInfo> {
    await this.ensureRemoteModels()
    // 优先远端 maxInputTokens，其次静态 fallback 表（对齐 Rust
    // context_limit_for_model 的两级查找）。
    const contextWindow = this.remoteContextWindows.get(model) ?? CONTEXT_WINDOWS.get(model)
    const resolved: LlmResolvedModelInfo = {
      provider,
      id: model,
      name: model,
      inputModalities: this.inputModalitiesFor(model),
    }
    if (contextWindow !== undefined) resolved.context = { contextWindow }
    // 思考等级：这是"思考强度"选择器出现在模型选择里的唯一入口——composer
    // 读取 resolveModel().reasoning。无等级可选的模型不声明该字段，UI 显示
    // "当前模型未提供推理等级"。
    const efforts = this.effortsFor(model)
    if (efforts.length > 0) {
      const remoteDefault = this.remoteMeta.get(model)?.defaultReasoningEffort
      resolved.reasoning = {
        efforts: efforts.map((id) => ({
          id: ReasoningEffortId(id),
          name: EFFORT_NAMES[id] ?? id,
        })),
        ...remoteDefault !== undefined && efforts.includes(remoteDefault)
          ? { defaultEffort: ReasoningEffortId(remoteDefault) }
          : {},
      }
    }
    return resolved
  }

  /**
   * 兼容 0.1.1-rc.2：新版 LlmRuntime.prepareCall() 会调用
   * `registration.adapter.prepareCall(...)`，而本仓库链接的 dsh-llm 副本
   * （0.1.0-rc.6）的 LlmAdapter 基类尚未提供该方法，缺少时会在每轮请求
   * 开始时抛 `registration.adapter.prepareCall is not a function`。这里把
   * 模型解析与分发绑定到同一个适配器实例（与 CodeArtsAdapter 同款 shim）。
   */
  async prepareCall(
    provider: string,
    model: string,
    signal?: AbortSignal,
  ): Promise<{ model: LlmResolvedModelInfo; stream: (options: GenerateOptions) => AsyncIterable<StreamChunk> }> {
    return {
      model: await this.resolveModel(provider, model, signal),
      stream: (options: GenerateOptions) => this.stream(options),
    }
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    // 1. 获取凭据（过期则先静默续期）。
    // 传入模型 id：账号池据此跳过该模型已限流的账号。
    let credential = await this.options.resolveCredential(options.model)
    if (credential === undefined || isCredentialExpired(credential)) {
      await this.options.refresh()
      credential = await this.options.resolveCredential(options.model)
    }
    if (credential === undefined || credential.access_token.length === 0) {
      throw new LlmError('buddy: no usable credential; log in first with /buddy-login', 'MISSING_CREDENTIAL')
    }

    // Track current account for rate limit switching
    let currentAccountId = ''
    if (this.options.accountPool && credential) {
      try {
        currentAccountId = await this.options.accountPool.findAccountIdByCredential(
          'buddy',
          credential.access_token,
        )
        if (currentAccountId === '') {
          // 账号池里没有匹配该凭据的账号（例如用的是回退的单凭据），
          // 此时限流无法归属到具体账号，也就无法在 UI 上显示标记。
          console.warn('[buddy] 当前凭据未匹配到账号池条目，限流记录将被跳过')
        }
      } catch (error) {
        console.warn('[buddy] 账号匹配失败（不影响本次请求）:', error)
      }
    }

    // 能力判定（图片 / 思考强度）必须有远端目录在手：两者都以 /v3/config
    // 下发值为权威，而该拉取是懒加载的。缺了这一步，远端显式 false 会被
    // 静态兜底表覆盖，合法的思考等级也会被误判为不支持而丢弃。
    await this.ensureRemoteModels()

    // 2. 序列化消息
    // 图片：读原始字节并以内联 data URL 发出——这是 CodeBuddy 唯一接受的
    // 图片形态（{type:'image'} 会被服务端 400 拒绝）。
    const imageRefs = new Map<string, unknown>()
    for (const message of options.messages) {
      if (Array.isArray(message.content)) collectImages(message.content, imageRefs)
    }
    let imageUrls: Map<string, string> | undefined
    if (imageRefs.size > 0) {
      if (!this.inputModalitiesFor(options.model).includes('image')) {
        throw new LlmError(`buddy: model "${options.model}" does not accept image input.`, 'UNSUPPORTED_CONTENT')
      }
      if (this.options.readImage === undefined) {
        throw new LlmError('buddy: image input requires the attachment service.', 'UNSUPPORTED_CONTENT')
      }
      imageUrls = new Map()
      for (const [id, ref] of imageRefs) {
        const image = await this.options.readImage(ref)
        if (image === undefined) continue
        imageUrls.set(id, `data:${image.mediaType};base64,${Buffer.from(image.data).toString('base64')}`)
      }
    }
    const messages = serializeMessages(options.messages, imageUrls)
    if (options.system !== undefined && options.system.length > 0) {
      messages.unshift({ role: 'system', content: options.system })
    }
    // 上游（尤其国际站）硬性要求首条消息为 system，否则 400 code=11128。
    const normalizedMessages = ensureLeadingSystemMessage(messages)
    const tools = options.tools?.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))

    // 3. 构造请求体
    const bodyObj: Record<string, unknown> = {
      model: options.model,
      messages: normalizedMessages,
      stream: true,
      // prompt_cache_key 让服务端启用前缀缓存并在 usage 中返回缓存命中，
      // 缺少该字段时命中恒为 0（与 codearts 同款修复，见 llm-adapter.ts）。
      // 实证（2026 实测 deepseek-v4-flash，同一段 8k token 前缀）：
      //   不带该字段 → prompt_tokens=8027, prompt_cache_hit_tokens=0,    credit=0.34
      //   带该字段   → prompt_tokens=8027, prompt_cache_hit_tokens=7808, credit=0.02
      // 仅此一个字段的差异，费用差约 17 倍。同 key 重复请求稳定命中同一前缀。
      prompt_cache_key: this.sessionId,
    }
    if (tools !== undefined && tools.length > 0) bodyObj.tools = tools
    if (options.temperature !== undefined) bodyObj.temperature = options.temperature
    if (options.stop !== undefined && options.stop.length > 0) bodyObj.stop = options.stop
    // 思考强度：composer 选中的等级透传为 `reasoning_effort`（实测
    // low/high/max 会显著改变返回的 reasoning_content 长度，服务端真实生效）。
    // 只在该模型确实支持该等级时才发，否则服务端会因非法参数 400。
    if (options.reasoningEffort !== undefined && this.effortsFor(options.model).includes(options.reasoningEffort)) {
      bodyObj.reasoning_effort = options.reasoningEffort
    }
    const body = JSON.stringify(bodyObj)

    // 4. 发送请求（401/403 时刷新一次凭据后重试）
    let response = await this.send(credential, body, options)
    if (!response.ok && (response.status === 401 || response.status === 403)) {
      await this.options.refresh()
      credential = await this.options.resolveCredential(options.model)
      if (credential === undefined || credential.access_token.length === 0) {
        throw new LlmError('buddy: credential expired and refresh failed', 'AUTH', { status: response.status })
      }
      response = await this.send(credential, body, options)
    }
    if (!response.ok) {
      let errorText = await response.text().catch(() => '')
      // 限流处理：把当前账号在该模型上的重置时间记录下来，然后逐个尝试
      // 其余可用账号。每个失败账号都会被记录，只有真正试完全部候选才报
      // "所有账号均受限"——避免只试一个就下结论（那会让 UI 显示的限流
      // 状态与实际判定不一致）。
      //
      // 判定必须带上 HTTP 状态码：上游（尤其国际站/CDN 边缘）可能返回 429
      // 但响应体为空或只有一句 Too Many Requests，仅靠文本会漏判。
      if (this.options.accountPool && isRateLimited(errorText, response.status)) {
        const pool = this.options.accountPool
        const tried = new Set<string>()
        if (currentAccountId) tried.add(currentAccountId)

        for (;;) {
          // 解析不出具体时刻时仍返回默认冷却（parseRateLimitError 保证），
          // 因此这里拿到的 resetTimeMs 一定可用，不会因解析失败而放弃切换。
          const parsed = parseRateLimitError(errorText, options.model, { status: response.status })
          if (parsed && currentAccountId) {
            // 记录当前账号在该模型上的限流重置时间（UI 据此展示限流标记）
            await pool.updateModelRateLimit(currentAccountId, parsed.modelId, parsed.resetTimeMs)
          }
          // 取下一个未尝试过的可用账号
          const next = await pool.getAvailableAccount('buddy', options.model)
          if (!next || tried.has(next.entry.id)) break
          tried.add(next.entry.id)
          credential = next.credential as BuddyCredential
          currentAccountId = next.entry.id
          response = await this.send(credential, body, options)
          if (response.ok) {
            yield* this.consumeSse(response, options)
            return
          }
          errorText = await response.text().catch(() => '')
          if (!isRateLimited(errorText, response.status)) {
            // 新账号失败但不是限流：按原错误分类抛出，不要再吞成"均受限"
            throw new LlmError(`buddy: ${errorDetail(errorText)}`, httpErrorCode(response.status), { status: response.status })
          }
        }
        throw new LlmError(`buddy: 模型 ${options.model} 所有账号均受限，请稍后再试`, 'QUOTA_EXCEEDED')
      }
      throw new LlmError(`buddy: ${errorDetail(errorText)}`, httpErrorCode(response.status), { status: response.status })
    }

    // 5. 消费 SSE 流
    yield* this.consumeSse(response, options)
  }

  /** 发起一次 chat 请求；网络失败映射为可重试的 TRANSPORT 错误。 */
  private async send(
    credential: BuddyCredential,
    body: string,
    options: GenerateOptions,
  ): Promise<Response> {
    const site = buddySiteProfile(credential.edition)
    const headers = new Headers(attributionHeaders())
    headers.set('Authorization', `Bearer ${credential.access_token}`)
    headers.set('Accept', 'text/event-stream')
    headers.set('Content-Type', 'application/json')
    // X-Domain 缺失时回退到凭据所属站点的域名：国际站账号发到国际站上游，
    // 不能用国内站域名（会被判为跨站而拒绝）。空串同样按缺失处理。
    headers.set(HTTP_HEADER_DOMAIN, domainOrDefault(credential))
    headers.set(HTTP_HEADER_PRODUCT, BUDDY_DEPLOYMENT_TYPE)
    headers.set(HTTP_HEADER_PRODUCT_CODE, BUDDY_PRODUCT_CODE)
    // Origin/Referer 伪装为各站 Web 控制台（国际站为 workbuddy.ai）。
    headers.set('Origin', site.origin)
    headers.set('Referer', `${site.origin}/`)
    // User-Agent 必须伪装为 CodeBuddy IDE（后端以此识别客户端）。
    headers.set('User-Agent', BUDDY_USER_AGENT)
    try {
      return await this.fetchImpl(`${site.base}/v2/chat/completions`, {
        method: 'POST',
        headers,
        body,
        signal: options.signal,
      })
    } catch (error) {
      if (options.signal?.aborted) throw error
      if (isTransportError(error)) {
        throw new LlmError(`buddy: transport error: ${errorMessage(error)}`, 'TRANSPORT', { cause: error as Error })
      }
      throw error
    }
  }

  /**
   * 消费 SSE 响应并产出 StreamChunk。
   *
   * CodeBuddy 返回标准 OpenAI SSE：`delta.content` 为正文、
   * `delta.reasoning_content` 为思考、`delta.tool_calls` 为工具调用。
   * 流式工具调用仅首个分片携带真实 id（chatcmpl-tool-xxx），后续参数分片
   * 只有 index——按 index 缓存 id 保证同一工具的所有分片 id 一致。
   */
  private async *consumeSse(
    response: Response,
    options: GenerateOptions,
  ): AsyncIterable<StreamChunk> {
    if (!response.body) throw new LlmError('buddy: empty model response body', 'EMPTY_RESPONSE')

    const blocks: Array<{ index: number; kind: 'text' | 'reasoning'; text: string }> = []
    let nextIndex = 0
    const toolCalls = new Map<number, { index: number; text: string; callId?: string; name?: string }>()
    const toolOrder: number[] = []
    // tool_call index → 后端签发的真实 id。缺失时回退 call_{index}，
    // 保证 Start/Delta 使用同一 id。
    const toolIds = new Map<number, string>()
    let buffer = ''
    let streamEnded = false
    let finishReason: 'stop' | 'tool_calls' | 'length' | undefined
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    // 首 token 与 chunk 间超时分阶段使用：第一次读取用 firstTokenTimeout，
    // 收到首 chunk 后切换为 chunkTimeout 并在每次成功读取后重置。没有这层
    // 保护时，半开的 SSE 连接会让 read() 永久挂起，会话卡死在"运行中"。
    let firstTokenReceived = false

    try {
      for (;;) {
        if (streamEnded) break
        let result
        try {
          const timeoutMs = firstTokenReceived ? resolveChunkTimeoutMs() : resolveFirstTokenTimeoutMs()
          const phase = firstTokenReceived ? 'chunk' : 'first-token'
          result = await readWithIdleTimeout(reader, timeoutMs, 'buddy', options.signal, phase)
          if (!result.done) firstTokenReceived = true
        } catch (error) {
          if (options.signal?.aborted) throw error
          if (error instanceof LlmError) throw error
          if (isTransportError(error)) {
            throw new LlmError(`buddy: sse transport error: ${errorMessage(error)}`, 'TRANSPORT', { cause: error as Error })
          }
          throw error
        }
        if (result.done) break
        buffer += decoder.decode(result.value, { stream: true })
        let newline: number
        while ((newline = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newline).trim()
          buffer = buffer.slice(newline + 1)
          if (!line.startsWith('data:')) continue
          const payload = line.slice(5).trim()
          if (payload === '[DONE]') {
            streamEnded = true
            break
          }
          let data: {
            error?: { message?: string }
            choices?: Array<{
              delta?: {
                content?: string
                reasoning_content?: string
                tool_calls?: Array<{
                  index?: number
                  id?: string
                  function?: { name?: string; arguments?: string }
                }>
              }
              finish_reason?: string
            }>
            usage?: {
              prompt_tokens?: number
              completion_tokens?: number
              /** 缓存命中的 prompt token 数（与 prompt_cache_hit_tokens 同值）。 */
              prompt_tokens_details?: {
                cached_tokens?: number
                cache_write_tokens?: number
              }
              completion_tokens_details?: { reasoning_tokens?: number }
              prompt_cache_hit_tokens?: number
              prompt_cache_miss_tokens?: number
              /** 费用权重（非 token 数）。 */
              credit?: number
            }
          }
          try {
            data = JSON.parse(payload)
          } catch {
            continue
          }
          if (data.error !== undefined) {
            throw new LlmError(`buddy: ${data.error.message ?? 'unknown error'}`, 'SERVER')
          }
          const choice = data.choices?.[0]
          const delta = choice?.delta
          if (typeof choice?.finish_reason === 'string') {
            finishReason = choice.finish_reason as 'stop' | 'tool_calls' | 'length'
          }
          if (delta?.content) {
            let block = blocks.find(candidate => candidate.kind === 'text')
            if (block === undefined) {
              block = { index: nextIndex++, kind: 'text', text: '' }
              blocks.push(block)
              yield { type: 'block-start', index: block.index, blockType: 'text' }
            }
            block.text += delta.content
            yield { type: 'text-delta', index: block.index, text: delta.content }
          }
          if (delta?.reasoning_content) {
            let block = blocks.find(candidate => candidate.kind === 'reasoning')
            if (block === undefined) {
              block = { index: nextIndex++, kind: 'reasoning', text: '' }
              blocks.push(block)
              yield { type: 'block-start', index: block.index, blockType: 'reasoning' }
            }
            block.text += delta.reasoning_content
            yield { type: 'reasoning-delta', index: block.index, text: delta.reasoning_content }
          }
          for (const call of delta?.tool_calls ?? []) {
            const wireIndex = call.index ?? 0
            if (typeof call.id === 'string' && call.id.length > 0) {
              toolIds.set(wireIndex, call.id)
            }
            const callId = toolIds.get(wireIndex) ?? `call_${wireIndex}`
            let block = toolCalls.get(wireIndex)
            if (block === undefined) {
              block = { index: nextIndex++, text: '', callId }
              toolCalls.set(wireIndex, block)
              toolOrder.push(block.index)
              yield { type: 'block-start', index: block.index, blockType: 'tool-call' }
            }
            block.callId = callId
            // 后续参数分片会带上空的 function.name（""），它不是 undefined，
            // 直接覆盖会把首个分片解析出的真实工具名清空，导致
            // `unknown tool ""`。只有非空名字才允许更新。
            if (typeof call.function?.name === 'string' && call.function.name.length > 0) {
              block.name = call.function.name
            }
            const fragment = call.function?.arguments ?? ''
            block.text += fragment
            yield {
              type: 'tool-call-delta',
              index: block.index,
              id: ToolCallId(callId),
              ...block.name !== undefined ? { name: block.name } : {},
              argumentsDelta: fragment,
            }
          }
          if (data.usage) {
            const promptTokens = data.usage.prompt_tokens ?? 0
            // 后端在六处回传缓存信息，其中 cached_tokens 同时出现在
            // prompt_tokens_details 与 completion_tokens_details 里，但后者
            // **恒为 0**（实测）——只认 prompt_tokens_details，误取会永远读到 0。
            const cachedTokens = data.usage.prompt_tokens_details?.cached_tokens
              ?? data.usage.prompt_cache_hit_tokens
              ?? 0
            const cacheWriteTokens = data.usage.prompt_tokens_details?.cache_write_tokens
            const reasoningTokens = data.usage.completion_tokens_details?.reasoning_tokens
            yield {
              type: 'usage',
              usage: {
                // 与 codearts 一致：inputTokens 只计**未命中缓存**的部分，
                // 命中部分单列 cacheReadTokens，否则缓存命中率显示会偏大。
                inputTokens: cachedTokens > 0 ? promptTokens - cachedTokens : promptTokens,
                outputTokens: data.usage.completion_tokens ?? 0,
                ...cachedTokens > 0 ? { cacheReadTokens: cachedTokens } : {},
                ...cacheWriteTokens !== undefined && cacheWriteTokens > 0 ? { cacheWriteTokens } : {},
                ...reasoningTokens !== undefined && reasoningTokens > 0 ? { reasoningTokens } : {},
              },
            }
          }
        }
      }
    } finally {
      reader.releaseLock()
    }

    // 按创建顺序关闭每个块
    const textBlock = blocks.find(block => block.kind === 'text')
    for (const index of toolOrder) {
      const block = [...toolCalls.values()].find(candidate => candidate.index === index)!
      yield {
        type: 'block-end',
        index,
        block: {
          type: 'tool-call',
          id: ToolCallId(block.callId ?? ''),
          name: block.name ?? '',
          // 仅把"无参数工具下发的空分片"补成 {}；**残缺参数保持原样**，
          // 由 max-tokens 判定触发重试。切勿把残缺 JSON 也补成 {}——那会
          // 伪造出合法外观，让 harness 报 `missing required property` 而
          // 非重试，掩盖真正的分片丢失。
          arguments: isTruncatedArguments(block.text)
            ? block.text
            : normalizeToolArguments(block.text),
        },
      }
    }
    if (textBlock !== undefined) {
      yield { type: 'block-end', index: textBlock.index, block: { type: 'text', text: textBlock.text } }
    }
    const reasoningBlock = blocks.find(block => block.kind === 'reasoning')
    if (reasoningBlock !== undefined && reasoningBlock.text !== '') {
      yield { type: 'block-end', index: reasoningBlock.index, block: { type: 'reasoning', text: reasoningBlock.text } }
    }
    // 三种"不完整"都必须报告 max-tokens 而非 tool-calls，否则 harness 会
    // 执行残缺调用、报 INVALID_ARGS，并把脏参数持久化进会话历史：
    // - 'length'：模型输出被 max_tokens 显式截断；
    // - 未收到 finish_reason：连接被中途掐断，参数必然是半截 JSON；
    // - 参数分片丢失：后端并行下发多个工具调用时偶发丢分片（实测
    //   session-23851745 turn1 step4，两个并行 `read` 都丢了 `{"file_path": "…`
    //   前缀）。此时报告 tool-calls 会让 harness 执行缺参调用，报
    //   `missing required property "file_path"`，模型收到莫名其妙的参数错误
    //   并陷入重试循环。判定为截断后 dsh 丢弃残缺调用并重试，实测一次即恢复。
    const argsTruncated = [...toolCalls.values()].some(block => isTruncatedArguments(block.text))
    const reason = finishReason === 'length'
      || finishReason === undefined && toolOrder.length > 0
      || argsTruncated
      ? { kind: 'max-tokens' as const }
      : finishReason === 'tool_calls' || toolOrder.length > 0
        ? { kind: 'tool-calls' as const }
        : { kind: 'stop' as const }
    yield { type: 'finish', reason }
  }
}

/** 凭据是否已过期；无法解析过期时间时不判定过期（与 Rust is_expired 一致）。 */
function isCredentialExpired(credential: BuddyCredential): boolean {
  const expiresAt = credentialExpiresAtMs(credential)
  return expiresAt === undefined ? false : Date.now() >= expiresAt
}

/** 在 ctx.llm 上注册 buddy 提供商路由和适配器。 */
export function registerBuddyLlm(ctx: Context, options: BuddyAdapterOptions): void {
  ctx.llm.registerConfigurableProviders([
    { provider: PROVIDER, displayName: 'CodeBuddy (Tencent)', settingsNs: 'llm-buddy', settingsPath: [] },
  ])
  ctx.llm.registerAdapter([PROVIDER], new BuddyAdapter(options))
}
