/**
 * 可选中的手牌区（T04，视觉重构）。
 *
 * 横向排列玩家手牌，支持点击选中（高亮上移）。移动端通过横向滚动避免溢出。
 * 选牌逻辑完全由父级通过 `selectedIds` + `onToggle` 控制，本组件只负责渲染与交互分发。
 */

import { memo } from 'react';
import type { Card } from '@/types/card';
import { sortCards } from '@/engine';
import { cn } from '@/utils/cn';
import { CardView, type CardSize } from './CardView';

export interface HandCardsProps {
  /** 手牌（任意顺序，内部按规则排序展示） */
  cards: Card[];
  /** 已选中的牌 id 集合 */
  selectedIds?: string[];
  /** 点击某张牌时的回调 */
  onToggle?: (cardId: string) => void;
  /** 是否允许选牌 */
  selectable?: boolean;
  /** 牌尺寸 */
  size?: CardSize;
  /** 额外类名 */
  className?: string;
}

/**
 * 手牌区。
 * 桌面端紧凑叠放（负 margin），移动端允许横向滚动。
 * 顶部预留上浮空间（pt-4），保证选中抬升时不被容器裁剪。
 */
export const HandCards = memo(function HandCards({
  cards,
  selectedIds = [],
  onToggle,
  selectable = false,
  size = 'md',
  className,
}: HandCardsProps): JSX.Element {
  const ordered: Card[] = sortCards(cards);

  if (ordered.length === 0) {
    return (
      <div
        className={cn(
          'flex h-24 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/25 bg-black/20 text-white/55',
          className,
        )}
      >
        <span className="text-2xl leading-none opacity-60">🂠</span>
        <span className="text-xs">暂无手牌</span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'hand-scroll flex justify-center px-2 pb-3 pt-4 md:overflow-visible md:px-0',
        className,
      )}
    >
      <div className="flex items-end">
        {ordered.map((card: Card, idx: number) => (
          <div
            key={card.id}
            className={cn(idx > 0 && '-ml-3 md:-ml-4', 'transition-transform duration-150')}
            style={{ zIndex: idx }}
          >
            <CardView
              card={card}
              size={size}
              selected={selectedIds.includes(card.id)}
              disabled={!selectable}
              onClick={selectable && onToggle ? () => onToggle(card.id) : undefined}
            />
          </div>
        ))}
      </div>
    </div>
  );
});

export default HandCards;
