import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { SettingsProps } from './settings.js';
import type { Predictions } from './predictions.js';
type StatusProps = PropsRuntime<'conversation.input.right'> & SettingsProps & {
    predictions: Predictions;
};
/** 公开工具栏插槽只呈现状态，不 acquire 请求，也不接管输入焦点或按键。 */
export declare function PredictionStatus({ form, predictions, sessionId, useProjection, useSession }: StatusProps): import("react").JSX.Element | null;
export {};
