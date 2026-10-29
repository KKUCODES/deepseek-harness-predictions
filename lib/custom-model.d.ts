import { z } from 'zod';
/** 地址只承担基础路径；禁止在 URL 中夹带另一套认证或切换接口协议。 */
export declare function normalizeBaseURL(raw: string): string | undefined;
export declare const customDraftSchema: z.ZodObject<{
    baseURL: z.ZodString;
    model: z.ZodString;
}, z.core.$strip>;
export declare const apiKeySchema: z.ZodString;
export declare const credentialIdSchema: z.ZodString;
export interface CustomKeyInfo {
    credential: string;
    configured: boolean;
    writable: boolean;
}
