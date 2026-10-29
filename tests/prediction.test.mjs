import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyTurn, foldTurn, predictionContext, predictionText, generatePrediction, LIMITS } from '../lib/prediction.js'
import { apply, Config } from '../lib/index.js'
import { updateVolatile } from '@deepseek-ai/cosmokit'
import { usageDay, emptyTotals } from '../lib/usage.js'
import { CUSTOM_ROUTE } from '../lib/config.js'
import { chatCompletionsFixture } from '../scripts/chat-completions-fixture.mjs'

const event = (type, data, seq = 1) => ({ type, data, seq, time: 0 })
const message = (role, text, kind = role === 'assistant' ? 'model' : 'user') => ({ role, source: { kind }, content: [{ type: 'text', text }] })

test('只有正常结束且有助手回复的一轮可触发；中断、空会话不触发', () => {
  let state = foldTurn(emptyTurn(), event('turn/start', { turn: 1 }))
  assert.equal(state.key, null)
  state = foldTurn(state, event('assistant/message', {}))
  assert.equal(foldTurn(state, event('turn/end', { reason: { kind: 'aborted' } }, 5)).key, null)
  state = foldTurn(state, event('turn/end', { reason: { kind: 'completed' } }, 6))
  assert.equal(state.key, '6')
  assert.equal(foldTurn(state, event('turn/start', { turn: 2 })).key, null)
})

test('上下文排除系统指令、注入内容、工具和思考；限制条数、JSON 字符数', () => {
  const user = message('user', '给待办加搜索框')
  const assistant = message('assistant', '先写筛选逻辑')
  assistant.content.push({ type: 'reasoning', text: 'PRIVATE_REASONING' })
  const context = predictionContext([message('system', 'PRIVATE_SYSTEM'), user,
    message('user', 'PRIVATE_FILE', 'file'), message('tool', 'PRIVATE_TOOL'), assistant])
  assert.deepEqual(JSON.parse(context), [{ role: 'user', text: '给待办加搜索框' }, { role: 'assistant', text: '先写筛选逻辑' }])
  const many = Array.from({ length: 30 }, (_, i) => message(i % 2 ? 'assistant' : 'user', '中😀"\\'.repeat(300)))
  const bounded = predictionContext(many)
  assert.ok(bounded.length <= LIMITS.contextChars)
  assert.ok(JSON.parse(bounded).length <= LIMITS.messages)
  assert.ok(Buffer.byteLength(bounded) < LIMITS.inputBytes)
  assert.equal(predictionContext([assistant]), undefined)
  assert.equal(predictionContext([user]), undefined)
})

test('拒绝空建议、解释、多行和截断结果', () => {
  for (const text of ['', '<NO_PREDICTION>', '建议：继续', '第一行\n第二行', 'a'.repeat(121), '```code```']) assert.equal(predictionText(text), undefined)
  assert.equal(predictionText('请帮我实现搜索框。'), '请帮我实现搜索框。')
})

// 仅单元测试替身，不注册到 Harness、不伪造认证；真实 API 验收由独立 Web 脚本记录。
function modelFixture(finish = 'stop', beforeOutput, usagePatch = {}) {
  const captured = []
  return { captured, llm: {
    listProviders: () => [{ id: 'existing-provider', name: '现有提供商' }],
    async listModels(provider) { return provider === 'existing-provider' ? [{ provider, id: 'existing-model', name: '现有模型' }, { provider, id: 'small-model', name: '小模型' }] : [] },
    async prepareCall(config, signal, configure) {
    const controls = configure({}, { reasoning: { efforts: [{ id: 'off' }] } })
    return { config: { ...config, ...controls }, async *stream(options) {
      captured.push(options)
      signal.throwIfAborted()
      if (beforeOutput) await beforeOutput(signal)
      yield { type: 'text-delta', index: 0, text: '请帮我实现搜索框。' }
      yield { type: 'usage', usage: { inputTokens: 30, outputTokens: 10, ...usagePatch } }
      if (finish !== 'missing') yield { type: 'finish', reason: { kind: finish } }
    } }
  } } }
}
const session = { id: 'owned-session', requestHeader: () => ({ config: { provider: 'existing-provider', model: 'existing-model' } }) }

