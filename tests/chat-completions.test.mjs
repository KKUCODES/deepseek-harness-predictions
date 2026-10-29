import test from 'node:test'
import assert from 'node:assert/strict'
import { chatCompletion } from '../lib/chat-completions.js'
import { normalizeBaseURL, apiKeySchema } from '../lib/custom-model.js'
import { chatCompletionsFixture } from '../scripts/chat-completions-fixture.mjs'

test('智谱 1311 套餐模型权限与余额、并发和套餐额度分别提示，厂商原文不回显', async () => {
  const originalFetch = globalThis.fetch
  try {
    for (const [code, expected] of [['1311', 'model-not-entitled'], ['1113', 'insufficient-balance'], ['1302', 'rate-limited'], ['1308', 'quota-exceeded']]) {
      globalThis.fetch = async () => Response.json({ error: { code, message: 'SECRET-fixture-key echoed by provider' } }, { status: 429 })
      await assert.rejects(chatCompletion({ baseURL: 'https://open.bigmodel.cn/api/coding/paas/v4', model: 'GLM-5.3-FlashX', apiKey: 'SECRET-fixture-key' },
        [{ role: 'user', content: 'OK' }], 128, new AbortController().signal), error => error.code === expected && error.message.includes(code)
          && !error.message.includes('SECRET-fixture-key') && (code !== '1311' || !error.message.includes('余额')))
    }
  } finally { globalThis.fetch = originalFetch }
})

test('其他厂家的同名错误码不套用智谱解释，异常错误体仍安全回退', async () => {
  const originalFetch = globalThis.fetch
  try {
    for (const body of [JSON.stringify({ error: { code: '1311', message: 'SECRET-fixture-key' } }), '<html>proxy</html>', 'x'.repeat(20000)]) {
      globalThis.fetch = async () => new Response(body, { status: 429 })
      await assert.rejects(chatCompletion({ baseURL: 'https://other.example/v1', model: 'model', apiKey: 'SECRET-fixture-key' },
        [{ role: 'user', content: 'OK' }], 128, new AbortController().signal), error => error.code === 'rate-limited' && !error.message.includes('SECRET-fixture-key'))
    }
  } finally { globalThis.fetch = originalFetch }
})

test('基础地址只接受 HTTP(S)，保留代理路径，拒绝认证、查询与其他接口路径', () => {
  assert.equal(normalizeBaseURL(' https://example.test/proxy/v1/ '), 'https://example.test/proxy/v1')
  for (const url of ['api.example.test', 'file:///tmp/key', 'https://u:p@example.test/v1', 'https://example.test/v1?k=x',
    'https://example.test/v1#key', 'https://example.test/v1/chat/completions/', 'https://example.test/v1/responses', 'https://example.test/messages']) assert.equal(normalizeBaseURL(url), undefined)
  assert.equal(apiKeySchema.safeParse('bad\nkey').success, false)
})

test('真实 HTTP 仅发 Chat Completions，带 Bearer 和输出上限，无工具、重发或协议猜测', async () => {
  const f = await chatCompletionsFixture()
  try {
    let usage
    const result = await chatCompletion({ baseURL: f.baseURL, model: 'my-model', apiKey: 'fixture-not-real-key' },
      [{ role: 'system', content: 'predict' }, { role: 'user', content: '[]' }], 96, new AbortController().signal, value => { usage = value })
    assert.equal(result, '请继续实现搜索框。')
    assert.deepEqual(usage, { inputTokens: 30, outputTokens: 10 })
    assert.equal(f.calls.length, 1)
    assert.equal(f.calls[0].path, '/v1/chat/completions')
    assert.equal(f.calls[0].headers.authorization, 'Bearer fixture-not-real-key')
    assert.ok(f.calls[0].headers['user-agent'])
    assert.deepEqual(Object.keys(f.calls[0].body).sort(), ['max_tokens', 'messages', 'model', 'stream'])
    assert.equal(f.calls[0].body.max_tokens, 96)
    assert.equal(f.calls[0].body.stream, false)
  } finally { await f.close() }
})

test('异常响应不回显密钥，不跟随跳转，不误接 Responses，不自动重试', async () => {
  const f = await chatCompletionsFixture()
  try {
    for (const [mode, code] of [['auth', 'authentication-failed'], ['missing-model', 'model-unavailable'], ['redirect', 'connection-failed'],
      ['html', 'invalid-response'], ['oversized', 'invalid-response'], ['responses', 'invalid-response'], ['length', 'incomplete-response']]) {
      f.mode(mode)
      const before = f.calls.length
      await assert.rejects(chatCompletion({ baseURL: f.baseURL, model: 'my-model', apiKey: 'fixture-not-real-key' },
        [{ role: 'user', content: 'OK' }], 16, new AbortController().signal), error => error.code === code && !error.message.includes('fixture-not-real-key'))
      assert.equal(f.calls.length, before + 1)
    }
  } finally { await f.close() }
})

test('截断响应仍报告已返回用量，缺失用量不造数；取消及时退出', async () => {
  const f = await chatCompletionsFixture()
  const connection = { baseURL: f.baseURL, model: 'my-model', apiKey: 'fixture-not-real-key' }
  try {
    let usage
    f.mode('length')
    await assert.rejects(chatCompletion(connection, [{ role: 'user', content: 'OK' }], 16, new AbortController().signal, value => { usage = value }))
    assert.deepEqual(usage, { inputTokens: 30, outputTokens: 10 })
    f.mode('no-usage'); usage = 'unchanged'
    await chatCompletion(connection, [{ role: 'user', content: 'OK' }], 16, new AbortController().signal, value => { usage = value })
    assert.equal(usage, undefined)
    f.mode('slow')
    const controller = new AbortController()
    const pending = chatCompletion(connection, [{ role: 'user', content: 'OK' }], 16, controller.signal)
    setTimeout(() => controller.abort(), 50)
    await assert.rejects(pending, { name: 'AbortError' })
  } finally { await f.close() }
})
