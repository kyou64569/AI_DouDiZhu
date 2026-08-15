/**
 * 对家面板（T04，REQ-U1 四要素，视觉重构）。
 *
 * 展示：头像/名字、剩余牌数、地主标识、回合倒计时、最近一手出牌。
 * 三处复用：桌面端两个对家 + 移动端可折叠区。
 *
 * 视觉重构：
 *  - 玻璃拟态卡片（半透明深色 + 背景模糊 + 顶部内高光）；
 *  - 轮到该家时：翠绿呼吸光晕 + SVG 倒计时进度环（最后 5s 转红）；
 *  - 地主：金色渐变徽章（👑 地主）；
 *  - 最近一手出牌以小尺寸牌面呈现，过牌/未出显示柔和占位。
 */

import { memo } from 'react';
import type { Player, PlayRecord } from '@/types/game';
import { CardGroup } from '@/components/card/CardGroup';
import { cn } from '@/utils/cn';

export interface OpponentPanelProps {
  /** 该座位玩家 */
  player: Player;
  /** 是否轮到该家 */
  isCurrent: boolean;
  /** 该家最近一手（用于展示最近出牌；为 null 显示「等待出牌」） */
  lastPlay?: PlayRecord | null;
  /** 该家的倒计时剩余秒数（仅当前回合显示） */
  countdown?: number | null;
  /** 紧凑模式（移动端折叠区使用） */
  compact?: boolean;
  /** 额外类名 */
  className?: string;
}

/** 对家倒计时总时长（与人类一致 30s；观战 AI 8s 由 store 侧决定，此处仅展示） */
const OPPONENT_TURN_SECONDS = 30;

/** 小型 SVG 倒计时进度环 */
function MiniRing({ remaining }: { remaining: number }): JSX.Element {
  const size = 26;
  const stroke = 3;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, remaining / OPPONENT_TURN_SECONDS));
  const urgent = remaining <= 5;
  const color = urgent ? '#ef4444' : '#34d399';

  return (
    <div
      className={cn(
        'relative flex items-center justify-center rounded-full bg-black/30',
        urgent ? 'animate-pulse-ring' : undefined,
      )}
      style={{ width: size, height: size }}
      role="timer"
      aria-label={`剩余 ${remaining} 秒`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.18)" strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - frac)}
          className="transition-[stroke-dashoffset] duration-1000 ease-linear"
        />
      </svg>
      <span
        className={cn(
          'absolute text-[10px] font-bold leading-none tabular-nums',
          urgent ? 'text-red-400' : 'text-emerald-300',
        )}
      >
        {remaining}
      </span>
    </div>
  );
}

/** 取最近一手出牌的展示标签 */
function lastPlayLabel(last: PlayRecord | null): string {
  if (!last) return '等待出牌';
  if (last.isPass) return '过牌';
  return last.cards.length > 0 ? `出 ${last.cards.length} 张` : '出牌';
}

/** 对家面板。 */
export const OpponentPanel = memo(function OpponentPanel({
  player,
  isCurrent,
  lastPlay,
  countdown,
  compact = false,
  className,
}: OpponentPanelProps): JSX.Element {
  const avatar: string =
    player.avatar && player.avatar.length > 0
      ? player.avatar
      : player.kind === 'HUMAN' ? '🧑' : '🤖';

  return (
    <div
      className={cn(
        'relative flex flex-col gap-2.5 rounded-2xl p-3 transition-all duration-300',
        compact ? 'w-full' : 'w-full min-w-[170px] max-w-[240px]',
        className,
      )}
    >
      {/* 玻璃拟态底层 */}
      <span className="pointer-events-none absolute inset-0 rounded-2xl border border-white/12 bg-black/25 backdrop-blur-md shadow-innerTop" aria-hidden="true" />

      {/* 行动中：翠绿呼吸光晕 */}
      {isCurrent ? (
        <span
          className="pointer-events-none absolute -inset-px rounded-2xl border border-emerald-400/60 animate-pulse-ring"
          aria-hidden="true"
        />
      ) : null}

      <div className="relative flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* 头像 */}
          <span
            className={cn(
              'flex h-10 w-10 flex-none items-center justify-center rounded-full text-xl leading-none shadow-sm',
              isCurrent
                ? 'bg-gradient-to-br from-emerald-400/30 to-emerald-600/20 ring-2 ring-emerald-400/70'
                : 'bg-white/10 ring-1 ring-white/20',
            )}
          >
            {avatar}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-white">{player.name}</p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-white/60">
              <span className="tabular-nums">
                剩 <span className="font-semibold text-white/85">{player.hand.length}</span> 张
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-none flex-col items-end gap-1.5">
          {player.isLandlord ? (
            <span className="flex items-center gap-1 rounded-md bg-gradient-to-br from-gold-300 via-gold-400 to-gold-600 px-1.5 py-0.5 text-[11px] font-bold leading-none text-gold-950 shadow-[0_2px_8px_rgba(245,158,11,0.4)]">
              👑 地主
            </span>
          ) : null}

          {isCurrent && typeof countdown === 'number' ? (
            <span className="flex items-center gap-1.5">
              <MiniRing remaining={countdown} />
              <span className="text-[11px] text-white/70">行动中</span>
            </span>
          ) : null}
        </div>
      </div>

      {/* 最近一手 */}
      <div className="relative flex min-h-[44px] items-center justify-center rounded-xl bg-black/20 px-1 py-1">
        {lastPlay && !lastPlay.isPass ? (
          <CardGroup cards={lastPlay.cards} size="sm" animate />
        ) : (
          <span className={cn('text-xs', lastPlay?.isPass ? 'text-white/45' : 'text-white/40')}>
            {lastPlayLabel(lastPlay ?? null)}
          </span>
        )}
      </div>
    </div>
  );
});

export default OpponentPanel;
