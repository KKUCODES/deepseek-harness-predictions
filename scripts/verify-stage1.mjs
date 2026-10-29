import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { resolve, join, dirname, relative, isAbsolute } from 'node:path'
import { parseArgs } from 'node:util'
import { homedir } from 'node:os'
import { zstdDecompressSync } from 'node:zlib'
import { chromium } from 'playwright'
import { verifyStability } from './stability-scenarios.mjs'
import { verifySettings } from './settings-scenarios.mjs'
import { verifyCustomModels } from './custom-model-scenarios.mjs'
import { verifyBigModelReal } from './bigmodel-real-scenarios.mjs'
import { verifyBigModelPredictions } from './bigmodel-prediction-scenarios.mjs'
import { readGlmKey } from './read-glm-key.mjs'
import { verifyPredictionStatus } from './prediction-status-scenarios.mjs'
import { verifyCustomParameters } from './custom-parameters-scenarios.mjs'
import { verifyGlmLow } from './glm-low-scenario.mjs'
import { chatCompletionsFixture } from './chat-completions-fixture.mjs'
import { verifyAutomaticCycle } from './automatic-cycle-scenarios.mjs'

const root = resolve(import.meta.dirname, '..')
const { values } = parseArgs({ options: { 'sdk-root': { type: 'string' }, 'real-model': { type: 'boolean', default: false },
  'cached-model-from': { type: 'string' }, 'manual-real': { type: 'boolean', default: false }, 'stage3': { type: 'boolean', default: false },
  'stage4': { type: 'boolean', default: false }, 'browser': { type: 'string', default: 'msedge' },
  'no-broadcast': { type: 'boolean', default: false }, 'headed': { type: 'boolean', default: false }, 'bigmodel-real-key-file': { type: 'string' },
  'bigmodel-prediction-key-file': { type: 'string' }, 'prediction-status': { type: 'boolean', default: false }, 'custom-parameters': { type: 'boolean', default: false },
  'glm-low-key-file': { type: 'string' }, 'automatic-cycle': { type: 'boolean', default: false } } })
