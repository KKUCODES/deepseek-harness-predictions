import { z } from 'zod'
import type { PredictionConfig } from './config.js'

const reserved = new Set(['model', 'messages', 'stream', 'stream_options', 'tools', 'tool_choice', 'functions', 'function_call',
  'api_key', 'apikey', 'authorization', 'headers', 'baseurl', 'base_url', 'max_tokens', '__proto__', 'constructor', 'prototype'])
const jsonNumber = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/u
const positiveInteger = /^\d+$/u
export const parameterSchema = z.object({ key: z.string(), type: z.enum(['text', 'number', 'boolean', 'json']), value: z.string() }).strict()
export const requestParametersSchema = z.object({ maxTokensEnabled: z.boolean(), maxTokens: z.string(),
  parameters: z.array(parameterSchema) }).strict().superRefine((value, ctx) => {
  const issue = (path: (string | number)[], message: string) => ctx.addIssue({ code: 'custom', path, message })
  if (value.maxTokensEnabled && (!positiveInteger.test(value.maxTokens.trim()) || !/[1-9]/u.test(value.maxTokens)))
    issue(['maxTokens'], '请输入大于或等于 1 的整数。')
  const keys = new Set<string>()
  value.parameters.forEach((row, index) => {
    const key = row.key.trim()
    const path = ['parameters', index]
    if (!key) issue([...path, 'key'], '请填写参数名。')
    else if (/[\s\u0000-\u001f\u007f]/u.test(key)) issue([...path, 'key'], '参数名不能包含空白或控制字符。')
    else if (reserved.has(key.toLowerCase())) issue([...path, 'key'], key === 'max_tokens' ? '请使用上方的输出长度开关。' : '此字段由插件管理，不能覆盖。')
    else if (key === 'extra_body') issue([...path, 'key'], 'extra_body 是 SDK 写法，请直接填写其中的参数。')
    else if (keys.has(key)) issue([...path, 'key'], '参数名重复。')
    keys.add(key)
    if (key === 'max_completion_tokens' && value.maxTokensEnabled)
      issue([...path, 'key'], '不能同时设置 max_tokens 和 max_completion_tokens，请关闭上方开关或删除此参数。')
    const raw = row.value.trim()
    if (row.type === 'number' && !jsonNumber.test(raw)) issue([...path, 'value'], '请输入有效数字。')
    if (row.type === 'boolean' && raw !== 'true' && raw !== 'false') issue([...path, 'value'], '请选择 true 或 false。')
    if (row.type === 'json') {
      try { JSON.parse(raw) } catch { issue([...path, 'value'], '请输入有效 JSON。') }
    }
    if (key === 'max_completion_tokens' && !((row.type === 'number' || row.type === 'json') && /^[1-9]\d*$/u.test(raw)))
      issue([...path, 'value'], 'max_completion_tokens 必须是大于或等于 1 的整数，类型选数字或 JSON。')
  })
})
export type RequestParameters = z.infer<typeof requestParametersSchema>
export type Parameter = z.infer<typeof parameterSchema>
export const emptyRequestParameters = (): RequestParameters => ({ maxTokensEnabled: false, maxTokens: '', parameters: [] })
export const legacyRequestParameters = (tokens: number): RequestParameters => ({ maxTokensEnabled: true, maxTokens: String(tokens), parameters: [] })

/** 旧连接保留原上限；新连接默认不传，不把升级变成一次用量设置变更。 */
export function customRequestOf(config: PredictionConfig): RequestParameters {
  if (!config.customRequestConfigured) return config.customCredential ? legacyRequestParameters(config.outputTokens) : emptyRequestParameters()
  return requestParametersSchema.parse({ maxTokensEnabled: config.customMaxTokensEnabled, maxTokens: config.customMaxTokens,
    parameters: JSON.parse(config.customParameters) })
}

/** 数字片段均先验证再拼接，避免大整数经过 JS Number 时被舍入或变成 Infinity。 */
export function completionBody(model: string, messages: { role: string; content: string }[], input: RequestParameters | number): string {
  const request = requestParametersSchema.parse(typeof input === 'number' ? legacyRequestParameters(input) : input)
  const fields = [JSON.stringify({ model, messages, stream: false }).slice(1, -1)]
  if (request.maxTokensEnabled) fields.push('"max_tokens":' + request.maxTokens.trim().replace(/^0+(?=\d)/u, ''))
  for (const row of request.parameters) fields.push(JSON.stringify(row.key.trim()) + ':' + (row.type === 'text' ? JSON.stringify(row.value) : row.value.trim()))
  return '{' + fields.join(',') + '}'
}
