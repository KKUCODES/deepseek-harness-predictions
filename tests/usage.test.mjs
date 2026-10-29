import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULTS, usageDay, startUsage, settleUsage, emptyTotals, controlSchema, totalsSchema, sumTotals } from '../lib/usage.js'

test('统计按 UTC+8 分日；生成参数仍校验，旧每日限制不再属于配置', () => {
  assert.equal(usageDay(Date.parse('2026-10-27T15:59:59Z')), '2026-10-27')
  assert.equal(usageDay(Date.parse('2026-10-27T16:00:00Z')), '2026-10-28')
  for (const patch of [{ outputTokens: 512 }, { contextChars: 4001 }, { contextMessages: 2.5 }, { inputPrice: NaN }, { modelRoute: 'made-up' }]) {
    assert.equal(controlSchema.safeParse({ ...DEFAULTS, ...patch }).success, false)
  }
  assert.deepEqual(controlSchema.parse({ ...DEFAULTS, dailyCalls: 0, dailyTokens: -1, dailyAmount: 1 }), { ...DEFAULTS })
  assert.deepEqual(controlSchema.parse({ ...DEFAULTS, pricingMode: 'auto' }), { ...DEFAULTS })
  assert.deepEqual(controlSchema.parse({ ...DEFAULTS, delayMs: 5000, cooldownSeconds: 300 }), { ...DEFAULTS })
  assert.deepEqual(controlSchema.parse({ ...DEFAULTS, delayMs: -1, cooldownSeconds: 'invalid' }), { ...DEFAULTS })
})

test('未知用量只记待核对；返回用量按调用时价格结算，不预占额度', () => {
  const settings = { ...DEFAULTS, inputPrice: 2, outputPrice: 4 }
  const pending = startUsage(emptyTotals(), settings)
  assert.equal(pending.calls, 1)
  assert.equal(pending.uncertainCalls, 1)
  assert.equal('reservedTokens' in pending, false)
  assert.deepEqual(settleUsage(pending, undefined, settings), pending)
  assert.deepEqual(settleUsage(pending, { inputTokens: NaN, outputTokens: 1 }, settings), pending)
  const done = settleUsage(pending, { inputTokens: 100, outputTokens: 10 }, settings)
  assert.equal(done.uncertainCalls, 0)
  assert.equal(done.inputTokens, 100)
  assert.equal(done.outputTokens, 10)
  assert.equal(done.amountMicros, 240)
})

test('旧账本保留次数、实际 tokens 与历史费用；旧预留字段丢弃且从不限制新调用', () => {
  const legacy = { ...emptyTotals(), calls: 5000, inputTokens: 10000000, outputTokens: 2000000,
    uncertainCalls: 3, unpricedCalls: 4, amountMicros: 100000000, reservedTokens: 99999999, reservedMicros: 99999999, officialPriceCalls: 5000 }
  const decoded = totalsSchema.parse(legacy)
  assert.equal(decoded.calls, 5000)
  assert.equal(decoded.amountMicros, 100000000)
  assert.equal('reservedTokens' in decoded, false)
  assert.equal('officialPriceCalls' in decoded, false)
  assert.equal(startUsage(decoded, DEFAULTS).calls, 5001)
  assert.equal(startUsage(decoded, DEFAULTS).unpricedCalls, 5)
  assert.deepEqual(sumTotals([decoded, emptyTotals()]), decoded)
})
