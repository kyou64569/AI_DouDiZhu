/**
 * 只读牌组展示（T04，视觉重构）。
 *
 * 用于出牌区、底牌等「不可选中、只展示」的场景。空牌组时展示占位文案。
 * 支持 `animate`：出现时逐张交错弹入（用于场上出牌、底牌等动态出现的场景）。
 */

import { memo } from 'react';
import type { Card } from '@/types/card';
import { sortCards } from '@/engine';
import { cn } from '@/utils/cn';
import { CardView, type CardSize } from './CardView';

export interface CardGroupProps {
  /** 要展示的牌（内部排序） */
  cards: Card[];
  /** 区域标题（如「底牌」「上一手」） */
  label?: string;
  /** 空牌组时的占位文案 */
  emptyText?: string;
  /** 牌尺寸 */
  size?: CardSize;
  /** 出现时逐张交错弹入动画（出牌/底牌等动态场景） */
  animate?: boolean;
  /** 额外类名 */
  className?: string;
}

/**
 * 只读牌组。
 */
export const CardGroup = memo(function CardGroup({
  cards,
  label,
  emptyText = '—',
  size = 'sm',
  animate = false,
  className,
}: CardGroupProps): JSX.Element {
  const ordered: Card[] = sortCards(cards);

  return (
    <div className={cn('flex flex-col items-center gap-1.5', className)}>
      {label ? <span className="text-[11px] font-medium tracking-wide text-white/60">{label}</span> : null}
      {ordered.length === 0 ? (
        <span className="flex h-14 items-center rounded-lg border border-dashed border-white/20 px-4 text-sm text-white/45">
          {emptyText}
        </span>
      ) : (
        <div className="flex items-end">
          {ordered.map((card: Card, idx: number) => (
            <div key={card.id} className={cn(idx > 0 && '-ml-2')} style={{ zIndex: idx }}>
              <div
                className={animate ? 'animate-play-pop' : undefined}
                style={animate ? { animationDelay: `${idx * 45}ms` } : undefined}
              >
                <CardView card={card} size={size} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

export default CardGroup;
