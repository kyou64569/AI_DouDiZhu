/**
 * 路由表。
 *
 * 四个页面对应 PRD 4.1~4.4：
 * - /config  模型配置
 * - /players AI 玩家管理
 * - /room    房间创建
 * - /table   牌桌
 * - /history 战绩
 *
 * 页面组件全部 React.lazy 懒加载（建议清单 #16）：按路由拆分 chunk 减小首屏体积，
 * Suspense fallback 与全站深色皮肤一致，避免加载期白屏闪烁。
 */

import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import { ROUTES, NAV_ITEMS, type NavItem } from './routes';

const ModelConfigPage = lazy((): Promise<{ default: React.ComponentType }> => import('./pages/ModelConfigPage'));
const AIPlayerPage = lazy((): Promise<{ default: React.ComponentType }> => import('./pages/AIPlayerPage'));
const RoomPage = lazy((): Promise<{ default: React.ComponentType }> => import('./pages/RoomPage'));
const GameTablePage = lazy((): Promise<{ default: React.ComponentType }> => import('./pages/GameTablePage'));
const HistoryPage = lazy((): Promise<{ default: React.ComponentType }> => import('./pages/HistoryPage'));

// 路由常量已下沉到 `./routes`（纯数据、零组件依赖），以断开
// router → page → router 的循环依赖。此处 re-export 仅为兼容既有引用，
// 新代码请直接从 `@/routes` 引入。
export { ROUTES, NAV_ITEMS, type NavItem };

/** 懒加载期间的占位（与深色主题一致，避免白屏闪烁） */
function PageFallback(): JSX.Element {
  return (
    <div className="flex min-h-[60vh] items-center justify-center" role="status" aria-label="页面加载中">
      <span className="h-8 w-8 animate-spin rounded-full border-2 border-gold-400/30 border-t-gold-400" />
    </div>
  );
}

/** 用统一 Suspense 包裹懒加载页面 */
function withSuspense(node: ReactNode): JSX.Element {
  return <Suspense fallback={<PageFallback />}>{node}</Suspense>;
}

/** 路由未匹配时的兜底页面 */
function NotFoundPage(): JSX.Element {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 text-center">
      <p className="text-6xl font-black text-gold-400/80">404</p>
      <p className="text-sm text-slate-400">页面不存在</p>
      <a href={ROUTES.ROOM} className="rounded-xl bg-gradient-to-br from-gold-400 to-gold-600 px-4 py-2 text-sm font-semibold text-gold-950 shadow-glowGold transition-transform hover:scale-105">
        返回创建房间
      </a>
    </div>
  );
}

/** 路由定义 */
const routes: RouteObject[] = [
  {
    path: ROUTES.ROOT,
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to={ROUTES.ROOM} replace /> },
      { path: 'config', element: withSuspense(<ModelConfigPage />) },
      { path: 'players', element: withSuspense(<AIPlayerPage />) },
      { path: 'room', element: withSuspense(<RoomPage />) },
      { path: 'table', element: withSuspense(<GameTablePage />) },
      { path: 'history', element: withSuspense(<HistoryPage />) },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

/** 应用路由实例 */
export const router = createBrowserRouter(routes);

export default router;
