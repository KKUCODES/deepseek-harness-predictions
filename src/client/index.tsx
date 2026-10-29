import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-shortcuts/client'
import type { ShortcutFixedCommand } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { ENTRY_ID, PACKAGE_NAME, validTestText, type PredictionConfig } from '../config.js'
import { SettingsPanel } from './settings.js'
import { PredictionPreview } from './preview.js'
import { PredictionStatus } from './status.js'
import { styles } from './styles.js'
import { Predictions } from './predictions.js'

export const inject = ['slots', 'configForms', 'shortcuts', 'connection']

export function apply(ctx: Context): void {
  const form = ctx.configForms.get<PredictionConfig>(ENTRY_ID)
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  let bus: BroadcastChannel | undefined
  try { if (typeof BroadcastChannel !== 'undefined') bus = new BroadcastChannel('dsh-predictions:cache') } catch {}
  const predictions = new Predictions(connection.rpc, connection.state, bus)
  ctx.effect(() => () => predictions.dispose(), 'dsh-predictions: client requests')
  ctx.effect(() => {
    const focus = () => predictions.revalidate()
    const visible = () => { if (document.visibilityState === 'visible') predictions.revalidate() }
    let fallbackTimer: ReturnType<typeof setTimeout> | undefined
    // 缺少窗口通知时，浏览器切换未必再次派发 window focus；返回输入框也核对一次。
    const returnToInput = (event: Event) => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-composer-input]') || fallbackTimer !== undefined) return
      fallbackTimer = setTimeout(() => { fallbackTimer = undefined; predictions.revalidateCached() }, 0)
    }
    window.addEventListener('focus', focus)
    document.addEventListener('visibilitychange', visible)
    if (!bus) {
      document.addEventListener('pointerdown', returnToInput, true)
      document.addEventListener('focusin', returnToInput, true)
    }
    return () => {
      clearTimeout(fallbackTimer)
      window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visible)
      document.removeEventListener('pointerdown', returnToInput, true); document.removeEventListener('focusin', returnToInput, true)
    }
  }, 'dsh-predictions: focus and connection cache recovery')
  // 一个窗口可以同时挂载多个会话输入框，固定快捷键目录只能注册一次。
  ctx.effect(() => {
    let release: (() => void) | undefined
    const sync = () => {
      const state = form.getSnapshot()
      const enabled = state.status === 'ready' && (state.value?.predictionEnabled
        || (state.value?.previewEnabled && validTestText(state.value.testText) !== undefined))
      if (enabled && !release) release = ctx.shortcuts.registerFixed({
        id: 'dsh-predictions.accept-test' as ShortcutFixedCommand['id'],
        label: () => '填入预测消息；双击 → 手动预测', keys: ['Tab', '→'], group: 'input',
        bindings: [{ code: 'Tab', modifiers: [] }, { code: 'ArrowRight', modifiers: [] }],
      })
      else if (!enabled && release) { release(); release = undefined }
    }
    const unsubscribe = form.subscribe(sync)
    sync()
    return () => { unsubscribe(); release?.() }
  }, 'dsh-predictions: fixed shortcut catalog')
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.dshPredictions = 'stage2'
    style.textContent = styles
    document.head.append(style)
    return () => { style.remove() }
  }, 'dsh-predictions: scoped styles')

  const Settings = () => <SettingsPanel form={form} rpc={connection.rpc} />
  const Preview = (props: PropsRuntime<'conversation.input.overlay'>) => <PredictionPreview {...props} form={form} shortcuts={ctx.shortcuts} predictions={predictions} />
  const Status = (props: PropsRuntime<'conversation.input.right'>) => <PredictionStatus {...props} form={form} predictions={predictions} />
  ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({ name: 'plugins.bundle.config', key: PACKAGE_NAME }, Settings))
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({ name: 'conversation.input.overlay', id: 'dsh-predictions.preview', order: 50 }, Preview))
  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({ name: 'conversation.input.right', id: 'dsh-predictions.status', order: 50 }, Status))
}
