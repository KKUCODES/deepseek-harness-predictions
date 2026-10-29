import type { ClientConnectionRpc, ConnectionStateSource } from '@deepseek-ai/dsh-client-connection/client'
import { DEFAULTS, RPC_CHANNEL, RPC_PREFIX, type PredictionReply } from '../config.js'

interface Entry {
  sessionId: string
  key: string
  users: number
  controller: AbortController
  value?: PredictionReply
  timer?: ReturnType<typeof setTimeout>
  started: boolean
  pending: boolean
  generating: boolean
  stale: boolean
}

export type PredictionIndicatorState = 'empty' | 'waiting' | 'loading' | 'ready' | 'error' | 'timeout'

/** 同一页面的多个输入框共享请求；最后一个使用者离开后取消，不因重绘重复调用。 */
export class Predictions {
  private entries = new Map<string, Entry>()
  private listeners = new Set<() => void>()
  private online = true
  private releaseConnection?: () => void
  constructor(private rpc: ClientConnectionRpc, connection?: ConnectionStateSource, private bus?: BroadcastChannel) {
    if (connection) {
      this.online = connection.getSnapshot() === 'connected'
      this.releaseConnection = connection.subscribe(() => {
        const next = connection.getSnapshot() === 'connected'
        if (next === this.online) return
        this.online = next
        this.revalidate()
      })
    }
    bus?.addEventListener('message', this.onPeerChange)
  }
  private onPeerChange = (event: MessageEvent) => {
    const value = event.data
    if (!value || value.type !== 'invalidate' || typeof value.sessionId !== 'string' || value.sessionId.length > 200
      || typeof value.key !== 'string' || !/^\d{1,30}$/u.test(value.key)) return
    for (const entry of new Set(this.entries.values())) if (entry.sessionId === value.sessionId && entry.key === value.key) this.invalidate(entry)
    this.publish()
  }
  private notify(sessionId: string, key: string) { if (key) this.bus?.postMessage({ type: 'invalidate', sessionId, key }) }
  private invalidate(entry: Entry) {
    clearTimeout(entry.timer); entry.controller.abort()
    entry.pending = false; entry.generating = false; entry.value = undefined; entry.stale = true
    if (this.online && entry.users > 0) this.request(entry, entry.sessionId, entry.key, undefined, true)
  }
  /** 聚焦、重连和其他窗口变更只核对缓存，不能成为自动补发模型请求的理由。 */
  revalidate(): void {
    for (const entry of new Set(this.entries.values())) {
      // 已排定、尚未分发的自动预测不因窗口聚焦丢失；断线仍取消等待。
      if (this.online && entry.value?.retryAfterMs !== undefined) continue
      this.invalidate(entry)
    }
    this.publish()
  }
  /** 输入框降级核对只处理已有建议，不能打断首次自动请求。 */
  revalidateCached(): void {
    for (const entry of new Set(this.entries.values())) if (entry.value?.status === 'ready') this.invalidate(entry)
    this.publish()
  }
  private id(sessionId: string, key: string) { return `${sessionId}:${key}` }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private publish() { for (const listener of this.listeners) listener() }
  read(sessionId: string, key: string) { return this.entries.get(this.id(sessionId, key))?.value }
  /** 图标只订阅已有请求；只读缓存核对不是模型生成，不显示转圈。 */
  indicator(sessionId: string, key: string): PredictionIndicatorState {
    const entry = this.entries.get(this.id(sessionId, key))
    if (!entry || !this.online || entry.stale) return 'empty'
    if (entry.pending && entry.generating) return 'loading'
    if (entry.value?.retryAfterMs !== undefined) return 'waiting'
    if (entry.value?.status === 'ready' && entry.value.text) return 'ready'
    if (entry.value?.reason === 'timeout') return 'timeout'
    if (entry.value?.status === 'failed' || entry.value?.notice && entry.value.status === 'skipped') return 'error'
    return 'empty'
  }

