import { z } from 'zod';
import type { PredictionConfig } from './config.js';
export declare const parameterSchema: z.ZodObject<{
    key: z.ZodString;
    type: z.ZodEnum<{
        number: "number";
        boolean: "boolean";
        text: "text";
        json: "json";
    }>;
    value: z.ZodString;
}, z.core.$strict>;
export declare const requestParametersSchema: z.ZodObject<{
    maxTokensEnabled: z.ZodBoolean;
    maxTokens: z.ZodString;
    parameters: z.ZodArray<z.ZodObject<{
        key: z.ZodString;
        type: z.ZodEnum<{
            number: "number";
            boolean: "boolean";
            text: "text";
            json: "json";
        }>;
        value: z.ZodString;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type RequestParameters = z.infer<typeof requestParametersSchema>;
export type Parameter = z.infer<typeof parameterSchema>;
export declare const emptyRequestParameters: () => RequestParameters;
export declare const legacyRequestParameters: (tokens: number) => RequestParameters;
/** 旧连接保留原上限；新连接默认不传，不把升级变成一次用量设置变更。 */
export declare function customRequestOf(config: PredictionConfig): RequestParameters;
/** 数字片段均先验证再拼接，避免大整数经过 JS Number 时被舍入或变成 Infinity。 */
export declare function completionBody(model: string, messages: {
    role: string;
    content: string;
}[], input: RequestParameters | number): string;
