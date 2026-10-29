import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import Schema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { clientRequestSchema, type ConnectionRpcHandlerResult } from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-session-projection'
import { SessionId } from '@deepseek-ai/dsh-session'
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { RPC_PREFIX, PROJECTION_KEY, type PredictionReply } from './config.js'
import { emptyTurn, foldTurn, generatePrediction, predictionContext, LIMITS, SYSTEM_PROMPT } from './prediction.js'
import { DEFAULTS, TEST_TEXT, type PredictionConfig, type PredictionStatus } from './config.js'
import { usageDay, controlsOf, emptyTotals, parseRoute, startUsage, settleUsage, sumTotals, totalsSchema } from './usage.js'
import { randomUUID } from 'node:crypto'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { CUSTOM_ROUTE } from './config.js'
import { customDraftSchema, apiKeySchema, credentialIdSchema } from './custom-model.js'
import { chatCompletion, CustomModelError } from './chat-completions.js'
import { predictionText } from './prediction.js'
import { customRequestOf, legacyRequestParameters, requestParametersSchema, type RequestParameters } from './request-parameters.js'

export const name = 'dsh-predictions'
export const inject = ['connection', 'storageDomain', 'sessions', 'sessionProjections', 'llm', 'credentials']
export type Config = { [K in keyof PredictionConfig]: Volatile<PredictionConfig[K]> }
export const Config: Schema<PredictionConfig, Config> = Schema.object({
  previewEnabled: Schema.boolean().default(false).volatile().description('显示接入测试灰字（不调用模型）'),
  testText: Schema.string().default(TEST_TEXT).volatile().description('单行测试文字，最多 240 个字符'),
  predictionEnabled: Schema.boolean().default(false).volatile().description('启用预测消息'),
  automaticEnabled: Schema.boolean().default(DEFAULTS.automaticEnabled).volatile().description('助手回复后自动预测；关闭后仍可双次右箭头手动生成'),
  modelRoute: Schema.string().default(DEFAULTS.modelRoute).volatile().description('预测模型路由；空值跟随会话'),
  customBaseURL: Schema.string().default('').volatile().description('自定义 Chat Completions 基础地址'),
  customModel: Schema.string().default('').volatile().description('自定义预测模型 ID'),
  customCredential: Schema.string().default('').volatile().description('插件凭据引用；不包含密钥值'),
  customRequestConfigured: Schema.boolean().default(false).volatile().description('连接是否已保存独立请求参数'),
  customMaxTokensEnabled: Schema.boolean().default(false).volatile().description('自定义模型是否传 max_tokens'),
  customMaxTokens: Schema.string().default('').volatile().description('自定义 max_tokens 正整数字符串'),
  customParameters: Schema.string().default('[]').volatile().description('自定义 Chat Completions 参数行'),
  contextMessages: Schema.number().min(2).max(8).step(1).default(DEFAULTS.contextMessages).volatile().description('最多读取的消息条数'),
  contextChars: Schema.number().min(500).max(4000).step(1).default(DEFAULTS.contextChars).volatile().description('上下文字符上限'),
  outputTokens: Schema.number().min(32).max(256).step(1).default(DEFAULTS.outputTokens).volatile().description('每次输出 token 上限'),
  inputPrice: Schema.number().min(0).max(100000).default(DEFAULTS.inputPrice).volatile().description('每百万输入 tokens 的估算单价（人民币）；0 为未填写'),
  outputPrice: Schema.number().min(0).max(100000).default(DEFAULTS.outputPrice).volatile().description('每百万输出 tokens 的估算单价（人民币）；0 为未填写'),
})

