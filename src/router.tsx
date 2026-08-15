/**
 * 路由表。
 *
 * 四个页面对应 PRD 4.1~4.4：
 * - /config  模型配置
 * - /players AI 玩家管理
 * - /room    房间创建
 * - /table   牌桌
 */

import { createBrowserRouter, Navigate, type RouteObject } from 'react-router-dom';
import AppLayout from './components/layout/AppLayout';
import ModelConfigPage from './pages/ModelConfigPage';
import AIPlayerPage from './pages/AIPlayerPage';
import RoomPage from './pages/RoomPage';
import GameTablePage from './pages/GameTablePage';
import HistoryPage from './pages/HistoryPage';
import { ROUTES, NAV_ITEMS, type NavItem } from './routes';

// 路由常量已下沉到 `./routes`（纯数据、零组件依赖），以断开
// router → page → router 的循环依赖。此处 re-export 仅为兼容既有引用，
// 新代码请直接从 `@/routes` 引入。
export { ROUTES, NAV_ITEMS, type NavItem };

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
      { path: 'config', element: <ModelConfigPage /> },
      { path: 'players', element: <AIPlayerPage /> },
      { path: 'room', element: <RoomPage /> },
      { path: 'table', element: <GameTablePage /> },
      { path: 'history', element: <HistoryPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

/** 应用路由实例 */
export const router = createBrowserRouter(routes);

export default router;
