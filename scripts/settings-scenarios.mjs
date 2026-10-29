import assert from 'node:assert/strict'
import { join } from 'node:path'

/** 安装到官方 Web 后验收真实插件入口；故障注入仅拦截本页网络，不替换宿主或模型。 */
export async function verifySettings({ page, browserContext, report, output }) {
  const checks = report.settings = []
  const step = name => { checks.push(name); console.log(JSON.stringify({ stage: 'settings:' + name })) }
  const settings = page.locator('[data-dsh-predictions-settings]')
  const button = (name, root = settings) => root.getByRole('button', { name, exact: true })
  const open = async target => {
    await target.getByRole('button', { name: '插件', exact: true }).click()
    await target.getByText('@kkucodes/dsh-predictions', { exact: true }).first().click()
    await target.locator('[data-dsh-predictions-settings]').waitFor({ state: 'visible' })
  }
  const more = async (target = page) => {
    const s = target.locator('[data-dsh-predictions-settings]')
    if (await s.getByRole('button', { name: '更多设置', exact: true }).isVisible()) await s.getByRole('button', { name: '更多设置', exact: true }).click()
  }
  const save = async (target = page) => {
    const s = target.locator('[data-dsh-predictions-settings]')
    await s.getByRole('button', { name: '保存更改', exact: true }).click()
    await target.waitForFunction(() => document.querySelector('[data-dsh-predictions-settings] button.dshp-button-primary')?.disabled === true
      && document.querySelector('[data-dsh-predictions-settings]')?.getAttribute('aria-busy') === 'false')
  }
  const snapshot = async name => {
    await settings.locator('h2').first().scrollIntoViewIfNeeded()
    await settings.screenshot({ path: join(output, name + '.png') })
  }
  await open(page)
  assert.equal(await settings.getByText('已保存', { exact: true }).count(), 0)
  assert.equal(await settings.getByText('有未保存的更改', { exact: true }).count(), 0)
  for (const name of ['每日最多预测次数', '每日 token 额度', '每日估算费用上限（元，0 为关闭）']) {
    assert.equal(await settings.getByRole('spinbutton', { name, exact: true }).count(), 0)
  }
  await settings.getByText('调用模型会消耗 Token，由你的模型服务商计费。', { exact: true }).waitFor()
  await snapshot('settings-main-desktop')
  await button('查看明细').click()
  const details = settings.getByRole('dialog', { name: '用量明细', exact: true })
  await details.getByText('未定价调用', { exact: true }).first().waitFor()
  assert.ok(!(await details.innerText()).includes('预留'))
  await details.screenshot({ path: join(output, 'settings-usage-desktop.png') })
  await page.keyboard.press('Escape')
  await details.waitFor({ state: 'hidden' })
  assert.equal(await button('查看明细').evaluate(element => element === document.activeElement), true)
  step('usage-read-only-and-dialog-escape-restores-focus')
  await more()
  assert.equal(await settings.getByRole('table', { name: 'DeepSeek 官方模型价格', exact: true }).count(), 0)
  assert.equal(await settings.getByRole('combobox', { name: '计价方式', exact: true }).count(), 0)
  assert.equal(await settings.getByRole('link', { name: '官方来源', exact: true }).count(), 0)
  step('official-price-table-and-auto-pricing-removed')
  assert.equal(await settings.getByRole('spinbutton').count(), 5)
  assert.equal(await settings.getByRole('spinbutton', { name: '触发等待', exact: true }).count(), 0)
  assert.equal(await settings.getByRole('spinbutton', { name: '自动调用间隔', exact: true }).count(), 0)
  const outputField = settings.getByRole('spinbutton', { name: '最长输出', exact: true })
  await outputField.fill('16')
  await settings.getByText('请输入 32–256 之间的整数', { exact: true }).waitFor()
  assert.equal(await button('保存更改').isDisabled(), true)
  await outputField.fill('96')
  await button('撤销修改').click()
  const discard = settings.getByRole('dialog', { name: '撤销本次修改？', exact: true })
  await discard.waitFor({ state: 'visible' })
  await discard.getByRole('button', { name: '继续编辑', exact: true }).click()
  assert.equal(await outputField.inputValue(), '96')
  await button('撤销修改').click()
  await discard.getByRole('button', { name: '撤销修改', exact: true }).click()
  assert.equal(await outputField.inputValue(), '128')
  step('inline-validation-and-confirmed-revert')
  await outputField.fill('96')
  // 即时开关可与未保存参数共存，不造成自身版本冲突。
  await settings.getByRole('checkbox', { name: '效果测试', exact: true }).click()
  await save()
  assert.equal(await outputField.inputValue(), '96')
  await settings.getByRole('spinbutton', { name: '输入单价', exact: true }).fill('2')
  await settings.getByRole('spinbutton', { name: '输出单价', exact: true }).fill('4')
  await save()
  await snapshot('settings-more-desktop')
  await button('返回').click()
  await button('仅手动').click(); await save()
  await page.reload(); await open(page)
  assert.equal(await button('仅手动').getAttribute('aria-pressed'), 'true')
  await more()
  assert.equal(await outputField.inputValue(), '96')
  assert.equal(await settings.getByRole('spinbutton', { name: '输入单价', exact: true }).inputValue(), '2')
  step('mode-generation-prices-and-immediate-switch-persist')

  // 使用真实 settings/mutate 接口制造版本冲突，保留第二窗口草稿。
  const second = await browserContext.newPage()
  try {
    await second.goto(report.origin); await open(second); await more(second)
    const secondSettings = second.locator('[data-dsh-predictions-settings]')
    await secondSettings.getByRole('spinbutton', { name: '最长输出', exact: true }).fill('64')
    await page.bringToFront(); await more()
    await outputField.fill('128'); await save()
    await second.bringToFront()
    await secondSettings.getByRole('button', { name: '保存更改', exact: true }).click()
    await secondSettings.getByText('当前修改已保留', { exact: true }).waitFor()
    assert.equal(await secondSettings.getByRole('spinbutton', { name: '最长输出', exact: true }).inputValue(), '64')
    await secondSettings.getByRole('button', { name: '读取最新设置', exact: true }).click()
    await secondSettings.getByRole('dialog').getByRole('button', { name: '继续编辑', exact: true }).click()
    assert.equal(await secondSettings.getByRole('spinbutton', { name: '最长输出', exact: true }).inputValue(), '64')
    await secondSettings.getByRole('button', { name: '读取最新设置', exact: true }).click()
    await secondSettings.getByRole('dialog').getByRole('button', { name: '读取最新设置', exact: true }).click()
    assert.equal(await secondSettings.getByRole('spinbutton', { name: '最长输出', exact: true }).inputValue(), '128')
  } finally { await second.close() }
  step('real-multi-window-conflict-preserves-draft-and-confirmed-reload')

  await outputField.fill('64')
  const failSave = async route => route.abort('failed')
  await page.route('**/api/settings/mutate', failSave)
  await button('保存更改').click()
  await settings.getByText('保存失败', { exact: true }).waitFor()
  assert.equal(await outputField.inputValue(), '64')
  await page.unroute('**/api/settings/mutate', failSave)
  await save()
  step('save-network-error-preserves-draft-and-retry-succeeds')
  await button('返回').click()
  const failStatus = async route => route.abort('failed')
  await page.route('**/api/dsh-predictions/status', failStatus)
  await button('查看明细').click()
  await details.getByText('暂时无法读取用量', { exact: true }).waitFor()
  await page.unroute('**/api/dsh-predictions/status', failStatus)
  await details.getByRole('button', { name: '重新读取', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[aria-label="用量明细"] [role=alert]'))
  await page.keyboard.press('Escape')
  step('usage-network-error-and-explicit-read-only-retry')

  for (const [width, label] of [[768, 'narrow'], [390, 'mobile']]) {
    await page.setViewportSize({ width, height: 900 })
    await snapshot('settings-main-' + label)
    assert.ok(await settings.evaluate(element => element.scrollWidth <= element.clientWidth + 1))
    await more(); await snapshot('settings-more-' + label)
    assert.ok(await settings.evaluate(element => element.scrollWidth <= element.clientWidth + 1))
    await settings.getByRole('checkbox', { name: '效果测试', exact: true }).scrollIntoViewIfNeeded()
    assert.equal(await settings.getByRole('textbox', { name: '测试句', exact: true }).isVisible(), true)
    await button('保存更改').scrollIntoViewIfNeeded()
    await page.screenshot({ path: join(output, 'settings-more-' + label + '-bottom.png') })
    await button('返回').click(); await button('查看明细').click()
    await details.screenshot({ path: join(output, 'settings-usage-' + label + '.png') })
    assert.ok(await details.evaluate(element => element.scrollWidth <= element.clientWidth + 1))
    await page.keyboard.press('Escape')
  }
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.emulateMedia({ colorScheme: 'dark' }); await snapshot('settings-main-dark')
  await page.emulateMedia({ colorScheme: 'light' })
  // 所有设计图标已内嵌至插件包，离线或签名 URL 过期不会损坏图标。
  const assets = await settings.locator('img').evaluateAll(images => images.map(image => ({ src: image.getAttribute('src')?.slice(0, 32), width: image.naturalWidth, height: image.naturalHeight, rendered: [image.width, image.height] })))
  assert.ok(assets.length > 0 && assets.every(asset => asset.src.startsWith('data:image/svg+xml') && asset.width > 0 && asset.height > 0))
  report.settingsAssets = assets
  step('desktop-narrow-mobile-dark-and-local-svg-assets')
}
