import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

// 编译真实客户端模块，RPC 替身仅用于请求次数／取消单元测试，不接入宿主或认证。
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../src/client/predictions.ts', import.meta.url))],
  bundle: true, write: false, platform: 'node', format: 'esm' })
const { Predictions } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
const settled = () => new Promise(done => setImmediate(done))

test('自动预测在取得完成回合后立即请求，已有触发等待值被忽略且多个输入框只请求一次', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = []
  const service = new Predictions({ async call(channel, endpoint, payload) {
    calls.push({ endpoint, key: payload.key })
    return { ok: true, value: { key: payload.key, status: 'ready', text: '继续' } }
  } })
  const a = service.acquire('session', '8', { automaticEnabled: true, delayMs: 5000 })
  const b = service.acquire('session', '8', { automaticEnabled: true, delayMs: 5000 })
  t.mock.timers.tick(0); await settled()
  assert.deepEqual(calls, [{ endpoint: 'dsh-predictions/predict', key: '8' }])
  a(); b(); service.forget('session')
  const next = service.acquire('session', '9', { automaticEnabled: true, delayMs: 5000 })
  t.mock.timers.tick(0); await settled()
  assert.equal(calls.length, 2)
  assert.equal(service.read('session', '9').status, 'ready')
  t.mock.timers.tick(60000); await settled(); assert.equal(calls.length, 2)
  next(); service.dispose()
})

test('下一回合遇到其他在途请求时等待空闲，完成后只生成一次', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = []
  const service = new Predictions({ async call(channel, endpoint, payload) {
    calls.push({ endpoint, key: payload.key })
    if (payload.key === '9' && calls.filter(call => call.key === '9').length === 1)
      return { ok: true, value: { key: '9', status: 'skipped', retryAfterMs: 8000 } }
    return { ok: true, value: { key: payload.key, status: 'ready', text: '继续下一步' } }
  } })
  const releaseFirst = service.acquire('session', '8')
  t.mock.timers.tick(600); await settled()
  assert.equal(service.read('session', '8').status, 'ready')
  releaseFirst(); service.forget('session')
  const releaseNext = service.acquire('session', '9')
  t.mock.timers.tick(600); await settled()
  assert.equal(calls.length, 2)
  assert.equal(service.indicator('session', '9'), 'waiting')
  service.revalidate(); service.manual('session', '9'); await settled()
  assert.equal(calls.length, 2, '聚焦或双次右箭头不能打断已排定的自动生成')
  t.mock.timers.tick(7999); await settled(); assert.equal(calls.length, 2)
  t.mock.timers.tick(1); await settled()
  assert.equal(calls.length, 3)
  assert.equal(service.read('session', '9').status, 'ready')
  t.mock.timers.tick(60000); await settled(); assert.equal(calls.length, 3)
  releaseNext(); service.dispose()
})

test('自动等待尚未分发时，输入、切换回合、断线和卸载会取消，不发生迟到调用', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  for (const cancel of ['input', 'turn', 'offline', 'dispose']) {
    const calls = []
    let online = true, changed
    const service = new Predictions({ async call(channel, endpoint) {
      calls.push(endpoint)
      return { ok: true, value: { key: '9', status: 'skipped', retryAfterMs: 8000 } }
    } }, { getSnapshot: () => online ? 'connected' : 'disconnected', subscribe(listener) { changed = listener; return () => {} } })
    const release = service.acquire('session', '9')
    t.mock.timers.tick(600); await settled()
    assert.equal(service.indicator('session', '9'), 'waiting')
    if (cancel === 'input') release()
    if (cancel === 'turn') service.forget('session')
    if (cancel === 'offline') { online = false; changed() }
    if (cancel === 'dispose') service.dispose()
    t.mock.timers.tick(60000); await settled()
    assert.equal(calls.length, 1, cancel)
    release(); service.dispose()
  }
})

test('等待期间输入再清空可重新安排，已经分发失败则不自动重发', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = []
  const service = new Predictions({ async call(channel, endpoint, payload) {
    calls.push(endpoint)
    return { ok: true, value: calls.length === 1 ? { key: payload.key, status: 'skipped', retryAfterMs: 8000 }
      : { key: payload.key, status: 'failed', reason: 'timeout' } }
  } })
  const release = service.acquire('session', '9')
  t.mock.timers.tick(600); await settled(); release()
  const releaseEmpty = service.acquire('session', '9')
  t.mock.timers.tick(600); await settled()
  assert.equal(calls.length, 2)
  assert.equal(service.indicator('session', '9'), 'timeout')
  t.mock.timers.tick(60000); await settled(); assert.equal(calls.length, 2)
  releaseEmpty(); service.dispose()
})

