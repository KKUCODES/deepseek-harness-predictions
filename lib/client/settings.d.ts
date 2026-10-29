import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client';
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client';
import { type PredictionConfig } from '../config.js';
export interface SettingsProps {
    form: ConfigForm<PredictionConfig>;
}
export declare function usePredictionSettings(form: ConfigForm<PredictionConfig>): import("@deepseek-ai/dsh-client-ui-settings/client").ConfigFormSnapshot<PredictionConfig>;
export declare function SettingsPanel({ form, rpc }: SettingsProps & {
    rpc: ClientConnectionRpc;
}): import("react").JSX.Element;
