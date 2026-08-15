/**
 * 倒计时 Hook。
 * 用于人类玩家回合的 30s 倒计时（PRD D4），归零时触发回调。
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** 倒计时参数 */
export interface UseCountdownOptions {
  /** 起始秒数 */
  seconds: number;
  /** 是否处于激活状态。为 false 时暂停并重置为起始值 */
  active: boolean;
  /** 归零回调。内部用 ref 持有，回调变化不会重启计时 */
  onTimeout?: () => void;
  /** 依赖变化时重置倒计时的键，例如回合序号 */
  resetKey?: string | number;
}

/** 倒计时返回值 */
export interface UseCountdownResult {
  /** 剩余秒数 */
  remaining: number;
  /** 是否正在计时 */
  isRunning: boolean;
  /** 手动重置为起始秒数 */
  reset: () => void;
}

/**
 * 倒计时。
 *
 * 行为：
 * - `active` 为 true 时每秒递减；
 * - 递减到 0 时调用一次 `onTimeout`，并停止；
 * - `active` 变为 false 或 `resetKey` 变化时重置为起始值；
 * - 卸载时清理定时器。
 *
 * @param options 见 `UseCountdownOptions`
 */
export function useCountdown(options: UseCountdownOptions): UseCountdownResult {
  const { seconds, active, onTimeout, resetKey } = options;

  const [remaining, setRemaining] = useState<number>(seconds);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const firedRef = useRef<boolean>(false);
  const onTimeoutRef = useRef<(() => void) | undefined>(onTimeout);
  // L7：归零回调的宏任务定时器也纳入清理，卸载后不再触发
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 始终持有最新回调，避免回调变化导致计时重启
  useEffect(() => {
    onTimeoutRef.current = onTimeout;
  }, [onTimeout]);

  const clear = useCallback((): void => {
    if (timerRef.current !== null) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (timeoutRef.current !== null) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const reset = useCallback((): void => {
    firedRef.current = false;
    setRemaining(seconds);
  }, [seconds]);

  useEffect(() => {
    clear();
    firedRef.current = false;
    setRemaining(seconds);

    if (!active) {
      return () => {
        clear();
      };
    }

    timerRef.current = setInterval(() => {
      setRemaining((prev: number): number => {
        if (prev <= 1) {
          clear();
          if (!firedRef.current) {
            firedRef.current = true;
            // 在下一个宏任务触发，避免在 setState 期间同步调用外部逻辑
            timeoutRef.current = setTimeout(() => {
              timeoutRef.current = null;
              if (onTimeoutRef.current) {
                onTimeoutRef.current();
              }
            }, 0);
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clear();
    };
  }, [active, seconds, resetKey, clear]);

  return {
    remaining,
    isRunning: active && remaining > 0,
    reset,
  };
}

export default useCountdown;
