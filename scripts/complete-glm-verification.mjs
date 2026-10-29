import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, readdir, mkdir, writeFile, rm } from 'node:fs/promises'
import { resolve, join, dirname, relative, isAbsolute } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'
import { chromium } from 'playwright'
import { parseCredentialsDocument } from '@deepseek-ai/dsh-credentials-local'

// 付费主流程已完成，仅纠正 source:user 计数并补齐只读用量／卸载验收，不再提供任何模型密钥。
const root = resolve(import.meta.dirname, '..')
const sourceFile = resolve(root, process.argv[2])
const owned = relative(join(root, 'artifacts/undo'), sourceFile)
assert.ok(owned && !owned.startsWith('..') && !isAbsolute(owned))
const paid = JSON.parse(await readFile(sourceFile, 'utf8'))
assert.equal(paid.realGlmPredictions.autoReply.value.status, 'ready')
assert.equal(paid.realGlmPredictions.manualReply.value.status, 'ready')
assert.match(paid.failure, /4 !== 1/u)
assert.ok(paid.failure.includes('bigmodel-prediction-scenarios.mjs:153:10'))
assert.equal(paid.hostStopped, true); assert.equal(paid.testCredentialRemoved, true)
assert.equal(paid.officialFilesUnchanged, true); assert.deepEqual(paid.errors, [])
const output = join(root, 'artifacts/glm-prediction-final', new Date().toISOString().replace(/[:.]/gu, '-'))
await mkdir(output, { recursive: true })
const report = { executionMode: 'paid-flow-plus-readonly-audit', paidEvidence: sourceFile, output, hostVersion: paid.hostVersion,
  archive: paid.archive, realGlmPredictions: structuredClone(paid.realGlmPredictions), errors: [], webVerified: false }
