export declare const DOUBLE_ARROW_MS = 300;
/** 第一次右箭头先等待；第二次到达则取消单次接受，避免先填入草稿再误判双击。 */
export declare class ArrowTaps {
    private timer?;
    press(single: () => void, double: () => void): void;
    cancel(): void;
}
