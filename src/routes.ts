/**
 * 路由常量（纯数据模块，零组件依赖）。
 *
 * 为什么单独成文件：
 * 这些常量原先定义在 `src/router.tsx` 里，而 router.tsx 又必须 import 全部页面组件，
 * 页面组件（GameTablePage / RoomPage / AIPlayerPage）与布局组件反过来又要 import ROUTES，
 * 形成 **循环依赖**：router → page → router。
 *
 * 在生产入口顺序（main.tsx → router.tsx → page）下，页面只在函数体内访问 ROUTES，
 * 靠 ESM live binding 侥幸不出错；但只要 import 顺序反过来（先加载页面模块，
 * 例如单测、脚本、代码分割、HMR 热更），router.tsx 求值时页面组件尚未导出，
 * `<GameTablePage />` 就会拿到 undefined，React 抛
 * "type is invalid -- got: undefined" 并渲染失败（白屏）。
 *
 * 把常量下沉到这个不依赖任何组件的叶子模块，即可彻底断环。
 * 消费方一律从 `@/routes` 引入；`@/router` 仍做 re-export 以兼容既有引用。
 */

/** 路由路径常量，避免各处硬编码字符串 */
export const ROUTES = {
  ROOT: '/',
  CONFIG: '/config',
  PLAYERS: '/players',
  ROOM: '/room',
  TABLE: '/table',
  HISTORY: '/history',
} as const;

/** 导航项，供 AppLayout 渲染顶部导航 */
export interface NavItem {
  path: string;
  label: string;
}

/** 顶部导航配置 */
export const NAV_ITEMS: NavItem[] = [
  { path: ROUTES.CONFIG, label: '模型配置' },
  { path: ROUTES.PLAYERS, label: 'AI 玩家' },
  { path: ROUTES.ROOM, label: '创建房间' },
  { path: ROUTES.TABLE, label: '牌桌' },
  { path: ROUTES.HISTORY, label: '战绩' },
];
