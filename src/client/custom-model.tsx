import { useEffect, useRef, useState } from 'react'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client'
import { CUSTOM_ROUTE, RPC_CHANNEL, RPC_PREFIX, type PredictionConfig } from '../config.js'
import { apiKeySchema, customDraftSchema, normalizeBaseURL, type CustomKeyInfo } from '../custom-model.js'
import { Button, Dialog, Notice } from './settings-ui.js'
import { customRequestOf, requestParametersSchema } from '../request-parameters.js'
import { RequestParametersEditor } from './request-parameters.js'

interface Props {
  form: ConfigForm<PredictionConfig>
  snapshot: ConfigFormSnapshot<PredictionConfig>
  rpc: ClientConnectionRpc
  onBack: () => void
  onSaved: () => void
}
const connectionOf = (value: PredictionConfig) => {
  // 配置文件被外部编辑损坏时仍能进入面板修正，不能使整个设置页崩溃。
  let request
  try { request = customRequestOf(value) } catch {
    request = { maxTokensEnabled: !!value.customMaxTokensEnabled, maxTokens: value.customMaxTokens ?? '', parameters: [] }
  }
  return { baseURL: value.customBaseURL, model: value.customModel, credential: value.customCredential, request }
}

export function CustomModelPanel({ form, snapshot, rpc, onBack, onSaved }: Props) {
  const value = snapshot.value!
  const [draft, setDraft] = useState(() => connectionOf(value))
  const base = useRef(connectionOf(value))
  const revision = useRef(snapshot.revision)
  const [key, setKey] = useState('')
  const [replaceKey, setReplaceKey] = useState(!value.customCredential)
  const [showKey, setShowKey] = useState(false)
  const [info, setInfo] = useState<CustomKeyInfo>()
  const [infoError, setInfoError] = useState(false)
  const [infoVersion, setInfoVersion] = useState(0)
  const [busy, setBusy] = useState<'test' | 'save'>()
  const [result, setResult] = useState<{ success: boolean; text: string }>()
  const [error, setError] = useState<string>()
  const [conflict, setConflict] = useState(false)
  const [confirm, setConfirm] = useState<'back' | 'reload'>()
  const controller = useRef<AbortController>()
  const heading = useRef<HTMLHeadingElement>(null)
  const dirty = JSON.stringify(draft) !== JSON.stringify(base.current) || !!key
  const parsed = customDraftSchema.safeParse(draft)
  const keyValid = replaceKey ? apiKeySchema.safeParse(key).success : !!info?.configured && info.credential === draft.credential
  const valid = parsed.success && requestParametersSchema.safeParse(draft.request).success && keyValid
  const disabled = !!busy || !snapshot.writable
  const canSave = valid && (dirty || value.modelRoute !== CUSTOM_ROUTE)
  const [touched, setTouched] = useState(() => new Set<string>())

  useEffect(() => { heading.current?.focus({ preventScroll: true }); heading.current?.scrollIntoView({ block: 'nearest' }); return () => controller.current?.abort() }, [])
  useEffect(() => {
    const latest = connectionOf(value)
    if (JSON.stringify(latest) !== JSON.stringify(base.current)) { controller.current?.abort(); setResult(undefined) }
    if (!dirty) { setDraft(latest); base.current = latest; setReplaceKey(!latest.credential); setResult(undefined) }
    if (!dirty || JSON.stringify(latest) === JSON.stringify(base.current)) revision.current = snapshot.revision
  }, [value, snapshot.revision, dirty])
  useEffect(() => {
    const request = new AbortController()
    setInfo(undefined); setInfoError(false)
    void rpc.call(RPC_CHANNEL, RPC_PREFIX + 'custom/info', {}, request.signal).then(reply => {
      if (request.signal.aborted) return
      if (reply.ok) setInfo(reply.value as CustomKeyInfo)
      else setInfoError(true)
    }).catch(() => { if (!request.signal.aborted) setInfoError(true) })
    return () => request.abort()
  }, [rpc, value.customCredential, infoVersion])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const edit = (field: 'baseURL' | 'model', next: string) => {
    setDraft(previous => ({ ...previous, [field]: next })); setResult(undefined); setError(undefined)
  }
  const restore = () => {
    const latest = form.getSnapshot()
    if (!latest.value) return
    const connection = connectionOf(latest.value)
    base.current = connection; revision.current = latest.revision; setDraft(connection)
    setKey(''); setShowKey(false); setReplaceKey(!connection.credential); setConflict(false); setError(undefined)
    setResult(undefined); setConfirm(undefined); setInfoVersion(n => n + 1)
  }
  const test = async () => {
    if (!valid || busy) return
    const request = new AbortController(); controller.current = request
    setBusy('test'); setError(undefined); setResult(undefined)
    try {
      const reply = await rpc.call(RPC_CHANNEL, RPC_PREFIX + 'custom/test', { baseURL: normalizeBaseURL(draft.baseURL), model: draft.model.trim(),
        request: draft.request,
        ...(replaceKey ? { apiKey: key.trim() } : { credential: draft.credential }) }, request.signal)
      if (request.signal.aborted) return
      setResult(reply.ok ? { success: true, text: '测试通过；保存后用于预测。' }
        : { success: false, text: reply.error.message })
    } catch { if (!request.signal.aborted) setResult({ success: false, text: '无法完成测试，请检查与 Harness 的连接。' }) }
    finally { if (controller.current === request) { controller.current = undefined; setBusy(undefined) } }
  }
  const save = async () => {
    if (!canSave || busy) return
    const expected = revision.current
    setBusy('save'); setError(undefined)
    try {
      let credential = draft.credential
      if (replaceKey) {
        const reply = await rpc.call(RPC_CHANNEL, RPC_PREFIX + 'custom/key', { apiKey: key.trim() })
        if (!reply.ok) { setError('密钥未能保存，请检查凭据服务后重试。'); return }
        credential = (reply.value as { credential: string }).credential
      }
      // 引用和连接字段随模型选择原子保存；API Key 从未进入公开配置或复制草稿。
      const values = { customBaseURL: normalizeBaseURL(draft.baseURL)!, customModel: draft.model.trim(), customCredential: credential, modelRoute: CUSTOM_ROUTE,
        customRequestConfigured: true, customMaxTokensEnabled: draft.request.maxTokensEnabled, customMaxTokens: draft.request.maxTokens.trim(),
        customParameters: JSON.stringify(draft.request.parameters.map(row => ({ ...row, key: row.key.trim() }))) }
      const accepted = await form.mutate(Object.entries(values).map(([field, next]) => ({ op: 'set' as const, path: [field], value: next })), expected)
      if (accepted) { setKey(''); setShowKey(false); onSaved() }
      else if (form.getSnapshot().revision !== expected) { setConflict(true); setError('其他窗口保存了新设置，当前修改已保留。') }
      else setError('未能保存配置，填写内容已保留，请重试。')
    } catch { setError('未能保存配置，填写内容已保留，请检查连接后重试。') }
    finally { setBusy(undefined) }
  }
  const fieldError = (field: 'baseURL' | 'model') => {
    if (!touched.has(field) || parsed.success) return undefined
    return parsed.error.issues.find(issue => issue.path[0] === field)?.message
  }
  const blur = (field: string) => setTouched(previous => new Set([...previous, field]))

  return <section className="dshp-settings dshp-custom" data-dsh-predictions-settings data-view="custom" aria-busy={!!busy}>
    <div className="dshp-stack">
      <header className="dshp-row dshp-custom-heading"><h2 ref={heading} tabIndex={-1}>自定义模型</h2>
        <Button kind="ghost" disabled={!!busy} onClick={() => dirty ? setConfirm('back') : onBack()}>返回</Button></header>
      <div className="dshp-custom-intro"><p className="dshp-caption dshp-custom-subtitle">用于预测，不影响聊天模型。</p>
        <p className="dshp-caption">仅支持 OpenAI 兼容 Chat Completions。</p></div>
      <label className="dshp-field"><span>API 地址</span><input type="text" aria-label="API 地址" autoComplete="off" spellCheck={false}
        value={draft.baseURL} placeholder="https://api.example.com/v1" disabled={disabled} onChange={event => edit('baseURL', event.target.value)} onBlur={() => blur('baseURL')}
        aria-invalid={!!fieldError('baseURL') || undefined} aria-describedby="dshp-custom-url-hint" />
        <span className="dshp-caption" id="dshp-custom-url-hint">填写基础地址，不含 /chat/completions。</span>
        {fieldError('baseURL') && <span className="dshp-field-error">{fieldError('baseURL')}</span>}</label>
      <label className="dshp-field"><span>API Key</span><span className="dshp-input-wrap dshp-secret">
        <input type={showKey && replaceKey ? 'text' : 'password'} aria-label="API Key" autoComplete="new-password" spellCheck={false}
          readOnly={!replaceKey} disabled={disabled || (!replaceKey && !info)} value={replaceKey ? key : ''} placeholder={replaceKey ? '填写服务商密钥' : '已保存密钥'}
          onChange={event => { setKey(event.target.value); setResult(undefined); setError(undefined) }} onBlur={() => blur('key')}
          aria-invalid={replaceKey && !!key && !apiKeySchema.safeParse(key).success || undefined} />
        <Button kind="ghost" disabled={disabled || !info?.writable} onClick={() => {
          if (!replaceKey) { setReplaceKey(true); setResult(undefined); setShowKey(false) } else setShowKey(n => !n)
        }}>{!replaceKey ? '更换' : showKey ? '隐藏' : '显示'}</Button></span>
        {replaceKey && !!key && !apiKeySchema.safeParse(key).success && <span className="dshp-field-error">请输入有效的 API Key。</span>}</label>
      {infoError && <Notice tone="error" title="无法读取密钥状态"><Button onClick={() => setInfoVersion(n => n + 1)}>重新读取</Button></Notice>}
      {info && !info.writable && <Notice title="凭据服务只读">当前不能保存或更换密钥。</Notice>}
      <label className="dshp-field"><span>模型名称</span><input type="text" aria-label="模型名称" autoComplete="off" spellCheck={false}
        placeholder="填写模型 ID，例如 my-model" value={draft.model} disabled={disabled} onChange={event => edit('model', event.target.value)} onBlur={() => blur('model')}
        aria-invalid={!!fieldError('model') || undefined} aria-describedby="dshp-custom-model-hint" />
        <span className="dshp-caption" id="dshp-custom-model-hint">与服务商提供的模型 ID 一致。</span>
        {fieldError('model') && <span className="dshp-field-error">{fieldError('model')}</span>}</label>
      <RequestParametersEditor value={draft.request} disabled={disabled} onChange={request => {
        setDraft(previous => ({ ...previous, request })); setResult(undefined); setError(undefined)
      }} />
      <div className="dshp-custom-test"><div className="dshp-custom-test-actions">
        <Button disabled={!valid || !!busy} busy={busy === 'test'} onClick={() => { void test() }}>{busy === 'test' ? '测试中…' : '测试连接'}</Button>
        {busy === 'test' ? <Button kind="ghost" onClick={() => { controller.current?.abort(); setResult(undefined) }}>取消测试</Button>
          : <span className="dshp-caption">{result?.success ? '连接成功' : result ? '测试未通过' : '尚未测试'}</span>}</div>
        <p className="dshp-caption">发送一次简短请求，可能产生少量模型费用。</p>
        {result && <Notice title={result.success ? '模型可用' : '连接测试失败'} tone={result.success ? 'success' : 'error'}>{result.text}</Notice>}</div>
      <hr />
      {error && <Notice title={conflict ? '当前修改已保留' : '保存失败'} tone={conflict ? 'warning' : 'error'}>{error}</Notice>}
      {conflict && <div className="dshp-actions"><Button disabled={!!busy} onClick={() => setConfirm('reload')}>读取最新设置</Button></div>}
      {!snapshot.writable && <Notice title="当前设置只读">无法保存修改。</Notice>}
      <footer className="dshp-actions dshp-custom-footer"><Button kind="primary" disabled={disabled || !canSave || (replaceKey && !info?.writable)} busy={busy === 'save'}
        onClick={() => { void save() }}>{busy === 'save' ? '保存中…' : '保存并使用'}</Button></footer>
    </div>
    <Dialog open={!!confirm} compact title={confirm === 'back' ? '放弃当前修改？' : '读取最新设置？'} onClose={() => setConfirm(undefined)}>
      <p>当前未保存的连接信息将被丢弃。</p><div className="dshp-actions"><Button onClick={() => setConfirm(undefined)}>继续编辑</Button>
        <Button kind="primary" onClick={() => { if (confirm === 'back') onBack(); else restore() }}>{confirm === 'back' ? '放弃修改' : '读取最新设置'}</Button></div>
    </Dialog>
  </section>
}
