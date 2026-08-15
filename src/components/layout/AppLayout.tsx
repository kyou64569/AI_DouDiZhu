/**
 * 应用外壳：顶部导航栏 + 路由出口（全站深色主题，与牌桌配套）。
 *
 * 响应式（DESIGN §8.8）：
 * - <768px：品牌行 + 汉堡菜单，展开为竖向导航，避免挤压标题
 * - ≥768px：导航项内联展示在顶栏右侧
 *
 * 沉浸式牌桌：
 * - 路由为 /table 时隐藏顶栏/底栏、去掉 main 的宽度/内边距限制，牌桌接管整屏；
 * - 其余页面使用深色玻璃顶栏（bg-slate-900/80 + blur）+ 深色底栏，与牌桌同源配色。
 */

import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { NAV_ITEMS, ROUTES, type NavItem } from '@/routes';
import { cn } from '@/utils/cn';

/** 汉堡 / 关闭图标 */
function MenuIcon({ open }: { open: boolean }): JSX.Element {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      {open ? (
        <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M4 7h16M4 12h16M4 17h16" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

/** 导航链接的类名计算（深色主题） */
function navLinkClass({ isActive }: { isActive: boolean }): string {
  return cn(
    'rounded-xl px-3 py-2 text-sm font-medium transition-all duration-150 active:scale-[0.97]',
    isActive
      ? 'bg-gradient-to-br from-gold-400/25 to-gold-600/20 text-gold-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.1)] ring-1 ring-gold-400/40'
      : 'text-slate-400 hover:bg-white/8 hover:text-slate-100',
  );
}

/**
 * 应用布局外壳。
 * 由路由表作为根节点渲染，子页面通过 `<Outlet />` 挂载。
 */
export function AppLayout(): JSX.Element {
  const [menuOpen, setMenuOpen] = useState<boolean>(false);
  const location = useLocation();

  /** 牌桌路由：切换为沉浸式（无顶栏/底栏/页面宽度限制） */
  const isImmersive: boolean = location.pathname === ROUTES.TABLE;

  // 路由切换后自动收起移动端菜单
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  return (
    <div className={cn('flex min-h-screen flex-col', isImmersive ? 'bg-felt-900' : '')}>
      {!isImmersive ? (
        <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-900/80 backdrop-blur-xl">
          <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3">
            {/* 品牌 */}
            <NavLink to={ROUTES.ROOM} className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-felt-400 to-felt-800 text-base font-bold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.2),0_4px_12px_rgba(0,0,0,0.35)]">
                斗
              </span>
              <span className="text-base font-semibold text-slate-100">AI 斗地主</span>
            </NavLink>

            {/* 桌面导航（≥768px） */}
            <nav className="hidden items-center gap-1 md:flex" aria-label="主导航">
              {NAV_ITEMS.map((item: NavItem) => (
                <NavLink key={item.path} to={item.path} className={navLinkClass}>
                  {item.label}
                </NavLink>
              ))}
            </nav>

            {/* 移动端汉堡按钮（<768px） */}
            <button
              type="button"
              onClick={() => setMenuOpen((prev: boolean): boolean => !prev)}
              aria-label={menuOpen ? '收起菜单' : '展开菜单'}
              aria-expanded={menuOpen}
              className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/15 text-slate-300 transition-colors hover:bg-white/10 md:hidden"
            >
              <MenuIcon open={menuOpen} />
            </button>
          </div>

          {/* 移动端展开的导航 */}
          {menuOpen ? (
            <nav className="border-t border-white/10 bg-slate-900/95 px-4 pb-3 pt-2 md:hidden" aria-label="移动端导航">
              <div className="flex flex-col gap-1">
                {NAV_ITEMS.map((item: NavItem) => (
                  <NavLink key={item.path} to={item.path} className={navLinkClass}>
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </nav>
          ) : null}
        </header>
      ) : null}

      <main className={cn(isImmersive ? 'flex min-h-screen flex-1 flex-col' : 'mx-auto w-full max-w-6xl flex-1 px-4 py-5 lg:py-8')}>
        <Outlet />
      </main>

      {!isImmersive ? (
        <footer className="border-t border-white/10 bg-slate-900/60 py-3 backdrop-blur">
          <p className="mx-auto max-w-6xl px-4 text-xs text-slate-500">
            本机单机应用 · 模型配置与 API Key 仅保存在当前浏览器
          </p>
        </footer>
      ) : null}
    </div>
  );
}

export default AppLayout;
