import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { parse } from 'yaml'
import { readGlmKey } from './read-glm-key.mjs'

/** 显式授权的一次厂商预测：原设置、凭据及输入框路径，不发主聊天、不自动重试。 */
export async function verifyGlmLow({ page, report, output, fixture, keyFile, records, events }) {
  const key = await readGlmKey(keyFile)
  const keySourceDigest = createHash('sha256').update(await readFile(keyFile)).digest('hex')
  const result = report.realGlmLow = { verified: false, model: 'GLM-5.3-Flash', reasoningEffort: 'low',
    maxTokensParameterPresent: false, predictionCalls: 0, checks: [] }
  const settings = page.locator('[data-dsh-predictions-settings]')
  const button = name => settings.getByRole('button', { name, exact: true })
  const field = name => settings.getByLabel(name, { exact: true })
  const editor = page.locator('[data-composer-input]:visible').last()
  const ghost = page.locator('[data-dsh-prediction-active=true]')
  const beforeEvents = await events()
  // 基础验证器已通过官方 UI 打开设置，仍保持默认关闭。
  await button('仅手动').click()
  await button('保存更改').click()
  await page.waitForFunction(() => [...document.querySelectorAll('[data-dsh-predictions-settings] button')].find(n => n.textContent === '保存更改')?.disabled)
  await button('自定义连接').click()
  const secret = field('API Key')
  try {
    await field('API 地址').fill('https://open.bigmodel.cn/api/coding/paas/v4')
    await field('模型名称').fill(result.model)
    await secret.fill(key)
    await field('限制输出长度').uncheck()
    await button('添加参数').click()
    await field('参数名 1').fill('reasoning_effort')
    await field('参数值 1').fill('low')
    await button('保存并使用').click()
    await field('预测模型').waitFor()
  } finally {
    // 出错后的附件也不能包含密码输入框值。
    if (await secret.isVisible()) await secret.fill('')
  }
  const patchText = await readFile(join(report.home, 'profiles/web/cordis.patch.yml'), 'utf8')
  assert.ok(!patchText.includes(key))
  const find = entries => {
    for (const entry of entries ?? []) {
      if (entry.id === 'dsh-predictions') return entry.config
      const nested = find(entry.children)
      if (nested) return nested
    }
  }
  const saved = find(parse(patchText))
  assert.equal(saved.customRequestConfigured, true)
  assert.equal(saved.customMaxTokensEnabled, false)
  assert.equal(saved.automaticEnabled, false)
  assert.deepEqual(JSON.parse(saved.customParameters), [{ key: 'reasoning_effort', type: 'text', value: 'low' }])
  result.checks.push('official-settings-save-max-tokens-disabled-and-text-reasoning-effort-low-with-secret-outside-config')
  await field('启用预测消息').click()
  await page.waitForFunction(() => document.querySelector('[aria-label="启用预测消息"]')?.checked === true)
  await page.locator(`[data-row-key="session:${fixture.sessionId}"]`).click()
  await editor.waitFor()
  assert.equal((await editor.innerText()).trim(), '')
  assert.equal(await ghost.count(), 0)
  let started
  const onRequest = request => {
    if (!request.url().endsWith('/api/dsh-predictions/manual')) return
    result.predictionCalls++
    started = performance.now()
  }
  page.on('request', onRequest)
  try {
    const generated = page.waitForResponse(response => response.url().endsWith('/api/dsh-predictions/manual'), { timeout: 25000 })
    await editor.focus(); await editor.press('ArrowRight')
    const gestureStart = performance.now()
    await editor.press('ArrowRight')
    const response = await generated
    const reply = (await response.json()).result
    await response.finished()
    result.rpcDurationMs = Math.round(response.request().timing().responseEnd - response.request().timing().requestStart)
    result.observedRpcMs = Math.round(performance.now() - started)
    result.reply = reply
    result.record = (await records()).find(row => row.key === fixture.key)
    assert.equal(result.predictionCalls, 1)
    assert.equal(reply.ok, true)
    assert.equal(reply.value.status, 'ready', '必须产生完整预测，不能把 HTTP 200 或连接成功当作通过')
    await ghost.waitFor()
    result.gestureToGhostMs = Math.round(performance.now() - gestureStart)
    result.text = await ghost.innerText()
    result.usage = result.record?.usage
    assert.equal(result.record.model, result.model)
    assert.equal(result.record.status, 'ready')
    assert.equal(Object.hasOwn(result.record, 'maxTokens'), false)
    assert.ok(result.usage.inputTokens > 0 && result.usage.outputTokens > 0)
    result.checks.push('single-double-right-real-GLM-prediction-ready-within-unchanged-12-second-timeout')
    await page.screenshot({ path: join(output, 'glm-low-real-prediction.png'), fullPage: true })
    const snapshot = await records()
    await editor.focus(); await editor.press('Tab')
    assert.equal(await editor.innerText(), result.text)
    await editor.press('Control+Z'); await ghost.waitFor()
    assert.equal(await ghost.innerText(), result.text)
    await page.reload(); await ghost.waitFor({ timeout: 25000 })
    assert.equal(await ghost.innerText(), result.text)
    assert.deepEqual(await records(), snapshot)
    assert.equal(result.predictionCalls, 1)
    const afterEvents = await events()
    assert.equal(afterEvents['human/message'] ?? 0, beforeEvents['human/message'] ?? 0)
    assert.equal(afterEvents['step/start'] ?? 0, beforeEvents['step/start'] ?? 0)
    result.checks.push('Tab-accept-undo-reload-restore-same-real-prediction-without-resend-or-main-chat')
    result.verified = true
  } finally {
    page.off('request', onRequest)
    result.keySourceUnchanged = createHash('sha256').update(await readFile(keyFile)).digest('hex') === keySourceDigest
    assert.equal(result.keySourceUnchanged, true)
  }
}
