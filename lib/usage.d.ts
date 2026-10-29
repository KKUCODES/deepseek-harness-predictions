import { z } from 'zod';
import { DEFAULTS, type PredictionConfig, type UsageTotals } from './config.js';
export declare const controlSchema: z.ZodObject<{
    automaticEnabled: z.ZodBoolean;
    modelRoute: z.ZodString;
    contextMessages: z.ZodNumber;
    contextChars: z.ZodNumber;
    outputTokens: z.ZodNumber;
    inputPrice: z.ZodNumber;
    outputPrice: z.ZodNumber;
}, z.core.$strip>;
export type Controls = z.infer<typeof controlSchema>;
export declare function controlsOf(config: PredictionConfig): Controls;
export declare function parseRoute(value: string): {
    provider: string;
    model: string;
} | undefined;
export declare const totalsSchema: z.ZodObject<{
    calls: z.ZodNumber;
    inputTokens: z.ZodNumber;
    outputTokens: z.ZodNumber;
    uncertainCalls: z.ZodNumber;
    amountMicros: z.ZodNumber;
    unpricedCalls: z.ZodNumber;
}, z.core.$strip>;
export declare const emptyTotals: () => UsageTotals;
/** 按 UTC+8 归档统计；跨日响应仍记入调用出发日，不据此限制生成。 */
export declare const usageDay: (now?: number) => string;
export declare const priceMicros: (input: number, output: number, settings: Controls) => number;
export declare function startUsage(today: UsageTotals, settings: Controls): UsageTotals;
export declare function settleUsage(today: UsageTotals, usage: {
    inputTokens: number;
    outputTokens: number;
} | undefined, settings: Controls): UsageTotals;
export declare function sumTotals(rows: Iterable<UsageTotals>): UsageTotals;
export { DEFAULTS };
