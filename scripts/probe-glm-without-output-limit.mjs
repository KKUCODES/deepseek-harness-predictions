import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join, resolve, relative, isAbsolute } from 'node:path'
import { parseArgs } from 'node:util'
import { zstdDecompressSync } from 'node:zlib'
import { parse } from 'yaml'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { parseCredentialsDocument } from '@deepseek-ai/dsh-credentials-local'
import { credentialKey } from '@deepseek-ai/dsh-credentials'
import { attributionHeaders } from '@deepseek-ai/dsh-llm'
import { predictionContext, predictionText, SYSTEM_PROMPT } from '../lib/prediction.js'

// 仅在显式指定数据来源并选择收费请求后读取凭据；不默认访问本机用户目录。
const { values } = parseArgs({ options: { 'run-one-paid-request': { type: 'boolean', default: false },
  'dsh-home': { type: 'string' }, 'session-file': { type: 'string' }, 'session-id': { type: 'string' },
  'turn-key': { type: 'string' }, help: { type: 'boolean', default: false } } })
if (values.help) {
  console.log('Usage: node scripts/probe-glm-without-output-limit.mjs --run-one-paid-request --dsh-home <directory> --session-file <file> --session-id <id> --turn-key <sequence>')
  process.exit(0)
}
assert.ok(values['run-one-paid-request'], '需要明确选择一次真实模型请求')
for (const field of ['dsh-home', 'session-file', 'session-id', 'turn-key']) assert.ok(values[field]?.trim(), `需要显式指定 --${field}`)
assert.match(values['turn-key'], /^[1-9]\d*$/u, '--turn-key 必须是正整数')
const root = resolve(import.meta.dirname, '..')
const home = await realpath(resolve(values['dsh-home']))
const sessionId = values['session-id']
const turnKey = Number(values['turn-key'])
assert.ok(Number.isSafeInteger(turnKey), '--turn-key 超出有效序号范围')
const sessionRoot = await realpath(join(home, 'sessions'))
const sessionPath = await realpath(resolve(values['session-file']))
const sessionRelative = relative(sessionRoot, sessionPath)
assert.ok(sessionRelative && !sessionRelative.startsWith('..') && !isAbsolute(sessionRelative), '会话文件必须位于指定 DSH_HOME 的 sessions 目录内')
const profilePath = join(home, 'profiles/web/cordis.patch.yml')
const profileBefore = await readFile(profilePath)
const entries = parse(profileBefore.toString('utf8'))
const findConfig = entries => {
  for (const entry of entries ?? []) {
    if (entry.id === 'dsh-predictions') return entry.config
    if (Array.isArray(entry.children)) { const found = findConfig(entry.children); if (found) return found }
  }
}
const config = findConfig(entries)
assert.equal(config?.customModel, 'GLM-5.3-Flash')
assert.equal(config.customBaseURL.replace(/\/+$/u, ''), 'https://open.bigmodel.cn/api/coding/paas/v4')
const credentialPath = join(home, '.credentials.yaml')
const credentialsBefore = await readFile(credentialPath)
const credentials = parseCredentialsDocument(credentialsBefore.toString('utf8'), credentialPath)
const record = credentials.records.get(credentialKey('dsh-predictions', config.customCredential))
assert.equal(record?.kind, 'api-key')
const apiKey = record.key
assert.ok(apiKey && !/\s/u.test(apiKey))
const source = await readFile(sessionPath)
const chunks = []
let offset = 0
while (offset < source.length) {
  const frame = zstdDecompressSync(source.subarray(offset), { info: true })
  assert.ok(frame.engine.bytesWritten > 0)
  offset += frame.engine.bytesWritten; chunks.push(frame.buffer)
}
const events = Buffer.concat(chunks).toString('utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(e => e.seq <= turnKey)
assert.ok(events.some(e => e.seq === turnKey && e.type === 'turn/end'))
const session = Session.create(SessionId(sessionId), events)
const context = predictionContext(session.deriveMessages(), { contextMessages: config.contextMessages, contextChars: config.contextChars })
assert.ok(context)
assert.ok(!context.includes(apiKey))
const body = { model: config.customModel, messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: context }], stream: false }
const output = join(root, 'artifacts/glm-no-output-limit', new Date().toISOString().replace(/[:.]/gu, '-'))
await mkdir(output, { recursive: true })
const report = { startedAt: new Date().toISOString(), model: config.customModel,
  endpoint: config.customBaseURL + '/chat/completions', requests: 0, maxTokensParameterPresent: false,
  requestFields: Object.keys(body), inputMessages: JSON.parse(context).length, contextChars: context.length,
  contextSha256: createHash('sha256').update(context).digest('hex'), sourceTurn: String(turnKey),
  timeoutMs: 120000, reasoningOptionsUnchanged: true, pluginVersion: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version }
const started = performance.now()
try {
  report.requests++
  const response = await fetch(report.endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(report.timeoutMs),
    headers: { ...attributionHeaders(), authorization: 'Bearer ' + apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body) })
  report.httpStatus = response.status
  const raw = await response.json()
  if (!response.ok) {
    report.providerCode = typeof raw?.error?.code === 'string' || typeof raw?.error?.code === 'number' ? raw.error.code : null
  } else {
    const choice = raw.choices?.find(choice => choice.index === 0)
    const visible = typeof choice?.message?.content === 'string' ? choice.message.content : ''
    const reasoning = typeof choice?.message?.reasoning_content === 'string' ? choice.message.reasoning_content : ''
    report.finishReason = choice?.finish_reason ?? null
    report.usage = raw.usage
    report.visibleCharacters = Array.from(visible).length
    report.reasoningCharacters = Array.from(reasoning).length
    report.visibleText = visible.replaceAll(apiKey, '[redacted]')
    report.acceptedByPredictionText = predictionText(visible) !== undefined
    report.withinExisting12SecondTimeout = performance.now() - started < 12000
  }
} catch (error) {
  report.failureKind = error?.name ?? 'Error'
} finally {
  report.elapsedMs = Math.round(performance.now() - started)
  report.profileUnchanged = profileBefore.equals(await readFile(profilePath))
  report.credentialsUnchanged = credentialsBefore.equals(await readFile(credentialPath))
  report.finishedAt = new Date().toISOString()
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ report: join(output, 'report.json'), ...report }))
}
