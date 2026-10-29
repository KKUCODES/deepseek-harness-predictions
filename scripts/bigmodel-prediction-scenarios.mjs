import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readGlmKey } from './read-glm-key.mjs'

/** 显式付费入口：真实官方输入框、插件凭据与厂商预测，绝不改写会话日志。 */
export async function verifyBigModelPredictions({ page, browserContext, report, output, keyFile, fixture, records, events, restartHost }) {
  const key = await readGlmKey(keyFile)
  const result = report.realGlmPredictions = { model: 'GLM-5.3-Flash', outputTokens: 256, predictionCalls: 0, checks: [], predictions: [] }
  result.cacheRequests = []
  page.on('response', async response => {
    if (!response.url().endsWith('/api/dsh-predictions/peek')) return
    try { result.cacheRequests.push({ payload: response.request().postDataJSON().payload, result: (await response.json()).result }) } catch {}
  })
  const settings = page.locator('[data-dsh-predictions-settings]')
  const button = name => settings.getByRole('button', { name, exact: true })
  const editor = page.locator('[data-composer-input]:visible').last()
  const ghost = page.locator('[data-dsh-prediction-active=true]')
  const open = async () => {
    await page.getByRole('button', { name: '插件', exact: true }).click()
    await page.getByText('@kkucodes/dsh-predictions', { exact: true }).first().click()
    await settings.waitFor({ state: 'visible' })
  }
  const save = async () => {
    await button('保存更改').click()
    await page.waitForFunction(() => [...document.querySelectorAll('[data-dsh-predictions-settings] button')].find(b => b.textContent === '保存更改')?.disabled === true)
  }
  const totals = async () => {
    try { return JSON.parse(await readFile(join(report.home, 'storages/dsh_predictions_usage.json'), 'utf8')).tables.daily }
    catch (error) { if (error.code === 'ENOENT') return {}; throw error }
  }
  const sum = rows => Object.values(rows).reduce((a, r) => ({ calls: a.calls + r.calls, inputTokens: a.inputTokens + r.inputTokens,
    outputTokens: a.outputTokens + r.outputTokens, uncertainCalls: a.uncertainCalls + r.uncertainCalls }), { calls: 0, inputTokens: 0, outputTokens: 0, uncertainCalls: 0 })
  const baseline = sum(await totals())
  const beforeMessages = await events()
  await open()
  await button('仅手动').click(); await save()
  await settings.getByRole('button', { name: /^(自定义连接|编辑)$/u }).click()
  const secret = settings.getByLabel('API Key', { exact: true })
  try {
    await settings.getByRole('textbox', { name: 'API 地址', exact: true }).fill('https://open.bigmodel.cn/api/coding/paas/v4')
    await settings.getByRole('textbox', { name: '模型名称', exact: true }).fill(result.model)
    if (await button('更换').isVisible()) await button('更换').click()
    await secret.fill(key)
    await settings.getByLabel('限制输出长度', { exact: true }).check()
    await settings.getByLabel('最大输出 Token', { exact: true }).fill(String(result.outputTokens))
    await button('保存并使用').click()
    await settings.getByRole('combobox', { name: '预测模型', exact: true }).waitFor()
  } finally {
    if (await secret.isVisible()) await secret.fill('')
  }
  assert.equal(await settings.getByRole('combobox', { name: '预测模型', exact: true }).locator('option:checked').innerText(), result.model)
  assert.ok(!(await readFile(join(report.home, 'profiles/web/cordis.patch.yml'), 'utf8')).includes(key))
  result.checks.push('real-key-saved-only-through-official-credentials-and-model-name-has-no-prefix')
  await page.locator(`[data-row-key="session:${fixture.sessionId}"]`).click()
  await editor.waitFor()
  assert.equal(await ghost.count(), 0)
  const generated = page.waitForResponse(r => r.url().endsWith('/api/dsh-predictions/manual'), { timeout: 25000 })
  await editor.click(); await editor.press('ArrowRight'); await editor.press('ArrowRight')
  const reply = (await (await generated).json()).result
  result.predictionCalls++
  result.manualReply = reply
  result.manualRecord = (await records()).find(r => r.requestId)
  assert.equal(reply.ok, true)
  assert.equal(reply.value.status, 'ready', '真实手动预测必须完整生成，不能仅以 HTTP 200 或连接成功验收')
  await ghost.waitFor()
  const manualText = await ghost.innerText()
  result.predictions.push({ kind: 'manual', text: manualText, usage: result.manualRecord?.usage })
  assert.equal(result.manualRecord.model, result.model)
  assert.equal(result.manualRecord.provider, 'dsh-predictions-custom')
  assert.ok(result.manualRecord.usage.inputTokens > 0 && result.manualRecord.usage.outputTokens > 0)
  await page.screenshot({ path: join(output, 'glm-real-manual.png'), fullPage: true })
  result.checks.push('old-history-double-right-produces-real-GLM-prediction')
  console.log(JSON.stringify({ stage: 'glm-real-manual-ready', usage: result.manualRecord.usage }))

  async function verifyAcceptance(text) {
    const stored = await records()
    const usage = await totals()
    const eventSnapshot = await events()
    await editor.click(); await editor.press('Tab')
    await page.waitForFunction(text => [...document.querySelectorAll('[data-composer-input]')].some(n => n.getClientRects().length && n.textContent === text), text)
    assert.equal(await ghost.count(), 0)
    await editor.press('Control+Z'); await ghost.waitFor()
    assert.equal((await editor.innerText()).trim(), '')
    assert.equal(await ghost.innerText(), text)
    await page.keyboard.insertText('我先自己输入')
    await editor.press('ArrowRight'); await editor.press('ArrowRight'); await page.waitForTimeout(350)
    assert.equal(await editor.innerText(), '我先自己输入')
    await editor.press('Control+A'); await editor.press('Backspace'); await ghost.waitFor()
    assert.equal(await ghost.innerText(), text)
    await editor.press('ArrowRight')
    await page.waitForFunction(text => [...document.querySelectorAll('[data-composer-input]')].some(n => n.getClientRects().length && n.textContent === text), text)
    await editor.press('Control+Z'); await ghost.waitFor()
    await editor.press('ArrowRight'); await editor.press('ArrowRight'); await page.waitForTimeout(400)
    assert.equal((await editor.innerText()).trim(), '')
    assert.equal(await ghost.innerText(), text)
    assert.deepEqual(await records(), stored)
    assert.deepEqual(await totals(), usage)
    assert.deepEqual(await events(), eventSnapshot, '接受与撤销只能修改草稿，不得自动发送或启动主聊天')
  }
  await verifyAcceptance(manualText)
  result.checks.push('manual-Tab-right-arrow-undo-edit-clear-and-existing-double-right-reuse-cache-without-send-or-fee')
  await page.reload(); await ghost.waitFor({ timeout: 30000 })
  assert.equal(await ghost.innerText(), manualText)
  const snapshot = await records()
  await restartHost()
  await page.reload(); await ghost.waitFor({ timeout: 30000 })
  assert.equal(await ghost.innerText(), manualText)
  assert.deepEqual(await records(), snapshot)
  result.checks.push('browser-reload-and-real-host-restart-preserve-real-prediction-without-regeneration')
  console.log(JSON.stringify({ stage: 'glm-real-cache-restart-verified' }))

  await open(); await button('自动').click(); await save()
  await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
  await editor.waitFor()
  await page.waitForTimeout(800)
  assert.equal(await ghost.count(), 0)
  const autoReply = page.waitForResponse(r => r.url().endsWith('/api/dsh-predictions/predict'), { timeout: 120000 })
  console.log(JSON.stringify({ stage: 'glm-real-main-chat-and-auto-start' }))
  await editor.click()
  await page.keyboard.insertText('我想在待办清单里加一个搜索框，支持按标题筛选。请只用一句话建议下一步，不调用工具，也不要直接实现。')
  await editor.press('Enter')
  const auto = (await (await autoReply).json()).result
  result.predictionCalls++
  result.autoReply = auto
  result.autoRecords = await records()
  assert.equal(auto.ok, true)
  assert.equal(auto.value.status, 'ready', '真实新聊天回复结束后必须自动显示真实预测')
  await ghost.waitFor()
  const autoText = await ghost.innerText()
  const autoRecord = result.autoRecords.find(r => r.key === auto.value.key && r.text === autoText)
  assert.ok(autoRecord?.usage?.inputTokens > 0)
  result.predictions.push({ kind: 'automatic-after-host-restart', text: autoText, usage: autoRecord.usage })
  await page.screenshot({ path: join(output, 'glm-real-auto.png'), fullPage: true })
  await verifyAcceptance(autoText)
  result.checks.push('new-real-GLM-main-chat-triggers-real-automatic-prediction-and-saved-key-works-after-host-restart')

  const second = await browserContext.newPage()
  await second.goto(page.url())
  await second.locator('[data-dsh-prediction-active=true]').waitFor({ timeout: 30000 })
  assert.equal(await second.locator('[data-dsh-prediction-active=true]').innerText(), autoText)
  assert.deepEqual(await records(), result.autoRecords)
  await second.close(); await page.bringToFront()
  await editor.click(); await editor.press('Escape')
  await page.waitForFunction(() => document.querySelector('[data-dsh-prediction-active=true]') === null)
  await page.reload(); await editor.waitFor(); await page.waitForTimeout(800)
  assert.equal(await ghost.count(), 0)
  result.checks.push('second-window-reuses-real-cache-and-Escape-dismissal-persists-without-new-call')

  const finalMessages = await events()
  // 宿主把运行环境、技能目录与时间快照也记录为 user/message；只有 source:user 是用户发送。
  assert.equal(finalMessages['human/message'] - beforeMessages['human/message'], 1)
  assert.equal(finalMessages['assistant/message'] - beforeMessages['assistant/message'], 1)
  assert.equal(finalMessages['step/start'] - beforeMessages['step/start'], 1)
  assert.equal(finalMessages['session/title-llm-request'] ?? 0, beforeMessages['session/title-llm-request'] ?? 0)
  const finalTotals = sum(await totals())
  result.usageDelta = Object.fromEntries(Object.keys(baseline).map(k => [k, finalTotals[k] - baseline[k]]))
  assert.equal(result.usageDelta.calls, 2)
  assert.equal(result.usageDelta.uncertainCalls, 0)
  assert.equal(result.usageDelta.inputTokens, result.predictions.reduce((a, p) => a + p.usage.inputTokens, 0))
  assert.equal(result.usageDelta.outputTokens, result.predictions.reduce((a, p) => a + p.usage.outputTokens, 0))
  await open(); await button('查看明细').click()
  await settings.getByRole('dialog', { name: '用量明细', exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'glm-real-usage.png'), fullPage: true })
  await page.keyboard.press('Escape')
  result.checks.push('actual-prediction-usage-settles-exactly-and-only-one-explicit-chat-message-was-sent')
  result.verified = true
}
