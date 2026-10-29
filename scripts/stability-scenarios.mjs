import assert from 'node:assert/strict'
import { join } from 'node:path'

/** 操作官方 Web 页面，复用已付费历史缓存；不注入宿主服务或替换模型／认证。 */
export async function verifyStability({ page, browserContext, report, output, fixture, records, events, stopHost, startHost }) {
  const checks = report.stability = []
  const step = name => { checks.push(name); console.log(JSON.stringify({ stage: `stage4:${name}` })) }
  const editor = target => target.locator('[data-composer-input]:visible').last()
  const ghost = target => target.locator('[data-dsh-prediction-active=true]')
  const onboarding = async target => {
    const addKey = target.getByRole('button', { name: '添加 API Key', exact: true })
    if (await addKey.isVisible()) {
      await addKey.click(); await target.getByRole('button', { name: '稍后配置', exact: true }).click()
    }
  }
  const history = async target => {
    await target.locator(`[data-row-key="session:${fixture.sessionId}"]`).click()
    await ghost(target).waitFor({ state: 'visible', timeout: 15000 })
    assert.equal(await ghost(target).innerText(), fixture.text)
    await editor(target).click()
  }
  const before = await events()
  const saved = await records()
  const requests = []
  const track = request => {
    const match = request.url().match(/\/api\/dsh-predictions\/(\w+)$/u)
    if (match) requests.push(match[1])
  }
  page.on('request', track)

  // 浏览器原生 IME 合成通道，不用 isComposing 替身；不等同于 Windows 候选词窗口。
  const cdp = await browserContext.newCDPSession(page)
  await editor(page).click()
  await cdp.send('Input.imeSetComposition', { text: 'ni', selectionStart: 2, selectionEnd: 2 })
  await page.waitForTimeout(100)
  await editor(page).press('Tab')
  await editor(page).press('ArrowRight'); await editor(page).press('ArrowRight')
  assert.notEqual(await editor(page).innerText(), fixture.text)
  assert.ok(!(await editor(page).innerText()).includes(fixture.text))
  await cdp.send('Input.insertText', { text: '你好' })
  assert.match(await editor(page).innerText(), /你好/u)
  await editor(page).press('Control+A'); await editor(page).press('Backspace')
  await ghost(page).waitFor({ state: 'visible' })
  assert.equal(requests.filter(action => action === 'manual').length, 0)
  step('chromium-ime-does-not-accept-or-request')
  await cdp.detach()

  await editor(page).press('ArrowRight')
  await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
  await page.waitForTimeout(400)
  await onboarding(page)
  assert.equal((await editor(page).innerText()).trim(), '')
  assert.equal(await ghost(page).count(), 0)
  await history(page)
  step('session-switch-cancels-delayed-insertion')

  const card = page.locator('[data-composer-card]:visible').last()
  await card.locator('input[type=file]').setInputFiles({ name: 'stage4-attachment.txt', mimeType: 'text/plain', buffer: Buffer.from('独立验收文件，不发送聊天。') })
  const remove = page.getByRole('button', { name: '移除文件 stage4-attachment.txt', exact: true })
  await remove.waitFor({ state: 'visible' })
  await ghost(page).waitFor({ state: 'hidden' })
  await editor(page).click()
  await editor(page).press('Tab'); await editor(page).press('ArrowRight'); await editor(page).press('ArrowRight')
  assert.equal((await editor(page).innerText()).trim(), '')
  assert.equal(requests.filter(action => action === 'manual').length, 0)
  await remove.click()
  await ghost(page).waitFor({ state: 'visible' })
  step('attachment-suppresses-acceptance-and-manual-trigger')

  // 宿主原生命令菜单拥有优先权，预测不得抢占其键盘操作。
  await editor(page).click()
  await page.keyboard.insertText('/')
  await page.getByRole('listbox').waitFor({ state: 'visible' })
  await editor(page).press('ArrowRight'); await editor(page).press('ArrowRight')
  assert.ok(!(await editor(page).innerText()).includes(fixture.text))
  assert.equal(requests.filter(action => action === 'manual').length, 0)
  await editor(page).press('Escape')
  await editor(page).press('Control+A'); await editor(page).press('Backspace')
  await ghost(page).waitFor({ state: 'visible' })
  step('native-command-menu-keeps-keyboard-priority')

  for (let index = 0; index < 12; index++) {
    await editor(page).press('Tab')
    assert.equal(await editor(page).innerText(), fixture.text)
    await editor(page).press('Control+Z')
    await ghost(page).waitFor({ state: 'visible' })
  }
  assert.equal(await ghost(page).count(), 1)
  step('twelve-accept-undo-cycles-keep-one-overlay')

  // 延迟真实缓存响应，再开始输入；原草稿不能被迟到结果覆盖。
  let responseReady, releaseResponse
  const ready = new Promise(done => { responseReady = done })
  const gate = new Promise(done => { releaseResponse = done })
  const routePattern = '**/api/dsh-predictions/predict'
  const delay = async route => {
    const response = await route.fetch()
    responseReady()
    await gate
    await route.fulfill({ response }).catch(() => {})
  }
  await page.route(routePattern, delay)
  try {
    await page.reload()
    await ready
    await onboarding(page)
    await editor(page).click()
    await page.keyboard.insertText('保留迟到请求期间的新草稿')
    releaseResponse()
    await page.waitForTimeout(250)
    assert.equal(await editor(page).innerText(), '保留迟到请求期间的新草稿')
    assert.equal(await ghost(page).count(), 0)
    await editor(page).press('Control+A'); await editor(page).press('Backspace')
    await ghost(page).waitFor({ state: 'visible' })
    assert.equal(await ghost(page).innerText(), fixture.text)
  } finally { releaseResponse(); await page.unroute(routePattern, delay) }
  step('late-cache-response-preserves-typing-and-clearing-recovers')

  await stopHost()
  await ghost(page).waitFor({ state: 'hidden', timeout: 10000 })
  await editor(page).click()
  await editor(page).press('Tab')
  assert.equal((await editor(page).innerText()).trim(), '')
  await page.keyboard.insertText('断线期间保留的草稿')
  await startHost()
  await page.waitForTimeout(2500)
  assert.equal(await editor(page).innerText(), '断线期间保留的草稿')
  await editor(page).press('Control+A'); await editor(page).press('Backspace')
  await ghost(page).waitFor({ state: 'visible', timeout: 20000 })
  assert.equal(await ghost(page).innerText(), fixture.text)
  assert.deepEqual(await records(), saved)
  step('real-host-restart-hides-stale-overlay-and-restores-cache')

  const second = await browserContext.newPage()
  second.on('pageerror', error => report.errors.push(error.message))
  second.on('request', track)
  try {
    await second.goto(report.origin)
    await second.waitForFunction(() => document.querySelector('[data-composer-input]') !== null
      || [...document.querySelectorAll('button')].some(button => button.textContent?.trim() === '添加 API Key'))
    await onboarding(second)
    await history(second)
    await page.bringToFront()
    await history(page)
    const dismissed = page.waitForResponse(response => response.url().endsWith('/api/dsh-predictions/dismiss'))
    await editor(page).press('Escape')
    await ghost(page).waitFor({ state: 'hidden' })
    assert.equal((await (await dismissed).json()).result.ok, true)
    if (report.broadcastChannel === 'disabled-for-capability-test') {
      const count = requests.filter(action => action === 'peek').length
      await second.bringToFront()
      await editor(second).click()
      await page.waitForTimeout(150)
      report.focusFallback = { focused: await second.evaluate(() => document.hasFocus()),
        visibility: await second.evaluate(() => document.visibilityState),
        cacheReadsAfterReturn: requests.filter(action => action === 'peek').length - count }
    }
    await ghost(second).waitFor({ state: 'hidden', timeout: 4000 })
    assert.equal((await records())[0].status, 'skipped')
    step(report.broadcastChannel === 'disabled-for-capability-test'
      ? 'peer-return-revalidates-without-broadcast' : 'escape-hides-cached-prediction-in-peer-window')
  } finally { await second.close() }

  const after = await events()
  for (const type of ['user/message', 'assistant/message', 'step/start', 'request/header', 'session/title-llm-request']) {
    assert.equal(after[type] ?? 0, before[type] ?? 0, `稳定性回归不得新增 ${type}`)
  }
  const current = (await records())[0]
  assert.equal(current.key, saved[0].key)
  assert.deepEqual(current.usage, saved[0].usage)
  assert.equal(requests.filter(action => action === 'manual').length, 0)
  await page.screenshot({ path: join(output, '15-stability-final.png'), fullPage: true })
  page.off('request', track)
  report.stabilityVerified = true
}
