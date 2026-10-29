import { z } from 'zod'
import { DEFAULTS, type PredictionConfig, type UsageTotals } from './config.js'

export const controlSchema = z.object({
  automaticEnabled: z.boolean(), modelRoute: z.string().max(600),
  contextMessages: z.number().int().min(2).max(8), contextChars: z.number().int().min(500).max(4000),
  outputTokens: z.number().int().min(32).max(256),
  inputPrice: z.number().min(0).max(100000), outputPrice: z.number().min(0).max(100000),
}).superRefine((value, ctx) => {
  if (value.modelRoute && !parseRoute(value.modelRoute)) ctx.addIssue({ code: 'custom', path: ['modelRoute'], message: '请选择可用的预测模型。' })
})

export type Controls = z.infer<typeof controlSchema>
export function controlsOf(config: PredictionConfig): Controls { return controlSchema.parse(config) }
export function parseRoute(value: string): { provider: string; model: string } | undefined {
  try {
    const route = z.tuple([z.string().min(1).max(200), z.string().min(1).max(300)]).parse(JSON.parse(value))
    return { provider: route[0], model: route[1] }
  } catch { return undefined }
}

export const totalsSchema = z.object({ calls: z.number().int().nonnegative(), inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(), uncertainCalls: z.number().int().nonnegative(),
  amountMicros: z.number().int().nonnegative(), unpricedCalls: z.number().int().nonnegative() })
export const emptyTotals = (): UsageTotals => ({ calls: 0, inputTokens: 0, outputTokens: 0, uncertainCalls: 0,
  amountMicros: 0, unpricedCalls: 0 })
/** 按 UTC+8 归档统计；跨日响应仍记入调用出发日，不据此限制生成。 */
export const usageDay = (now = Date.now()) => new Date(now + 8 * 3600000).toISOString().slice(0, 10)
export const priceMicros = (input: number, output: number, settings: Controls) =>
  Math.ceil(input * settings.inputPrice + output * settings.outputPrice)

const hasPrices = (settings: Controls) => settings.inputPrice > 0 && settings.outputPrice > 0
export function startUsage(today: UsageTotals, settings: Controls): UsageTotals {
  return { ...today, calls: today.calls + 1, uncertainCalls: today.uncertainCalls + 1,
    unpricedCalls: today.unpricedCalls + (hasPrices(settings) ? 0 : 1) }
}
export function settleUsage(today: UsageTotals, usage: { inputTokens: number; outputTokens: number } | undefined, settings: Controls): UsageTotals {
  if (!usage || !Number.isSafeInteger(usage.inputTokens) || usage.inputTokens < 0
    || !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens < 0) return today
  return { ...today, uncertainCalls: today.uncertainCalls - 1, inputTokens: today.inputTokens + usage.inputTokens,
    outputTokens: today.outputTokens + usage.outputTokens,
    amountMicros: today.amountMicros + (hasPrices(settings) ? priceMicros(usage.inputTokens, usage.outputTokens, settings) : 0) }
}
export function sumTotals(rows: Iterable<UsageTotals>): UsageTotals {
  const total = emptyTotals()
  for (const row of rows) for (const field of Object.keys(total) as (keyof UsageTotals)[]) total[field] += row[field]
  return total
}
export { DEFAULTS }
