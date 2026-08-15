/**
 * 通用表单输入框。
 * 支持 label、错误提示、以及 password 类型的显示/隐藏切换（API Key 场景，PRD 4.1）。
 */

import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/utils/cn';

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  /** 标签文本 */
  label?: string;
  /** 错误提示，非空时输入框转为红色边框 */
  error?: string;
  /** 辅助说明，展示在输入框下方 */
  hint?: string;
  /** 是否必填，展示红色星号 */
  required?: boolean;
  /** 右侧附加内容（如单位、按钮） */
  suffix?: ReactNode;
  /** 是否撑满父容器宽度，默认 true */
  block?: boolean;
}

/** 眼睛图标（显示密码） */
function EyeIcon(): JSX.Element {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

/** 闭眼图标（隐藏密码） */
function EyeOffIcon(): JSX.Element {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path
        d="M17.94 17.94A10.07 10.07 0 0112 19c-6.5 0-10-7-10-7a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c6.5 0 10 7 10 7a18.5 18.5 0 01-2.16 3.19"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M1 1l22 22" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.88 9.88a3 3 0 104.24 4.24" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * 输入框。
 * 当 `type === 'password'` 时自动在右侧渲染显示/隐藏切换按钮。
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    error,
    hint,
    required = false,
    suffix,
    block = true,
    type = 'text',
    className,
    id,
    disabled = false,
    ...rest
  }: InputProps,
  ref,
): JSX.Element {
  const autoId: string = useId();
  const inputId: string = id ?? autoId;
  const isPassword: boolean = type === 'password';
  const [revealed, setRevealed] = useState<boolean>(false);
  const actualType: string = isPassword && revealed ? 'text' : type;
  const hasError: boolean = typeof error === 'string' && error.length > 0;

  return (
    <div className={cn('flex flex-col gap-1', block && 'w-full')}>
      {label ? (
        <label htmlFor={inputId} className="text-sm font-medium text-slate-300">
          {label}
          {required ? <span className="ml-0.5 text-red-400">*</span> : null}
        </label>
      ) : null}

      <div className="relative flex items-center">
        <input
          ref={ref}
          id={inputId}
          type={actualType}
          disabled={disabled}
          aria-invalid={hasError}
          className={cn(
            'h-10 w-full rounded-lg border bg-slate-900/70 px-3 text-sm text-slate-100 transition-colors shadow-innerTop',
            'placeholder:text-slate-500',
            'focus:outline-none focus:ring-2 focus:ring-brand-400/70 focus:border-brand-400/70',
            'disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-600',
            hasError ? 'border-red-400/70 focus:ring-red-300/60 focus:border-red-400' : 'border-white/15',
            (isPassword || suffix) && 'pr-10',
            className,
          )}
          {...rest}
        />

        {isPassword ? (
          <button
            type="button"
            tabIndex={-1}
            onClick={() => setRevealed((prev: boolean): boolean => !prev)}
            aria-label={revealed ? '隐藏密钥' : '显示密钥'}
            className="absolute right-2 flex h-7 w-7 items-center justify-center rounded text-slate-400 transition-colors hover:bg-white/10 hover:text-slate-200"
          >
            {revealed ? <EyeOffIcon /> : <EyeIcon />}
          </button>
        ) : suffix ? (
          <div className="absolute right-3 flex items-center text-sm text-slate-400">{suffix}</div>
        ) : null}
      </div>

      {hasError ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
});

export default Input;