  acquire(sessionId: string, key: string, options: { automaticEnabled: boolean } = DEFAULTS) {
    const id = this.id(sessionId, key)
    let entry = this.entries.get(id)
    const unresolved = this.entries.get(this.id(sessionId, ''))
    if (!entry && key && unresolved?.pending) {
      entry = unresolved
      this.entries.set(id, entry)
    }
    if (!entry) {
      // 只保留当前各会话的最后一轮；旧结果不会在下一轮重新出现。
      for (const [oldId, old] of this.entries) if (oldId.startsWith(`${sessionId}:`)) {
        old.controller.abort(); clearTimeout(old.timer); this.entries.delete(oldId)
      }
      entry = { sessionId, key, users: 0, controller: new AbortController(), started: false, pending: false, generating: false, stale: false }
      this.entries.set(id, entry)
      const owned = entry
      if (this.online && (key || !options.automaticEnabled)) owned.timer = setTimeout(() => {
        // 仅手动也要恢复宿主已有缓存；peek 不准备模型，不能成为一次收费生成。
        this.request(owned, sessionId, key, undefined, !options.automaticEnabled)
      }, 0)
    }
    entry.users++
    if (this.online && (entry.stale || (entry.started && !entry.value && !entry.pending))) this.request(entry, sessionId, key, undefined, true)
    const owned = entry
    return () => {
      owned.users--
      if (owned.users > 0) return
      clearTimeout(owned.timer)
      const waiting = owned.value?.retryAfterMs !== undefined
      if (owned.value && !owned.pending && !waiting) return
      if (owned.pending) owned.stale = true
      owned.controller.abort()
      if (!owned.started || waiting) this.entries.delete(id)
      owned.pending = false; owned.generating = false
      this.publish()
    }
  }

  /** 明确手势才创建手动请求；在途请求直接复用，不排队、不取消后再重复收费。 */
  manual(sessionId: string, key: string): void {
    const entry = this.entries.get(this.id(sessionId, key))
    if (!this.online || !entry || entry.pending || entry.value?.status === 'ready' || entry.value?.retryAfterMs !== undefined) return
    clearTimeout(entry.timer)
    this.request(entry, sessionId, key, crypto.randomUUID())
  }

  private request(entry: Entry, sessionId: string, key: string, requestId?: string, readOnly = false): void {
    if (!this.online) return
    entry.controller.abort()
    const controller = new AbortController()
    entry.controller = controller
    entry.started = true
    entry.pending = true
    entry.generating = !readOnly
    entry.stale = false
    entry.value = undefined
    this.publish()
    void this.rpc.call(RPC_CHANNEL, `${RPC_PREFIX}${readOnly ? 'peek' : requestId ? 'manual' : 'predict'}`,
      { sessionId, ...(key ? { key } : {}), ...(requestId ? { requestId } : {}) }, controller.signal).then(result => {
      if (controller.signal.aborted || entry.controller !== controller) return
      if (result.ok) {
        const reply = result.value as PredictionReply
        if (reply.key === key || (!key && /^\d+$/u.test(reply.key))) {
          entry.value = reply
          entry.key = reply.key
          if (!key && reply.key) this.entries.set(this.id(sessionId, reply.key), entry)
          if (!readOnly && reply.retryAfterMs === undefined) this.notify(sessionId, reply.key)
        }
      } else entry.value = { key, status: 'failed', notice: '预测暂不可用，请检查宿主连接或模型设置。' }
    }).catch(() => {
      if (!controller.signal.aborted && entry.controller === controller) entry.value = { key, status: 'failed' }
    }).finally(() => {
      if (entry.controller !== controller) return
      entry.pending = false
      entry.generating = false
      const delay = entry.value?.retryAfterMs
      // 只继续服务端明确尚未分发的自动请求；失败、超时和只读核对均不重试。
      if (!controller.signal.aborted && !readOnly && !requestId && entry.users > 0
        && typeof delay === 'number' && Number.isFinite(delay) && delay > 0 && delay <= 300000) {
        clearTimeout(entry.timer)
        entry.timer = setTimeout(() => {
          if (this.online && entry.users > 0 && this.entries.get(this.id(sessionId, key)) === entry)
            this.request(entry, sessionId, key)
        }, delay)
      }
      this.publish()
    })
  }

  dismiss(sessionId: string, key: string) {
    const entry = this.entries.get(this.id(sessionId, key))
    if (entry) {
      clearTimeout(entry.timer); entry.controller.abort(); entry.pending = false; entry.generating = false
      entry.value = { key, status: 'skipped' }; this.publish()
    }
    void this.rpc.call(RPC_CHANNEL, `${RPC_PREFIX}dismiss`, { sessionId, key }).then(result => {
      if (result.ok) this.notify(sessionId, key)
    }).catch(() => {})
  }

  forget(sessionId: string): void {
    for (const [id, entry] of this.entries) if (id.startsWith(`${sessionId}:`)) {
      clearTimeout(entry.timer); entry.controller.abort(); this.entries.delete(id)
    }
    this.publish()
  }
  dispose() {
    this.releaseConnection?.()
    this.bus?.removeEventListener('message', this.onPeerChange)
    this.bus?.close()
    for (const entry of this.entries.values()) { clearTimeout(entry.timer); entry.controller.abort() }
    this.entries.clear(); this.listeners.clear()
  }
}