let host, browser, page, log = ''
const home = paid.home
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1' }
for (const field of Object.keys(env)) if (/^(?:DEEPSEEK|OPENAI|ANTHROPIC|DSH_MOBILE_|DSH_PREDICTIONS_GLM_TEST_KEY)/u.test(field)) delete env[field]
const credentialFile = join(home, '.credentials.yaml')
const credentialText = await readFile(credentialFile, 'utf8').catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
if (credentialText) {
  const credentials = parseCredentialsDocument(credentialText, credentialFile)
  assert.equal([...credentials.records.keys()].some(key => key.startsWith('dsh-predictions/')), false)
  assert.equal(credentials.refs.size, 0)
}
async function digest() {
  const files = []
  async function walk(path) {
    for (const e of await readdir(path, { withFileTypes: true })) {
      if (e.isSymbolicLink()) continue
      const file = join(path, e.name)
      if (e.isDirectory()) await walk(file)
      else files.push([relative(root, file), createHash('sha256').update(await readFile(file)).digest('hex')])
    }
  }
  await walk(join(root, 'node_modules/@deepseek-ai'))
  return createHash('sha256').update(JSON.stringify(files.sort(([a], [b]) => a.localeCompare(b)))).digest('hex')
}
async function events(path) {
  const counts = {}
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name)
      if (entry.isDirectory()) await walk(file)
      else if (/\.jsonl(?:\.zstd)?$/u.test(file)) {
        const bytes = await readFile(file)
        const parts = []
        if (file.endsWith('.zstd')) {
          let offset = 0
          while (offset < bytes.length) { const part = zstdDecompressSync(bytes.subarray(offset), { info: true }); offset += part.engine.bytesWritten; parts.push(part.buffer) }
        } else parts.push(bytes)
        for (const line of Buffer.concat(parts).toString('utf8').split('\n').filter(Boolean)) {
          const event = JSON.parse(line)
          counts[event.type] = (counts[event.type] ?? 0) + 1
          if (event.type === 'user/message' && event.data.source?.kind === 'user') counts['human/message'] = (counts['human/message'] ?? 0) + 1
        }
      }
    }
  }
  await walk(join(path, 'sessions')); return counts
}
try {
  report.officialBefore = await digest()
  const before = await events(home)
  const original = await events(JSON.parse(await readFile(paid.cachedReplay.source, 'utf8')).home)
  report.messageDelta = Object.fromEntries(['human/message', 'user/message', 'assistant/message', 'step/start', 'session/title-llm-request'].map(k => [k, (before[k] ?? 0) - (original[k] ?? 0)]))
  assert.equal(report.messageDelta['human/message'], 1)
  assert.equal(report.messageDelta['assistant/message'], 1)
  assert.equal(report.messageDelta['step/start'], 1)
  assert.equal(report.messageDelta['session/title-llm-request'], 0)
  const usageText = await readFile(join(home, 'storages/dsh_predictions_usage.json'), 'utf8')
  const usage = Object.values(JSON.parse(usageText).tables.daily).reduce((a, r) => ({ calls: a.calls + r.calls,
    inputTokens: a.inputTokens + r.inputTokens, outputTokens: a.outputTokens + r.outputTokens, uncertainCalls: a.uncertainCalls + r.uncertainCalls }),
  { calls: 0, inputTokens: 0, outputTokens: 0, uncertainCalls: 0 })
  assert.equal(usage.calls, 2); assert.equal(usage.uncertainCalls, 0)
  for (const key of ['inputTokens', 'outputTokens']) assert.equal(usage[key], report.realGlmPredictions.predictions.reduce((a, p) => a + p.usage[key], 0))
  report.realGlmPredictions.usageDelta = usage
  host = spawn(process.execPath, [join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js'), 'web', '--patch', join(dirname(sourceFile), 'owned-workspace.patch.yml'), '--no-open', '--host', '127.0.0.1', '--port', '0'],
    { cwd: join(dirname(sourceFile), 'workspace'), env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  host.stdout.on('data', b => { log += b }); host.stderr.on('data', b => { log += b })
  let url
  for (let i = 0; i < 180; i++) {
    url = log.match(/http:\/\/127\.0\.0\.1:\d+[^\s\u001b]*/u)?.[0]
    if (url) break
    if (host.exitCode !== null) throw new Error('只读验收 Host 启动失败')
    await new Promise(done => setTimeout(done, 500))
  }
  assert.ok(url); report.origin = new URL(url).origin
  browser = await chromium.launch({ channel: 'msedge', headless: true })
  page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', error => report.errors.push(error.message))
  await page.goto(url)
  await page.getByRole('button', { name: '插件', exact: true }).waitFor()
  const add = page.getByRole('button', { name: '添加 API Key', exact: true })
  await add.waitFor({ state: 'visible', timeout: 10000 }).catch(() => {})
  if (await add.isVisible()) { await add.click(); await page.getByRole('button', { name: '稍后配置', exact: true }).click() }
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.getByText('@kkucodes/dsh-predictions', { exact: true }).first().click()
  const settings = page.locator('[data-dsh-predictions-settings]')
  await settings.getByRole('button', { name: '查看明细', exact: true }).click()
  const dialog = settings.getByRole('dialog', { name: '用量明细', exact: true })
  await dialog.getByText('466', { exact: true }).waitFor()
  await dialog.getByText('229', { exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'glm-real-usage.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '卸载 @kkucodes/dsh-predictions', exact: true }).click()
  await page.getByRole('button', { name: /^(?:确认)?卸载$/u }).click()
  await page.waitForFunction(() => document.querySelector('style[data-dsh-predictions]') === null)
  await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
  await page.locator('[data-composer-input]').waitFor()
  assert.equal(await page.locator('[data-dsh-prediction-active=true]').count(), 0)
  assert.equal(await page.locator('[data-composer-placeholder]').evaluate(n => getComputedStyle(n).visibility), 'visible')
  const after = await events(home)
  for (const field of ['human/message', 'user/message', 'assistant/message', 'step/start']) assert.equal(after[field], before[field])
  assert.equal(await readFile(join(home, 'storages/dsh_predictions_usage.json'), 'utf8'), usageText)
  report.realGlmPredictions.checks.push('actual-prediction-usage-matches-provider-records-in-official-settings',
    'source-user-only-count-confirms-one-intentional-chat-and-no-prediction-auto-send', 'official-ui-uninstall-restores-composer')
  report.realGlmPredictions.verified = true
  report.additionalModelCalls = 0
  report.webVerified = true
  assert.deepEqual(report.errors, [])
} catch (error) {
  report.failure = error.stack ?? String(error); process.exitCode = 1
  if (page) {
    await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
    await writeFile(join(output, 'failure-page.txt'), await page.locator('body').innerText()).catch(() => {})
  }
}
finally {
  await browser?.close()
  if (host && host.exitCode === null && host.signalCode === null) { const exited = new Promise(done => host.once('exit', done)); host.kill('SIGTERM'); await exited }
  report.hostStopped = !host || host.exitCode !== null || host.signalCode !== null
  if (report.hostStopped) { await rm(credentialFile, { force: true }); report.testCredentialRemoved = true }
  if (report.origin) { try { await fetch(report.origin, { signal: AbortSignal.timeout(1000) }); report.listenerStopped = false } catch { report.listenerStopped = true } }
  report.officialAfter = await digest(); report.officialFilesUnchanged = report.officialBefore === report.officialAfter
  if (!report.hostStopped || report.listenerStopped === false || !report.officialFilesUnchanged) process.exitCode = 1
  await writeFile(join(output, 'host.log'), log.replace(/(http:\/\/127\.0\.0\.1:\d+)[^\s\u001b]*/gu, '$1/<login-redacted>'))
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ report: join(output, 'report.json'), webVerified: report.webVerified, failure: report.failure }))
}
