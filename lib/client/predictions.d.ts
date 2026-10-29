import type { ClientConnectionRpc, ConnectionStateSource } from '@deepseek-ai/dsh-client-connection/client';
import { type PredictionReply } from '../config.js';
export type PredictionIndicatorState = 'empty' | 'waiting' | 'loading' | 'ready' | 'error' | 'timeout';
/** 同一页面的多个输入框共享请求；最后一个使用者离开后取消，不因重绘重复调用。 */
export declare class Predictions {
    private rpc;
    private bus?;
    private entries;
    private listeners;
    private online;
    private releaseConnection?;
    constructor(rpc: ClientConnectionRpc, connection?: ConnectionStateSource, bus?: BroadcastChannel | undefined);
    private onPeerChange;
    private notify;
    private invalidate;
    /** 聚焦、重连和其他窗口变更只核对缓存，不能成为自动补发模型请求的理由。 */
    revalidate(): void;
    /** 输入框降级核对只处理已有建议，不能打断首次自动请求。 */
    revalidateCached(): void;
    private id;
    subscribe: (listener: () => void) => () => void;
    private publish;
    read(sessionId: string, key: string): PredictionReply | undefined;
    /** 图标只订阅已有请求；只读缓存核对不是模型生成，不显示转圈。 */
    indicator(sessionId: string, key: string): PredictionIndicatorState;
    acquire(sessionId: string, key: string, options?: {
        automaticEnabled: boolean;
    }): () => void;
    /** 明确手势才创建手动请求；在途请求直接复用，不排队、不取消后再重复收费。 */
    manual(sessionId: string, key: string): void;
    private request;
    dismiss(sessionId: string, key: string): void;
    forget(sessionId: string): void;
    dispose(): void;
}
