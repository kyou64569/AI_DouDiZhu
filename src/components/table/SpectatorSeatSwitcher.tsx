/**
 * 观战视角切换器（观战模式专用，视觉重构）。
 *
 * 背景：观战模式此前把视角硬编码为 0 号座位（`viewSeat = humanSeat ?? 0`），
 * 导致用户只能看到第一位 AI 的手牌，无法观察另外两家的牌型与决策质量。
 *
 * 职责：
 *  - 提供三个座位的视角切换（点击即切底部手牌区展示的座位）；
 *  - 提供「三家全明」开关，一次性摊开全部三家手牌（观战无需保密）；
 *  - 每个座位标注：头像 / 名字 / 地主标识 / 剩余张数 / 是否正在行动。
 *
 * 仅在无人类座位（humanSeat === null，即 AI_SPECTATE 模式）时渲染。
 * 纯展示组件：不读 store，全部状态由父级传入。
 */

import { memo } from 'react';

import type { Player, SeatIndex } from '@/types/game';
import { cn } from '@/utils/cn';

export interface SpectatorSeatSwitcherProps {
  /** 三个座位的玩家（按座位索引顺序） */
  players: readonly Player[];
  /** 当前视角座位 */
  viewSeat: SeatIndex;
  /** 当前轮到行动的座位（用于高亮小圆点） */
  currentSeat: SeatIndex;
  /** 是否处于「三家全明」模式 */
  showAll: boolean;
  /** 选择某个座位为视角 */
  onSelect: (seat: SeatIndex) => void;
  /** 切换「三家全明」 */
  onToggleShowAll: () => void;
  /** 额外类名 */
  className?: string;
}

/** 观战视角切换器。 */
export const SpectatorSeatSwitcher = memo(function SpectatorSeatSwitcher({
  players,
  viewSeat,
  currentSeat,
  showAll,
  onSelect,
  onToggleShowAll,
  className,
}: SpectatorSeatSwitcherProps): JSX.Element {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className="flex shrink-0 items-center gap-1.5 text-xs text-white/55">
        <span className="h-1.5 w-1.5 rounded-full bg-brand-400" aria-hidden="true" />
        观战视角
      </span>

      <div className="flex flex-1 flex-wrap items-center gap-1.5">
        {players.map((player: Player): JSX.Element => {
          // 「三家全明」时不高亮单个座位，避免误导为仅看该家
          const active: boolean = !showAll && player.seat === viewSeat;
          const acting: boolean = player.seat === currentSeat;

          return (
            <button
              key={player.seat}
              type="button"
              onClick={() => onSelect(player.seat)}
              aria-pressed={active}
              title={`查看 ${player.name} 的手牌`}
              className={cn(
                'flex items-center gap-1.5 rounded-xl border px-2 py-1.5 text-xs transition-all duration-150 active:scale-95',
                active
                  ? 'border-brand-400/70 bg-brand-500/25 text-white shadow-glow ring-1 ring-brand-400/60'
                  : 'border-white/12 bg-black/25 text-white/75 hover:border-white/30 hover:bg-black/35 hover:text-white',
              )}
            >
              <span className="leading-none">
                {player.avatar && player.avatar.length > 0
                  ? player.avatar
                  : player.kind === 'HUMAN' ? '🧑' : '🤖'}
              </span>
              <span className="max-w-[6.5rem] truncate font-medium">{player.name}</span>
              {player.isLandlord ? (
                <span className="rounded bg-gradient-to-br from-gold-300 to-gold-500 px-1 py-px text-[10px] font-bold leading-none text-gold-950">
                  地主
                </span>
              ) : null}
              <span className="tabular-nums text-white/55">{player.hand.length}</span>
              {acting ? (
                <span className="h-1.5 w-1.5 shrink-0 animate-pulse-ring rounded-full bg-emerald-400" aria-label="行动中" />
              ) : null}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onToggleShowAll}
        aria-pressed={showAll}
        title="同时展示三家手牌"
        className={cn(
          'shrink-0 rounded-xl border px-2.5 py-1.5 text-xs font-medium transition-all duration-150 active:scale-95',
          showAll
            ? 'border-emerald-400/70 bg-emerald-500/25 text-white ring-1 ring-emerald-400/60'
            : 'border-white/12 bg-black/25 text-white/75 hover:border-white/30 hover:bg-black/35 hover:text-white',
        )}
      >
        {showAll ? '✓ 三家全明' : '三家全明'}
      </button>
    </div>
  );
});

export default SpectatorSeatSwitcher;
