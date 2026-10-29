import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { PROJECTION_KEY } from '../config.js'
import type { SettingsProps } from './settings.js'
import { usePredictionSettings } from './settings.js'
import type { Predictions, PredictionIndicatorState } from './predictions.js'
import emptyIcon from './assets/prediction-empty.svg'
import loadingIcon from './assets/prediction-loading.svg'
import readyIcon from './assets/prediction-ready.svg'

type StatusProps = PropsRuntime<'conversation.input.right'> & SettingsProps & { predictions: Predictions }
const messages: Record<PredictionIndicatorState, string> = {
  empty: '暂无预测', waiting: '等待自动生成', loading: '正在生成', ready: '已有预测',
  error: '请求失败，可双击 → 重试', timeout: '请求超时，可双击 → 重试',
}

/** 公开工具栏插槽只呈现状态，不 acquire 请求，也不接管输入焦点或按键。 */
export function PredictionStatus({ form, predictions, sessionId, useProjection, useSession }: StatusProps) {
  const config = usePredictionSettings(form)
  const turn = useProjection(PROJECTION_KEY)
  const running = useSession(state => state.running)
  const key = turn?.key ?? ''
  const read = useCallback(() => predictions.indicator(sessionId, key), [predictions, sessionId, key])
  const state = useSyncExternalStore(predictions.subscribe, read, read)
  const enabled = config.status === 'ready' && !!config.value?.predictionEnabled && !config.value.previewEnabled
  const shownState = running || turn !== undefined && !turn.key ? 'empty' : state
  const message = messages[shownState]
  const anchor = useRef<HTMLSpanElement>(null)
  const [hover, setHover] = useState(false)
  const [position, setPosition] = useState<CSSProperties>()
  const tooltipId = useId()

  useEffect(() => { setHover(false) }, [sessionId, enabled])
  useLayoutEffect(() => {
    if (!hover || !enabled) { setPosition(undefined); return }
    const place = () => {
      const rect = anchor.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(208, window.innerWidth - 24)
      setPosition({ width, left: Math.max(12, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 12)),
        top: rect.top >= 92 ? rect.top - 80 : rect.bottom + 12 })
    }
    const close = () => setHover(false)
    const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' || event.key === 'Tab') close() }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', close, true)
    window.addEventListener('blur', close)
    document.addEventListener('keydown', keydown)
    return () => {
      window.removeEventListener('resize', place); window.removeEventListener('scroll', close, true)
      window.removeEventListener('blur', close); document.removeEventListener('keydown', keydown)
    }
  }, [hover, enabled])

  if (!enabled) return null
  return <span ref={anchor} className="dshp-prediction-status" data-dsh-prediction-status={shownState}
    role="status" aria-label="预测消息状态" aria-live="polite" aria-atomic="true" aria-busy={shownState === 'loading'}
    aria-describedby={hover && position ? tooltipId : undefined}
    onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
    <img src={shownState === 'loading' ? loadingIcon : shownState === 'ready' ? readyIcon : emptyIcon}
      width={shownState === 'loading' ? 16 : 14} height={shownState === 'loading' ? 16 : 14} alt="" aria-hidden="true" />
    <span className="dshp-sr-only">{message}</span>
    {hover && position && <span id={tooltipId} role="tooltip" className="dshp-prediction-tooltip" style={position}>
      <strong>预测消息状态</strong><span>{message}</span>
    </span>}
  </span>
}