export async function apply(ctx: Context, config: Config): Promise<void> {
  const schema = z.object({ key: z.string().nullable(), running: z.boolean(), sawAssistant: z.boolean() })
  ctx.sessionProjections.register({ key: PROJECTION_KEY, stateVersion: 1, stateSchema: schema,
    init: emptyTurn, apply: foldTurn, wire: { viewSchema: schema, view: state => state } })
  const domain = await ctx.storageDomain.open(defineDomain({ name: 'dsh_predictions', version: 1, tables: {
    attempts: domainTable(z.object({ key: z.string(), status: z.enum(['attempted', 'ready', 'empty', 'failed', 'cancelled', 'skipped']),
      text: z.string().optional(), provider: z.string().optional(), model: z.string().optional(),
      inputBytes: z.number().optional(), maxTokens: z.union([z.number(), z.string()]).optional(),
      requestId: z.string().optional(),
      usage: z.object({ inputTokens: z.number(), outputTokens: z.number() }).optional() })) } }))
  ctx.effect(() => () => domain.close(), 'dsh-predictions: independent storage')
  const attempts = domain.table('attempts')
  // 沿用原用量域与版本；新记录模式兼容旧数据，多余的预留字段由模式解析丢弃。
  const usageDomain = await ctx.storageDomain.open(defineDomain({ name: 'dsh_predictions_usage', version: 1,
    tables: { daily: domainTable(totalsSchema) } }))
  ctx.effect(() => () => usageDomain.close(), 'dsh-predictions: usage storage')
  const daily = usageDomain.table('daily')
  const entries = new Map<string, { key: string; requestId?: string; controller: AbortController; reply?: PredictionReply }>()
  let lastDispatch = 0
  let active = false
  let lastNotice: { day: string; text: string } | undefined
  const testControllers = new Set<AbortController>()
  const cancel = () => { for (const entry of entries.values()) entry.controller.abort(); for (const controller of testControllers) controller.abort() }
  ctx.effect(() => cancel, 'dsh-predictions: cancel model requests')
  ctx.on('loader/volatile-update', cancel)
  ctx.on('session/disposed', session => { entries.get(session.id)?.controller.abort(); entries.delete(session.id) })
  ctx.on('session/event', (session, event) => {
    if (event.type === 'turn/start' || event.type === 'user/message') entries.get(session.id)?.controller.abort()
  })
  const storedKey = async () => {
    const id = config.customCredential.get()
    if (!credentialIdSchema.safeParse(id).success) throw new CustomModelError('missing-key', '请填写 API Key。')
    const record = await ctx.credentials.readRecord(credentialKey(name, id))
    if (record?.kind !== 'api-key' || !record.key) throw new CustomModelError('missing-key', '已保存的密钥不可用，请重新填写。')
    return apiKeySchema.parse(record.key)
  }
  const handle = async (endpoint: string, payload: unknown, signal: AbortSignal): Promise<ConnectionRpcHandlerResult> => {
    const refuse = (code: string, message: string) => ({ ok: false as const, error: { code, message, details: {} } })
    if (endpoint === 'custom/info') {
      if (!z.object({}).strict().safeParse(payload).success) return refuse('invalid-request', '连接请求无效。')
      const id = config.customCredential.get()
      const info = await ctx.credentials.describeRecord(credentialKey(name, credentialIdSchema.safeParse(id).success ? id : 'custom-model'))
      return { ok: true, value: { credential: id, configured: !!id && info.configured, writable: info.writable } }
    }
    if (endpoint === 'custom/key') {
      const parsed = z.object({ apiKey: apiKeySchema }).strict().safeParse(payload)
      if (!parsed.success) return refuse('invalid-key', '请输入有效的 API Key。')
      signal.throwIfAborted()
      const id = 'custom-' + randomUUID()
      // 密钥先存成新引用；仅原子表单保存成功后才会切换，失败不会替换当前使用的密钥。
      await ctx.credentials.modifyRecord(credentialKey(name, id), async () => ({ kind: 'api-key', key: parsed.data.apiKey }))
      return { ok: true, value: { credential: id } }
    }
    if (endpoint === 'custom/test') {
      const parsed = customDraftSchema.extend({ apiKey: apiKeySchema.optional(), credential: z.string().optional(), request: requestParametersSchema.optional() }).strict().safeParse(payload)
      if (!parsed.success) return refuse('invalid-settings', '请检查连接信息、输出长度和自定义参数。')
      if (active) return refuse('request-busy', '已有预测或连接测试正在进行，请稍后再试。')
      if (!parsed.data.apiKey && parsed.data.credential !== config.customCredential.get()) return refuse('settings-conflict', '密钥设置已变化，请读取最新设置。')
      const prices = controlsOf({ ...DEFAULTS, outputTokens: config.outputTokens.get(), inputPrice: config.inputPrice.get(), outputPrice: config.outputPrice.get() } as PredictionConfig)
      const controller = new AbortController()
      testControllers.add(controller)
      const abort = () => controller.abort()
      signal.addEventListener('abort', abort, { once: true })
      let timedOut = false
      const timeout = setTimeout(() => { timedOut = true; abort() }, LIMITS.timeoutMs)
      active = true
      let usage: { inputTokens: number; outputTokens: number } | undefined
      const day = usageDay()
      let started = false
      try {
        if (signal.aborted) controller.abort()
        controller.signal.throwIfAborted()
        const apiKey = parsed.data.apiKey ?? await storedKey()
        controller.signal.throwIfAborted()
        await daily.put(day, startUsage(daily.get(day) ?? emptyTotals(), prices)); started = true
        await chatCompletion({ ...parsed.data, apiKey }, [{ role: 'user', content: 'Reply with exactly OK.' }], parsed.data.request ?? legacyRequestParameters(prices.outputTokens),
          controller.signal, value => { usage = value })
        return { ok: true, value: {} }
      } catch (error) {
        return refuse(controller.signal.aborted ? 'test-cancelled' : error instanceof CustomModelError ? error.code : 'test-failed',
          controller.signal.aborted ? timedOut ? '请求超时，请检查服务后手动重试。' : '测试已取消。' : error instanceof CustomModelError ? error.message : '测试未成功，请检查配置。')
      } finally {
        testControllers.delete(controller)
        clearTimeout(timeout); signal.removeEventListener('abort', abort)
        try { if (started) await daily.put(day, settleUsage(daily.get(day)!, usage, prices)) } finally { active = false }
      }
    }
    if (endpoint === 'status') {
      if (!z.object({}).strict().safeParse(payload).success) return refuse('invalid-request', '统计请求无效。')
      let catalogIncomplete = false
      const models: PredictionStatus['models'] = []
      for (const provider of ctx.llm.listProviders()) {
        try {
          for (const model of await ctx.llm.listModels(provider.id)) models.push({
            route: JSON.stringify([provider.id, model.id]), label: `${provider.name} / ${model.name}` })
        } catch { catalogIncomplete = true }
      }
      const day = usageDay()
      const status: PredictionStatus = { day, today: daily.get(day) ?? emptyTotals(),
        total: sumTotals([...daily.entries()].map(([, value]) => value)), models, catalogIncomplete,
        ...(lastNotice?.day === day ? { notice: lastNotice.text } : {}) }
      return { ok: true, value: status }
    }
    const manual = endpoint === 'manual'
    const readOnly = endpoint === 'peek'
    const requestSchema = z.object({ sessionId: z.string().min(1).max(200), key: z.string().regex(/^\d+$/u) })
    const parsed = (manual ? requestSchema.partial({ key: true }).extend({ requestId: z.string().uuid() })
      : readOnly ? requestSchema.partial({ key: true }) : requestSchema).strict().safeParse(payload)
    if (!parsed.success || !['predict', 'dismiss', 'manual', 'peek'].includes(endpoint)) return refuse('invalid-request', '预测请求无效。')
    const { sessionId } = parsed.data
    const requestId = 'requestId' in parsed.data ? String(parsed.data.requestId) : undefined
    const session = ctx.sessions.get(SessionId(sessionId))
    if (!session) {
      // 客户端可先收到缓存投影；未分发任何模型时等待宿主正常加载，不能靠固定延迟猜测就绪。
      if (endpoint === 'predict' && config.predictionEnabled.get() && config.automaticEnabled.get() && !config.previewEnabled.get())
        return { ok: true, value: { key: parsed.data.key, status: 'skipped', retryAfterMs: 100 } }
      return refuse('session-unavailable', '会话尚未加载。')
    }
    const state = ctx.sessionProjections.stateOf(session, PROJECTION_KEY)
    // 刚安装时客户端可能尚未收到本插件投影，手动请求可由宿主还原历史回合身份。
    const key = parsed.data.key ?? state?.key ?? ''
    const skipped = (): { ok: true; value: PredictionReply } => ({ ok: true, value: { key, status: 'skipped' } })
    if (!state || state.key !== key || state.running) return skipped()
    if (endpoint === 'dismiss') {
      entries.get(sessionId)?.controller.abort()
      const previous = attempts.get(sessionId)
      const { text: _text, ...facts } = previous?.key === key ? previous : { key }
      await attempts.put(sessionId, { ...facts, key, status: 'skipped' })
      return skipped()
    }
    if (!config.predictionEnabled.get() || config.previewEnabled.get()) return skipped()
    if (readOnly) {
      const saved = attempts.get(sessionId)
      return saved?.key === key && saved.status === 'ready'
        ? { ok: true, value: { key, status: 'ready', text: saved.text } } : skipped()
    }
    let settings
    try { settings = controlsOf(Object.fromEntries(Object.entries(config).map(([key, value]) => [key, typeof value?.get === 'function' ? value.get() : value])) as unknown as PredictionConfig) }
    catch { return { ok: true, value: { key, status: 'skipped', notice: '预测设置无效；请在插件设置中检查范围、模型和估算单价。' } } }
    const saved = attempts.get(sessionId)
    const hasReady = saved?.key === key && saved.status === 'ready'
    // 已有建议始终复用，手动入口只补充缺失的预测，不能绕过客户端重新生成。
    if (saved?.key === key && (!manual || saved.requestId === requestId || hasReady)) return saved.status === 'ready'
      ? { ok: true, value: { key, status: 'ready', text: saved.text } } : skipped()
    if (!manual && !settings.automaticEnabled) return skipped()
    const old = entries.get(sessionId)
    if (old?.key === key && (!manual || old.requestId === requestId)) return { ok: true, value: old.reply ?? { key, status: 'skipped' } }
    if (manual && Date.now() - lastDispatch < 1000) return skipped()
    if (active) return manual ? skipped() : { ok: true, value: { key, status: 'skipped', retryAfterMs: 1000 } }
    const input = predictionContext(session.deriveMessages(), settings)
    if (!input || !session.requestHeader()) return skipped()
    const custom = settings.modelRoute === CUSTOM_ROUTE
    const route = settings.modelRoute ? parseRoute(settings.modelRoute) : undefined
    old?.controller.abort()
    const controller = new AbortController()
    const entry: { key: string; requestId?: string; controller: AbortController; reply?: PredictionReply } = { key, controller, ...(requestId ? { requestId } : {}) }
    entries.set(sessionId, entry)
    active = true
    const onAbort = () => controller.abort()
    signal.addEventListener('abort', onAbort, { once: true })
    let timedOut = false
    const timeout = setTimeout(() => {
      if (controller.signal.aborted) return
      timedOut = true; onAbort()
    }, LIMITS.timeoutMs)
    let dispatched = false
    let usageStarted = false
    let day = ''
    let usage: { inputTokens: number; outputTokens: number } | undefined
    let notice: string | undefined
    let requestOptions: RequestParameters | undefined
    try {
      if (signal.aborted) controller.abort()
      if (route && !custom) {
        try {
          const available = await ctx.llm.listModels(route.provider)
          if (!available.some(model => model.id === route.model)) notice = '选择的预测模型已不可用，请重新选择。'
        } catch { notice = '无法读取预测模型目录，请检查宿主模型配置。' }
        if (notice) throw new Error('model-unavailable')
      }
      const beforeDispatch = async (actualRoute: { provider: string; model: string }) => {
        const current = ctx.sessionProjections.stateOf(session, PROJECTION_KEY)
        if (!config.predictionEnabled.get() || config.previewEnabled.get() || current?.key !== key || current.running
          || (!manual && attempts.get(sessionId)?.key === key)
          || controller.signal.aborted) throw new Error('stale')
        // 先持久记录再发请求；即使失败、刷新或宿主重启，本轮也不会自动再次收费。
        const inputBytes = Buffer.byteLength(input + SYSTEM_PROMPT, 'utf8')
        day = usageDay()
        const today = daily.get(day) ?? emptyTotals()
        await daily.put(day, startUsage(today, settings))
        usageStarted = true
        await attempts.put(sessionId, { key, status: 'attempted', ...actualRoute, ...(requestId ? { requestId } : {}),
          inputBytes, ...(custom ? requestOptions?.maxTokensEnabled ? { maxTokens: requestOptions.maxTokens } : {} : { maxTokens: settings.outputTokens }) })
        lastDispatch = Date.now()
        dispatched = true
        lastNotice = undefined
      }
      let result
      if (custom) {
        requestOptions = customRequestOf(Object.fromEntries(Object.entries(config).map(([key, value]) => [key, value.get()])) as unknown as PredictionConfig)
        const connection = customDraftSchema.parse({ baseURL: config.customBaseURL.get(), model: config.customModel.get() })
        const apiKey = await storedKey()
        controller.signal.throwIfAborted()
        await beforeDispatch({ provider: 'dsh-predictions-custom', model: connection.model })
        const text = await chatCompletion({ ...connection, apiKey }, [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: input }],
          requestOptions, controller.signal, value => { usage = value })
        result = { text: predictionText(text), usage }
      } else result = await generatePrediction(ctx.llm, session, input, controller.signal, beforeDispatch,
        { route, outputTokens: settings.outputTokens, onUsage: value => { usage = value } })
      entry.reply = { key, status: result.text ? 'ready' : 'empty', ...(result.text ? { text: result.text } : {}) }
      if (!controller.signal.aborted) await attempts.put(sessionId, { ...attempts.get(sessionId)!, key,
        status: result.text ? 'ready' : 'empty', ...(result.text ? { text: result.text } : {}),
        ...(result.usage ? { usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens } } : {}) })
    } catch (error) {
      if (error instanceof CustomModelError) notice = error.message
      else if (custom && (error instanceof z.ZodError || error instanceof SyntaxError)) notice = '自定义模型参数无效，请打开自定义连接检查后保存。'
      if (notice) lastNotice = { day: usageDay(), text: notice }
      entry.reply = { key, status: timedOut ? 'failed' : notice ? 'skipped' : controller.signal.aborted ? 'cancelled' : 'failed',
        ...(timedOut ? { reason: 'timeout' as const } : {}),
        notice: timedOut ? '请求超时，可在空输入框双击右箭头重试。'
          : notice ?? (controller.signal.aborted ? '本轮预测已取消。' : '本轮预测未成功；请检查宿主模型配置，本轮不会自动重试。') }
      if (dispatched && attempts.get(sessionId)?.status !== 'skipped') {
        await attempts.put(sessionId, { ...attempts.get(sessionId)!, key, status: controller.signal.aborted ? 'cancelled' : 'failed' })
      }
    } finally {
      try {
        // 无完整用量的调用保持“待核对”；已返回终态用量的失败也按实际值记录。
        if (usageStarted) await daily.put(day, settleUsage(daily.get(day)!, usage, settings))
      } finally {
        active = false
        clearTimeout(timeout)
        signal.removeEventListener('abort', onAbort)
      }
    }
    const current = ctx.sessionProjections.stateOf(session, PROJECTION_KEY)
    return current?.key === key && !current.running && !signal.aborted && !config.previewEnabled.get()
      && (notice !== undefined || attempts.get(sessionId)?.status !== 'skipped') && config.predictionEnabled.get() && (!controller.signal.aborted || timedOut)
      ? { ok: true, value: entry.reply } : skipped()
  }
  for (const action of ['predict', 'dismiss', 'manual', 'status', 'peek', 'custom/info', 'custom/key', 'custom/test']) {
    const endpoint = `${RPC_PREFIX}${action}`
    // 公开精确路由由 Connection 统一执行 Host/Origin、浏览器认证及 owner 身份检查。
    ctx.effect(() => ctx.connection.fetch.register({ path: `/api/${endpoint}`, methods: ['POST'], requestBody: 'buffered',
      async fetch(request) {
        const parsed = clientRequestSchema.safeParse(await request.json().catch(() => null))
        if (!parsed.success || parsed.data.method !== endpoint) return new Response('Invalid prediction request', { status: 400 })
        let result: ConnectionRpcHandlerResult
        try { result = await handle(action, parsed.data.payload, request.signal) }
        catch { result = { ok: false, error: { code: 'prediction-unavailable', message: '预测暂不可用。', details: {} } } }
        return Response.json({ type: 'server-response', rpcId: parsed.data.rpcId, result })
      } }), `dsh-predictions: authenticated ${action}`)
  }
}
