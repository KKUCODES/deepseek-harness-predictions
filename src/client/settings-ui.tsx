import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import chevron from './assets/ecab1.svg'
import down from './assets/8d885.svg'
import close from './assets/e257e.svg'
import check from './assets/f7aa9.svg'
import success from './assets/44f6b.svg'
import info from './assets/41133.svg'
import warning from './assets/be118.svg'
import error from './assets/91c54.svg'
import loader from './assets/744eb.svg'
import loaderInverse from './assets/5cee1.svg'
import off from './assets/b8a1c.svg'
import on from './assets/c60d9.svg'
import file from './assets/0354b.svg'

export const icons = { chevron, down, close, check, success, info, warning, error, loader, loaderInverse, off, on, file }
export function Icon({ src }: { src: string }) { return <img className="dshp-icon" src={src} width={16} height={16} alt="" aria-hidden="true" /> }

export function Button({ kind = 'secondary', busy, className = '', children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: 'primary' | 'secondary' | 'ghost'; busy?: boolean
}) {
  return <button {...props} type="button" className={`dshp-button dshp-button-${kind} ${className}`} aria-busy={busy || undefined}>
    {busy && <Icon src={kind === 'primary' ? icons.loaderInverse : icons.loader} />}{children}
  </button>
}

export function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (next: boolean) => void }) {
  return <label className="dshp-toggle">
    <input type="checkbox" aria-label={label} checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
    <img src={checked ? icons.on : icons.off} width={36} height={20} alt="" aria-hidden="true" />
  </label>
}

export function Notice({ title, children, tone = 'info' }: { title: string; children?: ReactNode; tone?: 'info' | 'warning' | 'error' | 'success' }) {
  return <div className={`dshp-notice dshp-tone-${tone}`} role={tone === 'error' ? 'alert' : 'status'}>
    <Icon src={icons[tone]} /><div><strong>{title}</strong>{children && <div className="dshp-caption">{children}</div>}</div>
  </div>
}

/** 原生 dialog 负责焦点约束、Esc 和关闭后的焦点归还，不接管宿主弹窗服务。 */
export function Dialog({ open, title, onClose, children, compact = false }: { open: boolean; title: string; onClose: () => void; children: ReactNode; compact?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (open && !element.open) element.showModal()
    else if (!open && element.open) element.close()
    return () => { if (element.open) element.close() }
  }, [open])
  return <dialog ref={ref} className={`dshp-dialog${compact ? ' dshp-dialog-compact' : ''}`} aria-label={title}
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => { const box = event.currentTarget.getBoundingClientRect(); if (event.target === event.currentTarget
      && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) onClose() }}>
    <div className="dshp-stack"><header className="dshp-row"><h2>{title}</h2>
      <Button kind="ghost" className="dshp-icon-button" aria-label={`关闭${title}`} onClick={onClose}><Icon src={icons.close} /></Button></header>
      {children}
    </div>
  </dialog>
}