test('状态订阅不发请求：自动等待为灰圈，手动立即转圈，在途复用，结果随缓存保留', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = []
  let resolve
  const service = new Predictions({ call(channel, endpoint) {
    calls.push(endpoint); return new Promise(done => { resolve = done })
  } })
  const unsubscribe = service.subscribe(() => service.indicator('session', '8'))
  assert.equal(service.indicator('session', '8'), 'empty')
  const release = service.acquire('session', '8')
  assert.equal(service.indicator('session', '8'), 'empty')
  t.mock.timers.tick(600)
  assert.equal(service.indicator('session', '8'), 'loading')
  service.manual('session', '8')
  assert.deepEqual(calls, ['dsh-predictions/predict'])
  resolve({ ok: true, value: { key: '8', status: 'ready', text: '继续实现' } })
  await settled()
  assert.equal(service.indicator('session', '8'), 'ready')
  release()
  assert.equal(service.indicator('session', '8'), 'ready', '接受或编辑不应清除缓存状态')
  service.dismiss('session', '8')
  assert.equal(service.indicator('session', '8'), 'empty')
  unsubscribe(); service.dispose()
})

test('只读核对不显示生成中；超时、错误与主动取消分开，丢弃和新回合立即清理状态', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  let resolve
  const calls = []
  const service = new Predictions({ call(channel, endpoint) {
    calls.push(endpoint); return new Promise(done => { resolve = done })
  } })
  const release = service.acquire('session', '8', { automaticEnabled: false, delayMs: 600 })
  t.mock.timers.tick(0)
  assert.equal(service.indicator('session', '8'), 'empty')
  resolve({ ok: true, value: { key: '8', status: 'skipped' } }); await settled()
  for (const [reply, expected] of [
    [{ status: 'failed', reason: 'timeout' }, 'timeout'], [{ status: 'failed' }, 'error'],
    [{ status: 'skipped', notice: '服务商权限不可用' }, 'error'], [{ status: 'cancelled' }, 'empty'],
    [{ status: 'empty' }, 'empty'],
  ]) {
    service.manual('session', '8')
    assert.equal(service.indicator('session', '8'), 'loading')
    resolve({ ok: true, value: { key: '8', ...reply } }); await settled()
    assert.equal(service.indicator('session', '8'), expected)
  }
  const before = calls.length
  t.mock.timers.tick(60000); await settled()
  assert.equal(calls.length, before, '状态错误和超时不能安排自动重试')
  service.manual('session', '8')
  release()
  assert.equal(service.indicator('session', '8'), 'empty')
  resolve({ ok: true, value: { key: '8', status: 'ready', text: '迟到' } }); await settled()
  assert.equal(service.indicator('session', '8'), 'empty')
  service.forget('session')
  assert.equal(service.indicator('session', '8'), 'empty')
  service.dispose()
})

test('没有客户端投影时也能手动请求，并按宿主返回的回合复用结果', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = []
  const service = new Predictions({ async call(channel, endpoint, payload) {
    calls.push({ endpoint, payload }); return { ok: true, value: { key: '8', status: 'ready', text: '继续实现' } }
  } })
  const releaseUnknown = service.acquire('session', '')
  t.mock.timers.tick(1000)
  assert.equal(calls.length, 0)
  service.manual('session', '')
  await settled()
  assert.equal(calls[0].endpoint, 'dsh-predictions/manual')
  assert.equal('key' in calls[0].payload, false)
  assert.ok(calls[0].payload.requestId)
  assert.equal(service.read('session', '').key, '8')
  const releaseKnown = service.acquire('session', '8')
  releaseUnknown()
  t.mock.timers.tick(1000)
  assert.equal(service.read('session', '8').text, '继续实现')
  assert.equal(calls.length, 1)
  service.manual('session', '')
  service.manual('session', '8')
  await settled()
  assert.equal(calls.length, 1, '已有预测时不能通过手动入口重新生成')
  assert.equal(service.read('session', '8').text, '继续实现')
  releaseKnown(); service.dispose()
})

