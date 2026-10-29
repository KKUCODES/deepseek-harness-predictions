import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { Shortcuts } from '@deepseek-ai/dsh-client-shortcuts/client'
import type { SettingsProps } from './settings.js'
import { usePredictionSettings } from './settings.js'
import { DEFAULTS, PROJECTION_KEY, validTestText } from '../config.js'
import type { Predictions } from './predictions.js'
import { ArrowTaps } from './arrow-taps.js'

type PreviewProps = PropsRuntime<'conversation.input.overlay'> & SettingsProps & { shortcuts: Shortcuts; predictions: Predictions }
interface Surface { editor: HTMLElement; style: CSSProperties }

function openMenu(document: Document): boolean {
  return [...document.querySelectorAll<HTMLElement>('[role=menu], [role=listbox]')]
    .some(element => element.getClientRects().length > 0 && !element.hidden)
}

/** 只观察宿主公开 DOM 标记；灰字、样式与监听都属于插件并在卸载时撤下。 */
export function PredictionPreview({ form, shortcuts, predictions, sessionId, useProjection, useInput, useSession, inputActions }: PreviewProps) {
  const config = usePredictionSettings(form)
  const input = useInput(state => state)
  const running = useSession(state => state.running)
  const turn = useProjection(PROJECTION_KEY)
  const [visible, setVisible] = useState(document.visibilityState === 'visible')
  const anchor = useRef<HTMLSpanElement>(null)
  const [surface, setSurface] = useState<Surface>()
  const [dismissedRev, setDismissedRev] = useState<number>()
  const arrows = useRef(new ArrowTaps())
  const current = useRef({ input, running, text: undefined as string | undefined })
  const projectedKey = turn?.key ?? ''
  const readPrediction = useCallback(() => predictions.read(sessionId, projectedKey), [predictions, sessionId, projectedKey])
  const prediction = useSyncExternalStore(predictions.subscribe, readPrediction, readPrediction)
  const key = turn === undefined ? prediction?.key ?? '' : projectedKey
  useEffect(() => setDismissedRev(undefined), [key, sessionId])
  const empty = input.draft === '' && input.phase === 'plain'
    && input.attachmentIds.length === 0 && input.occurrences.length === 0 && input.queue.length === 0
  const realEnabled = config.status === 'ready' && !!config.value?.predictionEnabled && !config.value.previewEnabled
  const canOperate = realEnabled && empty && !running && visible
  const canRequest = canOperate && !!key
  useEffect(() => { if (running) predictions.forget(sessionId) }, [running, predictions, sessionId])
  useEffect(() => {
    const sync = () => setVisible(document.visibilityState === 'visible')
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])
  useEffect(() => {
    if (!canOperate) return
    return predictions.acquire(sessionId, key, { automaticEnabled: config.value?.automaticEnabled ?? DEFAULTS.automaticEnabled })
  }, [predictions, sessionId, key, canOperate, config.value?.automaticEnabled])
  // 草稿非空时只隐藏灰字，保留本轮结果；撤销或清空后直接复用，不重新请求模型。
  const text = config.status === 'ready' && config.value?.previewEnabled ? validTestText(config.value.testText)
    : canRequest && prediction?.status === 'ready' && prediction.key === key ? prediction.text : undefined
  current.current = { input, running, text }
  const eligible = text !== undefined && empty && !running && dismissedRev !== input.draftRev
  const shown = eligible && surface !== undefined

  useLayoutEffect(() => {
    const node = anchor.current
    const card = node?.closest('[data-composer-card]')
    const editor = card?.querySelector<HTMLElement>('[data-composer-input]')
    if (!node || !card || !editor) { setSurface(undefined); return }
    let disposed = false
    const measure = () => {
      if (disposed) return
      if (!editor.isConnected || !editor.isContentEditable || editor.getAttribute('aria-disabled') === 'true') {
        setSurface(undefined)
        return
      }
      const rect = editor.getBoundingClientRect()
      const base = node.getBoundingClientRect()
      const style = getComputedStyle(editor)
      if (rect.width === 0 || rect.height === 0) { setSurface(undefined); return }
      const next: Surface = { editor, style: {
        left: rect.left - base.left + parseFloat(style.paddingLeft || '0'),
        top: rect.top - base.top + parseFloat(style.paddingTop || '0'),
        width: Math.max(0, rect.width - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0')),
        fontFamily: style.fontFamily, fontSize: style.fontSize, fontWeight: style.fontWeight,
        fontStyle: style.fontStyle, lineHeight: style.lineHeight, letterSpacing: style.letterSpacing,
        color: style.color, opacity: 0.45,
      } }
      setSurface(previous => previous?.editor === editor && JSON.stringify(previous.style) === JSON.stringify(next.style) ? previous : next)
    }
    const resize = new ResizeObserver(measure)
    resize.observe(editor)
    resize.observe(card)
    const changes = new MutationObserver(measure)
    changes.observe(editor, { attributes: true, attributeFilter: ['class', 'style', 'contenteditable', 'aria-disabled'] })
    changes.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] })
    window.addEventListener('resize', measure)
    document.fonts.ready.then(measure).catch(() => {})
    measure()
    return () => { disposed = true; resize.disconnect(); changes.disconnect(); window.removeEventListener('resize', measure) }
  }, [eligible, canOperate, sessionId])

  useEffect(() => {
    if (!surface || (!shown && !canOperate)) return
    const cancelArrow = () => arrows.current.cancel()
    const mayEdit = () => {
      const latest = current.current
      return !latest.running && latest.input.draft === '' && latest.input.phase === 'plain'
        && latest.input.attachmentIds.length === 0 && latest.input.occurrences.length === 0 && latest.input.queue.length === 0
        && surface.editor.isContentEditable && !surface.editor.textContent
    }
    surface.editor.addEventListener('blur', cancelArrow)
    surface.editor.addEventListener('beforeinput', cancelArrow)
    surface.editor.addEventListener('compositionstart', cancelArrow)
    const disposeInput = shortcuts.observeFixedInput(event => {
      if (event.type !== 'keydown') return
      const { gesture, context } = event
      if (gesture.code !== 'ArrowRight') cancelArrow()
      if (gesture.defaultPrevented || gesture.composing || gesture.repeat || gesture.control || gesture.alt
        || gesture.meta || gesture.shift || context.modal !== null || context.region !== 'editable'
        || !context.target || !surface.editor.contains(context.target) || openMenu(surface.editor.ownerDocument)) {
        cancelArrow(); return
      }
      const latest = current.current
      if (!mayEdit()) { cancelArrow(); return }
      if (gesture.code === 'Escape') {
        if (!latest.text) return
        setDismissedRev(latest.input.draftRev)
        if (realEnabled) predictions.dismiss(sessionId, key)
        event.consume(); return
      }
      if (gesture.code !== 'Tab' && gesture.code !== 'ArrowRight') return
      const accept = () => {
        const now = current.current
        if (!latest.text || now.text !== latest.text || now.input.draftRev !== latest.input.draftRev || !mayEdit()) return false
        const span = inputActions.captureInsertion()
        // 延迟确认单次右箭头时，仍须重新比较草稿版本，不能覆盖新编辑。
        return span.draftRev === now.input.draftRev && inputActions.insertText(latest.text, span)
      }
      if (gesture.code === 'ArrowRight' && realEnabled && canOperate) {
        arrows.current.press(() => {
          if (surface.editor.contains(surface.editor.ownerDocument.activeElement) && !openMenu(surface.editor.ownerDocument)) accept()
        }, () => {
          if (!mayEdit() || current.current.text) return
          setDismissedRev(undefined)
          predictions.manual(sessionId, projectedKey)
        })
        event.consume()
      } else if (accept()) event.consume()
    })
    return () => {
      cancelArrow(); disposeInput()
      surface.editor.removeEventListener('blur', cancelArrow)
      surface.editor.removeEventListener('beforeinput', cancelArrow)
      surface.editor.removeEventListener('compositionstart', cancelArrow)
    }
  }, [shown, canOperate, surface, shortcuts, inputActions, predictions, sessionId, key, projectedKey, realEnabled])

  return <span ref={anchor} className="dshp-anchor" aria-hidden="true">
    {shown && <span className="dshp-ghost" style={surface.style} data-dsh-prediction-active="true">{text}</span>}
  </span>
}