test('真实调用路径复用宿主路由，先记录尝试再分发；不携带工具和 Agent 权限', async () => {
  const { llm, captured } = modelFixture()
  let committed = false
  const result = await generatePrediction(llm, session, '[]', new AbortController().signal, route => {
    assert.equal(captured.length, 0)
    assert.deepEqual(route, { provider: 'existing-provider', model: 'existing-model' })
    committed = true
  })
  assert.equal(committed, true)
  assert.equal(result.text, '请帮我实现搜索框。')
  assert.deepEqual(result.usage, { inputTokens: 30, outputTokens: 10 })
  assert.equal(captured[0].maxTokens, 128)
  assert.equal(captured[0].reasoningEffort, 'off')
  assert.equal(captured[0].tools, undefined)
})

test('取消和不完整流均不显示建议', async () => {
  for (const finish of ['max-tokens', 'missing']) {
    await assert.rejects(generatePrediction(modelFixture(finish).llm, session, '[]', new AbortController().signal, () => {}))
  }
  const controller = new AbortController(); controller.abort()
  const { llm, captured } = modelFixture()
  await assert.rejects(generatePrediction(llm, session, '[]', controller.signal, () => {}))
  assert.equal(captured.length, 0)
})

async function hostFixture(savedRecords = new Map(), model = modelFixture(), legacyConfig = {}, usageRecords = new Map(), sessionConfig = session.requestHeader().config) {
  let definition
  let state = { ...emptyTurn(), key: '8', sawAssistant: true }
  const records = []
  const routes = new Map()
  const handlers = new Map()
  const { llm, captured } = model
  let failUsage = false
  let sessionLoaded = true
  const secrets = new Map()
  const sess = { ...session, requestHeader: () => ({ config: sessionConfig }), deriveMessages: () => [message('user', '加搜索框'), message('assistant', '先做搜索逻辑')],
    append(type, data) { records.push({ type, data }); state = foldTurn(state, event(type, data)) } }
  const ctx = { llm, credentials: { async readRecord(key) { return secrets.get(key) },
    async describeRecord(key) { return { configured: secrets.has(key), writable: true } },
    async modifyRecord(key, mutate) { const next = await mutate(secrets.get(key)); if (next) secrets.set(key, next); return next },
  }, sessions: { get: () => sessionLoaded ? sess : undefined }, storageDomain: {
    async open(spec) { const data = spec.name === 'dsh_predictions_usage' ? usageRecords : savedRecords; return { table() { return {
      get(id) { return data.get(id) },
      entries() { return data.entries() },
      async put(id, value) { if (data === usageRecords && failUsage) throw new Error('unit-only-storage-failure'); records.push(value); data.set(id, value) },
    } }, async close() {} } },
  }, sessionProjections: {
    register(value) { definition = value }, stateOf: () => state },
    effect(fn) { fn() }, on(name, handler) { handlers.set(name, handler) }, connection: { fetch: { register(route) { routes.set(route.path, route); return () => {} } } } }
  const config = Config({ predictionEnabled: false, ...legacyConfig })
  await apply(ctx, config)
  const call = async (key = '8', endpoint = 'predict', payload) => {
    const route = routes.get(`/api/dsh-predictions/${endpoint}`)
    const response = await route.fetch(new Request(`http://localhost${route.path}`, { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'unit-request',
        method: `dsh-predictions/${endpoint}`, payload: payload ?? { sessionId: 'owned-session', key } }) }))
    return (await response.json()).result
  }
  return { call, config, records, captured, savedRecords, usageRecords, secrets,
    set(field, value) { updateVolatile(config[field], Config({ [field]: value })[field]) },
    turn(key) { state = { ...state, key } },
    failUsage() { failUsage = true },
    sessionLoaded(value) { sessionLoaded = value },
    enable() { updateVolatile(config.predictionEnabled, Config({ predictionEnabled: true }).predictionEnabled) },
    fire(name, ...args) { handlers.get(name)?.(...args) },
    get definition() { return definition } }
}

