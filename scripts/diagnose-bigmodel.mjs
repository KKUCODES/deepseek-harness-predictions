import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { chatCompletion } from '../lib/chat-completions.js'
import { readGlmKey } from './read-glm-key.mjs'

// 显式诊断入口；只在内存中读取用户指定的 GLM Key，绝不复制文件或输出密钥。
const keyFile = process.argv[2]
if (!keyFile) throw new Error('请提供密钥文件路径')
const model = process.argv[3] ?? 'GLM-5.3-FlashX'
const maxTokens = Number(process.argv[4] ?? 16)
if (![16, 128, 256].includes(maxTokens)) throw new Error('诊断仅允许 16、128 或 256 的输出上限')
const apiKey = await readGlmKey(keyFile)
const redact = value => typeof value === 'string' ? value.replaceAll(apiKey, '[redacted]').replace(/[A-Za-z0-9_-]{16,}(?:\.[A-Za-z0-9_-]{8,})*/gu, '[redacted]') : undefined
const report = { startedAt: new Date().toISOString(), baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4', model,
  variant: maxTokens === 16 ? 'plugin-0.6.0-test' : 'token-limit-comparison', maxTokens, requests: 0 }
const originalFetch = globalThis.fetch
globalThis.fetch = async (...args) => {
  report.requests++
  const response = await originalFetch(...args)
  report.httpStatus = response.status
  if (response.ok) {
    const json = await response.clone().json().catch(() => null)
    const choice = json?.choices?.[0]
    report.response = { finishReason: choice?.finish_reason, contentChars: choice?.message?.content?.length ?? 0,
      reasoningChars: choice?.message?.reasoning_content?.length ?? 0, usage: json?.usage }
  }
  if (!response.ok) {
    const json = await response.clone().json().catch(() => null)
    const error = json?.error
    report.providerCode = redact(String(error?.code ?? ''))
    report.providerMessage = redact(error?.message)
  }
  return response
}
try {
  let usage
  await chatCompletion({ baseURL: report.baseURL, model, apiKey }, [{ role: 'user', content: 'Reply with exactly OK.' }], maxTokens,
    AbortSignal.timeout(15000), value => { usage = value })
  report.success = true
  report.usage = usage
} catch (error) {
  report.success = false
  report.pluginCode = typeof error.code === 'string' && error.code.length < 64 && !error.code.includes(apiKey) ? error.code : undefined
  report.pluginMessage = redact(error.message)
} finally { globalThis.fetch = originalFetch }
const directory = resolve('artifacts/bigmodel-diagnosis')
await mkdir(directory, { recursive: true })
const path = resolve(directory, new Date().toISOString().replace(/[:.]/gu, '-') + '.json')
await writeFile(path, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ ...report, report: path }))
