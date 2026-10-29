import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { chatCompletionsFixture } from './chat-completions-fixture.mjs'

/** 官方 Web 安装入口 + 本地协议服务；验证真实传输与持久化，不视为付费厂商验收。 */
export async function verifyCustomModels({ page, browserContext, report, output, fixture }) {
  const server = await chatCompletionsFixture()
  const checks = []
  report.customModel = { checks, externalModelCalls: 0, fixtureRequests: 0 }
  const key = 'protocol-fixture-not-a-real-api-key'
  const settings = page.locator('[data-dsh-predictions-settings]')
  const button = name => settings.getByRole('button', { name, exact: true })
  const open = async (p = page) => {
    await p.getByRole('button', { name: '插件', exact: true }).click()
    await p.getByText('@kkucodes/dsh-predictions', { exact: true }).first().click()
    await p.locator('[data-dsh-predictions-settings]').waitFor({ state: 'visible' })
  }
  const custom = async (p = page) => {
    const s = p.locator('[data-dsh-predictions-settings]')
    await s.getByRole('button', { name: /^(自定义连接|编辑)$/u }).click()
    await s.getByRole('textbox', { name: 'API 地址', exact: true }).waitFor()
  }
  const save = async (p = page) => {
    const s = p.locator('[data-dsh-predictions-settings]')
    await s.getByRole('button', { name: '保存并使用', exact: true }).click()
    await s.getByRole('combobox', { name: '预测模型', exact: true }).waitFor()
  }
  try {
    for (const action of ['custom/info', 'custom/key', 'custom/test']) {
      const response = await fetch(report.origin + '/api/dsh-predictions/' + action, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'client-request', rpcId: 'unauthenticated-custom-test', method: 'dsh-predictions/' + action, payload: {} }) })
      assert.ok([401, 403].includes(response.status))
    }
    checks.push('custom-routes-use-official-owner-authentication')
    // 原值恢复后按钮重新置灰，没有重复成功提示。
    await button('自动').click(); assert.equal(await button('保存更改').isEnabled(), true)
    await button('仅手动').click(); assert.equal(await button('保存更改').isDisabled(), true)
    assert.equal(await settings.getByText('已保存', { exact: true }).count(), 0)
    await custom()
    const url = settings.getByRole('textbox', { name: 'API 地址', exact: true })
    const model = settings.getByRole('textbox', { name: '模型名称', exact: true })
    const secret = settings.getByLabel('API Key', { exact: true })
    await url.fill('not-a-url'); await model.focus()
    await settings.getByText(/请输入 http:\/\/ 或 https:\/\/ 基础地址/u).waitFor()
    await url.fill(server.baseURL); await model.fill('my-model'); await secret.fill(key)
    assert.equal(await secret.getAttribute('type'), 'password')
    await button('显示').click(); assert.equal(await secret.getAttribute('type'), 'text')
    await button('隐藏').click()
    await button('测试连接').click(); await settings.getByText('模型可用', { exact: true }).waitFor()
    assert.equal(server.calls.length, 1)
    await settings.screenshot({ path: join(output, 'custom-model-success.png') })
    const assets = await settings.locator('img.dshp-icon').evaluateAll(images => images.map(image => ({ src: image.getAttribute('src')?.slice(0, 32), natural: [image.naturalWidth, image.naturalHeight], rendered: [image.width, image.height] })))
    assert.ok(assets.length > 0 && assets.every(asset => asset.src.startsWith('data:image/svg+xml') && asset.natural[0] > 0 && asset.rendered[0] === 16 && asset.rendered[1] === 16))
    report.customModel.assets = assets
    await model.fill('changed-model'); await settings.getByText('尚未测试', { exact: true }).waitFor()
    await model.fill('my-model')
    await button('返回').click()
    const discard = settings.getByRole('dialog', { name: '放弃当前修改？', exact: true })
    await discard.getByRole('button', { name: '继续编辑', exact: true }).click()
    checks.push('draft-validation-key-mask-test-result-invalidation-and-return-confirmation')
    await settings.screenshot({ path: join(output, 'custom-model-desktop.png') })
    await save()
    const picker = settings.getByRole('combobox', { name: '预测模型', exact: true })
    assert.equal(await picker.locator('option:checked').innerText(), 'my-model')
    assert.equal(await button('保存更改').isDisabled(), true)
    await page.reload(); await open(); await custom()
    assert.equal(await secret.inputValue(), '')
    assert.equal(await secret.getAttribute('placeholder'), '已保存密钥')
    const profile = await readFile(join(report.home, 'profiles/web/cordis.patch.yml'), 'utf8')
    assert.ok(profile.includes('customCredential'))
    assert.ok(!profile.includes(key))
    assert.equal(await model.inputValue(), 'my-model')
    await button('测试连接').click(); await settings.getByText('模型可用', { exact: true }).waitFor()
    assert.equal(server.calls.at(-1).headers.authorization, 'Bearer ' + key)
    assert.equal(await settings.innerText().then(text => text.includes(key)), false)
    checks.push('native-credential-store-and-reload-reuse-without-secret-readback-or-model-prefix')
    server.mode('auth'); await button('测试连接').click()
    await settings.getByText('API Key 无效或无模型访问权限。', { exact: true }).waitFor()
    assert.equal((await settings.innerText()).includes(key), false)
    const beforeSlow = server.calls.length
    server.mode('slow'); await button('测试连接').click()
    await button('取消测试').waitFor()
    assert.equal(await button('测试中…').isDisabled(), true)
    for (let i = 0; i < 100 && server.calls.length === beforeSlow; i++) await page.waitForTimeout(20)
    assert.equal(server.calls.length, beforeSlow + 1)
    await button('取消测试').click(); await button('测试连接').waitFor()
    server.mode('success')
    checks.push('provider-auth-error-is-sanitized-and-test-cancellation-does-not-retry')
    await button('更换').click(); await secret.fill('replacement-fixture-not-a-real-key')
    await model.fill('my-model-2')
    const failSave = route => route.abort('failed')
    await page.route('**/api/settings/mutate', failSave)
    await button('保存并使用').click(); await settings.getByText('保存失败', { exact: true }).waitFor()
    assert.equal(await model.inputValue(), 'my-model-2')
    // 新密钥暂存成功、原生设置提交失败时，另一窗口仍使用原来已激活的密钥。
    const active = await browserContext.newPage()
    try {
      await active.goto(report.origin); await open(active); await custom(active)
      const s = active.locator('[data-dsh-predictions-settings]')
      assert.equal(await s.getByRole('textbox', { name: '模型名称', exact: true }).inputValue(), 'my-model')
      await s.getByRole('button', { name: '测试连接', exact: true }).click()
      await s.getByText('模型可用', { exact: true }).waitFor()
      assert.equal(server.calls.at(-1).headers.authorization, 'Bearer ' + key)
    } finally { await active.close() }
    await page.bringToFront()
    await page.unroute('**/api/settings/mutate', failSave); await save()
    await custom(); await button('测试连接').click(); await settings.getByText('模型可用', { exact: true }).waitFor()
    assert.equal(server.calls.at(-1).headers.authorization, 'Bearer replacement-fixture-not-a-real-key')
    await button('返回').click()
    checks.push('save-failure-preserves-draft-and-explicit-retry-applies')
    await custom()
    const second = await browserContext.newPage()
    try {
      await second.goto(report.origin); await open(second); await custom(second)
      const s = second.locator('[data-dsh-predictions-settings]')
      await s.getByRole('textbox', { name: '模型名称', exact: true }).fill('window-b')
      await page.bringToFront()
      if (!await model.isVisible()) await custom()
      await model.fill('window-a'); await save()
      await s.getByRole('button', { name: '保存并使用', exact: true }).click()
      await s.getByText('当前修改已保留', { exact: true }).waitFor()
      assert.equal(await s.getByRole('textbox', { name: '模型名称', exact: true }).inputValue(), 'window-b')
      await s.getByRole('button', { name: '读取最新设置', exact: true }).click()
      await s.getByRole('dialog').getByRole('button', { name: '读取最新设置', exact: true }).click()
      assert.equal(await s.getByRole('textbox', { name: '模型名称', exact: true }).inputValue(), 'window-a')
    } finally { await second.close() }
    checks.push('real-concurrent-custom-save-conflict-keeps-draft-and-explicit-reload')
    await custom()
    for (const [width, label] of [[768, 'narrow'], [390, 'mobile']]) {
      await page.setViewportSize({ width, height: 900 })
      assert.ok(await settings.evaluate(n => n.scrollWidth <= n.clientWidth + 1))
      await settings.screenshot({ path: join(output, 'custom-model-' + label + '.png') })
    }
    await page.setViewportSize({ width: 1280, height: 900 }); await page.emulateMedia({ colorScheme: 'dark' })
    await settings.screenshot({ path: join(output, 'custom-model-dark.png') }); await page.emulateMedia({ colorScheme: 'light' })
    await button('返回').click()
    await settings.getByRole('checkbox', { name: '启用预测消息', exact: true }).click()
    await page.waitForFunction(() => document.querySelector('[data-dsh-predictions-settings] [aria-label="启用预测消息"]')?.checked === true)
    await page.locator(`[data-row-key="session:${fixture.sessionId}"]`).click()
    const editor = page.locator('[data-composer-input]:visible').last()
    const ghost = page.locator('[data-dsh-prediction-active=true]')
    const before = server.calls.length
    await editor.focus(); await editor.press('ArrowRight'); await editor.press('ArrowRight')
    await ghost.waitFor({ state: 'visible' })
    assert.equal(await ghost.innerText(), '请继续实现搜索框。')
    assert.equal(server.calls.length, before + 1)
    assert.equal(server.calls.at(-1).body.model, 'window-a')
    await editor.press('Tab'); await page.waitForFunction(() => document.querySelector('[data-composer-input]')?.textContent === '请继续实现搜索框。')
    await editor.press('Control+Z'); await ghost.waitFor({ state: 'visible' })
    assert.equal(server.calls.length, before + 1)
    checks.push('custom-model-manual-prediction-through-real-composer-and-undo-cache-without-send')
    await open()
    assert.equal(await settings.getByText('已保存', { exact: true }).count(), 0)
    report.customModel.fixtureRequests = server.calls.length
    report.customModel.chatCompletionsOnly = server.calls.every(call => call.path === '/v1/chat/completions' && call.body.stream === false)
    assert.equal(report.customModel.chatCompletionsOnly, true)
    checks.push('desktop-narrow-mobile-dark-and-chat-completions-only')
  } finally { await server.close() }
}
