/**
 * 轻提示（Toast）。
 *
 * 提供全局单例容器 `<ToastContainer />` 与命令式 API `toast.success(...)`。
 * 组件外（如 store action）也可直接调用，无需依赖 React 上下文。
 */

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/utils/cn';
import { createId } from '@/utils/id';

/** 提示类型 */
export type ToastType = 'success' | 'error' | 'warning' | 'info';

/** 单条提示 */
export interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  /** 展示时长（毫秒） */
  duration: number;
}

/** 订阅者回调 */
type Listener = (items: ToastItem[]) => void;

/** 默认展示时长 */
const DEFAULT_DURATION_MS: number = 3000;

/** 同屏最多展示条数 */
const MAX_VISIBLE: number = 5;

/** 内部状态 */
let items: ToastItem[] = [];
const listeners: Set<Listener> = new Set<Listener>();
const timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

/** 通知所有订阅者 */
function emit(): void {
  for (const listener of listeners) {
    listener([...items]);
  }
}

/** 移除一条提示 */
function remove(id: string): void {
  const timer = timers.get(id);
  if (timer !== undefined) {
    clearTimeout(timer);
    timers.delete(id);
  }
  items = items.filter((item: ToastItem): boolean => item.id !== id);
  emit();
}

/** 追加一条提示 */
function push(type: ToastType, message: string, duration: number): string {
  const id: string = createId('toast');
  const item: ToastItem = { id, type, message, duration };
  items = [...items, item].slice(-MAX_VISIBLE);
  emit();

  const timer = setTimeout(() => {
    remove(id);
  }, duration);
  timers.set(id, timer);

  return id;
}

/**
 * 命令式 Toast API。
 * 可在组件内外任意位置调用。
 */
export const toast = {
  /** 成功提示 */
  success(message: string, duration: number = DEFAULT_DURATION_MS): string {
    return push('success', message, duration);
  },
  /** 错误提示（默认停留更久） */
  error(message: string, duration: number = 4000): string {
    return push('error', message, duration);
  },
  /** 警告提示 */
  warning(message: string, duration: number = DEFAULT_DURATION_MS): string {
    return push('warning', message, duration);
  },
  /** 普通信息 */
  info(message: string, duration: number = DEFAULT_DURATION_MS): string {
    return push('info', message, duration);
  },
  /** 手动关闭指定提示 */
  dismiss(id: string): void {
    remove(id);
  },
  /** 清空全部提示 */
  clear(): void {
    for (const timer of timers.values()) {
      clearTimeout(timer);
    }
    timers.clear();
    items = [];
    emit();
  },
};

/** 各类型的样式 */
const TYPE_CLASS: Record<ToastType, string> = {
  success: 'bg-emerald-600 text-white',
  error: 'bg-red-600 text-white',
  warning: 'bg-amber-500 text-white',
  info: 'bg-slate-800 text-white',
};

/** 各类型的图标字符 */
const TYPE_ICON: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '!',
  info: 'i',
};

/**
 * Toast 容器。
 * 在 `App.tsx` 中挂载一次即可，全局共享。
 */
export function ToastContainer(): JSX.Element | null {
  const [list, setList] = useState<ToastItem[]>(items);

  useEffect(() => {
    const listener: Listener = (next: ToastItem[]): void => {
      setList(next);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  if (typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div className="pointer-events-none fixed left-1/2 top-4 z-[60] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
      {list.map((item: ToastItem) => (
        <div
          key={item.id}
          role="status"
          className={cn(
            'pointer-events-auto flex items-start gap-2 rounded-xl px-4 py-2.5 text-sm shadow-panel animate-fade-in',
            TYPE_CLASS[item.type],
          )}
          onClick={() => toast.dismiss(item.id)}
        >
          <span className="mt-0.5 flex h-4 w-4 flex-none items-center justify-center rounded-full bg-white/25 text-[10px] font-bold">
            {TYPE_ICON[item.type]}
          </span>
          <span className="flex-1 break-words leading-5">{item.message}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

export default ToastContainer;
