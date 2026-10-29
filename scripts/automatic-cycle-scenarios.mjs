import assert from 'node:assert/strict'
import { join } from 'node:path'

/** 原输入框实际发送、官方模型适配器流式回复、下一轮自动预测；仅本地协议调用。 */
export async function verifyAutomaticCycle({ page, report, output, server, events }) {
  const settings = page.locator('[data-dsh-predictions-settings]')
  const button = name => settings.getByRole('button', { name, exact: true })
  const editor = page.locator('[data-composer-input]:visible').last()
  const ghost = page.locator('[data-dsh-prediction-active=true]')
  const replies = [], rounds = []
  let manual = 0
  const result = report.automaticCycle = { verified: false, externalModelCalls: 0, replies, rounds }
  const before = await events()
  const observe = async response => {
    if (response.url().endsWith('/api/dsh-predictions/manual')) manual++
    if (!response.url().endsWith('/api/dsh-predictions/predict')) return
    try { replies.push((await response.json()).result.value) } catch {}
  }
  page.on('response', observe)
  const state = async value => page.waitForFunction(value => [...document.querySelectorAll('[data-dsh-prediction-status]')]
    .some(n => n.getClientRects().length && n.dataset.dshPredictionStatus === value), value, { timeout: 25000 })
  try {
    await button('自定义连接').click()
    await settings.getByLabel('API 地址', { exact: true }).fill(server.baseURL)
    await settings.getByLabel('API Key', { exact: true }).fill('local-cycle-protocol-fixture-not-a-real-key')
    await settings.getByLabel('模型名称', { exact: true }).fill('prediction-cycle-fixture')
    await button('保存并使用').click()
    await settings.getByLabel('预测模型', { exact: true }).waitFor()
    await button('更多设置').click()
    assert.equal(await settings.getByRole('spinbutton', { name: '触发等待', exact: true }).count(), 0)
    assert.equal(await settings.getByRole('spinbutton', { name: '自动调用间隔', exact: true }).count(), 0)
    await button('返回').click()
    await settings.getByLabel('启用预测消息', { exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[aria-label="启用预测消息"]')?.checked === true)
    await page.getByRole('button', { name: '新建会话', exact: true }).last().click()
    await editor.waitFor()
    await editor.fill('给待办清单加一个搜索框。')
    const firstPrediction = page.waitForResponse(response => response.url().endsWith('/api/dsh-predictions/predict'))
    await editor.press('Enter')
    const first = (await (await firstPrediction).json()).result.value
    assert.equal(first.status, 'ready')
    await ghost.waitFor({ timeout: 25000 })
    await state('ready')
    const predictions = () => server.calls.filter(call => call.body.model === 'prediction-cycle-fixture')
    const chats = () => server.calls.filter(call => call.body.stream)
    const recordRound = async (round, reply) => {
      const requestAt = predictions().at(-1).at
      const afterModelReplyMs = requestAt - chats().at(-1).finishedAt
      assert.ok(afterModelReplyMs >= 0 && afterModelReplyMs < 5000, '模型回复后没有额外固定等待')
      rounds.push({ round, key: reply.key, text: await ghost.innerText(), requestAt, afterModelReplyMs })
    }
    await recordRound(1, first)
    for (let round = 2; round <= 3; round++) {
      const suggestion = await ghost.innerText()
      await editor.focus(); await editor.press('Tab')
      assert.equal(await editor.innerText(), suggestion)
      const nextPrediction = page.waitForResponse(response => response.url().endsWith('/api/dsh-predictions/predict'))
      await editor.press('Enter')
      const reply = (await (await nextPrediction).json()).result.value
      assert.equal(reply.status, 'ready')
      assert.notEqual(reply.key, rounds.at(-1).key)
      await ghost.waitFor({ timeout: 25000 }); await state('ready')
      await recordRound(round, reply)
      assert.equal(predictions().length, round)
      assert.ok(rounds[round - 1].requestAt - rounds[round - 2].requestAt < 9900, '短回合不受跨轮 10 秒间隔阻挡')
    }
    await page.waitForTimeout(1200)
    assert.equal(manual, 0)
    assert.equal(predictions().length, 3)
    assert.equal(server.calls.filter(call => call.body.stream).length, 3)
    assert.equal(replies.filter(reply => reply?.status === 'ready').length, 3)
    assert.equal(replies.filter(reply => reply?.retryAfterMs > 0).length, 0)
    const after = await events()
    assert.equal((after['human/message'] ?? 0) - (before['human/message'] ?? 0), 3)
    assert.equal((after['step/start'] ?? 0) - (before['step/start'] ?? 0), 3)
    result.mainChatCalls = 3; result.predictionCalls = 3; result.manualCalls = manual
    result.verified = true
    await page.screenshot({ path: join(output, 'cycle-completed.png'), fullPage: true })
  } finally { page.off('response', observe) }
}