test('默认关闭、参数检查与迟到回合均不会触发模型', async () => {
  const f = await hostFixture()
  await f.call()
  f.enable()
  assert.equal((await f.call('8', 'predict', { sessionId: 'x', key: '8', text: 'injected' })).ok, false)
  await f.call('7')
  assert.equal(f.captured.length, 0)
})

const manualPayload = requestId => ({ sessionId: 'owned-session', key: '8', requestId })
const firstRequest = 'ac6cdb50-e956-41b8-9e76-01824fadfb71'
const nextRequest = 'ac6cdb50-e956-41b8-9e76-01824fadfb72'

test('连续回合立即自动预测，已有延迟配置不生效且每轮只生成一次', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 20000 })
  const f = await hostFixture(new Map(), modelFixture(), { delayMs: 5000, cooldownSeconds: 300 })
  f.enable()
  assert.equal((await f.call()).value.status, 'ready')
  f.turn('9')
  assert.equal((await f.call('9')).value.status, 'ready')
  assert.equal(f.captured.length, 2)
  await f.call('9')
  assert.equal(f.captured.length, 2, '同轮结果仍只生成一次')
  f.turn('10')
  assert.equal((await f.call('10')).value.status, 'ready')
  assert.equal(f.captured.length, 3, '同一时刻完成的下一轮也没有跨轮冷却')
})

test('已有聊天的投影先到达时，只等待宿主会话就绪并恢复缓存，不重复调用模型', async () => {
  const f = await hostFixture(new Map([['owned-session', { key: '8', status: 'ready', text: '已存建议' }]]))
  f.enable(); f.sessionLoaded(false)
  const reply = await f.call()
  assert.equal(reply.ok, true)
  assert.equal(reply.value.status, 'skipped')
  assert.equal(reply.value.retryAfterMs, 100)
  assert.equal(f.captured.length, 0)
  f.sessionLoaded(true)
  assert.equal((await f.call()).value.text, '已存建议')
  assert.equal(f.captured.length, 0)
  f.sessionLoaded(false); f.set('automaticEnabled', false)
  assert.equal((await f.call()).ok, false, '仅手动模式不能安排自动生成')
})

test('自定义密钥只存凭据域，连接字段切换前不影响原模型；真实预测走独立 HTTP 并复用缓存', async () => {
  const http = await chatCompletionsFixture()
  try {
    const f = await hostFixture()
    const staged = await f.call('', 'custom/key', { apiKey: 'fixture-not-real-key' })
    assert.equal(staged.ok, true)
    const id = staged.value.credential
    assert.ok(id.startsWith('custom-'))
    assert.equal(f.config.customCredential.get(), '')
    assert.equal(JSON.stringify(await f.call('', 'custom/info', {})).includes('fixture-not-real-key'), false)
    f.set('customBaseURL', http.baseURL); f.set('customModel', 'my-model'); f.set('customCredential', id); f.set('modelRoute', CUSTOM_ROUTE)
    const info = await f.call('', 'custom/info', {})
    assert.equal(info.value.configured, true)
    f.enable()
    const reply = await f.call()
    assert.equal(reply.value.status, 'ready')
    assert.equal(reply.value.text, '请继续实现搜索框。')
    assert.equal(f.captured.length, 0)
    assert.equal(f.savedRecords.get('owned-session').model, 'my-model')
    assert.equal(f.usageRecords.get(usageDay()).inputTokens, 30)
    assert.equal(f.usageRecords.get(usageDay()).calls, 1)
    await f.call()
    assert.equal(http.calls.length, 1)
    assert.equal(http.calls[0].body.messages[1].content.includes('加搜索框'), true)
  } finally { await http.close() }
})

