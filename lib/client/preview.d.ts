import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { Shortcuts } from '@deepseek-ai/dsh-client-shortcuts/client';
import type { SettingsProps } from './settings.js';
import type { Predictions } from './predictions.js';
type PreviewProps = PropsRuntime<'conversation.input.overlay'> & SettingsProps & {
    shortcuts: Shortcuts;
    predictions: Predictions;
};
/** 只观察宿主公开 DOM 标记；灰字、样式与监听都属于插件并在卸载时撤下。 */
export declare function PredictionPreview({ form, shortcuts, predictions, sessionId, useProjection, useInput, useSession, inputActions }: PreviewProps): import("react").JSX.Element;
export {};
