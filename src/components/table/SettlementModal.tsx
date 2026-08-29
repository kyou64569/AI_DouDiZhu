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
import { useTournamentStore, computeChampion } from '@/store/tournamentStore';
import { useGameStore } from '@/store/gameStore';
import { cn } from '@/utils/cn';
import { ROUTES } from '@/routes';

export interface SettlementModalProps {
  /** 是否展示 */
  open: boolean;
  /** 结算结果（为 null 时不展示主体） */
  settlement: SettlementResult | null;
  /** 三家玩家（用于展示座位名与地主标识） */
  players: [Player, Player, Player];
  /** 残局模式：隐藏「查看战绩」入口并把重开按钮改为「重新挑战」 */
  puzzleMode?: boolean;
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
  puzzleMode = false,
  onRestart,
  onDismiss,
  onExit,
  className,
}: SettlementModalProps): JSX.Element | null {
  // 连胜赛进度（未开启时各字段为默认值，主体区块不渲染）
  const tournament = useTournamentStore();
  // AI 复盘（#8）：结算后异步生成；null 表示本局不可用（无绑定模型 / 残局）
  const aiReview = useGameStore((state) => state.aiReview);

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

  // 连胜赛：冠军（打满后）与重开按钮文案（残局模式不参与赛制，隐藏该区块）
  const showTournament: boolean = tournament.active && !puzzleMode;
  const champion = showTournament && tournament.finished ? computeChampion(tournament.seatScores) : null;
  const restartLabel: string = puzzleMode
    ? '重新挑战'
    : tournament.active && tournament.finished
      ? '重新开始比赛'
      : tournament.active
        ? '下一局 →'
        : '再来一局';

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

        {/* 连胜赛进度 / 总冠军（建议清单 #4；残局模式不显示） */}
        {showTournament ? (
          <div className="flex flex-col gap-2">
            {champion !== null ? (
              <div className="flex flex-col items-center gap-1 rounded-xl border border-gold-400/40 bg-gold-500/10 px-3 py-3 text-center">
                <p className="text-lg font-black text-gold-gradient">
                  🏆 总冠军：{players[champion.seat].name}
                </p>
                <p className="text-xs text-slate-300">
                  {champion.tie ? '（并列最高分，按座位序取首）' : ''}
                  累计 <span className="font-bold text-gold-300 tabular-nums">{formatScore(champion.score)}</span> 分 ·{' '}
                  {tournament.completedRounds}/{tournament.targetRounds} 局
                </p>
              </div>
            ) : (
              <p className="text-center text-xs font-medium text-gold-300">
                🏆 连胜赛 · 第 {tournament.completedRounds} / {tournament.targetRounds} 局累计积分
              </p>
            )}
            <div className="flex flex-wrap items-center justify-center gap-2">
              {players.map((p: Player, seat: number) => (
                <span
                  key={seat}
                  className={cn(
                    'rounded-lg px-2 py-1 text-xs tabular-nums ring-1',
                    champion !== null && seat === champion.seat
                      ? 'bg-gold-500/15 text-gold-200 ring-gold-400/40'
                      : 'bg-white/5 text-slate-300 ring-white/10',
                  )}
                >
                  {p.name} <span className="font-bold">{formatScore(tournament.seatScores[seat])}</span>
                </span>
              ))}
            </div>
          </div>
        ) : null}

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

        {/* AI 复盘（建议清单 #8） */}
        {aiReview !== null ? (
          <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3">
            {aiReview.status === 'pending' ? (
              <p className="flex items-center gap-2 text-xs text-slate-400">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-gold-400/30 border-t-gold-400" aria-hidden="true" />
                AI 复盘生成中…（约需 10~30 秒，完成后自动展示并写入战绩）
              </p>
            ) : aiReview.status === 'failed' ? (
              <p className="text-xs text-slate-500">🧠 AI 复盘生成失败：{aiReview.error ?? '未知原因'}</p>
            ) : (
              <>
                <p className="text-xs font-medium text-gold-300">
                  🧠 AI 复盘
                  {aiReview.model ? <span className="ml-1.5 text-[11px] text-slate-500">复盘模型：{aiReview.model}</span> : null}
                </p>
                {aiReview.summary ? (
                  <p className="text-xs leading-relaxed text-slate-200">{aiReview.summary}</p>
                ) : null}
                {aiReview.hands !== undefined && aiReview.hands.length > 0 ? (
                  <ol className="flex flex-col gap-2">
                    {aiReview.hands.map((hand, i: number) => (
                      <li key={`${hand.playIndex}-${hand.seat}`} className="rounded-lg bg-black/20 px-2.5 py-2">
                        <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-300">
                          <span className="font-semibold text-slate-200">
                            第 {hand.playIndex + 1} 手 · {players[hand.seat]?.name ?? `座位${hand.seat + 1}`}
                          </span>
                          <span className="tabular-nums">{hand.play}</span>
                          {hand.degraded ? (
                            <span className="rounded bg-red-500/15 px-1.5 py-px text-[10px] text-red-300 ring-1 ring-red-400/30">
                              ⚠ 降级
                            </span>
                          ) : null}
                        </p>
                        {hand.reason ? (
                          <p className="mt-0.5 text-[11px] text-slate-500">当时理由：{hand.reason}</p>
                        ) : null}
                        <p className="mt-1 text-xs leading-relaxed text-slate-200">
                          {aiReview.comments?.[i] ?? '（该手无点评）'}
                        </p>
                      </li>
                    ))}
                  </ol>
                ) : null}
              </>
            )}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2.5">
          {!puzzleMode ? (
            <Link to={ROUTES.HISTORY}>
              <Button variant="ghost" className="text-slate-300 hover:bg-white/10 hover:text-white">
                查看战绩
              </Button>
            </Link>
          ) : null}
          <Button variant="ghost" onClick={onExit} className="text-slate-300 hover:bg-white/10 hover:text-white">
            退出对局
          </Button>
          <Button variant="gold" size="lg" onClick={onRestart}>
            {restartLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
});

export default SettlementModal;
