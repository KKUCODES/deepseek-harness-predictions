import { type ButtonHTMLAttributes, type ReactNode } from 'react';
export declare const icons: {
    chevron: string;
    down: string;
    close: string;
    check: string;
    success: string;
    info: string;
    warning: string;
    error: string;
    loader: string;
    loaderInverse: string;
    off: string;
    on: string;
    file: string;
};
export declare function Icon({ src }: {
    src: string;
}): import("react").JSX.Element;
export declare function Button({ kind, busy, className, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & {
    kind?: 'primary' | 'secondary' | 'ghost';
    busy?: boolean;
}): import("react").JSX.Element;
export declare function Toggle({ label, checked, disabled, onChange }: {
    label: string;
    checked: boolean;
    disabled: boolean;
    onChange: (next: boolean) => void;
}): import("react").JSX.Element;
export declare function Notice({ title, children, tone }: {
    title: string;
    children?: ReactNode;
    tone?: 'info' | 'warning' | 'error' | 'success';
}): import("react").JSX.Element;
/** 原生 dialog 负责焦点约束、Esc 和关闭后的焦点归还，不接管宿主弹窗服务。 */
export declare function Dialog({ open, title, onClose, children, compact }: {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
    compact?: boolean;
}): import("react").JSX.Element;
