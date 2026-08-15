/**
 * 响应式断点判断 Hook。
 * 断点与 Tailwind 保持一致（DESIGN §8.8）：md=768px，lg=1024px。
 */

import { useEffect, useState } from 'react';

/**
 * 监听任意媒体查询。
 *
 * @param query 媒体查询串，如 `(min-width: 1024px)`
 * @returns 当前是否匹配
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>((): boolean => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return false;
    }
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql: MediaQueryList = window.matchMedia(query);
    const handler = (event: MediaQueryListEvent): void => {
      setMatches(event.matches);
    };

    // 同步一次，避免 query 变化后状态滞后
    setMatches(mql.matches);
    mql.addEventListener('change', handler);

    return () => {
      mql.removeEventListener('change', handler);
    };
  }, [query]);

  return matches;
}

/** 是否为桌面端（≥1024px），对应三栏布局 */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 1024px)');
}

/** 是否为平板及以上（≥768px） */
export function useIsTablet(): boolean {
  return useMediaQuery('(min-width: 768px)');
}

/** 是否为移动端（<768px），对应竖向堆叠布局 */
export function useIsMobile(): boolean {
  return !useMediaQuery('(min-width: 768px)');
}

export default useMediaQuery;
