import { type RequestParameters } from './request-parameters.js';
export declare class CustomModelError extends Error {
    readonly code: string;
    constructor(code: string, message: string);
}
/** 仅非流式 Chat Completions；不探测其他协议，也不因失败额外重发收费请求。 */
export declare function chatCompletion(connection: {
    baseURL: string;
    model: string;
    apiKey: string;
}, messages: {
    role: 'system' | 'user';
    content: string;
}[], parameters: RequestParameters | number, signal: AbortSignal, onUsage?: (usage: {
    inputTokens: number;
    outputTokens: number;
} | undefined) => void): Promise<string>;