test('连接测试使用草稿而不持久保存或启用预测，旧密钥引用变更会拒绝复用', async () => {
  const http = await chatCompletionsFixture()
  try {
    const f = await hostFixture()
    const result = await f.call('', 'custom/test', { baseURL: http.baseURL, model: 'draft-model', apiKey: 'fixture-not-real-key' })
    assert.equal(result.ok, true)
    assert.equal(f.secrets.size, 0)
    assert.equal(f.config.predictionEnabled.get(), false)
    assert.equal(f.config.customModel.get(), '')
    assert.equal(http.calls[0].body.messages.length, 1)
    assert.equal(http.calls[0].body.max_tokens, 128)
    assert.equal(f.usageRecords.get(usageDay()).calls, 1)
    f.set('outputTokens', 96)
    assert.equal((await f.call('', 'custom/test', { baseURL: http.baseURL, model: 'draft-model', apiKey: 'fixture-not-real-key' })).ok, true)
    assert.equal(http.calls.at(-1).body.max_tokens, 96)
    assert.equal((await f.call('', 'custom/test', { baseURL: http.baseURL, model: 'draft-model', credential: 'old-key' })).ok, false)
    assert.equal(http.calls.length, 2)
    f.failUsage()
    assert.equal((await f.call('', 'custom/test', { baseURL: http.baseURL, model: 'draft-model', apiKey: 'fixture-not-real-key' })).ok, false)
    assert.equal(http.calls.length, 2)
  } finally { await http.close() }
})

test('自定义连接测试与实际预测使用同一请求参数，失败校验零分发，缓存不重发', async () => {
  const http = await chatCompletionsFixture()
  try {
    const f = await hostFixture()
    const request = { maxTokensEnabled: false, maxTokens: '', parameters: [
      { key: 'reasoning_effort', type: 'text', value: 'low' }, { key: 'enable_thinking', type: 'boolean', value: 'false' },
      { key: 'temperature', type: 'number', value: '0' }, { key: 'thinking', type: 'json', value: '{"type":"disabled"}' }] }
    const draft = { baseURL: http.baseURL, model: 'my-model', apiKey: 'fixture-not-real-key', request }
    assert.equal((await f.call('', 'custom/test', { ...draft, request: { ...request, maxTokensEnabled: true, maxTokens: '0' } })).ok, false)
    assert.equal(http.calls.length, 0)
    assert.equal((await f.call('', 'custom/test', draft)).ok, true)
    const staged = await f.call('', 'custom/key', { apiKey: draft.apiKey })
    for (const [field, value] of Object.entries({ customBaseURL: http.baseURL, customModel: draft.model, customCredential: staged.value.credential,
      modelRoute: CUSTOM_ROUTE, customRequestConfigured: true, customMaxTokensEnabled: false, customMaxTokens: '', customParameters: JSON.stringify(request.parameters) })) f.set(field, value)
    f.enable()
    assert.equal((await f.call()).value.status, 'ready')
    assert.equal(http.calls.length, 2)
    const withoutMessages = body => Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'messages'))
    assert.deepEqual(withoutMessages(http.calls[0].body), withoutMessages(http.calls[1].body))
    assert.equal(Object.hasOwn(f.savedRecords.get('owned-session'), 'maxTokens'), false)
    await f.call(); assert.equal(http.calls.length, 2)
    const invalid = await hostFixture(new Map(), modelFixture(), { ...Object.fromEntries(Object.entries(f.config).map(([key, value]) => [key, value.get()])),
      customParameters: '[{"key":"stream","type":"boolean","value":"true"}]' })
    assert.match((await invalid.call()).value.notice, /自定义模型参数无效/u)
    assert.equal(http.calls.length, 2)
  } finally { await http.close() }
})

