/**
 * 叫分面板（T04，PRD D2，视觉重构）。
 *
 * 人类回合展示可选叫分按钮。叫分严格递增：只能选比当前最高分更高的分或不叫。
 * 由 store 的 `getLegalBids(highestBid)` 决定可选项，杜绝非法叫分。
 *
 * 视觉重构：
 *  - 玻璃拟态容器；
 *  - 1/2/3 分用金色大号数字卡片（hover 抬升发光），0 分「不叫」为次级按钮。
 */

import { memo } from 'react';
import type { BidScore } from '@/types/game';
import { cn } from '@/utils/cn';

export interface BiddingPanelProps {
  /** 当前最高叫分 */
  highestBid: number;
  /** 合法叫分列表（含 0 = 不叫） */
  legalBids: BidScore[];
  /** 选择某叫分 */
  onBid: (score: BidScore) => void;
  /** 额外类名 */
  className?: string;
}

/** 叫分面板。 */
export const BiddingPanel = memo(function BiddingPanel({
  highestBid,
  legalBids,
  onBid,
  className,
}: BiddingPanelProps): JSX.Element {
  const scoreBids: BidScore[] = legalBids.filter((s) => s > 0);
  const passBid: boolean = legalBids.includes(0);

  return (
    <div className={cn('glass-panel flex flex-col items-center gap-3 rounded-2xl px-6 py-4', className)}>
      <p className="text-sm text-white/85">
        {highestBid > 0 ? (
          <>
            轮到你叫分 · 当前最高{' '}
            <span className="font-bold text-gold-300 tabular-nums">{highestBid}</span> 分
          </>
        ) : (
          '轮到你叫分'
        )}
      </p>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {scoreBids.map((score: BidScore) => (
          <button
            key={score}
            type="button"
            onClick={() => onBid(score)}
            aria-label={`叫 ${score} 分`}
            className={cn(
              'flex h-20 w-16 flex-col items-center justify-center gap-0.5 rounded-2xl transition-all duration-150 active:scale-95',
              'bg-gradient-to-br from-gold-300 via-gold-400 to-gold-600 text-gold-950',
              'shadow-[0_6px_20px_rgba(245,158,11,0.35)] hover:-translate-y-1 hover:shadow-glowGold',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-gold-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900',
            )}
          >
            <span className="text-3xl font-black leading-none tabular-nums">{score}</span>
            <span className="text-[11px] font-semibold leading-none">分</span>
          </button>
        ))}

        {passBid ? (
          <button
            type="button"
            onClick={() => onBid(0)}
            aria-label="不叫"
            className={cn(
              'flex h-20 w-16 flex-col items-center justify-center gap-0.5 rounded-2xl transition-all duration-150 active:scale-95',
              'border border-white/15 bg-white/10 text-white/85 backdrop-blur-sm',
              'hover:bg-white/15 hover:text-white',
              'focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50',
            )}
          >
            <span className="text-2xl leading-none">✕</span>
            <span className="text-xs">不叫</span>
          </button>
        ) : null}
      </div>
    </div>
  );
});

export default BiddingPanel;
