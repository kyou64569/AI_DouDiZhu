/**
 * 单张扑克牌视图（T04，视觉重构）。
 *
 * 纯展示组件：根据 Card 的 rank / suit 渲染牌面，红桃/方块与大王用红色，
 * 黑桃/梅花与小王用黑色。支持选中态、背面（暗牌）、尺寸与点击。
 *
 * 视觉重构要点：
 *  - 牌面：白底微渐变 + 左上角牌点 + 中央大花色，圆角更圆润；
 *  - 大小王：中央圆形徽章呈现，区分红/黑；
 *  - 牌背：深蓝金边编织纹理（.card-back）+ 金色描边 + 周期高光扫过；
 *  - 选中态：上浮 + 金色 ring + 金色柔光，替代原蓝色描边；
 *  - 悬停（仅可选时）：轻抬升 + 阴影加深，引导可点性。
 */

import { memo } from 'react';
import type { Card } from '@/types/card';
import { SUIT_SYMBOLS } from '@/engine';
import { cn } from '@/utils/cn';

/** 尺寸预设 */
export type CardSize = 'sm' | 'md' | 'lg';

/** 各尺寸宽高（约 1:1.42 标准扑克比例） */
const SIZE_CLASS: Record<CardSize, string> = {
  sm: 'h-16 w-11',
  md: 'h-20 w-14',
  lg: 'h-24 w-[4.25rem]',
};

/** 左上角牌点字号 */
const RANK_CLASS: Record<CardSize, string> = {
  sm: 'text-sm',
  md: 'text-lg',
  lg: 'text-xl',
};

/** 左上角花色小标字号 */
const CORNER_SUIT_CLASS: Record<CardSize, string> = {
  sm: 'text-[9px]',
  md: 'text-[11px]',
  lg: 'text-[13px]',
};

/** 中央花色字号 */
const CENTER_SUIT_CLASS: Record<CardSize, string> = {
  sm: 'text-lg',
  md: 'text-2xl',
  lg: 'text-3xl',
};

/** 大小王中央徽章尺寸 */
const JOKER_BADGE_CLASS: Record<CardSize, string> = {
  sm: 'h-7 w-7 text-sm',
  md: 'h-9 w-9 text-lg',
  lg: 'h-11 w-11 text-xl',
};

/** 牌背中央装饰符字号 */
const BACK_MARK_CLASS: Record<CardSize, string> = {
  sm: 'text-[10px]',
  md: 'text-xs',
  lg: 'text-sm',
};

/** 判断牌面是否为红色（红桃/方块/大王） */
function isRed(card: Card): boolean {
  if (card.suit === 'HEART' || card.suit === 'DIAMOND') return true;
  // 大小王：rank 17 大王（红），rank 16 小王（黑）
  if (card.suit === 'JOKER') return card.rank === 17;
  return false;
}

/**
 * 单张牌。
 * 用 React.memo 包裹，避免手牌区重渲染时无关牌重复绘制。
 */
export const CardView = memo(function CardView({
  card,
  selected = false,
  faceDown = false,
  size = 'md',
  onClick,
  disabled = false,
  className,
}: CardViewProps): JSX.Element {
  const red: boolean = isRed(card);

  if (faceDown) {
    return (
      <div
        className={cn(
          'card-back relative flex flex-none items-center justify-center overflow-hidden rounded-[10px] border border-gold-400/50 shadow-card',
          SIZE_CLASS[size],
          className,
        )}
        aria-label="暗牌"
      >
        {/* 内层金线框 */}
        <span
          className="pointer-events-none absolute inset-[3px] rounded-[7px] border border-white/20"
          aria-hidden="true"
        />
        {/* 高光周期扫过 */}
        <span
          className="pointer-events-none absolute inset-y-0 w-10 animate-shine bg-gradient-to-r from-transparent via-white/15 to-transparent"
          aria-hidden="true"
        />
        <span className={cn('text-gold-300', BACK_MARK_CLASS[size])} aria-hidden="true">
          ✦
        </span>
      </div>
    );
  }

  const symbol: string = card.suit === 'JOKER' ? '🃏' : SUIT_SYMBOLS[card.suit];
  const isJoker: boolean = card.suit === 'JOKER';

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'relative flex flex-none select-none flex-col items-center justify-start rounded-[10px] border bg-gradient-to-b from-white via-white to-slate-50 px-1 pb-1 pt-1.5 shadow-card',
        'font-card transition-all duration-150 ease-out',
        SIZE_CLASS[size],
        red ? 'border-red-200 text-card-red' : 'border-slate-200 text-card-black',
        selected
          ? '-translate-y-4 scale-[1.04] shadow-glowGold ring-2 ring-gold-400'
          : !disabled && onClick
            ? 'cursor-pointer hover:-translate-y-2 hover:shadow-cardHover hover:ring-1 hover:ring-slate-300/80'
            : 'cursor-default',
        disabled && 'opacity-60',
        className,
      )}
      aria-pressed={selected}
      aria-label={`${card.label}${!isJoker ? symbol : ''}`}
    >
      {/* 左上角：牌点 + 花色小标 */}
      <span className="flex flex-col items-start leading-none">
        <span className={cn('card-face-text font-bold leading-none', RANK_CLASS[size])}>{card.label}</span>
        <span className={cn('mt-0.5 font-semibold leading-none', CORNER_SUIT_CLASS[size])}>{symbol}</span>
      </span>

      {/* 中央装饰：大小王用徽章，普通牌用大花色 */}
      {isJoker ? (
        <span className="mt-auto flex items-center justify-center">
          <span
            className={cn(
              'flex items-center justify-center rounded-full leading-none shadow-inner',
              JOKER_BADGE_CLASS[size],
              red
                ? 'bg-gradient-to-br from-red-400/25 to-red-500/10 ring-1 ring-red-300/70'
                : 'bg-gradient-to-br from-slate-400/25 to-slate-500/10 ring-1 ring-slate-400/70',
            )}
          >
            {symbol}
          </span>
        </span>
      ) : (
        <span
          className={cn(
            'mt-auto flex items-center justify-center leading-none opacity-90',
            CENTER_SUIT_CLASS[size],
          )}
        >
          {symbol}
        </span>
      )}
    </button>
  );
});

export interface CardViewProps {
  /** 牌数据 */
  card: Card;
  /** 是否选中（用于手牌区高亮） */
  selected?: boolean;
  /** 是否暗牌（背面朝上，不展示牌面） */
  faceDown?: boolean;
  /** 尺寸 */
  size?: CardSize;
  /** 是否可点击 */
  onClick?: () => void;
  /** 是否禁用点击 */
  disabled?: boolean;
  /** 额外类名 */
  className?: string;
}

export default CardView;