test('连接测试与预测共用在途约束，设置变化取消真实 HTTP 后可再次明确测试', async () => {
  const http = await chatCompletionsFixture()
  try {
    const f = await hostFixture()
    const draft = { baseURL: http.baseURL, model: 'my-model', apiKey: 'fixture-not-real-key' }
    http.mode('slow')
    const pending = f.call('', 'custom/test', draft)
    for (let i = 0; i < 100 && !http.calls.length; i++) await new Promise(done => setTimeout(done, 10))
    assert.equal(http.calls.length, 1)
    assert.equal((await f.call('', 'custom/test', draft)).error.code, 'request-busy')
    f.fire('loader/volatile-update')
    const cancelled = await pending
    assert.equal(cancelled.error.code, 'test-cancelled')
    assert.equal(cancelled.error.message, '测试已取消。')
    http.mode('success')
    assert.equal((await f.call('', 'custom/test', draft)).ok, true)
    assert.equal(http.calls.length, 2)
  } finally { await http.close() }
})

test('旧会话无预测时可明确手动调用，自动失败不会限制手动重试', async () => {
  const records = new Map([['owned-session', { key: '8', status: 'failed' }]])
  const f = await hostFixture(records)
  f.enable()
  assert.equal((await f.call('8', 'manual', manualPayload(firstRequest))).value.status, 'ready')
  assert.equal(f.captured.length, 1)
  assert.equal(records.get('owned-session').requestId, firstRequest)
})

test('刚安装尚未收到投影时，手动请求由宿主解析旧会话的回合身份', async () => {
  const f = await hostFixture()
  f.enable()
  const result = await f.call('8', 'manual', { sessionId: 'owned-session', requestId: firstRequest })
  assert.equal(result.value.key, '8')
  assert.equal(result.value.status, 'ready')
  assert.equal(f.captured.length, 1)
})

test('已有预测始终复用，手动入口不能重新生成', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 20000 })
  const f = await hostFixture(new Map(), modelFixture(), { allowRefresh: true })
  f.enable()
  const original = await f.call()
  t.mock.timers.tick(1100)
  const unchanged = await f.call('8', 'manual', manualPayload(firstRequest))
  assert.equal(unchanged.value.text, original.value.text)
  assert.equal(f.captured.length, 1)
  assert.equal(f.config.allowRefresh, true, '宿主保留未知旧字段时，仍不能重新生成已有建议')
  assert.equal('allowRefresh' in Config({}), false)
})

test('同一手动请求重发或重启不再次收费，新的请求身份也不能刷新已有建议', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 20000 })
  const f = await hostFixture()
  f.enable()
  assert.equal((await f.call('8', 'manual', manualPayload(firstRequest))).value.status, 'ready')
  assert.equal(f.captured.length, 1)
  await f.call('8', 'manual', manualPayload(firstRequest))
  assert.equal(f.captured.length, 1)
  const restarted = await hostFixture(f.savedRecords)
  restarted.enable()
  await restarted.call('8', 'manual', manualPayload(firstRequest))
  assert.equal(restarted.captured.length, 0)
  t.mock.timers.tick(1100)
  await restarted.call('8', 'manual', manualPayload(nextRequest))
  assert.equal(restarted.captured.length, 0)
})

test('手动操作不能绕过总开关、参数验证、回合身份和冷却', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 20000 })
  const f = await hostFixture()
  await f.call('8', 'manual', manualPayload(firstRequest))
  assert.equal(f.captured.length, 0)
  f.enable()
  assert.equal((await f.call('8', 'manual')).ok, false)
  assert.equal((await f.call('8', 'manual', { ...manualPayload(firstRequest), requestId: 'wrong' })).ok, false)
  assert.equal((await f.call('7', 'manual', { ...manualPayload(firstRequest), key: '7' })).value.status, 'skipped')
  await f.call('8', 'manual', manualPayload(firstRequest))
  assert.equal((await f.call('8', 'manual', manualPayload(nextRequest))).value.status, 'ready')
  assert.equal(f.captured.length, 1)
  const failed = await hostFixture(new Map(), modelFixture('max-tokens'))
  failed.enable()
  assert.equal((await failed.call('8', 'manual', manualPayload(firstRequest))).value.status, 'failed')
  assert.equal((await failed.call('8', 'manual', manualPayload(nextRequest))).value.status, 'skipped')
  assert.equal(failed.captured.length, 1)
  t.mock.timers.tick(1100)
  await failed.call('8', 'manual', manualPayload(nextRequest))
  assert.equal(failed.captured.length, 2)
})

