/**
 * AI 思考日志抽屉（侧边滑出面板）。
 *
 * 需求：观战模式的 AI 思考记录面板改为「固定侧边栏、默认隐藏」，
 * 提供一个按钮，点击后从侧边平滑滑出显示；面板背景半透明，
 * 用户无需滚动到页面底部即可随时查看最新思考记录。
 *
 * 实现要点：
 *  - 抽屉自身 `fixed` 定位在视口右侧，始终挂载于 DOM（仅用 transform 平移实现隐藏/滑出），
 *    配合 CSS transition 得到平滑动画，且新日志到达时自动滚到底部；
 *  - 关闭态用 `translate-x-full` 推到屏幕外，打开态 `translate-x-0` 滑入；
 *  - 悬浮触发按钮固定在右侧居中，面板打开时自动淡出；
 *  - 面板用玻璃拟态（半透明 + 背景模糊），可透出牌桌，方便边看边打；
 *  - 内部 ThinkingLogPanel 提供「关闭」按钮收起面板。
 */

import { useState } from 'react';
import ThinkingLogPanel from './ThinkingLogPanel';
import { cn } from '@/utils/cn';

export interface ThinkingLogDrawerProps {
  /** 附加类名（作用于外层抽屉容器） */
  className?: string;
}

/**
 * AI 思考日志抽屉。固定在牌桌右侧，默认隐藏，点按钮平滑滑出。
 */
export function ThinkingLogDrawer({ className }: ThinkingLogDrawerProps): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);

  return (
    <>
      {/* 悬浮触发按钮：默认可见；面板打开时淡出并禁止点击 */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="打开 AI 思考日志"
        aria-expanded={open}
        className={cn(
          'fixed right-0 top-1/2 z-40 -translate-y-1/2 rounded-l-xl border border-r-0 border-gold-400/30 bg-felt-950/80 px-2 py-5 text-gold-300 shadow-lg backdrop-blur transition-all duration-200',
          open ? 'pointer-events-none opacity-0' : 'opacity-100 hover:bg-felt-900/90 hover:text-gold-200',
        )}
      >
        <span className="block text-xs font-medium tracking-widest [writing-mode:vertical-rl]">AI 思考</span>
      </button>

      {/* 抽屉面板：始终挂载，默认 translate-x-full 隐藏，点击按钮平滑滑出 */}
      <aside
        className={cn(
          'fixed right-0 top-0 z-50 flex h-full w-[min(420px,90vw)] flex-col pr-3 transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
          className,
        )}
        aria-hidden={!open}
        aria-label="AI 思考日志面板"
      >
        <ThinkingLogPanel variant="glass" onClose={() => setOpen(false)} className="h-full" />
      </aside>
    </>
  );
}

export default ThinkingLogDrawer;
