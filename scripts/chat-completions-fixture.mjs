import { createServer } from 'node:http'

/** 仅协议测试使用的本地 HTTP 服务；无厂商 Key，不属于插件运行代码或真实厂商验收。 */
export async function chatCompletionsFixture() {
  const calls = []
  let mode = 'success'
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const rawBody = Buffer.concat(chunks).toString('utf8') || '{}'
    const body = JSON.parse(rawBody)
    const call = { path: request.url, headers: request.headers, body, rawBody, at: Date.now() }
    calls.push(call)
    if (body.stream) {
      // 官方聊天适配器使用 SSE；该分支只服务于隔离的真实聊天回合协议验证。
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
      const chunk = (delta, finish_reason = null) => ({ id: 'local-cycle-fixture', object: 'chat.completion.chunk', created: 1, model: body.model,
        choices: [{ index: 0, delta, finish_reason }] })
      for (const value of [chunk({ role: 'assistant', content: '' }), chunk({ content: '下一步可以实现搜索筛选。' }), chunk({}, 'stop'),
        { id: 'local-cycle-fixture', object: 'chat.completion.chunk', created: 1, model: body.model, choices: [],
          usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 } }]) response.write('data: ' + JSON.stringify(value) + '\n\n')
      response.end('data: [DONE]\n\n'); call.finishedAt = Date.now(); return
    }
    if (mode === 'timeout') {
      await new Promise(done => {
        const timer = setTimeout(done, 15000)
        response.once('close', () => { clearTimeout(timer); done() })
      })
      if (response.destroyed) return
    }
    if (mode === 'slow') await new Promise(done => setTimeout(done, 1500))
    if (mode === 'auth') { response.writeHead(401); response.end('do not echo ' + request.headers.authorization); return }
    if (mode === 'missing-model') { response.writeHead(404); response.end('model missing'); return }
    if (/^bigmodel-\d+$/u.test(mode)) { response.writeHead(429, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: {
      code: mode.slice('bigmodel-'.length), message: 'untrusted echo ' + request.headers.authorization } })); return }
    if (mode === 'redirect') { response.writeHead(307, { location: '/leaked' }); response.end(); return }
    if (mode === 'html') { response.end('<html>proxy error</html>'); return }
    if (mode === 'oversized') { response.end('a'.repeat(1024 * 1024 + 1)); return }
    if (mode === 'responses') { response.end(JSON.stringify({ output: [{ content: [{ text: 'OK' }] }] })); return }
    const text = body.messages?.some(m => m.role === 'system') ? '请继续实现搜索框。' : 'OK'
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ id: 'fixture-only', object: 'chat.completion', model: body.model,
      choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: mode === 'length' ? 'length' : 'stop' }],
      ...(mode === 'no-usage' ? {} : { usage: { prompt_tokens: 30, completion_tokens: 10, total_tokens: 40 } }) }))
  })
  await new Promise(done => server.listen(0, '127.0.0.1', done))
  return { calls, baseURL: 'http://127.0.0.1:' + server.address().port + '/v1',
    mode(next) { mode = next },
    async close() { server.closeAllConnections(); await new Promise(done => server.close(done)) } }
}