test('刷新、多窗口重复请求共用一次尝试，明确丢弃后不再返回灰字', async () => {
  const f = await hostFixture()
  f.enable()
  const first = await f.call()
  assert.equal(first.value.status, 'ready')
  assert.equal((await f.call()).value.text, first.value.text)
  assert.equal(f.captured.length, 1)
  assert.equal(f.records.filter(row => row.status === 'attempted').length, 1)
  const restarted = await hostFixture(f.savedRecords)
  restarted.enable()
  assert.equal((await restarted.call()).value.text, first.value.text)
  assert.equal(restarted.captured.length, 0)
  await f.call('8', 'dismiss')
  assert.equal((await f.call()).value.status, 'skipped')
  assert.equal(f.captured.length, 1)
})

test('主动取消后模型迟到至超时窗口之外，也不能变成超时提示', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let started, finish
  const gate = new Promise(done => { started = done })
  const model = modelFixture('stop', () => new Promise(done => { finish = done; started() }))
  const f = await hostFixture(new Map(), model)
  f.enable()
  const pending = f.call()
  await gate
  f.fire('loader/volatile-update', [])
  t.mock.timers.tick(LIMITS.timeoutMs)
  finish()
  assert.equal((await pending).value.status, 'skipped')
  assert.equal(f.captured.length, 1)
})

test('并行窗口不重复调用，关闭设置取消在途请求并丢弃迟到结果', async () => {
  let started
  const streamStarted = new Promise(done => { started = done })
  const model = modelFixture('stop', signal => new Promise((done, fail) => {
    signal.addEventListener('abort', () => fail(new Error('cancelled')), { once: true }); started()
  }))
  const f = await hostFixture(new Map(), model)
  f.enable()
  const first = f.call()
  await streamStarted
  assert.equal((await f.call()).value.status, 'skipped')
  f.fire('loader/volatile-update', [])
  assert.equal((await first).value.status, 'skipped')
  assert.equal(f.savedRecords.get('owned-session').status, 'cancelled')
  await f.call()
  assert.equal(f.captured.length, 1)
})

test('模型失败后即使重新加载插件，也不会在同一轮自动重试', async () => {
  const f = await hostFixture(new Map(), modelFixture('max-tokens'))
  f.enable()
  assert.equal((await f.call()).value.status, 'failed')
  assert.equal(f.savedRecords.get('owned-session').status, 'failed')
  const restarted = await hostFixture(f.savedRecords)
  restarted.enable()
  assert.equal((await restarted.call()).value.status, 'skipped')
  assert.equal(restarted.captured.length, 0)
})

test('服务端超时返回明确原因，主动取消或回合变化不冒充超时，也不自动重发', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let started
  const gate = new Promise(done => { started = done })
  const model = modelFixture('stop', signal => new Promise((done, fail) => {
    signal.addEventListener('abort', () => fail(new Error('aborted')), { once: true }); started()
  }))
  const f = await hostFixture(new Map(), model)
  f.enable()
  const pending = f.call()
  await gate
  t.mock.timers.tick(LIMITS.timeoutMs)
  const reply = await pending
  assert.equal(reply.value.status, 'failed')
  assert.equal(reply.value.reason, 'timeout')
  assert.equal(f.captured.length, 1)
  assert.equal((await f.call()).value.status, 'skipped')
  assert.equal(f.captured.length, 1)
})

