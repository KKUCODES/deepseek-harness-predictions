import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readGlmKey } from './read-glm-key.mjs'

/** 需用户明确提供 GLM Key 才执行；只测试草稿，不把真实密钥写进隔离 profile。 */
export async function verifyBigModelReal({ page, report, output, keyFile }) {
  const key = await readGlmKey(keyFile)
  const settings = page.locator('[data-dsh-predictions-settings]')
  const button = name => settings.getByRole('button', { name, exact: true })
  const result = report.realCustomModel = { provider: 'BigModel', explicitRequests: 0, keySaved: false, checks: [] }
  await button('编辑').click()
  await settings.getByLabel('限制输出长度', { exact: true }).check()
  await settings.getByLabel('最大输出 Token', { exact: true }).fill('128')
  const secret = settings.getByLabel('API Key', { exact: true })
  try {
    await settings.getByRole('textbox', { name: 'API 地址', exact: true }).fill('https://open.bigmodel.cn/api/coding/paas/v4')
    await button('更换').click(); await secret.fill(key)
    const model = settings.getByRole('textbox', { name: '模型名称', exact: true })
    await model.fill('GLM-5.3-FlashX')
    await button('测试连接').click(); result.explicitRequests++
    await settings.getByText(/当前订阅套餐未开放该模型权限.*1311/u).waitFor()
    assert.equal((await settings.innerText()).includes(key), false)
    await settings.screenshot({ path: join(output, 'bigmodel-real-1311.png') })
    result.checks.push('real-FlashX-plan-permission-1311-is-explained')
    await model.fill('GLM-5.3-Flash')
    await button('测试连接').click(); result.explicitRequests++
    await settings.getByText('模型可用', { exact: true }).waitFor({ timeout: 20000 })
    await settings.screenshot({ path: join(output, 'bigmodel-real-success.png') })
    result.checks.push('real-Flash-test-succeeds-with-configured-128-token-output')
  } finally {
    // 基础验收器失败时会保存页面 HTML；先清空真实密码，避免把它带进故障附件。
    if (await secret.count()) {
      await secret.fill('')
      await page.waitForFunction(() => [...document.querySelectorAll('input[aria-label="API Key"]')].every(n => n.value === '' && !n.getAttribute('value')))
    }
    await button('返回').click()
    const dialog = settings.getByRole('dialog', { name: '放弃当前修改？', exact: true })
    await dialog.waitFor({ state: 'visible' })
    await dialog.getByRole('button', { name: '放弃修改', exact: true }).click()
  }
}
