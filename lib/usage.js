// src/usage.ts
import { z } from "zod";

// src/config.ts
var DEFAULTS = {
  automaticEnabled: true,
  modelRoute: "",
  contextMessages: 8,
  contextChars: 4e3,
  outputTokens: 128,
  inputPrice: 0,
  outputPrice: 0
};

// src/usage.ts
var controlSchema = z.object({
  automaticEnabled: z.boolean(),
  modelRoute: z.string().max(600),
  contextMessages: z.number().int().min(2).max(8),
  contextChars: z.number().int().min(500).max(4e3),
  outputTokens: z.number().int().min(32).max(256),
  inputPrice: z.number().min(0).max(1e5),
  outputPrice: z.number().min(0).max(1e5)
}).superRefine((value, ctx) => {
  if (value.modelRoute && !parseRoute(value.modelRoute)) ctx.addIssue({ code: "custom", path: ["modelRoute"], message: "\u8BF7\u9009\u62E9\u53EF\u7528\u7684\u9884\u6D4B\u6A21\u578B\u3002" });
});
function controlsOf(config) {
  return controlSchema.parse(config);
}
function parseRoute(value) {
  try {
    const route = z.tuple([z.string().min(1).max(200), z.string().min(1).max(300)]).parse(JSON.parse(value));
    return { provider: route[0], model: route[1] };
  } catch {
    return void 0;
  }
}
var totalsSchema = z.object({
  calls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  uncertainCalls: z.number().int().nonnegative(),
  amountMicros: z.number().int().nonnegative(),
  unpricedCalls: z.number().int().nonnegative()
});
var emptyTotals = () => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  uncertainCalls: 0,
  amountMicros: 0,
  unpricedCalls: 0
});
var usageDay = (now = Date.now()) => new Date(now + 8 * 36e5).toISOString().slice(0, 10);
var priceMicros = (input, output, settings) => Math.ceil(input * settings.inputPrice + output * settings.outputPrice);
var hasPrices = (settings) => settings.inputPrice > 0 && settings.outputPrice > 0;
function startUsage(today, settings) {
  return {
    ...today,
    calls: today.calls + 1,
    uncertainCalls: today.uncertainCalls + 1,
    unpricedCalls: today.unpricedCalls + (hasPrices(settings) ? 0 : 1)
  };
}
function settleUsage(today, usage, settings) {
  if (!usage || !Number.isSafeInteger(usage.inputTokens) || usage.inputTokens < 0 || !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens < 0) return today;
  return {
    ...today,
    uncertainCalls: today.uncertainCalls - 1,
    inputTokens: today.inputTokens + usage.inputTokens,
    outputTokens: today.outputTokens + usage.outputTokens,
    amountMicros: today.amountMicros + (hasPrices(settings) ? priceMicros(usage.inputTokens, usage.outputTokens, settings) : 0)
  };
}
function sumTotals(rows) {
  const total = emptyTotals();
  for (const row of rows) for (const field of Object.keys(total)) total[field] += row[field];
  return total;
}
export {
  DEFAULTS,
  controlSchema,
  controlsOf,
  emptyTotals,
  parseRoute,
  priceMicros,
  settleUsage,
  startUsage,
  sumTotals,
  totalsSchema,
  usageDay
};
//# sourceMappingURL=usage.js.map
