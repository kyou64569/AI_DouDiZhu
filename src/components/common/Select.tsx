/**
 * 通用下拉选择组件。
 * 基于原生 `<select>`，保证移动端体验与可访问性。
 */

import { forwardRef, useId, type SelectHTMLAttributes } from 'react';
import { cn } from '@/utils/cn';

/** 单个选项 */
export interface SelectOption {
  /** 选项值 */
  value: string;
  /** 展示文本 */
  label: string;
  /** 是否禁用 */
  disabled?: boolean;
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size' | 'children'> {
  /** 标签文本 */
  label?: string;
  /** 选项列表 */
  options: SelectOption[];
  /** 错误提示 */
  error?: string;
  /** 辅助说明 */
  hint?: string;
  /** 是否必填 */
  required?: boolean;
  /** 空值占位项文本，为空则不渲染占位项 */
  placeholder?: string;
  /** 是否撑满父容器宽度，默认 true */
  block?: boolean;
}

/** 下拉箭头 */
function ChevronIcon(): JSX.Element {
  return (
    <svg
      className="pointer-events-none absolute right-3 h-4 w-4 text-slate-500"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * 下拉选择。
 * `options` 为空时自动禁用并展示无可选项提示。
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    options,
    error,
    hint,
    required = false,
    placeholder,
    block = true,
    className,
    id,
    disabled = false,
    ...rest
  }: SelectProps,
  ref,
): JSX.Element {
  const autoId: string = useId();
  const selectId: string = id ?? autoId;
  const hasError: boolean = typeof error === 'string' && error.length > 0;
  const isEmpty: boolean = options.length === 0;
  const isDisabled: boolean = disabled || isEmpty;

  return (
    <div className={cn('flex flex-col gap-1', block && 'w-full')}>
      {label ? (
        <label htmlFor={selectId} className="text-sm font-medium text-slate-300">
          {label}
          {required ? <span className="ml-0.5 text-red-400">*</span> : null}
        </label>
      ) : null}

      <div className="relative flex items-center">
        <select
          ref={ref}
          id={selectId}
          disabled={isDisabled}
          aria-invalid={hasError}
          className={cn(
            'h-10 w-full appearance-none rounded-lg border bg-slate-900/70 pl-3 pr-9 text-sm text-slate-100 transition-colors shadow-innerTop',
            'focus:outline-none focus:ring-2 focus:ring-brand-400/70 focus:border-brand-400/70',
            'disabled:cursor-not-allowed disabled:bg-white/5 disabled:text-slate-600',
            hasError ? 'border-red-400/70 focus:ring-red-300/60 focus:border-red-400' : 'border-white/15',
            className,
          )}
          {...rest}
        >
          {placeholder ? (
            <option value="" disabled={required}>
              {placeholder}
            </option>
          ) : null}
          {options.map((opt: SelectOption) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled === true}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronIcon />
      </div>

      {hasError ? (
        <p className="text-xs text-red-400">{error}</p>
      ) : isEmpty ? (
        <p className="text-xs text-amber-400">暂无可选项</p>
      ) : hint ? (
        <p className="text-xs text-slate-500">{hint}</p>
      ) : null}
    </div>
  );
});

export default Select;
