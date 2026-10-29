import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { CUSTOM_ROUTE, DEFAULTS, RPC_CHANNEL, RPC_PREFIX, validTestText, type PredictionConfig, type PredictionStatus, type UsageTotals } from '../config.js'
import { controlSchema, type Controls } from '../usage.js'
import { Button, Dialog, Icon, Notice, Toggle, icons } from './settings-ui.js'
import { CustomModelPanel } from './custom-model.js'

export interface SettingsProps { form: ConfigForm<PredictionConfig> }
export function usePredictionSettings(form: ConfigForm<PredictionConfig>) {
  const subscribe = useCallback((listener: () => void) => form.subscribe(listener), [form])
  const read = useCallback(() => form.getSnapshot(), [form])
  return useSyncExternalStore(subscribe, read, read)
}

const fields = [
  { key: 'contextMessages', label: '最近消息', min: 2, max: 8, unit: '条', group: 'generation' },
  { key: 'contextChars', label: '上下文长度', min: 500, max: 4000, unit: '字符', group: 'generation' },
  { key: 'outputTokens', label: '最长输出', min: 32, max: 256, unit: 'Token', group: 'generation' },
  { key: 'inputPrice', label: '输入单价', min: 0, max: 100000, step: 0.0001, unit: '元 / 百万 Token', group: 'price' },
  { key: 'outputPrice', label: '输出单价', min: 0, max: 100000, step: 0.0001, unit: '元 / 百万 Token', group: 'price' },
] as const

const number = (value: number) => value.toLocaleString('zh-CN')
const compactNumber = (value: number) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(value).replace('K', 'k')
// 旧配置可能含失效路由或越界值：允许显示并修正，校验留在保存与模型调用边界。
const editableControls = (config: PredictionConfig): Controls => ({ automaticEnabled: config.automaticEnabled, modelRoute: config.modelRoute,
  contextMessages: config.contextMessages, contextChars: config.contextChars, outputTokens: config.outputTokens,
  inputPrice: config.inputPrice, outputPrice: config.outputPrice })
function amount(totals: UsageTotals, hasPrices: boolean) {
  return totals.calls === 0 ? hasPrices ? '¥0.00' : '—'
    : totals.calls === totals.unpricedCalls ? '—' : '¥' + (totals.amountMicros / 1000000).toFixed(6)
}
function UsageRows({ totals, cumulative, hasPrices }: { totals: UsageTotals; cumulative?: boolean; hasPrices: boolean }) {
  const rows = [['模型调用', number(totals.calls) + ' 次'],
    ...(cumulative ? [['输入 / 输出 Token', number(totals.inputTokens) + ' / ' + number(totals.outputTokens)]]
      : [['输入 Token', number(totals.inputTokens)], ['输出 Token', number(totals.outputTokens)]]),
    ['待核对调用', number(totals.uncertainCalls) + ' 次']]
  return <><dl className="dshp-data">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {!cumulative && <hr />}<dl className="dshp-data"><div><dt>已定价调用估算</dt><dd>{amount(totals, hasPrices)}</dd></div>
      <div><dt>未定价调用</dt><dd>{number(totals.unpricedCalls)} 次</dd></div></dl>
    {totals.unpricedCalls > 0 && <p className="dshp-caption">未设置单价，无法估算这部分费用。</p>}</>
}

