/** 第一阶段固定测试句；没有模型调用和费用。 */
export const TEST_TEXT = '［接入测试］请继续说明下一步。'
export const PACKAGE_NAME = '@kkucodes/dsh-predictions'
export const ENTRY_ID = 'dsh-predictions'
export const RPC_CHANNEL = '/api'
export const RPC_PREFIX = 'dsh-predictions/'
export const PROJECTION_KEY = 'dshPredictions'
export const CUSTOM_ROUTE = '["dsh-predictions-custom","configured"]'

export interface PredictionConfig {
  previewEnabled: boolean
  testText: string
  predictionEnabled: boolean
  automaticEnabled: boolean
  modelRoute: string
  customBaseURL: string
  customModel: string
  customCredential: string
  customRequestConfigured: boolean
  customMaxTokensEnabled: boolean
  customMaxTokens: string
  customParameters: string
  contextMessages: number
  contextChars: number
  outputTokens: number
  inputPrice: number
  outputPrice: number
}

export const DEFAULTS = { automaticEnabled: true, modelRoute: '', contextMessages: 8, contextChars: 4000,
  outputTokens: 128, inputPrice: 0, outputPrice: 0 } as const

export interface UsageTotals {
  calls: number
  inputTokens: number
  outputTokens: number
  uncertainCalls: number
  amountMicros: number
  unpricedCalls: number
}
export interface PredictionStatus {
  day: string
  today: UsageTotals
  total: UsageTotals
  models: { route: string; label: string }[]
  catalogIncomplete: boolean
  notice?: string
}

export interface PredictionTurn {
  key: string | null
  running: boolean
  sawAssistant: boolean
}

export interface PredictionReply {
  key: string
  status: 'ready' | 'empty' | 'failed' | 'cancelled' | 'skipped'
  text?: string
  notice?: string
  reason?: 'timeout'
  /** 尚未分发模型时等待调度；不能用于重试已经失败或已计费的请求。 */
  retryAfterMs?: number
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap { dshPredictions: PredictionTurn }
  interface SessionProjectionMap { dshPredictions: PredictionTurn }
}

/** 拒绝异常配置，避免把多行或过长内容绘制到原输入框之外。 */
export function validTestText(value: unknown): string | undefined {
  if (typeof value !== 'string' || /[\r\n\u0000]/u.test(value)) return undefined
  const text = value.trim()
  return text.length > 0 && Array.from(text).length <= 240 ? text : undefined
}