const realModel = values['real-model']
const cachedModel = values['cached-model-from']
const manualReal = values['manual-real']
const stage3 = values.stage3
const stage4 = values.stage4
const glmPrediction = values['bigmodel-prediction-key-file']
const predictionStatus = values['prediction-status']
const customParameters = values['custom-parameters']
const glmLow = values['glm-low-key-file']
const automaticCycle = values['automatic-cycle']
assert.ok(!automaticCycle || (cachedModel && !glmLow && !predictionStatus && !customParameters && !glmPrediction && !stage3 && !stage4 && !realModel && !manualReal), '连续回合验收只使用本地协议，不混入其他入口')
assert.ok(!glmLow || (cachedModel && !predictionStatus && !customParameters && !glmPrediction && !stage3 && !stage4 && !realModel && !manualReal), 'low 实测仅做一次真实预测，不能混入其他调用入口')
assert.ok(!customParameters || (cachedModel && !predictionStatus && !glmPrediction && !stage3 && !stage4 && !realModel && !manualReal), '参数验收使用隔离宿主和本地协议服务')
assert.ok(!predictionStatus || (cachedModel && !glmPrediction && !stage3 && !stage4 && !realModel && !manualReal), '状态图标使用已有真实会话与本地协议服务，不能混入付费分支')
assert.ok(!glmPrediction || (cachedModel && !stage3 && !stage4 && !realModel && !manualReal), '真实 GLM 主流程使用独立的缓存历史入口')
assert.ok(!values['bigmodel-real-key-file'] || stage3, '真实自定义模型验收必须显式附加到设置验收')
assert.ok(['msedge', 'chrome'].includes(values.browser), '仅验证本机已安装的 Edge 或 Chrome')
assert.ok(!stage4 || (cachedModel && !stage3 && !manualReal && !realModel), '第四阶段仅使用历史缓存，不能同时运行付费测试')
assert.ok(!stage3 || (values['cached-model-from'] && !manualReal && !values['real-model']), '第三阶段免费验收需要已有真实会话，不能同时调用付费模型')
assert.ok(!(realModel && cachedModel), '缓存回放不允许同时发起付费验收')
assert.ok(!manualReal || cachedModel, '手动付费验收需要本项目已有真实会话报告')
const output = resolve(root, cachedModel ? 'artifacts/undo' : realModel ? 'artifacts/stage2' : 'artifacts/stage1', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`)
const home = join(output, 'home')
const workspace = join(output, 'workspace')
await mkdir(workspace, { recursive: true })
let cachedFixture
if (cachedModel) {
  const reportPath = resolve(root, cachedModel)
  const fixtureRoot = dirname(reportPath)
  const inside = relative(join(root, 'artifacts/stage2'), fixtureRoot)
  assert.ok(inside && !inside.startsWith('..') && !isAbsolute(inside), '只读取本项目已完成的真实验收记录')
  const previous = JSON.parse(await readFile(reportPath, 'utf8'))
  assert.equal(previous.realModelVerified, true)
  assert.equal(previous.hostStopped, true)
  const sourceHome = join(fixtureRoot, 'home')
  await cp(join(sourceHome, 'sessions'), join(home, 'sessions'), { recursive: true, errorOnExist: true })
  await mkdir(join(home, 'storages'), { recursive: true })
  await cp(join(sourceHome, 'storages/session_projcache'), join(home, 'storages/session_projcache'), { recursive: true, errorOnExist: true })
  const workspaces = JSON.parse(await readFile(join(sourceHome, 'storages/workspace.json'), 'utf8'))
  for (const record of Object.values(workspaces.tables.workspaces)) {
    const owned = relative(join(fixtureRoot, 'workspace'), record.path)
    assert.ok(!owned.startsWith('..') && !isAbsolute(owned))
  }
  await writeFile(join(home, 'storages/workspace.json'), JSON.stringify(workspaces))
  const cache = JSON.parse(await readFile(join(sourceHome, 'storages/dsh_predictions.json'), 'utf8'))
  const [sessionId, record] = Object.entries(cache.tables.attempts)[0]
  record.status = 'ready'
  record.text = previous.realPrediction.text
  if (!predictionStatus && !customParameters && !glmLow && !automaticCycle) await writeFile(join(home, 'storages/dsh_predictions.json'), JSON.stringify(cache))
  cachedFixture = { sessionId, key: record.key, text: record.text, provider: record.provider, model: record.model, workspaceRoot: join(fixtureRoot, 'workspace') }
}
if (stage3) {
  await mkdir(join(home, 'storages'), { recursive: true })
  const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10)
  // 只在本项目隔离 home 中放入兼容性样本，验证旧高用量和预留字段可被新插件读取。
  await writeFile(join(home, 'storages/dsh_predictions_usage.json'), JSON.stringify({ unit: { name: 'dsh_predictions_usage', version: 1 }, global: null,
    tables: { daily: { [day]: { calls: 2000, inputTokens: 99999999, outputTokens: 999999, uncertainCalls: 2, amountMicros: 99999999,
      unpricedCalls: 2000, reservedTokens: 99999999, reservedMicros: 99999999, officialPriceCalls: 100 } } } }))
}
const overlay = join(output, 'owned-workspace.patch.yml')
const cycleHTTP = automaticCycle ? await chatCompletionsFixture() : undefined
await writeFile(overlay, `- id: workspace-controller\n  config:\n    documentsDirectory: ${JSON.stringify(cachedFixture?.workspaceRoot ?? workspace)}\n${realModel || manualReal ? '- id: session-title-llm\n  disabled: true\n- id: agent-default-model\n  config:\n    provider: deepseek-official\n    model: deepseek-flash\n    reasoningEffort: off\n' : ''}`)
if (glmPrediction) await writeFile(overlay, `- id: workspace-controller
  config:
    documentsDirectory: ${JSON.stringify(workspace)}
- id: session-title-llm
  disabled: true
- id: llm-pi-ai
  config:
    providers:
      predictions-glm-test:
        apiKeyEnv: DSH_PREDICTIONS_GLM_TEST_KEY
        displayName: GLM acceptance
        api: openai-completions
        baseURL: https://open.bigmodel.cn/api/coding/paas/v4
        retryPolicy:
          mode: normal
          maxRetries: 0
        compat:
          supportsDeveloperRole: false
          supportsReasoningEffort: false
          maxTokensField: max_tokens
        models:
          - id: GLM-5.3-Flash
            maxTokens: 1024
- id: agent-default-model
  config:
    provider: predictions-glm-test
    model: GLM-5.3-Flash
`)
const env = { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1',
  npm_config_cache: resolve(root, '.runtime/npm-cache'), npm_config_store_dir: resolve(root, '.runtime/pnpm-store') }
for (const key of Object.keys(env)) if (/^(?:DEEPSEEK|OPENAI|ANTHROPIC|DSH_MOBILE_|DSH_TELEMETRY_OTLP_URL)/.test(key)) delete env[key]
if (cycleHTTP) {
  env.DSH_PREDICTIONS_CYCLE_TEST_KEY = 'local-cycle-protocol-fixture-not-a-real-key'
  await writeFile(overlay, `- id: workspace-controller
  config:
    documentsDirectory: ${JSON.stringify(cachedFixture.workspaceRoot)}
- id: session-title-llm
  disabled: true
- id: llm-pi-ai
  config:
    providers:
      predictions-cycle-test:
        apiKeyEnv: DSH_PREDICTIONS_CYCLE_TEST_KEY
        displayName: Local cycle protocol fixture
        api: openai-completions
        baseURL: ${cycleHTTP.baseURL}
        retryPolicy:
          mode: normal
          maxRetries: 0
        compat:
          supportsDeveloperRole: false
          supportsReasoningEffort: false
          maxTokensField: max_tokens
        models:
          - id: chat-cycle-fixture
            maxTokens: 1024
- id: agent-default-model
  config:
    provider: predictions-cycle-test
    model: chat-cycle-fixture
`)
}
if (glmPrediction) env.DSH_PREDICTIONS_GLM_TEST_KEY = await readGlmKey(glmPrediction)
if (glmLow) env.DSH_PREDICTIONS_GLM_TEST_KEY = await readGlmKey(glmLow)
if (realModel || manualReal) {
  // 只有显式付费分支读取已有认证；免费设置验收不注入模型凭据。
  const { parseCredentialsDocument } = await import('@deepseek-ai/dsh-credentials-local')
  const file = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'), '.credentials.yaml')
  const credentials = parseCredentialsDocument(await readFile(file, 'utf8'), file)
  const key = credentials.refs.get('DEEPSEEK_API_KEY')
  assert.ok(key, '真实模型验收需要已有 DEEPSEEK_API_KEY；不会注入假认证')
  env.DEEPSEEK_API_KEY = key
}
const sdkRoot = values['sdk-root'] ? resolve(root, values['sdk-root']) : root
const cli = resolve(sdkRoot, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
const hostManifest = JSON.parse(await readFile(resolve(sdkRoot, 'node_modules/@deepseek-ai/dsh/package.json'), 'utf8'))
const npm = process.env.npm_execpath ?? resolve(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js')
const report = { startedAt: new Date().toISOString(), hostVersion: hostManifest.version, home, output,
  browser: values.browser, modelCalls: null, webVerified: false, desktopVerified: false, stages: [], errors: [] }
const baselineEvents = await sessionEventCounts()
if (cachedModel) report.cachedReplay = { source: resolve(root, cachedModel), ...cachedFixture }
let host, browser, page, hostLog = ''

async function run(binary, args, cwd = root) {
  const child = spawn(binary, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let text = ''
  child.stdout.on('data', bytes => { text += bytes })
  child.stderr.on('data', bytes => { text += bytes })
  const code = await new Promise((done, fail) => { child.once('close', done); child.once('error', fail) })
  await writeFile(join(output, `command-${report.stages.length}.log`), text)
  assert.equal(code, 0, text.slice(-7000))
  return text
}

async function officialDigest() {
  const base = resolve(sdkRoot, 'node_modules/@deepseek-ai')
  const files = []
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isSymbolicLink()) continue
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) files.push([path.slice(base.length + 1).replaceAll('\\', '/'), createHash('sha256').update(await readFile(path)).digest('hex')])
    }
  }
  await walk(base)
  files.sort(([a], [b]) => a.localeCompare(b))
  return { files: files.length, sha256: createHash('sha256').update(JSON.stringify(files)).digest('hex') }
}

async function sessionEventCounts() {
  const counts = {}
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await walk(path)
      else if (entry.isFile() && /\.jsonl(?:\.zstd)?$/u.test(entry.name)) {
        const bytes = await readFile(path)
        let text
        if (entry.name.endsWith('.zstd')) {
          const chunks = []
          let offset = 0
          // 官方日志包含多帧；Node 的同步解压每次只读取一帧，必须完整遍历。
          while (offset < bytes.length) {
            const decoded = zstdDecompressSync(bytes.subarray(offset), { info: true })
            const used = decoded.engine.bytesWritten
            assert.ok(Number.isInteger(used) && used > 0 && used <= bytes.length - offset)
            chunks.push(decoded.buffer)
            offset += used
          }
          text = Buffer.concat(chunks).toString('utf8')
        } else text = bytes.toString('utf8')
        for (const line of text.split('\n').filter(Boolean)) {
          const event = JSON.parse(line)
          if (typeof event.type === 'string') counts[event.type] = (counts[event.type] ?? 0) + 1
          if (event.type === 'user/message' && event.data.source?.kind === 'user') counts['human/message'] = (counts['human/message'] ?? 0) + 1
        }
      }
    }
  }
  await walk(join(home, 'sessions'))
  return counts
}

async function predictionRecords() {
  const document = JSON.parse(await readFile(join(home, 'storages/dsh_predictions.json'), 'utf8'))
  return Object.values(document.tables.attempts)
}

try {
  report.officialBefore = await officialDigest()
  console.log(JSON.stringify({ stage: 'pack-and-install', output }))
  const text = await run(process.execPath, [npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', output])
  const packed = JSON.parse(text.slice(text.indexOf('[')))
  const archive = join(output, packed[0].filename)
  report.archive = archive
  report.stages.push('packed-independent-plugin')
  await run(process.execPath, [cli, 'plugin', '--profile', 'web', 'add', archive], workspace)
  report.stages.push('installed-through-official-cli')
  console.log(JSON.stringify({ stage: 'start-official-web' }))
  host = spawn(process.execPath, [cli, 'web', '--patch', overlay, '--no-open', '--host', '127.0.0.1', '--port', '0'],
    { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  host.stdout.on('data', bytes => { hostLog += bytes })
  host.stderr.on('data', bytes => { hostLog += bytes })
  let launchUrl
  for (let attempt = 0; attempt < 180; attempt++) {
    const match = hostLog.match(/http:\/\/127\.0\.0\.1:\d+[^\s\u001b]*/)
    if (match) { launchUrl = match[0]; break }
    if (host.exitCode !== null) break
    await new Promise(done => setTimeout(done, 500))
  }
  await writeFile(join(output, 'host.log'), hostLog.replace(/(http:\/\/127\.0\.0\.1:\d+)[^\s\u001b]*/g, '$1/<login-redacted>'))
  assert.ok(launchUrl, 'Official Host did not become ready; inspect the redacted host.log')
  report.origin = new URL(launchUrl).origin
  const unauthenticated = await fetch(`${report.origin}/api/dsh-predictions/predict`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'unauthenticated-test',
      method: 'dsh-predictions/predict', payload: { sessionId: 'missing', key: '1' } }) })
  assert.ok([401, 403].includes(unauthenticated.status), '预测入口必须沿用宿主认证')
  report.stages.push('unauthenticated-prediction-is-refused')
  const unauthStatus = await fetch(`${report.origin}/api/dsh-predictions/status`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'anonymous-stats', method: 'dsh-predictions/status', payload: {} }) })
  assert.ok([401, 403].includes(unauthStatus.status), '统计入口必须沿用宿主认证')
  report.stages.push('unauthenticated-usage-is-refused')
  const unauthPeek = await fetch(`${report.origin}/api/dsh-predictions/peek`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'anonymous-cache', method: 'dsh-predictions/peek', payload: { sessionId: 'probe', key: '1' } }) })
  assert.ok([401, 403].includes(unauthPeek.status), '缓存入口必须沿用宿主认证')
  report.stages.push('unauthenticated-cache-is-refused')
  report.stages.push('official-web-ready')
  report.headed = values.headed
  browser = await chromium.launch({ channel: values.browser, headless: !values.headed })
  const browserContext = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  browserContext.setDefaultTimeout(20000)
  if (values['no-broadcast']) await browserContext.addInitScript(() => {
    Object.defineProperty(globalThis, 'BroadcastChannel', { value: undefined, configurable: true })
  })
  report.broadcastChannel = values['no-broadcast'] ? 'disabled-for-capability-test' : 'native'
  page = await browserContext.newPage()
  page.on('response', async response => {
    const endpoint = new URL(response.url()).pathname.match(/^\/api\/dsh-predictions\/(predict|manual|peek)$/u)?.[1]
    if (!endpoint) return
    try {
      const result = (await response.json()).result
      const value = result?.value
      const trace = report.predictionRpc ??= []
      trace.push({ endpoint, ok: result?.ok, key: value?.key, status: value?.status,
        retryAfterMs: value?.retryAfterMs, code: result?.error?.code, notice: value?.notice })
    } catch {}
  })
  page.on('pageerror', error => { report.errors.push(error.message) })
  page.on('console', message => { if (message.type() === 'error') (report.consoleErrors ??= []).push(message.text()) })
  await page.goto(launchUrl)
  await page.waitForTimeout(3000)
  await page.screenshot({ path: join(output, '01-initial.png'), fullPage: true })
  await writeFile(join(output, 'initial-page.txt'), await page.locator('body').innerText())
  console.log(JSON.stringify({ stage: 'web-loaded', body: (await page.locator('body').innerText()).slice(0, 5000) }))
  const welcome = page.getByRole('button', { name: '继续', exact: true })
  if (await welcome.isVisible()) {
    await welcome.click()
    await page.getByText('预览版说明', { exact: true }).waitFor({ state: 'hidden' })
  }
  console.log(JSON.stringify({ stage: 'after-welcome', body: (await page.locator('body').innerText()).slice(-6000) }))
  await page.screenshot({ path: join(output, '01-after-welcome.png'), fullPage: true })
  // 沿官方引导选择稍后配置，不填写密钥、不伪造账号或模型服务。
  if (!realModel && !manualReal && !glmPrediction && !automaticCycle) {
    await page.getByRole('button', { name: '添加 API Key', exact: true }).click()
    await page.getByRole('button', { name: '稍后配置', exact: true }).click()
  }
  let releaseInitialStatus
  const initialStatusGate = new Promise(done => { releaseInitialStatus = done })
  const holdInitialStatus = async route => { await initialStatusGate; await route.continue() }
  if (!cachedModel) await page.route('**/api/dsh-predictions/status', holdInitialStatus)
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.getByText('@kkucodes/dsh-predictions', { exact: true }).first().click()
  const settings = page.locator('[data-dsh-predictions-settings]')
  await settings.waitFor({ state: 'visible' })
  if (!cachedModel) {
    await settings.locator('.dshp-skeleton-bar').first().waitFor({ state: 'visible' })
    await settings.screenshot({ path: join(output, 'settings-first-loading.png') })
    const loaded = page.waitForResponse(response => response.url().endsWith('/api/dsh-predictions/status'))
    releaseInitialStatus()
    await loaded
    await page.unroute('**/api/dsh-predictions/status', holdInitialStatus)
    await settings.getByRole('button', { name: '查看明细', exact: true }).click()
    const emptyUsage = settings.getByRole('dialog', { name: '用量明细', exact: true })
    await emptyUsage.getByText('今天还没有预测', { exact: true }).waitFor()
    await emptyUsage.screenshot({ path: join(output, 'settings-empty-usage.png') })
    await page.keyboard.press('Escape')
    report.stages.push('first-loading-and-real-empty-usage-state')
  }
  const openMore = async () => { const b = settings.getByRole('button', { name: '更多设置', exact: true }); if (await b.isVisible()) await b.click() }
  const openMain = async () => { const b = settings.getByRole('button', { name: '返回', exact: true }); if (await b.isVisible()) await b.click() }
  const checkbox = settings.getByRole('checkbox', { name: '效果测试' })
  const realCheckbox = settings.getByRole('checkbox', { name: '启用预测消息', exact: true })
  const editor = page.locator('[data-composer-input]').first()
  const ghost = page.locator('[data-dsh-prediction-active=true]')
  assert.equal(await realCheckbox.isChecked(), false)
  assert.match(await realCheckbox.evaluate(input => input.closest('.dshp-enable')?.querySelector('p')?.textContent ?? ''), /由你的模型服务商计费/u)
  assert.equal(await settings.getByText('开启真实预测（会产生模型费用）', { exact: true }).count(), 0)
  assert.equal(await settings.getByRole('checkbox').count(), 1, '主页面仅显示启用开关，免费测试位于更多设置')
  assert.equal(await settings.getByText('允许刷新预测', { exact: false }).count(), 0)
  // 缓存回放只测撤销链路，避免先前合成输入法／插件重载状态影响这一独立场景。
  if (!cachedModel) {
  await openMore()
  await checkbox.click()
  await page.waitForFunction(() => document.querySelector('[data-dsh-predictions-settings] [aria-label="效果测试"]')?.checked === true)
  await page.screenshot({ path: join(output, '02-settings.png'), fullPage: true })
  report.stages.push('settings-page-and-toggle')
  console.log(JSON.stringify({ stage: 'settings-enabled', body: (await page.locator('body').innerText()).slice(-5000) }))
  await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
  await editor.waitFor({ state: 'visible' })
  await ghost.waitFor({ state: 'visible' })
  await page.screenshot({ path: join(output, '03-grey-preview.png'), fullPage: true })
  report.stages.push('inline-grey-preview')
  const suggestion = await ghost.innerText()
  await editor.click()
  await editor.press('Tab')
  await page.waitForFunction(text => document.querySelector('[data-composer-input]')?.textContent === text, suggestion)
  assert.equal(await ghost.count(), 0)
  assert.equal(await editor.innerText(), suggestion)
  report.stages.push('tab-accepts-without-send')
  await page.screenshot({ path: join(output, '04-tab-accepted.png'), fullPage: true })
  await editor.press('Control+Z')
  await ghost.waitFor({ state: 'visible' })
  assert.equal((await editor.innerText()).trim(), '')
  report.stages.push('one-step-undo')
  await editor.press('ArrowRight')
  await page.waitForFunction(text => document.querySelector('[data-composer-input]')?.textContent === text, suggestion)
  report.stages.push('right-arrow-accepts')
  await editor.press('Control+Z')
  await ghost.waitFor({ state: 'visible' })
  await editor.press('Escape')
  await page.waitForFunction(() => document.querySelector('[data-dsh-prediction-active=true]') === null)
  assert.equal((await editor.innerText()).trim(), '')
  report.stages.push('escape-dismisses')
  await editor.focus()
  await page.keyboard.insertText('我自己输入的文字')
  await page.waitForFunction(() => document.querySelector('[data-dsh-prediction-active=true]') === null)
  assert.equal(await editor.innerText(), '我自己输入的文字')
  await editor.press('Control+A')
  await editor.press('Backspace')
  await ghost.waitFor({ state: 'visible' })
  report.stages.push('typing-preserves-user-draft')

  await editor.press('Enter')
  assert.equal((await editor.innerText()).trim(), '')
  await ghost.waitFor({ state: 'visible' })
  await editor.press('Shift+Tab')
  assert.equal((await editor.innerText()).trim(), '')
  report.stages.push('enter-and-shift-tab-do-not-accept')

  const alignment = await page.evaluate(() => {
    const input = document.querySelector('[data-composer-input]')
    const hint = document.querySelector('[data-dsh-prediction-active=true]')
    const card = input?.closest('[data-composer-card]')
    const style = input && getComputedStyle(input)
    const a = input?.getBoundingClientRect(), b = hint?.getBoundingClientRect(), c = card?.getBoundingClientRect()
    return a && b && c && style ? { dx: b.x - a.x - parseFloat(style.paddingLeft), dy: b.y - a.y - parseFloat(style.paddingTop),
      inside: b.left >= c.left && b.right <= c.right + 1 && b.top >= c.top && b.bottom <= c.bottom + 1,
      placeholder: getComputedStyle(document.querySelector('[data-composer-placeholder]')).visibility } : null
  })
  assert.ok(alignment && Math.abs(alignment.dx) <= 1 && Math.abs(alignment.dy) <= 1 && alignment.inside)
  assert.equal(alignment.placeholder, 'hidden')
  report.alignment = alignment
  await page.setViewportSize({ width: 760, height: 780 })
  await page.screenshot({ path: join(output, '05-narrow.png'), fullPage: true })
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForTimeout(250)
  await page.screenshot({ path: join(output, '06-dark.png'), fullPage: true })
  report.stages.push('alignment-and-responsive-screenshots')

  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.getByText('@kkucodes/dsh-predictions', { exact: true }).first().click()
  await settings.waitFor({ state: 'visible' })
  const savedText = '［接入测试］这是一条保存后的测试文字。'
  await openMore()
  await settings.getByRole('textbox', { name: '测试句' }).fill(savedText)
  await settings.getByRole('button', { name: '保存测试句' }).click()
    await page.waitForFunction(() => [...document.querySelectorAll('[data-dsh-predictions-settings] button')].find(b => b.textContent === '保存测试句')?.disabled === true)
  await page.reload()
  // 账号引导的“稍后配置”只对当前页面有效，重载后沿同一官方路径退出。
  const addKey = page.getByRole('button', { name: '添加 API Key', exact: true })
  if (!realModel) {
    await addKey.waitFor({ state: 'visible' })
    await addKey.click()
    await page.getByRole('button', { name: '稍后配置', exact: true }).click()
  }
  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.getByText('@kkucodes/dsh-predictions', { exact: true }).first().click()
  await settings.waitFor({ state: 'visible' })
  await openMore()
  await page.waitForFunction(value => document.querySelector('[data-dsh-predictions-settings] input[type=text]')?.value === value, savedText)
  assert.equal(await checkbox.isChecked(), true)
  report.stages.push('test-text-and-switch-persist-after-reload')

  await openMore()
  await checkbox.click()
  await page.waitForFunction(() => document.querySelector('[data-dsh-predictions-settings] [aria-label="效果测试"]')?.checked === false)
  await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
  await editor.waitFor({ state: 'visible' })
  assert.equal(await ghost.count(), 0)
  assert.equal(await page.locator('[data-composer-placeholder]').evaluate(element => getComputedStyle(element).visibility), 'visible')
  await editor.focus()
  await editor.press('ArrowRight')
  assert.equal((await editor.innerText()).trim(), '')
  report.stages.push('feature-off-restores-placeholder-and-keys')

  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.getByText('@kkucodes/dsh-predictions', { exact: true }).first().click()
  await openMore()
  await checkbox.click()
  await page.waitForFunction(() => document.querySelector('[data-dsh-predictions-settings] [aria-label="效果测试"]')?.checked === true)
  const pluginSwitch = page.getByRole('switch', { name: '启用 @kkucodes/dsh-predictions', exact: true })
  await pluginSwitch.click()
  await settings.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.querySelector('style[data-dsh-predictions]') === null)
  await page.waitForFunction(() => document.querySelector('[role=switch][aria-label="启用 @kkucodes/dsh-predictions"]')?.getAttribute('aria-checked') === 'false')
  report.stages.push('plugin-disable-removes-client-contributions')
  await pluginSwitch.click()
  await settings.waitFor({ state: 'visible' })
  assert.equal(await page.locator('style[data-dsh-predictions]').count(), 1)
  await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
  await ghost.waitFor({ state: 'visible' })
  assert.equal(await ghost.innerText(), savedText)
  assert.equal(await ghost.count(), 1)
  report.stages.push('plugin-reenable-without-duplicate-preview')

  // /goal 无参数只读取本地状态：用官方命令形成真实历史，不调用模型，也不建立目标。
  await editor.focus()
  await page.keyboard.insertText('/goal')
  await editor.press('Escape')
  await editor.press('Enter')
  await page.getByText('No goal is currently set.', { exact: false }).waitFor()
  await ghost.waitFor({ state: 'visible' })
  await page.waitForFunction(() => document.querySelector('[data-composer-card]')?.getBoundingClientRect().top > innerHeight * 0.6)
  await page.waitForTimeout(150)
  await editor.focus()
  await editor.press('Tab')
  await page.waitForFunction(text => document.querySelector('[data-composer-input]')?.textContent === text, savedText)
  await page.screenshot({ path: join(output, '07-history-composer.png'), fullPage: true })
  await page.waitForTimeout(150)
  await editor.press('Control+Z')
  await page.waitForTimeout(150)
  report.historyUndoVerified = (await editor.innerText()).trim() === ''
  if (!report.historyUndoVerified) {
    report.limitations = ['刚执行本地命令后，宿主 Ctrl+Z 未撤销首次填入；未修改宿主历史实现。']
    await editor.press('Control+A')
    await editor.press('Backspace')
  }
  await ghost.waitFor({ state: 'visible' })
  report.stages.push('history-bottom-composer-accepts-without-model')

  await editor.focus()
  await editor.dispatchEvent('compositionstart', { data: '测' })
  await editor.press('ArrowRight')
  assert.equal((await editor.innerText()).replaceAll('\u200b', '').trim(), '')
  await editor.dispatchEvent('compositionend', { data: '' })
  report.stages.push('synthetic-composition-does-not-accept')

  if (realModel) {
    await page.getByRole('button', { name: '插件', exact: true }).click()
    await page.getByText('@kkucodes/dsh-predictions', { exact: true }).first().click()
    await openMain()
    await realCheckbox.click()
    await page.waitForFunction(() => document.querySelector('[data-dsh-predictions-settings] [aria-label="启用预测消息"]')?.checked === true)
    assert.equal(await checkbox.isChecked(), false)
    await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
    await editor.waitFor({ state: 'visible' })
    await page.waitForTimeout(1000)
    assert.equal(await ghost.count(), 0, '空会话不能凭空调用预测模型')
    await editor.focus()
    await page.keyboard.insertText('我想给待办清单加一个搜索框。请用一句话告诉我下一步可以做什么，不读取文件，不调用工具。')
    await editor.press('Enter')
    await ghost.waitFor({ state: 'visible', timeout: 90000 })
    const predicted = await ghost.innerText()
    assert.ok(predicted && !predicted.includes('［接入测试］'))
    report.realPrediction = { model: 'deepseek-official/deepseek-flash', text: predicted }
    report.stages.push('real-model-reply-triggers-real-prediction')
    await page.screenshot({ path: join(output, '08-real-prediction.png'), fullPage: true })
    const before = await sessionEventCounts()
    const records = await predictionRecords()
    assert.equal(records.length, 1)
    assert.equal(records[0].status, 'ready')
    report.predictionUsage = records[0].usage
    // 在尚未关闭的同一服务上刷新：读取同轮缓存，不再次生成。
    await page.reload()
    await ghost.waitFor({ state: 'visible', timeout: 30000 })
    assert.equal(await ghost.innerText(), predicted)
    assert.deepEqual(await predictionRecords(), records)
    await editor.focus()
    await editor.press('Tab')
    await page.waitForFunction(text => document.querySelector('[data-composer-input]')?.textContent === text, predicted)
    assert.equal(await ghost.count(), 0)
    const after = await sessionEventCounts()
    assert.equal((await predictionRecords()).length, 1)
    assert.equal(after['user/message'], before['user/message'])
    assert.equal(after['assistant/message'], before['assistant/message'])
    report.stages.push('real-prediction-refresh-dedup-and-tab-without-send')
    report.realModelVerified = true
  }
  }

  if (cachedModel && !predictionStatus && !customParameters && !glmLow && !automaticCycle) {
    const editor = page.locator('[data-composer-input]:visible').last()
    await page.getByRole('button', { name: '插件', exact: true }).click()
    await page.getByText('@kkucodes/dsh-predictions', { exact: true }).first().click()
    await openMain()
    await realCheckbox.click()
    await page.waitForFunction(() => document.querySelector('[data-dsh-predictions-settings] [aria-label="启用预测消息"]')?.checked === true)
    await page.locator(`[data-row-key="session:${cachedFixture.sessionId}"]`).click()
    await ghost.waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await ghost.innerText(), cachedFixture.text)
    if (stage4) {
      await verifyStability({ page, browserContext, report, output, fixture: cachedFixture,
        records: predictionRecords, events: sessionEventCounts,
        async stopHost() {
          const exited = new Promise(done => host.once('exit', done))
          host.kill('SIGTERM')
          let timer
          try { await Promise.race([exited, new Promise((done, fail) => { timer = setTimeout(() => fail(new Error('Owned Host did not exit')), 5000) })]) }
          finally { clearTimeout(timer) }
        },
        async startHost() {
          host = spawn(process.execPath, [cli, 'web', '--patch', overlay, '--no-open', '--host', '127.0.0.1', '--port', new URL(report.origin).port],
            { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
          host.stdout.on('data', bytes => { hostLog += bytes })
          host.stderr.on('data', bytes => { hostLog += bytes })
          for (let attempt = 0; attempt < 120; attempt++) {
            if (host.exitCode !== null) throw new Error('Owned Host restart failed')
            try {
              const response = await fetch(report.origin, { signal: AbortSignal.timeout(1000) })
              report.restartHealthStatus = response.status
              // 未认证健康探测也可能得到 401／403；只确认监听恢复，不绕过浏览器授权。
              if (response.status < 500) return
            } catch {}
            await new Promise(done => setTimeout(done, 250))
          }
          throw new Error('Owned Host restart timed out')
        } })
    } else {
    const before = await sessionEventCounts()
    const records = await predictionRecords()
    const predictionRequests = []
    page.on('request', request => {
      if (request.url().includes('/api/dsh-predictions/')) predictionRequests.push(request.url())
    })
    await editor.click()
    await page.waitForTimeout(150)
    await editor.press('Tab')
    await page.waitForFunction(text => [...document.querySelectorAll('[data-composer-input]')]
      .some(element => element.getClientRects().length > 0 && element.textContent === text), cachedFixture.text)
    await editor.press('Control+Z')
    await page.waitForFunction(() => [...document.querySelectorAll('[data-composer-input]')]
      .some(element => element.getClientRects().length > 0 && (element.textContent ?? '').trim() === ''), undefined, { timeout: 3000 })
    await ghost.waitFor({ state: 'visible', timeout: 3000 })
    assert.equal(await ghost.innerText(), cachedFixture.text)
    report.stages.push('tab-undo-restores-same-real-cached-prediction')
    // 单次右箭头尚未确认时开始打字，不应在 300ms 后覆盖新草稿。
    await editor.press('ArrowRight')
    await page.keyboard.insertText('我先自己想想')
    await page.waitForTimeout(350)
    assert.equal(await editor.innerText(), '我先自己想想')
    assert.equal(await ghost.count(), 0)
    await editor.press('ArrowRight')
    await editor.press('ArrowRight')
    await page.waitForTimeout(350)
    assert.equal(await editor.innerText(), '我先自己想想')
    await editor.press('Control+A')
    await editor.press('Backspace')
    await ghost.waitFor({ state: 'visible' })
    assert.equal(await ghost.innerText(), cachedFixture.text)
    await editor.press('ArrowRight')
    await page.waitForFunction(text => [...document.querySelectorAll('[data-composer-input]')]
      .some(element => element.getClientRects().length > 0 && element.textContent === text), cachedFixture.text)
    await editor.press('Control+Z')
    await ghost.waitFor({ state: 'visible' })
    await editor.press('ArrowRight')
    await editor.press('ArrowRight')
    await page.waitForTimeout(350)
    assert.equal((await editor.innerText()).trim(), '')
    assert.equal(await ghost.innerText(), cachedFixture.text)
    report.stages.push('double-arrow-with-draft-or-existing-prediction-does-not-request')
    await page.screenshot({ path: join(output, '09-undo-restores-prediction.png'), fullPage: true })
    assert.deepEqual(await predictionRecords(), records)
    assert.equal(predictionRequests.filter(url => !url.endsWith('/peek')).length, 0, '撤销和清空只允许复用或核对缓存，不能发送新预测请求')
    report.stages.push('typing-clearing-and-right-arrow-reuse-cached-prediction')
    await page.reload()
    await page.waitForFunction(() => document.querySelector('[data-dsh-prediction-active=true]') !== null
      || [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === '添加 API Key'))
    const addKey = page.getByRole('button', { name: '添加 API Key', exact: true })
    if (await addKey.isVisible()) {
      await addKey.click()
      await page.getByRole('button', { name: '稍后配置', exact: true }).click()
    }
    await ghost.waitFor({ state: 'visible' })
    assert.equal(await ghost.innerText(), cachedFixture.text)
    await editor.focus()
    await editor.press('Escape')
    await page.waitForFunction(() => document.querySelector('[data-dsh-prediction-active=true]') === null)
    await page.waitForTimeout(300)
    assert.equal((await predictionRecords())[0].status, 'skipped')
    const after = await sessionEventCounts()
    for (const type of ['user/message', 'assistant/message', 'step/start', 'request/header', 'session/title-llm-request']) {
      assert.equal(after[type] ?? 0, before[type] ?? 0, `缓存恢复不应新增 ${type}`)
    }
    report.stages.push('reload-reuses-cache-and-escape-still-dismisses')
    report.undoCacheVerified = true

    if (manualReal) {
      // 仅显式付费验收使用原会话模型生成一次，不设置每日调用限制。
      await page.getByRole('button', { name: '插件', exact: true }).click()
      await page.getByText('@kkucodes/dsh-predictions', { exact: true }).first().click()
      await settings.getByRole('combobox', { name: '预测模型', exact: true }).waitFor()
      await settings.getByRole('combobox', { name: '预测模型', exact: true }).selectOption(JSON.stringify([cachedFixture.provider, cachedFixture.model]))
      await settings.getByRole('button', { name: '保存更改', exact: true }).click()
      await page.waitForFunction(() => [...document.querySelectorAll('[data-dsh-predictions-settings] button')].find(b => b.textContent === '保存更改')?.disabled === true)
      await page.locator(`[data-row-key="session:${cachedFixture.sessionId}"]`).click()
      await editor.click()
      const doubleRight = async () => { await editor.press('ArrowRight'); await editor.press('ArrowRight') }
      const requests = predictionRequests.filter(url => url.endsWith('/manual')).length
      await doubleRight()
      await ghost.waitFor({ state: 'visible', timeout: 30000 })
      const first = (await predictionRecords())[0]
      assert.equal(first.status, 'ready')
      assert.ok(first.requestId)
      assert.equal(predictionRequests.filter(url => url.endsWith('/manual')).length, requests + 1)
      assert.equal((await editor.innerText()).trim(), '')
      report.firstManualUsage = first.usage
      const usageRows = JSON.parse(await readFile(join(home, 'storages/dsh_predictions_usage.json'), 'utf8')).tables.daily
      const today = Object.values(usageRows)[0]
      assert.equal(today.calls, 1)
      assert.equal(today.inputTokens, first.usage.inputTokens)
      assert.equal(today.outputTokens, first.usage.outputTokens)
      assert.equal(today.uncertainCalls, 0)
      assert.equal(today.unpricedCalls, 1)
      report.realUsageLedger = today
      report.stages.push('historical-chat-double-arrow-manually-generates-real-prediction')

      await doubleRight()
      await page.waitForTimeout(350)
      assert.equal((await editor.innerText()).trim(), '')
      assert.equal(predictionRequests.filter(url => url.endsWith('/manual')).length, requests + 1)
      await page.keyboard.insertText('不能覆盖这个草稿')
      await doubleRight()
      await page.waitForTimeout(350)
      assert.equal(await editor.innerText(), '不能覆盖这个草稿')
      assert.equal(predictionRequests.filter(url => url.endsWith('/manual')).length, requests + 1)
      await editor.press('Control+A'); await editor.press('Backspace')
      await ghost.waitFor({ state: 'visible' })

      await page.reload()
      await page.locator(`[data-row-key="session:${cachedFixture.sessionId}"]`).click()
      await ghost.waitFor({ state: 'visible' })
      await editor.click()
      await doubleRight()
      await page.waitForTimeout(350)
      const second = (await predictionRecords())[0]
      assert.equal(second.status, 'ready')
      assert.equal(second.requestId, first.requestId)
      assert.equal(predictionRequests.filter(url => url.endsWith('/manual')).length, requests + 1)
      assert.equal((await editor.innerText()).trim(), '')
      const counts = await sessionEventCounts()
      assert.equal(counts['user/message'], before['user/message'])
      assert.equal(counts['assistant/message'], before['assistant/message'])
      report.manualGenerations = 1
      report.manualModelVerified = true
      report.stages.push('reload-and-double-arrow-keep-existing-prediction-without-new-request')
      await page.screenshot({ path: join(output, '10-manual-prediction.png'), fullPage: true })
      await editor.press('Escape')
      await page.waitForTimeout(300)
      report.stages.push('real-usage-settled-without-daily-limits')
      await page.getByRole('button', { name: '插件', exact: true }).click()
      await page.getByText('@kkucodes/dsh-predictions', { exact: true }).first().click()
      await settings.getByRole('combobox', { name: '预测模型', exact: true }).waitFor()
      await settings.getByRole('button', { name: '查看明细', exact: true }).click()
      await page.screenshot({ path: join(output, '14-real-usage-statistics.png'), fullPage: true })
    }
    }
  }

  if (predictionStatus) await verifyPredictionStatus({ page, report, output, fixture: cachedFixture })
  if (customParameters) await verifyCustomParameters({ page, report, output, fixture: cachedFixture })
  if (automaticCycle) await verifyAutomaticCycle({ page, report, output, server: cycleHTTP, events: sessionEventCounts })
  if (glmLow) await verifyGlmLow({ page, report, output, fixture: cachedFixture, keyFile: glmLow, records: predictionRecords, events: sessionEventCounts })

  if (stage3) {
    await verifySettings({ page, browserContext, report, output })
    await verifyCustomModels({ page, browserContext, report, output, fixture: cachedFixture })
    if (values['bigmodel-real-key-file']) await verifyBigModelReal({ page, report, output, keyFile: values['bigmodel-real-key-file'] })
  }

  if (glmPrediction) await verifyBigModelPredictions({ page, browserContext, report, output,
    keyFile: glmPrediction, fixture: cachedFixture, records: predictionRecords, events: sessionEventCounts,
    async restartHost() {
      const exited = new Promise(done => host.once('exit', done))
      host.kill('SIGTERM')
      await exited
      host = spawn(process.execPath, [cli, 'web', '--patch', overlay, '--no-open', '--host', '127.0.0.1', '--port', new URL(report.origin).port],
        { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
      host.stdout.on('data', bytes => { hostLog += bytes })
      host.stderr.on('data', bytes => { hostLog += bytes })
      for (let attempt = 0; attempt < 120; attempt++) {
        if (host.exitCode !== null) throw new Error('Owned GLM Host restart failed')
        try {
          const health = await fetch(report.origin, { signal: AbortSignal.timeout(1000) })
          // 监听恢复不等于前端已挂载；启动过渡期的 404 不能视为可刷新页面。
          report.glmRestartHealth = { status: health.status, type: health.headers.get('content-type') }
          if ((health.status === 200 && health.headers.get('content-type')?.includes('text/html')) || [401, 403].includes(health.status)) return
        } catch {}
        await new Promise(done => setTimeout(done, 250))
      }
      throw new Error('Owned GLM Host restart timed out')
    } })

  await page.getByRole('button', { name: '插件', exact: true }).click()
  await page.getByText('@kkucodes/dsh-predictions', { exact: true }).first().click()
  await page.getByRole('button', { name: '卸载 @kkucodes/dsh-predictions', exact: true }).click()
  await page.getByRole('button', { name: /^(?:确认)?卸载$/u }).click()
  await page.waitForFunction(() => document.querySelector('style[data-dsh-predictions]') === null)
  await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
  await editor.waitFor({ state: 'visible' })
  assert.equal(await ghost.count(), 0)
  assert.equal(await page.locator('[data-dsh-prediction-status]').count(), 0)
  assert.equal(await page.locator('[data-composer-placeholder]').evaluate(element => getComputedStyle(element).visibility), 'visible')
  report.stages.push('official-ui-uninstall-restores-composer')
  report.sessionEvents = await sessionEventCounts()
  assert.ok(report.sessionEvents.session > 0, 'Owned official JSONL sessions must actually be inspected')
  report.modelCalls = (report.sessionEvents['step/start'] ?? 0) - (baselineEvents['step/start'] ?? 0)
    + (report.sessionEvents['session/title-llm-request'] ?? 0) - (baselineEvents['session/title-llm-request'] ?? 0)
    + (realModel ? (await predictionRecords()).length : 0)
    + (report.manualGenerations ?? 0)
    + (report.realGlmPredictions?.predictionCalls ?? 0)
    + (report.realGlmLow?.predictionCalls ?? 0)
    + (report.automaticCycle?.predictionCalls ?? 0)
  if (!realModel && !manualReal && !glmPrediction && !glmLow && !automaticCycle) {
    assert.equal(report.modelCalls, 0)
    assert.equal(report.sessionEvents['user/message'] ?? 0, baselineEvents['user/message'] ?? 0)
    assert.equal(report.sessionEvents['assistant/message'] ?? 0, baselineEvents['assistant/message'] ?? 0)
    report.stages.push(report.realCustomModel ? 'no-message-sent-and-explicit-custom-model-tests-only'
      : report.customModel ? 'no-message-sent-and-no-external-model-request' : 'no-message-sent-and-no-model-request')
  }
  assert.deepEqual(report.errors, [])
  report.webVerified = true
} catch (error) {
  report.failure = error.stack ?? String(error)
  if (env.DSH_PREDICTIONS_GLM_TEST_KEY) report.failure = report.failure.replaceAll(env.DSH_PREDICTIONS_GLM_TEST_KEY, '[redacted]')
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
    await writeFile(join(output, 'failure-page.txt'), await page.locator('body').innerText()).catch(() => {})
    if (!glmPrediction && !glmLow) await writeFile(join(output, 'failure-page.html'), await page.content()).catch(() => {})
  }
  console.error(report.failure)
  process.exitCode = 1
} finally {
  // 先保留功能结果；环境清理失败也必须形成可复查报告。
  await writeFile(join(output, 'checkpoint.json'), JSON.stringify(report, null, 2))
  await browser?.close().catch(error => { report.cleanupError = String(error) })
  if (host && host.exitCode === null && host.signalCode === null) {
    const exited = new Promise(done => host.once('exit', done))
    // 使用当前 ChildProcess 的句柄，避免按 PID 递归枚举时误碰已经复用的进程号。
    host.kill('SIGTERM')
    let timer
    await Promise.race([exited, new Promise(done => { timer = setTimeout(done, 5000) })])
    clearTimeout(timer)
  }
  report.hostStopped = !host || host.exitCode !== null || host.signalCode !== null
  if (cycleHTTP) await cycleHTTP.close()
  if ((glmPrediction || glmLow) && report.hostStopped) {
    // 仅删除本次验收创建的凭据文件；日常 profile 与用户提供的原文件不在此路径。
    const credentialFile = join(home, '.credentials.yaml')
    assert.ok(relative(output, credentialFile).startsWith('home'))
    await rm(credentialFile, { force: true })
    delete env.DSH_PREDICTIONS_GLM_TEST_KEY
    report.testCredentialRemoved = true
  }
  if (report.origin) {
    try { await fetch(report.origin, { signal: AbortSignal.timeout(1000) }); report.listenerStopped = false }
    catch { report.listenerStopped = true }
  }
  if (!report.hostStopped || report.listenerStopped === false || report.cleanupError) {
    report.cleanupError ??= 'Owned Host or its listener did not stop'
    process.exitCode = 1
  }
  report.officialAfter = await officialDigest()
  report.officialFilesUnchanged = JSON.stringify(report.officialBefore) === JSON.stringify(report.officialAfter)
  if (!report.officialFilesUnchanged) process.exitCode = 1
  report.finishedAt = new Date().toISOString()
  await writeFile(join(output, 'host.log'), hostLog.replace(/(http:\/\/127\.0\.0\.1:\d+)[^\s\u001b]*/g, '$1/<login-redacted>'))
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ report: join(output, 'report.json'), webVerified: report.webVerified,
    desktopVerified: report.desktopVerified, officialFilesUnchanged: report.officialFilesUnchanged }))
}
