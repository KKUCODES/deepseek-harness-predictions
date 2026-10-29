import { requestParametersSchema, type RequestParameters, type Parameter } from '../request-parameters.js'
import { Button, Toggle, Icon, icons } from './settings-ui.js'

export function RequestParametersEditor({ value, disabled, onChange }: {
  value: RequestParameters; disabled: boolean; onChange: (next: RequestParameters) => void
}) {
  const parsed = requestParametersSchema.safeParse(value)
  const error = (...path: (string | number)[]) => parsed.success ? undefined
    : parsed.error.issues.find(issue => JSON.stringify(issue.path) === JSON.stringify(path))?.message
  const edit = (index: number, patch: Partial<Parameter>) => onChange({ ...value,
    parameters: value.parameters.map((row, n) => n === index ? { ...row, ...patch } : row) })
  return <>
    <section className="dshp-request-section">
      <div className="dshp-row"><span className="dshp-request-title">限制输出长度</span>
        <Toggle label="限制输出长度" checked={value.maxTokensEnabled} disabled={disabled} onChange={next => onChange({ ...value, maxTokensEnabled: next })} /></div>
      {value.maxTokensEnabled ? <>
        <label className="dshp-field"><span className="dshp-sr-only">最大输出 Token</span><span className="dshp-input-wrap" data-error={!!error('maxTokens') || undefined}>
          <input type="text" inputMode="numeric" aria-label="最大输出 Token" aria-invalid={!!error('maxTokens') || undefined}
            placeholder="输入大于或等于 1 的整数" disabled={disabled} value={value.maxTokens}
            onChange={event => onChange({ ...value, maxTokens: event.target.value })} /><span className="dshp-unit">Token</span></span>
          {error('maxTokens') && <span className="dshp-field-error">{error('maxTokens')}</span>}</label>
        <p className="dshp-caption">数值过小可能导致生成失败（含思考消耗）。</p>
      </> : <p className="dshp-caption">不发送 max_tokens，使用服务商默认上限。</p>}
    </section>
    <section className="dshp-request-section">
      <div className="dshp-row"><h3 className="dshp-request-title">自定义参数</h3>
        <Button kind="ghost" disabled={disabled} onClick={() => onChange({ ...value, parameters: [...value.parameters, { key: '', type: 'text', value: '' }] })}>添加参数</Button></div>
      {value.parameters.map((row, index) => <div className="dshp-parameter" key={index} data-parameter-row>
        <label className="dshp-field dshp-parameter-key"><span className="dshp-sr-only">参数名 {index + 1}</span>
          <input type="text" aria-label={`参数名 ${index + 1}`} placeholder="参数名" disabled={disabled} value={row.key} spellCheck={false}
            aria-invalid={!!error('parameters', index, 'key') || undefined} onChange={event => edit(index, { key: event.target.value })} />
          {error('parameters', index, 'key') && <span className="dshp-field-error">{error('parameters', index, 'key')}</span>}</label>
        <label className="dshp-field dshp-parameter-type"><span className="dshp-sr-only">参数类型 {index + 1}</span>
          <select aria-label={`参数类型 ${index + 1}`} disabled={disabled} value={row.type} onChange={event => edit(index, {
            type: event.target.value as Parameter['type'], value: event.target.value === 'boolean' ? 'false' : '' })}>
            <option value="text">文本</option><option value="number">数字</option><option value="boolean">布尔</option><option value="json">JSON</option>
          </select></label>
        <label className="dshp-field dshp-parameter-value"><span className="dshp-sr-only">参数值 {index + 1}</span>
          {row.type === 'boolean' ? <select aria-label={`参数值 ${index + 1}`} disabled={disabled} value={row.value} onChange={event => edit(index, { value: event.target.value })}>
            <option value="false">false</option><option value="true">true</option></select>
            : <input type="text" aria-label={`参数值 ${index + 1}`} placeholder={row.type === 'json' ? '{"type":"disabled"}' : '参数值'} spellCheck={false}
              disabled={disabled} value={row.value} aria-invalid={!!error('parameters', index, 'value') || undefined} onChange={event => edit(index, { value: event.target.value })} />}
          {error('parameters', index, 'value') && <span className="dshp-field-error">{error('parameters', index, 'value')}</span>}</label>
        <Button kind="ghost" className="dshp-icon-button dshp-parameter-remove" aria-label={`删除参数 ${index + 1}`} disabled={disabled}
          onClick={() => onChange({ ...value, parameters: value.parameters.filter((_, n) => n !== index) })}><Icon src={icons.close} /></Button>
      </div>)}
      <p className="dshp-caption">参数名和值按服务商文档填写。</p>
    </section>
  </>
}