test('手动请求取消尚未发送的自动计时，在途双击不重复发请求', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = []
  let resolve
  const service = new Predictions({ call(channel, endpoint, payload, signal) {
    calls.push({ endpoint, signal }); return new Promise(done => { resolve = done })
  } })
  const release = service.acquire('session', '8')
  service.manual('session', '8')
  service.manual('session', '8')
  t.mock.timers.tick(1000)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].endpoint, 'dsh-predictions/manual')
  release()
  assert.equal(calls[0].signal.aborted, true)
  resolve({ ok: true, value: { key: '8', status: 'ready', text: '迟到结果' } })
  await settled()
  assert.equal(service.read('session', '8'), undefined)
  service.dispose()
})

test('新一轮开始清理临时回合别名，不显示上一轮的手动预测', async () => {
  const service = new Predictions({ async call() { return { ok: true, value: { key: '8', status: 'ready', text: '旧建议' } } } })
  const release = service.acquire('session', '')
  service.manual('session', '')
  await settled()
  service.forget('session')
  assert.equal(service.read('session', ''), undefined)
  assert.equal(service.read('session', '8'), undefined)
  release(); service.dispose()
})

test('仅手动模式只读缓存，自动模式立即触发且忽略已有等待参数', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = []
  const service = new Predictions({ async call(channel, endpoint) {
    calls.push(endpoint); return { ok: true, value: { key: '8', status: 'empty' } }
  } })
  const releaseManual = service.acquire('manual', '8', { automaticEnabled: false, delayMs: 1000 })
  t.mock.timers.tick(10000)
  await settled()
  assert.deepEqual(calls, ['dsh-predictions/peek'])
  service.manual('manual', '8'); await settled()
  assert.equal(calls[1], 'dsh-predictions/manual')
  const releaseAuto = service.acquire('auto', '8', { automaticEnabled: true, delayMs: 1500 })
  t.mock.timers.tick(0); await settled()
  assert.equal(calls.length, 3)
  assert.equal(calls[2], 'dsh-predictions/predict')
  releaseManual(); releaseAuto(); service.dispose()
})

test('仅手动模式刷新页面后只读恢复已存建议，首次挂载不调用预测模型', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = []
  const service = new Predictions({ async call(channel, endpoint, payload) {
    calls.push({ endpoint, payload })
    return { ok: true, value: { key: '20', status: 'ready', text: '刷新前已生成的真实建议' } }
  } })
  const release = service.acquire('old-session', '20', { automaticEnabled: false, delayMs: 600 })
  t.mock.timers.tick(10000); await settled()
  assert.deepEqual(calls, [{ endpoint: 'dsh-predictions/peek', payload: { sessionId: 'old-session', key: '20' } }])
  assert.equal(service.read('old-session', '20').text, '刷新前已生成的真实建议')
  release()
  const remount = service.acquire('old-session', '20', { automaticEnabled: false, delayMs: 600 })
  t.mock.timers.tick(10000); await settled()
  assert.equal(calls.length, 1)
  remount(); service.dispose()
})

test('仅手动模式重启后客户端投影尚未恢复时，由只读缓存解析历史回合身份', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = []
  const service = new Predictions({ async call(channel, endpoint, payload) {
    calls.push({ endpoint, payload })
    return { ok: true, value: { key: '20', status: 'ready', text: '重启后继续使用' } }
  } })
  const release = service.acquire('old-session', '', { automaticEnabled: false, delayMs: 600 })
  t.mock.timers.tick(600); await settled()
  assert.deepEqual(calls, [{ endpoint: 'dsh-predictions/peek', payload: { sessionId: 'old-session' } }])
  assert.equal(service.read('old-session', '').text, '重启后继续使用')
  assert.equal(service.read('old-session', '20').text, '重启后继续使用')
  release(); service.dispose()
})

test('在途响应因编辑取消后，重新挂载只读恢复宿主缓存，不重复生成', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = []
  let resolveFirst
  const service = new Predictions({ call(channel, endpoint) {
    calls.push(endpoint)
    return calls.length === 1 ? new Promise(done => { resolveFirst = done })
      : Promise.resolve({ ok: true, value: { key: '8', status: 'ready', text: '宿主已保存' } })
  } })
  const release = service.acquire('session', '8')
  t.mock.timers.tick(600)
  release()
  resolveFirst({ ok: true, value: { key: '8', status: 'ready', text: '迟到结果' } })
  await settled()
  const releaseAgain = service.acquire('session', '8')
  await settled()
  assert.equal(calls[1], 'dsh-predictions/peek')
  assert.equal(service.read('session', '8').text, '宿主已保存')
  releaseAgain(); service.dispose()
})