export function SettingsPanel({ form, rpc }: SettingsProps & { rpc: ClientConnectionRpc }) {
  const snapshot = usePredictionSettings(form)
  const value = snapshot.value
  const [view, setView] = useState<'main' | 'advanced' | 'custom'>('main')
  const heading = useRef<HTMLHeadingElement>(null)
  const [text, setText] = useState('')
  const [textDirty, setTextDirty] = useState(false)
  const textBase = useRef('')
  const [textRevision, setTextRevision] = useState<number>()
  const [controls, setControls] = useState<Controls>({ ...DEFAULTS })
  const [controlsDirty, setControlsDirty] = useState(false)
  const controlsBase = useRef<Controls>({ ...DEFAULTS })
  const [controlsRevision, setControlsRevision] = useState<number>()
  const [busy, setBusy] = useState<'settings' | 'test' | 'toggle'>()
  const [notice, setNotice] = useState<{ title: string; tone: 'info' | 'error' | 'warning' | 'success'; body?: string }>()
  const [conflict, setConflict] = useState(false)
  const [confirm, setConfirm] = useState<'discard' | 'reload' | 'custom'>()
  const [details, setDetails] = useState(false)
  const [status, setStatus] = useState<PredictionStatus>()
  const [statusError, setStatusError] = useState(false)
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusVersion, setStatusVersion] = useState(0)
  const disabled = !!busy || !snapshot.writable
  const dirty = controlsDirty || textDirty
  const parsed = controlSchema.safeParse(controls)
  const testError = textDirty && validTestText(text) === undefined ? '请输入最多 240 个字符的单行测试文字' : ''
  const errors = new Map<string, string>()
  if (controlsDirty && !parsed.success) for (const issue of parsed.error.issues) {
    const field = fields.find(field => field.key === issue.path[0])
    errors.set(String(issue.path[0]), field ? '请输入 ' + field.min + '–' + field.max + ' 之间的' + ('step' in field ? '数字' : '整数') : issue.message)
  }
  const pricesReady = controls.inputPrice > 0 && controls.outputPrice > 0
  const refresh = () => setStatusVersion(version => version + 1)

  useEffect(() => {
    if (!value) return
    const latest = editableControls(value)
    if (!controlsDirty) { setControls(latest); controlsBase.current = latest }
    // 无关字段（如即时开关）变化不制造自冲突；真实并发编辑仍保留原版本栅栏。
    if (!controlsDirty || JSON.stringify(latest) === JSON.stringify(controlsBase.current)) setControlsRevision(snapshot.revision)
    if (!textDirty) { setText(value.testText); textBase.current = value.testText }
    if (!textDirty || value.testText === textBase.current) setTextRevision(snapshot.revision)
  }, [value, snapshot.revision, controlsDirty, textDirty])
  useEffect(() => {
    const controller = new AbortController()
    setStatusLoading(true); setStatusError(false)
    void rpc.call(RPC_CHANNEL, RPC_PREFIX + 'status', {}, controller.signal).then(result => {
      if (controller.signal.aborted) return
      if (result.ok) setStatus(result.value as PredictionStatus)
      else setStatusError(true)
    }).catch(() => { if (!controller.signal.aborted) setStatusError(true) })
      .finally(() => { if (!controller.signal.aborted) setStatusLoading(false) })
    return () => controller.abort()
  }, [rpc, statusVersion])
  useEffect(() => { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: 'nearest' }) }, [view])
  useEffect(() => {
    if (notice?.tone !== 'success') return
    const timer = setTimeout(() => setNotice(undefined), 3000)
    return () => clearTimeout(timer)
  }, [notice])

  const edit = <K extends keyof Controls>(key: K, next: Controls[K]) => {
    const updated = { ...controls, [key]: next }
    setControlsDirty(JSON.stringify(updated) !== JSON.stringify(controlsBase.current)); setControls(updated); setNotice(undefined)
  }
  const refused = (expectedRevision: number | undefined) => {
    // 公开表单把网络失败也折叠为 false；只有版本确实变化才提示编辑冲突。
    if (form.getSnapshot().revision !== expectedRevision) {
      setConflict(true)
      setNotice({ title: '当前修改已保留', body: '其他窗口保存了新设置，请读取后重新确认。', tone: 'warning' })
    } else setNotice({ title: '保存失败', body: '当前修改已保留，请检查连接后重试。', tone: 'error' })
  }
  const save = async (onlyText = false) => {
    if ((!onlyText && !parsed.success) || (textDirty && testError)) {
      setNotice({ title: '请检查输入', body: '有些设置超出允许范围，当前修改已保留。', tone: 'error' }); return
    }
    const revisions = [!onlyText && controlsDirty ? controlsRevision : undefined, textDirty ? textRevision : undefined].filter((n): n is number => n !== undefined)
    const expectedRevision = revisions.length ? Math.min(...revisions) : undefined
    const ops = [...(!onlyText && controlsDirty && parsed.success ? Object.entries(parsed.data).map(([key, next]) => ({ op: 'set' as const, path: [key], value: next })) : []),
      ...(textDirty ? [{ op: 'set' as const, path: ['testText'], value: validTestText(text)! }] : [])]
    if (!ops.length) return
    setBusy(onlyText ? 'test' : 'settings'); setNotice(undefined)
    try {
      if (await form.mutate(ops, expectedRevision)) {
        if (!onlyText) setControlsDirty(false)
        setTextDirty(false); setConflict(false); refresh()
      } else refused(expectedRevision)
    } catch { setNotice({ title: '保存失败', body: '当前修改已保留，请检查连接后重试。', tone: 'error' }) }
    finally { setBusy(undefined) }
  }
  const toggle = async (enabled: boolean, mode: 'real' | 'preview') => {
    setBusy('toggle'); setNotice(undefined)
    try {
      const field = mode === 'real' ? 'predictionEnabled' : 'previewEnabled'
      const other = mode === 'real' ? 'previewEnabled' : 'predictionEnabled'
      const ops = [{ op: 'set' as const, path: [field], value: enabled }, ...(enabled ? [{ op: 'set' as const, path: [other], value: false }] : [])]
      if (!await form.mutate(ops, snapshot.revision)) refused(snapshot.revision)
    } catch { setNotice({ title: '保存失败', body: '开关未更改，请检查与 Harness 的连接。', tone: 'error' }) }
    finally { setBusy(undefined) }
  }
  const restore = () => {
    const latest = form.getSnapshot()
    if (!latest.value) return
    setControls(editableControls(latest.value)); setControlsRevision(latest.revision); controlsBase.current = editableControls(latest.value)
    setText(latest.value.testText); setTextRevision(latest.revision); textBase.current = latest.value.testText
    setControlsDirty(false); setTextDirty(false); setConflict(false); setConfirm(undefined); setNotice(undefined)
  }
  const copyDraft = async () => {
    try { await navigator.clipboard.writeText(JSON.stringify({ ...controls, testText: text }, null, 2)); setNotice({ title: '当前修改已复制', tone: 'info' }) }
    catch { setNotice({ title: '复制失败', body: '当前修改仍保留在页面中。', tone: 'error' }) }
  }
  const numberFields = (group: 'generation' | 'price') => <div className="dshp-grid">
    {fields.filter(field => field.group === group && !(field.key === 'outputTokens' && controls.modelRoute === CUSTOM_ROUTE)).map(field => <label className="dshp-field" key={field.key}>
      <span>{field.label}</span><span className="dshp-input-wrap" data-error={errors.has(field.key) || undefined}>
        <input type="number" aria-label={field.label} aria-invalid={errors.has(field.key) || undefined} aria-describedby={errors.has(field.key) ? 'dshp-error-' + field.key : undefined}
          min={field.min} max={field.max} step={'step' in field ? field.step : 1} disabled={disabled}
          value={Number.isFinite(controls[field.key]) ? controls[field.key] : ''} onChange={event => edit(field.key, event.target.valueAsNumber)} />
        <span className="dshp-unit" aria-hidden="true">{field.unit}</span></span>
      {errors.has(field.key) && <span className="dshp-field-error" id={'dshp-error-' + field.key}>{errors.get(field.key)}</span>}
    </label>)}
  </div>

  if (view === 'custom' && value) return <CustomModelPanel form={form} snapshot={snapshot} rpc={rpc}
    onBack={() => setView('main')} onSaved={() => { setView('main'); refresh() }} />

  return <section className="dshp-settings" data-dsh-predictions-settings data-view={view} aria-busy={busy !== undefined}>
    <div className="dshp-stack">
      <header className={view === 'main' ? 'dshp-heading' : 'dshp-row dshp-subhead'}>
        <h2 ref={heading} tabIndex={-1}>{view === 'main' ? '预测消息' : '更多设置'}</h2>
        {view === 'main' ? <p className="dshp-caption">DSH Predictions</p> : <Button kind="ghost" onClick={() => setView('main')}>返回</Button>}
      </header>
      {snapshot.status === 'loading' && <div className="dshp-skeleton" role="status" aria-label="正在读取设置"><span /><span /><span /></div>}
      {snapshot.status === 'unavailable' && <Notice tone="error" title="暂时无法读取设置">请检查插件是否已启用及宿主连接。</Notice>}
      {value !== undefined && <>
        {view === 'main' ? <>
          <div className="dshp-sample" aria-label="输入框效果示意"><p>继续，先把搜索逻辑补齐。</p><div><kbd>Tab / →</kbd><span>填入</span><kbd>→ →</kbd><span>空白无建议时生成</span></div></div>
          <div className="dshp-enable"><div className="dshp-row"><strong>启用预测消息</strong><Toggle label="启用预测消息" checked={value.predictionEnabled} disabled={disabled} onChange={next => { void toggle(next, 'real') }} /></div>
            <p className="dshp-caption">调用模型会消耗 Token，由你的模型服务商计费。</p></div>
          <div className="dshp-options">
            <div className="dshp-option"><span id="dshp-mode-label">生成方式</span><div className="dshp-segment" role="group" aria-labelledby="dshp-mode-label">
              {[true, false].map(automatic => <button key={String(automatic)} type="button" aria-pressed={controls.automaticEnabled === automatic} disabled={disabled}
                onClick={() => edit('automaticEnabled', automatic)} title={automatic ? '助手回复后自动生成，也可手动触发' : '空输入框无建议时，双次右箭头生成'}>{automatic ? '自动' : '仅手动'}</button>)}</div></div>
            <div className="dshp-option"><label htmlFor="dshp-model">预测模型</label><div className="dshp-model-choice"><select id="dshp-model" aria-label="预测模型" value={controls.modelRoute} disabled={disabled || (statusLoading && !status)} onChange={event => edit('modelRoute', event.target.value)}>
              <option value="">{statusLoading && !status ? '读取模型…' : '跟随当前会话'}</option>
              {value.customModel && <option value={CUSTOM_ROUTE}>{value.customModel}</option>}
              {controls.modelRoute && controls.modelRoute !== CUSTOM_ROUTE && !status?.models.some(model => model.route === controls.modelRoute) && <option value={controls.modelRoute}>已保存的模型（当前不可用）</option>}
              {status?.models.map(model => <option value={model.route} key={model.route}>{model.label}</option>)}</select>
              <Button kind="ghost" disabled={disabled} onClick={() => dirty ? setConfirm('custom') : setView('custom')}>{controls.modelRoute === CUSTOM_ROUTE ? '编辑' : '自定义连接'}</Button></div></div>
            {controls.modelRoute && controls.modelRoute !== CUSTOM_ROUTE && status && !status.models.some(model => model.route === controls.modelRoute) && <p className="dshp-field-error">所选模型暂不可用，请在宿主配置模型后重选。</p>}
            {status?.catalogIncomplete && <p className="dshp-caption">部分模型目录读取失败。<Button kind="ghost" disabled={statusLoading} onClick={refresh}>重新读取</Button></p>}
          </div><hr />
          <section className="dshp-stack dshp-usage-summary" aria-label="今日用量"><div className="dshp-row"><h3>今日用量</h3><Button kind="ghost" onClick={() => { setDetails(true); refresh() }}>查看明细</Button></div>
            {statusError ? <Notice tone="error" title="暂时无法读取用量"><Button disabled={statusLoading} onClick={refresh}>重新读取</Button></Notice>
              : <div className="dshp-metrics" aria-busy={statusLoading}>
                <div><span className="dshp-caption">Token</span>{statusLoading && !status ? <span className="dshp-skeleton-bar" /> : <strong title={status ? number(status.today.inputTokens + status.today.outputTokens) + ' Token' : undefined}>{status ? compactNumber(status.today.inputTokens + status.today.outputTokens) : '—'}</strong>}<span className="dshp-caption">已返回用量</span></div>
                <div><span className="dshp-caption">模型费用估算</span>{statusLoading && !status ? <span className="dshp-skeleton-bar" /> : <strong>{status ? amount(status.today, pricesReady) : '—'}</strong>}
                  <span className="dshp-caption">{!status || !status.today.calls ? pricesReady ? '按已填单价估算' : '未设置单价' : status.today.unpricedCalls ? '含未定价调用' : '按调用时单价估算'}</span></div>
              </div>}
          </section><hr />
          <Button kind="ghost" className="dshp-more" onClick={() => setView('advanced')}>更多设置<Icon src={icons.chevron} /></Button>
        </> : <>
          <section className="dshp-stack"><h3 className="dshp-section-title">生成参数</h3>{numberFields('generation')}</section><hr />
          <section className="dshp-stack"><h3 className="dshp-section-title">费用估算（可选）</h3>{numberFields('price')}
            <p className="dshp-caption">填写模型服务商单价，仅用于估算费用，不代表服务商账单。</p></section><hr />
          <section className="dshp-stack dshp-test"><div className="dshp-row"><h3>效果测试</h3><Toggle label="效果测试" checked={value.previewEnabled} disabled={disabled} onChange={next => { void toggle(next, 'preview') }} /></div>
            <p className="dshp-caption">固定测试句，不调用模型；开启后暂停真实预测。</p>
            <label className="dshp-field"><span>测试句</span><input aria-label="测试句" type="text" value={text} disabled={disabled} aria-invalid={!!testError || undefined}
              aria-describedby={testError ? 'dshp-test-error' : undefined} onChange={event => { setTextDirty(event.target.value !== textBase.current); setText(event.target.value); setNotice(undefined) }} />
              {testError && <span className="dshp-field-error" id="dshp-test-error">{testError}</span>}</label>
            <div className="dshp-actions"><Button disabled={disabled || !textDirty || !!testError} busy={busy === 'test'} onClick={() => { void save(true) }}>{busy === 'test' ? '保存中' : '保存测试句'}</Button></div>
          </section><hr />
        </>}
        {notice && <Notice title={notice.title} tone={notice.tone}>{notice.body}</Notice>}
        {conflict && <div className="dshp-actions"><Button disabled={!!busy} onClick={() => { void copyDraft() }}>复制当前修改</Button><Button disabled={!!busy} onClick={() => setConfirm('reload')}>读取最新设置</Button></div>}
        {!snapshot.writable && <Notice title="当前设置只读">无法保存修改。</Notice>}
        <footer className="dshp-row dshp-footer">
          <div className="dshp-actions">{dirty && <Button kind="ghost" disabled={!!busy} onClick={() => setConfirm('discard')}>撤销修改</Button>}
            <Button kind="primary" disabled={disabled || !dirty || !parsed.success || !!testError} busy={busy === 'settings'} onClick={() => { void save() }}>{busy === 'settings' ? '保存中' : '保存更改'}</Button></div></footer>
      </>}
    </div>
    <Dialog open={details} title="用量明细" onClose={() => setDetails(false)}>
      {statusLoading && !status && <p role="status">正在读取用量…</p>}
      {statusError && <Notice tone="error" title="暂时无法读取用量"><Button disabled={statusLoading} onClick={refresh}>重新读取</Button></Notice>}
      {status && <><div className="dshp-row"><strong>今天 · {status.day}</strong><span className="dshp-caption">UTC+8</span></div>
        {status.today.calls === 0 && <div className="dshp-empty"><Icon src={icons.file} /><strong>今天还没有预测</strong><span className="dshp-caption">第一次调用后，这里会显示用量。</span></div>}
        <UsageRows totals={status.today} hasPrices={pricesReady} /><hr /><h3 className="dshp-section-title">累计</h3><UsageRows totals={status.total} cumulative hasPrices={pricesReady} />
        <p className="dshp-caption">仅统计本插件。未返回完整用量的调用会单独记录。</p></>}
      <div className="dshp-actions"><Button disabled={statusLoading} busy={statusLoading} onClick={refresh}>更新统计</Button></div>
    </Dialog>
    <Dialog open={confirm !== undefined} title={confirm === 'reload' ? '读取最新设置？' : confirm === 'custom' ? '进入自定义模型？' : '撤销本次修改？'} compact onClose={() => setConfirm(undefined)}>
      <p>{confirm === 'reload' ? '将替换当前未保存的修改。你可以返回，先复制当前修改。' : confirm === 'custom' ? '当前页面的未保存修改将被放弃。' : '将恢复为上次保存的设置。'}</p>
      <div className="dshp-actions"><Button onClick={() => setConfirm(undefined)}>继续编辑</Button><Button kind="primary" onClick={() => { restore(); if (confirm === 'custom') setView('custom') }}>{confirm === 'reload' ? '读取最新设置' : confirm === 'custom' ? '放弃并继续' : '撤销修改'}</Button></div>
    </Dialog>
  </section>
}
