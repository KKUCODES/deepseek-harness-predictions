import test from 'node:test'
import assert from 'node:assert/strict'
import { ArrowTaps, DOUBLE_ARROW_MS } from '../src/client/arrow-taps.ts'

test('单次右箭头延迟确认，双次只触发一次手动动作', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const taps = new ArrowTaps()
  let accepted = 0, manual = 0
  const press = () => taps.press(() => accepted++, () => manual++)
  press()
  t.mock.timers.tick(DOUBLE_ARROW_MS - 1)
  assert.equal(accepted, 0)
  press()
  assert.equal(manual, 1)
  t.mock.timers.tick(DOUBLE_ARROW_MS + 1)
  assert.equal(accepted, 0)
  press()
  t.mock.timers.tick(DOUBLE_ARROW_MS)
  assert.equal(accepted, 1)
})

test('超过双击时间视为两次单按，取消后没有迟到插入', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const taps = new ArrowTaps()
  let accepted = 0, manual = 0
  const press = () => taps.press(() => accepted++, () => manual++)
  press(); t.mock.timers.tick(DOUBLE_ARROW_MS + 1)
  press(); t.mock.timers.tick(DOUBLE_ARROW_MS + 1)
  assert.equal(accepted, 2)
  assert.equal(manual, 0)
  press(); taps.cancel(); t.mock.timers.tick(DOUBLE_ARROW_MS + 1)
  assert.equal(accepted, 2)
})