test('仅手动模式仍允许读取缓存，缺失时只由明确手势调用', async () => {
  const f = await hostFixture(new Map(), modelFixture(), { automaticEnabled: false })
  f.enable()
  assert.equal((await f.call()).value.status, 'skipped')
  assert.equal(f.captured.length, 0)
  await f.call('8', 'manual', manualPayload(firstRequest))
  assert.equal(f.captured.length, 1)
  assert.equal((await f.call()).value.status, 'ready')
  assert.equal(f.captured.length, 1)
})

test('独立模型和输出上限到达真实调用入口，不修改会话模型', async () => {
  const f = await hostFixture(new Map(), modelFixture(), { modelRoute: JSON.stringify(['existing-provider', 'small-model']), outputTokens: 64 })
  f.enable()
  await f.call()
  assert.equal(f.captured[0].model, 'small-model')
  assert.equal(f.captured[0].maxTokens, 64)
  assert.equal(session.requestHeader().config.model, 'existing-model')
})

test('回退后官方路由也只用自填价，旧自动计价配置不再生效', async () => {
  for (const [inputPrice, outputPrice, expected] of [[0, 0, 0], [2, 4, 100]]) {
    const model = modelFixture()
    model.llm.listModels = async provider => [{ provider, id: 'deepseek-flash', name: 'Flash' }]
    const f = await hostFixture(new Map(), model, { modelRoute: JSON.stringify(['deepseek-official', 'deepseek-flash']),
      pricingMode: 'auto', inputPrice, outputPrice })
    f.enable()
    assert.equal((await f.call()).value.status, 'ready')
    const today = (await f.call('8', 'status', {})).value.today
    assert.equal(today.amountMicros, expected)
    assert.equal(today.inputTokens, 30)
    assert.equal(today.unpricedCalls, inputPrice ? 0 : 1)
    assert.equal('pricingMode' in Config({}), false)
  }
})

test('不可用独立模型和非法生成参数不调用模型；未填价格不阻止预测', async () => {
  await assert.rejects(hostFixture(new Map(), modelFixture(), { outputTokens: 512 }))
  for (const patch of [{ modelRoute: JSON.stringify(['missing', 'model']) }]) {
    const f = await hostFixture(new Map(), modelFixture(), patch)
    f.enable()
    assert.equal((await f.call()).value.status, 'skipped')
    assert.equal(f.captured.length, 0)
  }
})

test('统计和目录只读；旧配置与超高历史用量均不能阻止自动和手动预测', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 20000 })
  const history = new Map([[usageDay(), { ...emptyTotals(), calls: 2000, inputTokens: 99999999, amountMicros: 99999999, unpricedCalls: 2000 }]])
  const f = await hostFixture(new Map(), modelFixture(), { dailyCalls: 1, dailyTokens: 1, dailyAmount: 0.0001 }, history)
  f.enable()
  const before = await f.call('8', 'status', {})
  assert.equal(before.value.today.calls, 2000)
  assert.equal(before.value.models.length, 2)
  assert.equal(f.captured.length, 0)
  assert.equal((await f.call()).value.status, 'ready')
  f.turn('9'); t.mock.timers.tick(1100)
  assert.equal((await f.call('9', 'manual', { ...manualPayload(firstRequest), key: '9' })).value.status, 'ready')
  assert.equal(f.captured.length, 2)
  assert.equal(f.usageRecords.get(usageDay()).calls, 2002)
  for (const key of ['dailyCalls', 'dailyTokens', 'dailyAmount']) assert.equal(key in Config({}), false)
})

test('缓存读取不重复记用量，重启和跨日后继续调用且保留累计统计', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-27T02:00:00Z') })
  const f = await hostFixture(new Map(), modelFixture(), { dailyCalls: 1, inputPrice: 2, outputPrice: 4 })
  f.enable(); await f.call(); await f.call()
  const today = f.usageRecords.get(usageDay())
  assert.equal(today.calls, 1)
  assert.equal(today.inputTokens, 30)
  assert.equal(today.outputTokens, 10)
  assert.equal(today.uncertainCalls, 0)
  assert.equal(today.amountMicros, 100)
  const restarted = await hostFixture(new Map(), modelFixture(), { dailyCalls: 1 }, f.usageRecords)
  restarted.enable()
  assert.equal((await restarted.call()).value.status, 'ready')
  assert.equal(restarted.captured.length, 1)
  t.mock.timers.tick(24 * 3600000)
  restarted.turn('9')
  assert.equal((await restarted.call('9', 'manual', { ...manualPayload(nextRequest), key: '9' })).value.status, 'ready')
  const summary = await restarted.call('8', 'status', {})
  assert.equal(summary.value.today.calls, 1)
  assert.equal(summary.value.total.calls, 3)
})

