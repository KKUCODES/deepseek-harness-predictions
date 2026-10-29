import type { Context, Volatile } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { type PredictionConfig } from './config.js';
export declare const name = "dsh-predictions";
export declare const inject: string[];
export type Config = {
    [K in keyof PredictionConfig]: Volatile<PredictionConfig[K]>;
};
export declare const Config: Schema<PredictionConfig, Config>;
export declare function apply(ctx: Context, config: Config): Promise<void>;
