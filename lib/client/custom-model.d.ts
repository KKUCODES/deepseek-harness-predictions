import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client';
import type { ClientConnectionRpc } from '@deepseek-ai/dsh-client-connection/client';
import { type PredictionConfig } from '../config.js';
interface Props {
    form: ConfigForm<PredictionConfig>;
    snapshot: ConfigFormSnapshot<PredictionConfig>;
    rpc: ClientConnectionRpc;
    onBack: () => void;
    onSaved: () => void;
}
export declare function CustomModelPanel({ form, snapshot, rpc, onBack, onSaved }: Props): import("react").JSX.Element;
export {};