test('无用量的取消记待核对，已返回用量的截断失败仍按真实用量入账', async () => {
  let started
  const streamStarted = new Promise(done => { started = done })
  const model = modelFixture('stop', signal => new Promise((done, fail) => {
    signal.addEventListener('abort', () => fail(new Error('cancelled')), { once: true }); started()
  }))
  const f = await hostFixture(new Map(), model)
  f.enable()
  const request = f.call()
  await streamStarted
  const pending = (await f.call('8', 'status', {})).value.today
  assert.equal(pending.calls, 1)
  assert.equal(pending.uncertainCalls, 1)
  assert.equal('reservedTokens' in pending, false)
  f.fire('loader/volatile-update', [])
  await request
  assert.deepEqual((await f.call('8', 'status', {})).value.today, pending)
  const failed = await hostFixture(new Map(), modelFixture('max-tokens'))
  failed.enable(); await failed.call()
  const settled = (await failed.call('8', 'status', {})).value.today
  assert.equal(settled.calls, 1)
  assert.equal(settled.inputTokens, 30)
  assert.equal(settled.uncertainCalls, 0)
})

test('用量存储失败不发模型请求；旧金额限制与高价格不阻止预测', async () => {
  const f = await hostFixture()
  f.enable(); f.failUsage()
  await f.call()
  assert.equal(f.captured.length, 0)
  const capped = await hostFixture(new Map(), modelFixture(), { dailyAmount: 0.0001, inputPrice: 100, outputPrice: 100 })
  capped.enable()
  assert.equal((await capped.call()).value.status, 'ready')
  assert.equal(capped.captured.length, 1)
})

test('Esc 后新的手动操作可再次生成，调用次数不会成为每日额度', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 20000 })
  const f = await hostFixture(new Map(), modelFixture(), { dailyCalls: 1 })
  f.enable(); await f.call()
  await f.call('8', 'dismiss')
  t.mock.timers.tick(1100)
  const next = await f.call('8', 'manual', manualPayload(nextRequest))
  assert.equal(next.value.status, 'ready')
  assert.equal((await f.call('8', 'status', {})).value.today.calls, 2)
  assert.equal(f.captured.length, 2)
})

test('只读缓存入口从不准备模型、不写次数；支持历史身份解析并尊重关闭与丢弃', async () => {
  const f = await hostFixture()
  f.enable()
  assert.equal((await f.call('8', 'peek')).value.status, 'skipped')
  assert.equal(f.captured.length, 0)
  assert.equal(f.usageRecords.size, 0)
  await f.call()
  const before = [...f.usageRecords.entries()]
  assert.equal((await f.call('8', 'peek', { sessionId: 'owned-session' })).value.status, 'ready')
  assert.equal((await f.call('7', 'peek')).value.status, 'skipped')
  assert.equal((await f.call('8', 'peek', { sessionId: 'owned-session', key: '8', requestId: firstRequest })).ok, false)
  assert.deepEqual([...f.usageRecords.entries()], before)
  assert.equal(f.captured.length, 1)
  await f.call('8', 'dismiss')
  assert.equal((await f.call('8', 'peek')).value.status, 'skipped')
  const disabled = await hostFixture(new Map([['owned-session', { key: '8', status: 'ready', text: '旧缓存' }]]))
  assert.equal((await disabled.call('8', 'peek')).value.status, 'skipped')
  assert.equal(disabled.captured.length, 0)
})
