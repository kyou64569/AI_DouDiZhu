/**
 * 结算弹窗（T04，REQ-R7，视觉重构）。
 *
 * 展示对局结果：胜负方、倍数明细（含炸弹/春天等因子）、三家得分。
 * 提供「再来一局」与「返回房间」两个出口。
 *
 * 视觉重构：深色主题（Modal variant="dark"），金色渐变标注胜方，
 * 倍数构成 chips、春天徽章、得分正负色，质感与牌桌一致。
 */

import { memo } from 'react';
import { Link } from 'react-router-dom';
import type { SettlementResult } from '@/types/game';
import type { Player } from '@/types/game';
import { Modal } from '@/components/common/Modal';
import { Button } from '@/components/common/Button';
import { formatMultiplier, formatScore } from '@/utils/format';
import { cn } from '@/utils/cn';
import { ROUTES } from '@/routes';

export interface SettlementModalProps {
  /** 是否展示 */
  open: boolean;
  /** 结算结果（为 null 时不展示主体） */
  settlement: SettlementResult | null;
  /** 三家玩家（用于展示座位名与地主标识） */
  players: [Player, Player, Player];
  /** 再来一局 */
  onRestart: () => void;
  /** 关闭弹窗（查看终局牌桌，不重开） */
  onDismiss: () => void;
  /** 退出对局：清空牌桌并返回房间（不再保留终局状态） */
  onExit: () => void;
  /** 额外类名 */
  className?: string;
}

/** 结算弹窗。 */
export const SettlementModal = memo(function SettlementModal({
  open,
  settlement,
  players,
  onRestart,
  onDismiss,
  onExit,
  className,
}: SettlementModalProps): JSX.Element | null {
  if (!settlement) {
    return (
      <Modal open={open} onClose={onDismiss} title="对局结算" variant="dark">
        <p className="text-slate-400">结算数据缺失。</p>
      </Modal>
    );
  }

  const landlordWin: boolean = settlement.landlordWin;
  const title: string = landlordWin ? '地主获胜' : '农民获胜';
  const titleEmoji: string = landlordWin ? '👑' : '🌾';

  return (
    <Modal open={open} onClose={onDismiss} title="对局结算" size="md" variant="dark" className={className}>
      <div className="flex flex-col gap-5">
        {/* 胜方横幅 */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-2">
            <span className="text-3xl" aria-hidden="true">
              {titleEmoji}
            </span>
            <p
              className={cn(
                'text-3xl font-black tracking-wide',
                landlordWin
                  ? 'text-gold-gradient'
                  : 'bg-gradient-to-br from-emerald-300 to-emerald-500 bg-clip-text text-transparent',
              )}
            >
              {title}
            </p>
          </div>
          <p className="mt-2 text-sm text-slate-400">
            底分 <span className="font-semibold text-slate-200 tabular-nums">{settlement.baseScore}</span>
            {' · '}倍数{' '}
            <span className="font-semibold text-gold-300 tabular-nums">{formatMultiplier(settlement.multiplier)}</span>
            {' · '}单局分{' '}
            <span className="font-semibold text-slate-200 tabular-nums">{settlement.unitScore}</span>
          </p>
        </div>

        {/* 倍数明细 */}
        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-slate-500">倍数构成</p>
          <div className="flex flex-wrap items-center gap-2">
            {settlement.multiplierDetail.map((item, idx: number) => (
              <span
                key={`${item.reason}-${idx}`}
                className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-200"
              >
                {item.reason} <span className="font-bold text-gold-300">×{item.factor}</span>
              </span>
            ))}
            {(settlement.isSpring || settlement.isAntiSpring) && (
              <span
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-semibold',
                  settlement.isSpring
                    ? 'bg-pink-500/20 text-pink-300 ring-1 ring-pink-400/40'
                    : 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/40',
                )}
              >
                {settlement.isSpring ? '🌸 春天' : '🌿 反春天'}
              </span>
            )}
          </div>
        </div>

        {/* 三家得分 */}
        <div>
          <p className="mb-2 text-xs font-medium tracking-wide text-slate-500">各席得分</p>
          <div className="overflow-hidden rounded-xl border border-white/10">
            {players.map((p: Player, seat: number) => {
              const score: number = settlement.seatScores[seat];
              return (
                <div
                  key={seat}
                  className={cn(
                    'flex items-center justify-between px-3.5 py-2.5',
                    seat < 2 && 'border-b border-white/8',
                    p.isLandlord ? 'bg-gold-500/10' : 'bg-white/[0.03]',
                  )}
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-slate-200">
                    <span className="text-base leading-none" aria-hidden="true">
                      {p.avatar && p.avatar.length > 0 ? p.avatar : p.kind === 'HUMAN' ? '🧑' : '🤖'}
                    </span>
                    <span className="truncate">
                      {p.name}
                      {p.isLandlord ? <span className="ml-1.5 text-gold-300">👑 地主</span> : null}
                    </span>
                  </span>
                  <span
                    className={cn(
                      'text-base font-bold tabular-nums',
                      score > 0 ? 'text-emerald-400' : score < 0 ? 'text-red-400' : 'text-slate-400',
                    )}
                  >
                    {score > 0 ? '+' : ''}
                    {formatScore(score)}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2.5">
          <Link to={ROUTES.HISTORY}>
            <Button variant="ghost" className="text-slate-300 hover:bg-white/10 hover:text-white">
              查看战绩
            </Button>
          </Link>
          <Button variant="ghost" onClick={onExit} className="text-slate-300 hover:bg-white/10 hover:text-white">
            退出对局
          </Button>
          <Button variant="gold" size="lg" onClick={onRestart}>
            再来一局
          </Button>
        </div>
      </div>
    </Modal>
  );
});

export default SettlementModal;
