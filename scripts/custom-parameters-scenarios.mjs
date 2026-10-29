import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { chatCompletionsFixture } from './chat-completions-fixture.mjs'

/** 官方 Web 真正安装产物，操作设置和原输入框；本地协议服务无厂商费用。 */
export async function verifyCustomParameters({ page, report, output, fixture }) {
  const server = await chatCompletionsFixture()
  const checks = []
  report.customParameters = { verified: false, externalModelCalls: 0, checks }
  const settings = page.locator('[data-dsh-predictions-settings]')
  const button = name => settings.getByRole('button', { name, exact: true })
  const field = name => settings.getByLabel(name, { exact: true })
  const open = async () => {
    await page.getByRole('button', { name: '插件', exact: true }).click()
    await page.getByText('@kkucodes/dsh-predictions', { exact: true }).first().click()
    await settings.waitFor()
  }
  const custom = async () => { await button(/^(自定义连接|编辑)$/u).click(); await field('API 地址').waitFor() }
  const save = async () => { await button('保存并使用').click(); await field('预测模型').waitFor() }
  const test = async () => { await button('测试连接').click(); await settings.getByText('模型可用', { exact: true }).waitFor() }
  const add = async (key, type, value) => {
    await button('添加参数').click()
    const n = await settings.locator('[data-parameter-row]').count()
    await field(`参数名 ${n}`).fill(key)
    if (type !== 'text') await field(`参数类型 ${n}`).selectOption(type)
    if (type === 'boolean') await field(`参数值 ${n}`).selectOption(value)
    else await field(`参数值 ${n}`).fill(value)
    return n
  }
  const chat = async () => { await page.locator(`[data-row-key="session:${fixture.sessionId}"]`).click(); await page.locator('[data-composer-input]:visible').last().waitFor() }
  const ghost = page.locator('[data-dsh-prediction-active=true]')
  const enable = async checked => {
    if (await field('启用预测消息').isChecked() !== checked) await field('启用预测消息').click()
    await page.waitForFunction(checked => document.querySelector('[aria-label="启用预测消息"]')?.checked === checked, checked)
  }
  const editor = page.locator('[data-composer-input]:visible').last()
  const double = async () => { await editor.focus(); await editor.press('ArrowRight'); await editor.press('ArrowRight') }
  try {
    await open(); await custom()
    await field('API 地址').fill(server.baseURL)
    await field('API Key').fill('parameters-protocol-fixture-not-a-real-key')
    await field('模型名称').fill('parameters-fixture')
    assert.equal(await field('限制输出长度').isChecked(), false)
    assert.equal(await field('最大输出 Token').count(), 0)
    await test()
    assert.equal(Object.hasOwn(server.calls.at(-1).body, 'max_tokens'), false)
    await field('限制输出长度').check()
    assert.equal(await settings.getByText('尚未测试', { exact: true }).count(), 1)
    for (const invalid of ['', '0', '-1', '1.2', '1e3']) {
      await field('最大输出 Token').fill(invalid)
      assert.equal(await button('保存并使用').isDisabled(), true)
      assert.equal(await button('测试连接').isDisabled(), true)
    }
    await field('最大输出 Token').fill('9007199254740993123456789')
    await test()
    assert.ok(server.calls.at(-1).rawBody.includes('"max_tokens":9007199254740993123456789'))
    checks.push('default-off-omits-field-invalid-integers-block-save-and-test-large-integer-keeps-all-digits')
    await field('最大输出 Token').fill('1024')
    await add('reasoning_effort', 'text', 'low')
    await add('temperature', 'number', '0')
    await add('enable_thinking', 'boolean', 'false')
    await add('thinking', 'json', '{"type":"disabled"}')
    await test()
    const body = server.calls.at(-1).body
    assert.equal(body.max_tokens, 1024); assert.equal(body.reasoning_effort, 'low'); assert.equal(body.temperature, 0)
    assert.equal(body.enable_thinking, false); assert.deepEqual(body.thinking, { type: 'disabled' })
    await field('参数值 4').fill('{bad}')
    assert.equal(await button('测试连接').isDisabled(), true)
    await settings.getByText('请输入有效 JSON。', { exact: true }).waitFor()
    await field('参数值 4').fill('{"type":"disabled"}')
    await add('reasoning_effort', 'text', 'high')
    await settings.getByText('参数名重复。', { exact: true }).waitFor()
    await field('参数名 5').fill('messages')
    await settings.getByText('此字段由插件管理，不能覆盖。', { exact: true }).waitFor()
    await field('参数名 5').fill('extra_body')
    await settings.getByText('extra_body 是 SDK 写法，请直接填写其中的参数。', { exact: true }).waitFor()
    await field('参数名 5').fill('max_completion_tokens'); await field('参数类型 5').selectOption('number'); await field('参数值 5').fill('2048')
    await settings.getByText(/不能同时设置 max_tokens 和 max_completion_tokens/u).waitFor()
    assert.equal(await button('保存并使用').isDisabled(), true)
    await field('限制输出长度').uncheck(); assert.equal(await button('测试连接').isEnabled(), true)
    await test(); assert.equal(Object.hasOwn(server.calls.at(-1).body, 'max_tokens'), false)
    assert.equal(server.calls.at(-1).body.max_completion_tokens, 2048)
    await button('删除参数 5').click()
    await field('限制输出长度').check()
    checks.push('text-number-boolean-json-validation-duplicate-reserved-sdk-and-conflicting-limit-rejection')
    for (const width of [1280, 768, 390]) {
      await page.setViewportSize({ width, height: 1050 })
      await settings.screenshot({ path: join(output, `parameters-${width}.png`) })
      const geometry = await settings.locator('[data-parameter-row]').first().evaluate(row => {
        const boxes = [...row.children].map(n => { const r = n.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, right: r.right } })
        return { boxes, overflow: row.scrollWidth > row.clientWidth + 1 }
      })
      assert.equal(geometry.overflow, false)
      if (width === 390) assert.ok(geometry.boxes[1].y > geometry.boxes[0].y && geometry.boxes[3].y === geometry.boxes[0].y + 4)
    }
    await page.setViewportSize({ width: 1280, height: 900 })
    await save(); await custom()
    assert.equal(await button('保存并使用').isDisabled(), true)
    assert.equal(await settings.getByText('已保存', { exact: true }).count(), 0)
    assert.equal(await field('最大输出 Token').inputValue(), '1024')
    await field('限制输出长度').uncheck(); await save()
    await button('更多设置').click()
    assert.equal(await field('最长输出').count(), 0)
    await button('返回').click()
    assert.equal(await field('预测模型').locator('option:checked').innerText(), 'parameters-fixture')
    const profile = await readFile(join(report.home, 'profiles/web/cordis.patch.yml'), 'utf8')
    assert.ok(profile.includes('customRequestConfigured'))
    assert.ok(!profile.includes('parameters-protocol-fixture-not-a-real-key'))
    checks.push('responsive-desktop-table-mobile-two-lines-atomic-save-no-prefix-no-duplicate-output-limit-and-secret-outside-config')
    await enable(true)
    await chat(); await ghost.waitFor()
    const calls = server.calls.length
    const actual = server.calls.at(-1).body
    assert.ok(actual.messages.some(m => m.role === 'system'))
    assert.equal(Object.hasOwn(actual, 'max_tokens'), false)
    for (const key of ['reasoning_effort', 'temperature', 'enable_thinking', 'thinking']) assert.deepEqual(actual[key], body[key])
    await editor.focus(); await editor.press('Tab'); assert.equal(await editor.innerText(), '请继续实现搜索框。')
    await editor.press('Control+Z'); await ghost.waitFor()
    await page.keyboard.insertText('自己编辑'); await ghost.waitFor({ state: 'hidden' }); await double()
    assert.equal(await editor.innerText(), '自己编辑')
    await editor.press('Control+A'); await editor.press('Backspace'); await ghost.waitFor()
    await page.reload(); await chat(); await ghost.waitFor()
    assert.equal(server.calls.length, calls)
    await editor.focus(); await editor.press('Escape'); await ghost.waitFor({ state: 'hidden' }); await page.waitForTimeout(1200)
    await double(); await ghost.waitFor()
    assert.equal(server.calls.length, calls + 1)
    assert.equal(Object.hasOwn(server.calls.at(-1).body, 'max_tokens'), false)
    checks.push('automatic-and-double-arrow-real-prediction-send-same-parameters-tab-undo-edit-reload-restore-without-extra-request')
    await open(); await enable(false); await custom()
    assert.equal(await field('限制输出长度').isChecked(), false)
    assert.equal(await field('参数值 3').inputValue(), 'false')
    await field('限制输出长度').check(); await field('最大输出 Token').fill('2048'); await save()
    await enable(true); await chat()
    // 已有结果只读复用，参数变化不会重新收费。明确丢弃后才发下一次请求。
    await ghost.waitFor(); await editor.focus(); await editor.press('Escape'); await page.waitForTimeout(1200)
    await double(); await ghost.waitFor()
    assert.equal(server.calls.at(-1).body.max_tokens, 2048)
    assert.equal(server.calls.at(-1).body.reasoning_effort, 'low')
    await open(); await enable(false)
    checks.push('persisted-enabled-limit-reaches-actual-manual-prediction-and-existing-cache-is-not-refreshed')
    report.customParameters.verified = true
    report.customParameters.fixtureRequests = server.calls.length
  } finally { await server.close() }
}
