import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import { apiKeySchema, customDraftSchema, normalizeBaseURL } from './custom-model.js'
import { completionBody, type RequestParameters } from './request-parameters.js'

export class CustomModelError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
const usageSchema = z.object({ prompt_tokens: z.number().int().nonnegative(), completion_tokens: z.number().int().nonnegative() })
const responseSchema = z.object({ choices: z.array(z.object({
  index: z.number().int(), finish_reason: z.string().nullable(),
  message: z.object({ role: z.literal('assistant'), content: z.string().nullable(), tool_calls: z.array(z.unknown()).optional(), function_call: z.unknown().optional() }),
})).min(1), usage: z.unknown().optional() })

// 只翻译官方已定义的业务码，不把服务端任意 message（可能回显密钥）带到界面。
const bigModelErrors: Record<string, [string, string]> = {
  '1113': ['insufficient-balance', '服务商账户余额不足，请检查账户计费。'],
  '1302': ['rate-limited', '服务商请求速率受限，请减少并发或稍后手动重试。'],
  '1305': ['provider-busy', '该模型当前繁忙，请稍后手动重试。'],
  '1308': ['quota-exceeded', '服务商套餐额度已用尽，请查看服务商的重置时间。'],
  '1309': ['plan-expired', '服务商 Coding Plan 套餐已到期。'],
  '1310': ['quota-exceeded', '服务商每周或每月使用额度已用尽。'],
  '1311': ['model-not-entitled', '当前订阅套餐未开放该模型权限，请选择套餐支持的模型。'],
  '1313': ['rate-limited', '服务商因公平使用策略限制了请求，请查看服务商账户状态。'],
  '1314': ['plan-expired', '服务商企业套餐已失效，请联系管理员。'],
  '1315': ['credential-scope', '该 API Key 仅限服务商企业编程套餐场景，请检查 Key 类型。'],
}
async function readJSON(response: Response, signal: AbortSignal, limit: number): Promise<unknown> {
  const reader = response.body?.getReader()
  if (!reader) throw new CustomModelError('invalid-response', '服务未返回有效的 Chat Completions 响应。')
  const chunks: Uint8Array[] = []
  let bytes = 0
  try {
    while (true) {
      const part = await reader.read()
      signal.throwIfAborted()
      if (part.done) break
      bytes += part.value.byteLength
      if (bytes > limit) throw new CustomModelError('invalid-response', '模型响应过大。')
      chunks.push(part.value)
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) }
  catch { throw new CustomModelError('invalid-response', '服务未返回有效的 Chat Completions JSON。') }
}

/** 仅非流式 Chat Completions；不探测其他协议，也不因失败额外重发收费请求。 */
export async function chatCompletion(connection: { baseURL: string; model: string; apiKey: string },
  messages: { role: 'system' | 'user'; content: string }[], parameters: RequestParameters | number, signal: AbortSignal,
  onUsage: (usage: { inputTokens: number; outputTokens: number } | undefined) => void = () => {}) {
  const draft = customDraftSchema.parse(connection)
  const apiKey = apiKeySchema.parse(connection.apiKey)
  const body = completionBody(draft.model, messages, parameters)
  signal.throwIfAborted()
  let response: Response
  try {
    response = await fetch(normalizeBaseURL(draft.baseURL)! + '/chat/completions', { method: 'POST', redirect: 'error', signal,
      headers: { ...attributionHeaders(), authorization: 'Bearer ' + apiKey, 'content-type': 'application/json', accept: 'application/json' },
      body })
  } catch {
    signal.throwIfAborted()
    throw new CustomModelError('connection-failed', '无法连接到服务，请检查 API 地址和网络。')
  }
  if (!response.ok) {
    if (response.status === 429 && new URL(draft.baseURL).hostname === 'open.bigmodel.cn') {
      let raw: unknown
      try { raw = await readJSON(response, signal, 16 * 1024) } catch { signal.throwIfAborted() }
      const parsed = z.object({ error: z.object({ code: z.union([z.string(), z.number()]) }) }).safeParse(raw)
      const providerCode = parsed.success ? String(parsed.data.error.code) : ''
      const known = /^\d{4}$/u.test(providerCode) ? bigModelErrors[providerCode] : undefined
      if (known) throw new CustomModelError(known[0], known[1] + `（服务码 ${providerCode}）`)
    } else await response.body?.cancel()
    const [code, text] = response.status === 401 || response.status === 403 ? ['authentication-failed', 'API Key 无效或无模型访问权限。']
      : response.status === 404 ? ['model-unavailable', '找不到接口或模型，请检查基础地址和模型 ID。']
      : response.status === 429 ? ['rate-limited', '服务拒绝请求（HTTP 429），请检查服务商限额和模型权限。']
      : response.status === 400 || response.status === 422 ? ['invalid-parameters', `服务商拒绝请求参数（HTTP ${response.status}）。请检查输出上限、参数名、类型和值是否适用于该模型。`]
      : ['provider-failed', '模型服务拒绝请求，请检查 Chat Completions 配置。']
    throw new CustomModelError(code!, text!)
  }
  const raw = await readJSON(response, signal, 1024 * 1024)
  const parsed = responseSchema.safeParse(raw)
  if (!parsed.success) throw new CustomModelError('invalid-response', '服务返回格式不兼容 Chat Completions。')
  const usage = usageSchema.safeParse(parsed.data.usage)
  onUsage(usage.success ? { inputTokens: usage.data.prompt_tokens, outputTokens: usage.data.completion_tokens } : undefined)
  const choice = parsed.data.choices.find(choice => choice.index === 0)
  if (!choice || choice.finish_reason !== 'stop' || choice.message.tool_calls?.length || choice.message.function_call
    || typeof choice.message.content !== 'string' || !choice.message.content.trim()) {
    throw new CustomModelError('incomplete-response', choice?.finish_reason === 'length'
      ? '输出达到服务商返回的长度上限，预测未完成。请调高或关闭输出长度限制，并检查思考参数；思考也可能消耗输出额度。'
      : '模型未返回完整的文本预测。请检查自定义参数和服务商返回格式后手动重试。')
  }
  return choice.message.content
}
