/**
 * 出牌记录抽屉（侧边滑出面板，人机模式专用）。
 *
 * 需求：人机对战模式下牌桌隐藏 AI 思考过程与手牌，仅以文字时间线记录本局公开进程
 * —— 叫分 + 逐手出牌/过牌；将该时间线固定在牌桌右侧侧边栏（默认隐藏，点按钮滑出），
 * 与观战模式的「AI 思考」抽屉体验一致，用户无需滚动到牌桌底部即可随时查看最新出牌。
 *
 * 实现要点（与 ThinkingLogDrawer 对齐）：
 *  - 抽屉自身 fixed 定位在视口右侧，始终挂载于 DOM（仅用 transform 平移实现隐藏/滑出）；
 *  - 关闭态 translate-x-full 推到屏幕外，打开态 translate-x-0 滑入；
 *  - 悬浮触发按钮固定在右侧居中，面板打开时自动淡出；
 *  - 内部以纯文字形式展示出牌记录（PlayRecordTimeline variant="text"），不渲染牌图。
 */

import { useState } from 'react';
import PlayRecordTimeline from './PlayRecordTimeline';
import { cn } from '@/utils/cn';

export interface PlayRecordDrawerProps {
  /** 附加类名（作用于外层抽屉容器） */
  className?: string;
}

/**
 * 出牌记录抽屉。固定在牌桌右侧，默认隐藏，点按钮平滑滑出。
 */
export function PlayRecordDrawer({ className }: PlayRecordDrawerProps): JSX.Element {
  const [open, setOpen] = useState<boolean>(false);

  return (
    <>
      {/* 悬浮触发按钮：默认可见；面板打开时淡出并禁止点击 */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="打开出牌记录"
        aria-expanded={open}
        className={cn(
          'fixed right-0 top-1/2 z-40 -translate-y-1/2 rounded-l-xl border border-r-0 border-gold-400/30 bg-felt-950/80 px-2 py-5 text-gold-300 shadow-lg backdrop-blur transition-all duration-200',
          open ? 'pointer-events-none opacity-0' : 'opacity-100 hover:bg-felt-900/90 hover:text-gold-200',
        )}
      >
        <span className="block text-xs font-medium tracking-widest [writing-mode:vertical-rl]">出牌记录</span>
      </button>

      {/* 抽屉面板：始终挂载，默认 translate-x-full 隐藏，点击按钮平滑滑出 */}
      <aside
        className={cn(
          'fixed right-0 top-0 z-50 flex h-full w-[min(420px,90vw)] flex-col pr-3 transition-transform duration-300 ease-out',
          open ? 'translate-x-0' : 'translate-x-full',
          className,
        )}
        aria-hidden={!open}
        aria-label="出牌记录抽屉"
      >
        <PlayRecordTimeline variant="text" onClose={() => setOpen(false)} className="h-full" />
      </aside>
    </>
  );
}

export default PlayRecordDrawer;
