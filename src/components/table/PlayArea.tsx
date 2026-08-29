/**
 * 中央出牌区（T04，视觉重构）。
 *
 * 展示当前场上「最近一手有效出牌」，无人出牌时展示等待提示。
 * 若为自由出牌轮，额外提示「请出牌」。
 *
 * 视觉重构：
 *  - 椭圆舞台式大圆角面板 + 中心光斑，聚焦视线；
 *  - 出牌出现时逐张交错弹入（CardGroup animate）；
 *  - 空态：自由轮金色提示 / 等待轮翠绿脉冲点；
 *  - 炸弹 / 王炸：舞台震动 + 冲击波光圈 + 「炸弹！/王炸！」横幅（建议清单 #10）。
 */

import { memo } from 'react';
import { CardType } from '@/types/card';
import type { PlayRecord } from '@/types/game';
import { CardGroup } from '@/components/card/CardGroup';
import { cn } from '@/utils/cn';

export interface PlayAreaProps {
  /** 当前最近一手有效出牌（过牌为 null） */
  lastPlay: PlayRecord | null;
  /** 是否自由出牌轮（无需压牌） */
  isFreeTurn: boolean;
  /** 额外类名 */
  className?: string;
}

/** 中央出牌区。 */
export const PlayArea = memo(function PlayArea({
  lastPlay,
  isFreeTurn,
  className,
}: PlayAreaProps): JSX.Element {
  const patternType: CardType | null = lastPlay?.pattern?.type ?? null;
  const isBomb: boolean = patternType === CardType.BOMB;
  const isRocket: boolean = patternType === CardType.ROCKET;
  const isExplosive: boolean = isBomb || isRocket;
  // 逐手唯一键：换一手牌时重挂载特效节点，保证震动/光圈每次都重新播放
  const effectKey: string = lastPlay ? `${lastPlay.turn}-${lastPlay.seat}` : 'none';

  return (
    <div
      className={cn(
        'relative flex min-h-[200px] flex-col items-center justify-center gap-3 overflow-hidden rounded-[2.5rem] px-5 py-8',
        'border border-white/12 bg-black/20 shadow-panel backdrop-blur-sm',
        className,
      )}
    >
      {/* 中心光斑 */}
      <span
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_62%_72%_at_50%_46%,rgba(255,255,255,0.055),transparent_72%)]"
        aria-hidden="true"
      />

      {lastPlay && !lastPlay.isPass ? (
        <>
          <span className="relative text-[11px] font-medium tracking-[0.3em] text-white/45">
            场上出牌
          </span>
          <div className={cn('relative', isExplosive && 'animate-bomb-shake')} key={effectKey}>
            <CardGroup cards={lastPlay.cards} size="md" animate />
            {/* 炸弹 / 王炸冲击波光圈 */}
            {isExplosive ? (
              <span
                className="pointer-events-none absolute left-1/2 top-1/2 h-40 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-gold-300/70 bg-[radial-gradient(ellipse_at_center,rgba(251,191,36,0.35),transparent_65%)] animate-bomb-flash"
                aria-hidden="true"
              />
            ) : null}
          </div>
          {isExplosive ? (
            <span
              key={`banner-${effectKey}`}
              className={cn(
                'relative animate-bomb-banner rounded-full px-4 py-1 text-base font-black tracking-widest shadow-glowGold',
                isRocket
                  ? 'bg-gradient-to-r from-rose-500 to-red-600 text-white'
                  : 'bg-gradient-to-r from-gold-400 to-orange-500 text-gold-950',
              )}
              role="status"
              aria-label={isRocket ? '王炸' : '炸弹'}
            >
              💥 {isRocket ? '王炸！' : '炸弹！'}
            </span>
          ) : null}
        </>
      ) : (
        <div className="relative flex flex-col items-center gap-3 text-center">
          <span
            className={cn(
              'flex h-16 w-16 items-center justify-center rounded-2xl text-3xl leading-none shadow-inner',
              isFreeTurn
                ? 'bg-gold-500/15 ring-1 ring-gold-400/40'
                : 'bg-white/5 ring-1 ring-white/10',
            )}
            aria-hidden="true"
          >
            🂡
          </span>
          <div className="flex items-center gap-2">
            {!isFreeTurn ? (
              <span className="h-1.5 w-1.5 animate-pulse-ring rounded-full bg-emerald-400" />
            ) : null}
            <span className={cn('text-sm', isFreeTurn ? 'font-medium text-gold-300' : 'text-white/55')}>
              {isFreeTurn ? '自由出牌轮，请出牌' : '等待出牌…'}
            </span>
          </div>
        </div>
      )}
    </div>
  );
});

export default PlayArea;
