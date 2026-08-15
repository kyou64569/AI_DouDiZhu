/**
 * 通用按钮组件。
 * 纯 Tailwind 实现，支持 primary / secondary / danger / ghost / gold 五种变体。
 * gold 为牌桌主操作（出牌/叫分/再来一局）的金色强调按钮。
 */

import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/utils/cn';

/** 按钮变体 */
export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'gold';

/** 按钮尺寸 */
export type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 视觉变体，默认 primary */
  variant?: ButtonVariant;
  /** 尺寸，默认 md */
  size?: ButtonSize;
  /** 加载中：展示 spinner 并禁用交互 */
  loading?: boolean;
  /** 是否撑满父容器宽度 */
  block?: boolean;
  /** 左侧图标 */
  icon?: ReactNode;
}

/** 各变体的类名（深色主题适配：次级/幽灵改深色玻璃，主按钮加内高光） */
const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:
    'bg-gradient-to-br from-brand-500 to-brand-700 text-white hover:brightness-110 active:brightness-95 border border-brand-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_4px_14px_rgba(53,99,233,0.3)]',
  secondary:
    'bg-white/10 text-slate-200 hover:bg-white/15 active:bg-white/20 border border-white/15 shadow-innerTop',
  danger:
    'bg-gradient-to-br from-red-500 to-red-700 text-white hover:brightness-110 active:brightness-95 border border-red-400/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]',
  ghost: 'bg-transparent text-slate-400 hover:bg-white/10 hover:text-slate-100 border border-transparent',
  /** 金色主操作：渐变 + 金色投影，hover 轻微提亮 */
  gold:
    'bg-gradient-to-br from-gold-300 via-gold-400 to-gold-600 text-gold-950 font-semibold border border-gold-300/60 shadow-[0_4px_16px_rgba(245,158,11,0.35)] hover:brightness-105 active:brightness-95',
};

/** 各尺寸的类名 */
const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: 'h-8 px-3 text-sm gap-1',
  md: 'h-10 px-4 text-sm gap-1.5',
  lg: 'h-12 px-6 text-base gap-2',
};

/** 加载中的旋转图标 */
function Spinner(): JSX.Element {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

/**
 * 按钮。
 * `loading` 为 true 时自动禁用点击并展示 spinner。
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    block = false,
    icon,
    disabled = false,
    className,
    children,
    type = 'button',
    ...rest
  }: ButtonProps,
  ref,
): JSX.Element {
  const isDisabled: boolean = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading}
      className={cn(
        'inline-flex items-center justify-center rounded-xl font-medium transition-all duration-150',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none',
        'active:scale-[0.98]',
        VARIANT_CLASS[variant],
        SIZE_CLASS[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
});

export default Button;
