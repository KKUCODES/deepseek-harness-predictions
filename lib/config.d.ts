/** 第一阶段固定测试句；没有模型调用和费用。 */
export declare const TEST_TEXT = "\uFF3B\u63A5\u5165\u6D4B\u8BD5\uFF3D\u8BF7\u7EE7\u7EED\u8BF4\u660E\u4E0B\u4E00\u6B65\u3002";
export declare const PACKAGE_NAME = "@kkucodes/dsh-predictions";
export declare const ENTRY_ID = "dsh-predictions";
export declare const RPC_CHANNEL = "/api";
export declare const RPC_PREFIX = "dsh-predictions/";
export declare const PROJECTION_KEY = "dshPredictions";
export declare const CUSTOM_ROUTE = "[\"dsh-predictions-custom\",\"configured\"]";
export interface PredictionConfig {
    previewEnabled: boolean;
    testText: string;
    predictionEnabled: boolean;
    automaticEnabled: boolean;
    modelRoute: string;
    customBaseURL: string;
    customModel: string;
    customCredential: string;
    customRequestConfigured: boolean;
    customMaxTokensEnabled: boolean;
    customMaxTokens: string;
    customParameters: string;
    contextMessages: number;
    contextChars: number;
    outputTokens: number;
    inputPrice: number;
    outputPrice: number;
}
export declare const DEFAULTS: {
    readonly automaticEnabled: true;
    readonly modelRoute: "";
    readonly contextMessages: 8;
    readonly contextChars: 4000;
    readonly outputTokens: 128;
    readonly inputPrice: 0;
    readonly outputPrice: 0;
};
export interface UsageTotals {
    calls: number;
    inputTokens: number;
    outputTokens: number;
    uncertainCalls: number;
    amountMicros: number;
    unpricedCalls: number;
}
export interface PredictionStatus {
    day: string;
    today: UsageTotals;
    total: UsageTotals;
    models: {
        route: string;
        label: string;
    }[];
    catalogIncomplete: boolean;
    notice?: string;
}
export interface PredictionTurn {
    key: string | null;
    running: boolean;
    sawAssistant: boolean;
}
export interface PredictionReply {
    key: string;
    status: 'ready' | 'empty' | 'failed' | 'cancelled' | 'skipped';
    text?: string;
    notice?: string;
    reason?: 'timeout';
    /** 尚未分发模型时等待调度；不能用于重试已经失败或已计费的请求。 */
    retryAfterMs?: number;
}
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionStateMap {
        dshPredictions: PredictionTurn;
    }
    interface SessionProjectionMap {
        dshPredictions: PredictionTurn;
    }
}
/** 拒绝异常配置，避免把多行或过长内容绘制到原输入框之外。 */
export declare function validTestText(value: unknown): string | undefined;
