import test from 'node:test'
import assert from 'node:assert/strict'
import { completionBody, customRequestOf, emptyRequestParameters, requestParametersSchema } from '../lib/request-parameters.js'
import { chatCompletion } from '../lib/chat-completions.js'
import { chatCompletionsFixture } from '../scripts/chat-completions-fixture.mjs'

test('关闭时省略字段；上限从 1 起且大整数逐位保留，没有 256 或 JS 安全整数封顶', () => {
  const off = emptyRequestParameters()
  assert.equal(Object.hasOwn(JSON.parse(completionBody('m', [], off)), 'max_tokens'), false)
  for (const maxTokens of ['1', '1024', '000256', '900719925474099312345678901234567890']) {
    const body = completionBody('m', [], { ...off, maxTokensEnabled: true, maxTokens })
    assert.ok(body.includes('"max_tokens":' + maxTokens.replace(/^0+(?=\d)/u, '')))
  }
  for (const maxTokens of ['', '0', '000', '-1', '1.1', '1e3', 'Infinity', '1,"stream":true'])
    assert.equal(requestParametersSchema.safeParse({ ...off, maxTokensEnabled: true, maxTokens }).success, false)
  assert.equal(requestParametersSchema.safeParse({ ...off, maxTokens: 'bad-but-disabled' }).success, true)
})

test('四种类型保持原值，0 和 false 不丢失；点号作为原始顶层键，不作路径映射', () => {
  const parameters = [
    { key: 'reasoning_effort', type: 'text', value: 'low' }, { key: 'temperature', type: 'number', value: '0' },
    { key: 'enable_thinking', type: 'boolean', value: 'false' }, { key: 'thinking', type: 'json', value: '{"type":"disabled","budget":[1,0,false]}' },
    { key: 'literal.dot', type: 'text', value: '"quoted"\nvalue' },
  ]
  const body = JSON.parse(completionBody('m', [], { ...emptyRequestParameters(), parameters }))
  assert.deepEqual(body, { model: 'm', messages: [], stream: false, reasoning_effort: 'low', temperature: 0, enable_thinking: false,
    thinking: { type: 'disabled', budget: [1, 0, false] }, 'literal.dot': '"quoted"\nvalue' })
})

test('阻止空键、重复、SDK 包装、控制字段覆盖、类型错误和两种上限冲突', () => {
  const row = (key, value = 'low', type = 'text') => ({ key, value, type })
  for (const parameters of [[row('')], [row(' x '), row('x')], [row('extra_body')],
    ...['model', 'messages', 'stream', 'tools', 'tool_choice', 'functions', 'function_call', 'headers', 'authorization', 'API_KEY', '__proto__', 'max_tokens'].map(key => [row(key)]),
    [row('thinking', '{broken}', 'json')], [row('enabled', 'no', 'boolean')], [row('number', '01', 'number')], [row('max_completion_tokens', '1', 'text')]])
    assert.equal(requestParametersSchema.safeParse({ ...emptyRequestParameters(), parameters }).success, false)
  const alternative = { ...emptyRequestParameters(), parameters: [row('max_completion_tokens', '1024', 'number')] }
  assert.equal(requestParametersSchema.safeParse(alternative).success, true)
  assert.equal(requestParametersSchema.safeParse({ ...alternative, maxTokensEnabled: true, maxTokens: '256' }).success, false)
})

test('升级保留原连接上限；新连接关闭，已保存开关与参数优先于旧全局值', () => {
  assert.deepEqual(customRequestOf({ customCredential: '', outputTokens: 128 }), emptyRequestParameters())
  assert.deepEqual(customRequestOf({ customCredential: 'existing', outputTokens: 96 }), { maxTokensEnabled: true, maxTokens: '96', parameters: [] })
  assert.deepEqual(customRequestOf({ customCredential: 'existing', outputTokens: 96, customRequestConfigured: true,
    customMaxTokensEnabled: false, customMaxTokens: '4096', customParameters: '[]' }), { maxTokensEnabled: false, maxTokens: '4096', parameters: [] })
  assert.throws(() => customRequestOf({ customRequestConfigured: true, customMaxTokensEnabled: false, customMaxTokens: '', customParameters: '{broken}' }))
})

test('真实 HTTP 传输保留嵌套 JSON 与大整数，无效设置在发出前拒绝', async () => {
  const f = await chatCompletionsFixture()
  const connection = { baseURL: f.baseURL, model: 'model', apiKey: 'fixture-not-real-key' }
  const signal = new AbortController().signal
  try {
    const request = { ...emptyRequestParameters(), parameters: [{ key: 'thinking', type: 'json', value: '{"type":"disabled"}' }] }
    await chatCompletion(connection, [{ role: 'user', content: 'OK' }], request, signal)
    assert.equal(Object.hasOwn(f.calls[0].body, 'max_tokens'), false)
    assert.deepEqual(f.calls[0].body.thinking, { type: 'disabled' })
    await chatCompletion(connection, [{ role: 'user', content: 'OK' }], { ...request, maxTokensEnabled: true, maxTokens: '9007199254740993123456789' }, signal)
    assert.ok(f.calls[1].rawBody.includes('"max_tokens":9007199254740993123456789'))
    await assert.rejects(chatCompletion(connection, [], { ...request, parameters: [{ key: 'model', type: 'text', value: 'override' }] }, signal))
    assert.equal(f.calls.length, 2)
  } finally { await f.close() }
})
