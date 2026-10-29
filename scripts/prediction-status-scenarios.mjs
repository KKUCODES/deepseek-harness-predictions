import assert from 'node:assert/strict'
import { join } from 'node:path'
import { chatCompletionsFixture } from './chat-completions-fixture.mjs'

/** 官方安装、认证、设置、会话与 HTTP 预测全链路；服务商由本地协议测试服务替代，不收费。 */
export async function verifyPredictionStatus({ page, report, output, fixture }) {
  const server = await chatCompletionsFixture()
  const checks = []
  report.predictionStatus = { verified: false, checks, externalModelCalls: 0 }
  const status = page.locator('[data-dsh-prediction-status]:visible').last()
  const ghost = page.locator('[data-dsh-prediction-active=true]')
  const editor = page.locator('[data-composer-input]:visible').last()
  const settings = page.locator('[data-dsh-predictions-settings]')
  const open = async (loaded = true) => {
    await page.getByRole('button', { name: '插件', exact: true }).click()
    await page.getByText('@kkucodes/dsh-predictions', { exact: true }).first().click()
    if (loaded) await settings.waitFor({ state: 'visible' })
  }
  const chat = async () => { await page.locator(`[data-row-key="session:${fixture.sessionId}"]`).click(); await editor.waitFor() }
  const state = async (value, timeout = 20000) => page.waitForFunction(value =>
    [...document.querySelectorAll('[data-dsh-prediction-status]')].some(n => n.getClientRects().length && n.dataset.dshPredictionStatus === value), value, { timeout })
  const tooltip = async message => {
    await page.mouse.move(0, 0)
    await status.hover()
    const bubble = page.locator('.dshp-prediction-tooltip')
    await bubble.waitFor()
    assert.equal(await bubble.locator('strong').innerText(), '预测消息状态')
    assert.equal(await bubble.locator('span').innerText(), message)
    const box = await bubble.boundingBox()
    const viewport = page.viewportSize()
    assert.ok(box && box.x >= 0 && box.x + box.width <= viewport.width && box.y >= 0 && box.y + box.height <= viewport.height)
  }
  const double = async () => { await editor.focus(); await editor.press('ArrowRight'); await editor.press('ArrowRight') }
  const clear = async () => { await editor.focus(); await editor.press('Control+A'); await editor.press('Backspace') }
  const dismiss = async () => { await editor.focus(); await editor.press('Escape'); await state('empty'); await page.waitForTimeout(1150) }
  try {
    await open()
    await settings.getByRole('button', { name: '自定义连接', exact: true }).click()
    await settings.getByRole('textbox', { name: 'API 地址', exact: true }).fill(server.baseURL)
    await settings.getByLabel('API Key', { exact: true }).fill('local-status-protocol-fixture-not-a-real-key')
    await settings.getByRole('textbox', { name: '模型名称', exact: true }).fill('prediction-status-fixture')
    await settings.getByRole('button', { name: '保存并使用', exact: true }).click()
    await settings.getByRole('combobox', { name: '预测模型', exact: true }).waitFor()
    server.mode('slow')
    await settings.getByRole('checkbox', { name: '启用预测消息', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[aria-label="启用预测消息"]')?.checked === true)
    await chat()
    for (let attempt = 0; server.calls.length === 0 && attempt < 100; attempt++) await page.waitForTimeout(20)
    await state('loading')
    await tooltip('正在生成')
    assert.equal(await status.locator('img').evaluate(n => getComputedStyle(n).animationName), 'dshp-prediction-spin')
    await page.screenshot({ path: join(output, 'status-loading.png'), fullPage: true })
    await state('ready'); await ghost.waitFor()
    assert.equal(server.calls.length, 1)
    const geometry = await status.evaluate(n => {
      const group = n.parentElement
      const model = group?.parentElement?.querySelector('[data-slot="conversation.input.model"] button')
      const a = n.getBoundingClientRect(), b = model?.getBoundingClientRect()
      return { width: a.width, height: a.height, leftOfModel: !!b && a.right <= b.left, gap: b ? b.left - a.right : null }
    })
    assert.equal(geometry.width, 28); assert.equal(geometry.height, 28); assert.equal(geometry.leftOfModel, true)
    assert.equal(geometry.gap, 8)
    assert.equal(await status.getAttribute('tabindex'), null)
    checks.push('automatic-request-grey-to-loading-to-green-through-official-composer-and-local-http')
    await tooltip('已有预测')
    await page.screenshot({ path: join(output, 'status-ready-desktop.png'), fullPage: true })
    await editor.focus(); await editor.press('Tab')
    await ghost.waitFor({ state: 'hidden' }); await state('ready')
    assert.equal(await editor.innerText(), '请继续实现搜索框。')
    await editor.press('Control+Z'); await ghost.waitFor(); await state('ready')
    await page.keyboard.insertText('自己输入')
    await ghost.waitFor({ state: 'hidden' }); await state('ready'); await double()
    assert.equal(await editor.innerText(), '自己输入'); assert.equal(server.calls.length, 1)
    await clear(); await ghost.waitFor(); await double(); await page.waitForTimeout(350)
    assert.equal((await editor.innerText()).trim(), ''); assert.equal(server.calls.length, 1)
    await status.click(); assert.equal(server.calls.length, 1)
    checks.push('accept-undo-typing-clearing-and-read-only-icon-preserve-cache-without-extra-request')
    await dismiss(); await tooltip('暂无预测')
    await page.screenshot({ path: join(output, 'status-empty.png'), fullPage: true })
    server.mode('auth'); await double(); await state('error')
    await tooltip('请求失败，可双击 → 重试')
    await page.screenshot({ path: join(output, 'status-error.png'), fullPage: true })
    const failedCalls = server.calls.length
    await page.waitForTimeout(1300)
    assert.equal(server.calls.length, failedCalls)
    server.mode('slow'); await double(); await state('loading')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    assert.equal(await status.locator('img').evaluate(n => getComputedStyle(n).animationName), 'none')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await page.keyboard.insertText('取消中的草稿'); await state('empty')
    await page.waitForTimeout(1700); assert.equal(await ghost.count(), 0)
    await clear(); await state('empty')
    server.mode('timeout'); await double(); await state('loading'); await state('timeout')
    await tooltip('请求超时，可双击 → 重试')
    await page.screenshot({ path: join(output, 'status-timeout.png'), fullPage: true })
    const timeoutCalls = server.calls.length
    await page.waitForTimeout(1300); assert.equal(server.calls.length, timeoutCalls)
    checks.push('manual-failure-cancellation-timeout-and-no-automatic-retry-with-reduced-motion')
    server.mode('success'); await double(); await state('ready'); await ghost.waitFor()
    const requests = server.calls.length
    await page.reload()
    const addKey = page.getByRole('button', { name: '添加 API Key', exact: true })
    if (await addKey.isVisible()) { await addKey.click(); await page.getByRole('button', { name: '稍后配置', exact: true }).click() }
    await chat(); await state('ready'); await ghost.waitFor()
    assert.equal(server.calls.length, requests)
    const assets = await status.locator('img').evaluateAll(images => images.map(n => ({ natural: [n.naturalWidth, n.naturalHeight], width: n.width, height: n.height, local: n.src.startsWith('data:image/svg+xml') })))
    assert.ok(assets.every(n => n.local && n.natural[0] > 0 && n.width === 14 && n.height === 14))
    checks.push('reload-restores-green-from-cache-without-another-model-request-and-local-figma-assets')
    for (const width of [768, 390]) {
      await page.setViewportSize({ width, height: 900 })
      // 宿主在断点重挂载输入框，等待公开投影和只读缓存恢复后再核对提示。
      await state('ready'); await ghost.waitFor(); await tooltip('已有预测')
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
      assert.equal(server.calls.length, requests)
      await page.screenshot({ path: join(output, `status-${width}.png`), fullPage: true })
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.emulateMedia({ colorScheme: 'dark' }); await tooltip('已有预测')
    await page.screenshot({ path: join(output, 'status-dark.png'), fullPage: true })
    await page.emulateMedia({ colorScheme: 'light' })
    await open()
    await settings.getByRole('checkbox', { name: '启用预测消息', exact: true }).click()
    await chat(); await status.waitFor({ state: 'hidden' })
    await open()
    await settings.getByRole('checkbox', { name: '启用预测消息', exact: true }).click()
    await chat(); await state('ready')
    await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
    await state('empty'); assert.equal(server.calls.length, requests)
    await page.getByRole('button', { name: '添加 API Key', exact: true }).click()
    await page.getByRole('button', { name: '稍后配置', exact: true }).click()
    await chat(); await state('ready')
    checks.push('desktop-narrow-mobile-dark-tooltip-bounds-and-feature-off')
    await open()
    const pluginSwitch = page.getByRole('switch', { name: '启用 @kkucodes/dsh-predictions', exact: true })
    await pluginSwitch.click()
    await page.waitForFunction(() => document.querySelector('style[data-dsh-predictions]') === null)
    await page.waitForFunction(() => document.querySelector('[role=switch][aria-label="启用 @kkucodes/dsh-predictions"]')?.getAttribute('aria-checked') === 'false')
    await chat(); assert.equal(await page.locator('[data-dsh-prediction-status]').count(), 0)
    await open(false); await pluginSwitch.click()
    await page.waitForFunction(() => document.querySelector('[role=switch][aria-label="启用 @kkucodes/dsh-predictions"]')?.getAttribute('aria-checked') === 'true')
    await settings.waitFor()
    await chat(); await state('ready')
    assert.equal(await page.locator('[data-dsh-prediction-status]').count(), 1)
    assert.equal(await page.locator('style[data-dsh-predictions]').count(), 1)
    assert.equal(server.calls.length, requests)
    checks.push('new-session-reset-and-plugin-disable-reenable-without-duplicate-status-or-request')
    report.predictionStatus = { verified: true, checks, geometry, assets, fixtureRequests: server.calls.length, externalModelCalls: 0 }
  } finally { report.predictionStatus.fixtureRequests = server.calls.length; await server.close() }
}
