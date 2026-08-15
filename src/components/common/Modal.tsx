/**
 * 通用弹窗组件。
 * 供表单编辑、风险告知、结算展示等场景复用。
 * 支持 light（默认，浅色表单风格）与 dark（牌桌深色浮层风格）两种外观。
 */

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/utils/cn';

/** 弹窗尺寸 */
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl';

/** 弹窗外观 */
export type ModalVariant = 'light' | 'dark';

export interface ModalProps {
  /** 是否展示 */
  open: boolean;
  /** 关闭回调。为 undefined 时不渲染关闭按钮且遮罩不可关闭 */
  onClose?: () => void;
  /** 标题 */
  title?: ReactNode;
  /** 主体内容 */
  children: ReactNode;
  /** 底部操作区 */
  footer?: ReactNode;
  /** 尺寸，默认 md */
  size?: ModalSize;
  /** 外观，默认 dark（全站深色主题，与牌桌配套；light 保留给特殊浅色场景） */
  variant?: ModalVariant;
  /** 点击遮罩是否关闭，默认 true */
  closeOnOverlay?: boolean;
  /** 按 Esc 是否关闭，默认 true */
  closeOnEsc?: boolean;
  /** 附加类名 */
  className?: string;
}

/** 各尺寸的最大宽度 */
const SIZE_CLASS: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
  xl: 'max-w-4xl',
};

/** 关闭图标 */
function CloseIcon(): JSX.Element {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * 弹窗。
 * 通过 Portal 渲染到 body，打开时锁定背景滚动。
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
  variant = 'dark',
  closeOnOverlay = true,
  closeOnEsc = true,
  className,
}: ModalProps): JSX.Element | null {
  // Esc 关闭
  useEffect(() => {
    if (!open || !closeOnEsc || !onClose) {
      return;
    }
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', handler);
    };
  }, [open, closeOnEsc, onClose]);

  // 打开时锁定背景滚动
  useEffect(() => {
    if (!open || typeof document === 'undefined') {
      return;
    }
    const previous: string = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  if (!open || typeof document === 'undefined') {
    return null;
  }

  const handleOverlayClick = (): void => {
    if (closeOnOverlay && onClose) {
      onClose();
    }
  };

  const dark: boolean = variant === 'dark';

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true">
      {/* 遮罩 */}
      <div
        className={cn('absolute inset-0 animate-fade-in', dark ? 'bg-black/70 backdrop-blur-sm' : 'bg-black/50')}
        onClick={handleOverlayClick}
        aria-hidden="true"
      />

      {/* 面板 */}
      <div
        className={cn(
          'relative z-10 flex w-full flex-col rounded-2xl shadow-panel animate-pop-in',
          'max-h-[90vh]',
          dark
            ? 'border border-white/10 bg-slate-900/95 text-slate-100 backdrop-blur-xl'
            : 'bg-white text-slate-800',
          SIZE_CLASS[size],
          className,
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {title || onClose ? (
          <div
            className={cn(
              'flex items-center justify-between rounded-t-2xl border-b px-5 py-3.5',
              dark ? 'border-white/10' : 'border-slate-200',
            )}
          >
            <h3 className={cn('text-base font-semibold', dark ? 'text-white' : 'text-slate-800')}>{title}</h3>
            {onClose ? (
              <button
                type="button"
                onClick={onClose}
                aria-label="关闭"
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-lg transition-colors',
                  dark
                    ? 'text-slate-400 hover:bg-white/10 hover:text-white'
                    : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
                )}
              >
                <CloseIcon />
              </button>
            ) : null}
          </div>
        ) : null}

        <div className={cn('flex-1 overflow-y-auto px-5 py-4 text-sm', dark ? 'text-slate-300' : 'text-slate-700')}>
          {children}
        </div>

        {footer ? (
          <div
            className={cn(
              'flex items-center justify-end gap-2 rounded-b-2xl border-t px-5 py-3',
              dark ? 'border-white/10' : 'border-slate-200',
            )}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export default Modal;