test('断线隐藏结果并阻止手动生成，重连只读核对缓存', async () => {
  let state = 'connected'
  let changed
  const source = { getSnapshot: () => state, subscribe(listener) { changed = listener; return () => { changed = undefined } } }
  const calls = []
  const service = new Predictions({ async call(channel, endpoint) {
    calls.push(endpoint); return { ok: true, value: { key: '8', status: 'ready', text: '继续' } }
  } }, source)
  const release = service.acquire('session', '8', { automaticEnabled: false, delayMs: 600 })
  service.manual('session', '8'); await settled()
  state = 'disconnected'; changed?.()
  assert.equal(service.read('session', '8'), undefined)
  service.manual('session', '8'); await settled()
  assert.equal(calls.length, 1)
  state = 'connected'; changed?.(); await settled()
  assert.equal(calls[1], 'dsh-predictions/peek')
  assert.equal(service.read('session', '8').text, '继续')
  release(); service.dispose()
  assert.equal(changed, undefined)
})

test('两个真实 BroadcastChannel 只通知失效，由宿主 RPC 核对，不从消息填入文字', async () => {
  const channel = `prediction-unit-${crypto.randomUUID()}`
  let visible = true
  const calls = []
  const rpc = { async call(channel, endpoint) {
    calls.push(endpoint)
    if (endpoint.endsWith('/dismiss')) visible = false
    return { ok: true, value: { key: '8', status: visible ? 'ready' : 'skipped', ...(visible ? { text: '宿主缓存' } : {}) } }
  } }
  const a = new Predictions(rpc, undefined, new BroadcastChannel(channel))
  const b = new Predictions(rpc, undefined, new BroadcastChannel(channel))
  const releaseA = a.acquire('session', '8', { automaticEnabled: false, delayMs: 600 })
  const releaseB = b.acquire('session', '8', { automaticEnabled: false, delayMs: 600 })
  const wait = async check => {
    const end = Date.now() + 1000
    while (!check() && Date.now() < end) await new Promise(done => setTimeout(done, 5))
    assert.ok(check())
  }
  try {
    a.manual('session', '8')
    await wait(() => b.read('session', '8')?.status === 'ready')
    a.dismiss('session', '8')
    await wait(() => b.read('session', '8')?.status === 'skipped')
    assert.equal(calls.filter(endpoint => endpoint.endsWith('/manual')).length, 1)
    assert.ok(calls.some(endpoint => endpoint.endsWith('/peek')))
    assert.equal(b.read('session', '8').text, undefined)
  } finally { releaseA(); releaseB(); a.dispose(); b.dispose() }
})

test('只读核对失败不自动重试，卸载后不采纳迟到结果', async () => {
  const calls = []
  let reply
  const service = new Predictions({ call(channel, endpoint) {
    calls.push(endpoint)
    return new Promise(done => { reply = done })
  } })
  const release = service.acquire('session', '8', { automaticEnabled: false, delayMs: 600 })
  service.revalidate()
  reply({ ok: false, error: { code: 'disconnected', message: 'unit-only', details: {} } })
  await settled(); await settled()
  assert.deepEqual(calls, ['dsh-predictions/peek'])
  service.revalidate()
  service.dispose()
  reply({ ok: true, value: { key: '8', status: 'ready', text: '卸载后的迟到文字' } })
  await settled()
  assert.equal(service.read('session', '8'), undefined)
  release()
})

test('无频道时返回输入框只核对已有灰字，不打断首次自动计时', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const calls = []
  const service = new Predictions({ async call(channel, endpoint) {
    calls.push(endpoint); return { ok: true, value: { key: '8', status: 'ready', text: '已保存建议' } }
  } })
  const release = service.acquire('session', '8')
  service.revalidateCached()
  t.mock.timers.tick(600); await settled()
  assert.deepEqual(calls, ['dsh-predictions/predict'])
  service.revalidateCached(); await settled()
  assert.deepEqual(calls, ['dsh-predictions/predict', 'dsh-predictions/peek'])
  assert.equal(service.read('session', '8').text, '已保存建议')
  release(); service.dispose()
})
