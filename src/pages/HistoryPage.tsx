/**
 * 战绩页（历史记录 + 模型积分榜）。
 *
 * 两块内容：
 *  1. 模型排行榜：按模型聚合的累计净胜分 / 胜局 / 胜率，降序排列（看哪个模型最厉害）；
 *  2. 对局列表：每局时间 / 模式 / 胜方 / 三家得分，点击可展开倍数明细、叫分与逐手出牌摘要。
 *
 * 数据来自 useHistoryStore（localStorage 落库，由 gameStore.settle 写入）。
 */

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useHistoryStore, computeLeaderboard } from '@/store/historyStore';
import { usePlayerStore } from '@/store/playerStore';
import { ROUTES } from '@/routes';
import { formatMultiplier, formatScore } from '@/utils/format';
import { formatCards } from '@/engine/sort';
import { getCardTypeName } from '@/engine/cardType';
import type { GameRecord, SeatSummary } from '@/types/history';
import type { BidRecord, PlayRecord, SeatIndex } from '@/types/game';
import { cn } from '@/utils/cn';

/** 时间戳 → 本地可读时间 */
function formatTime(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 模式中文名 */
function modeLabel(mode: GameRecord['mode']): string {
  return mode === 'HUMAN_VS_AI' ? '人机对战' : 'AI 观战';
}

/** 单座位牌型名 */
function patternName(rec: PlayRecord): string {
  if (rec.pattern === null) return '过牌';
  return getCardTypeName(rec.pattern.type);
}

/** 一条出牌记录的展示文本 */
function playText(rec: PlayRecord, nameOf: (seat: SeatIndex) => string): string {
  if (rec.isPass || rec.cards.length === 0) {
    return `${nameOf(rec.seat)}：过牌`;
  }
  return `${nameOf(rec.seat)}：出 ${formatCards(rec.cards)}（${patternName(rec)}）`;
}

/** 一条叫分记录的展示文本 */
function bidText(rec: BidRecord, nameOf: (seat: SeatIndex) => string): string {
  return `${nameOf(rec.seat)}：${rec.score === 0 ? '不叫' : `叫 ${rec.score} 分`}`;
}

/**
 * 座位头像解析优先级：
 *  1. 记录内快照头像（结算时存的 avatar，最贴合该局实况）；
 *  2. 按 aiPlayerId 实时取 AI 玩家页配置的 avatar（新对局最精准，确保按用户配置显示）；
 *  3. 旧记录兜底：按名称 / 模型回溯 AI 玩家页配置（尽力还原修复前旧记录的各自头像）；
 *  4. 均无则按身份回退（AI→🤖，人类→🧑）。
 */
function seatAvatar(seat: SeatSummary): string {
  if (seat.avatar && seat.avatar.length > 0) return seat.avatar;
  if (seat.kind === 'AI') {
    const players = usePlayerStore.getState().players;
    if (seat.aiPlayerId) {
      const byId = players.find((p) => p.id === seat.aiPlayerId);
      if (byId?.avatar && byId.avatar.length > 0) return byId.avatar;
    }
    const byName = players.find((p) => p.name === seat.name);
    if (byName?.avatar && byName.avatar.length > 0) return byName.avatar;
    if (seat.model) {
      const byModel = players.find((p) => p.modelId === seat.model || p.modelConfigId === seat.model);
      if (byModel?.avatar && byModel.avatar.length > 0) return byModel.avatar;
    }
  }
  return seat.kind === 'HUMAN' ? '🧑' : '🤖';
}

/** 按座位号查找该座位头像（用于 bid/play 行首，确保每行显示对应座位自己的头像） */
function avatarOfSeat(rec: GameRecord, seat: SeatIndex): string {
  const s = rec.seats.find((x) => x.seat === seat);
  return s ? seatAvatar(s) : '🧑';
}

/**
 * 战绩页。
 */
export function HistoryPage(): JSX.Element {
  const records: GameRecord[] = useHistoryStore((s) => s.records);
  const clearHistory = useHistoryStore((s) => s.clear);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const leaderboard = useMemo(() => computeLeaderboard(records), [records]);

  const nameOf = (rec: GameRecord) => (seat: SeatIndex): string => {
    return rec.seats.find((s) => s.seat === seat)?.name ?? `座位${seat + 1}`;
  };

  const handleClear = (): void => {
    if (window.confirm('确定清空全部对局历史？此操作不可恢复。')) {
      clearHistory();
      setExpandedId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="app-icon-badge" aria-hidden="true">
            🏆
          </span>
          <div>
            <h1 className="app-page-title">战绩</h1>
            <p className="app-page-desc">模型排行榜与历史对局明细，全部保存在本机浏览器</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link to={ROUTES.TABLE} className="text-sm font-medium text-gold-300 underline underline-offset-4 hover:text-gold-200">
            去牌桌
          </Link>
          {records.length > 0 ? (
            <button
              type="button"
              onClick={handleClear}
              className="rounded-xl border border-white/15 bg-white/5 px-3 py-1.5 text-sm text-slate-300 transition-all duration-150 hover:bg-white/10 hover:text-white active:scale-95"
            >
              清空历史
            </button>
          ) : null}
        </div>
      </div>

      {/* —— 模型排行榜 —— */}
      <section>
        <h2 className="app-section-title mb-2">模型排行榜（累计净胜分）</h2>
        {leaderboard.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-6 text-center text-sm text-slate-500">
            还没有对局数据。打完一局后，这里会按模型累计积分。
          </p>
        ) : (
          <div className="app-card overflow-hidden">
            <div className="grid grid-cols-[2.5rem_1fr_5rem_3.5rem_3.5rem_3.5rem] gap-2 border-b border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-slate-400">
              <span>#</span>
              <span>模型 / 身份</span>
              <span className="text-right">净胜分</span>
              <span className="text-right">对局</span>
              <span className="text-right">胜局</span>
              <span className="text-right">胜率</span>
            </div>
            {leaderboard.map((entry, idx) => (
              <div
                key={entry.key}
                className={cn(
                  'grid grid-cols-[2.5rem_1fr_5rem_3.5rem_3.5rem_3.5rem] gap-2 px-3 py-2 text-sm transition-colors hover:bg-white/5',
                  idx < leaderboard.length - 1 && 'border-b border-white/8',
                )}
              >
                <span className={cn('font-semibold tabular-nums', idx === 0 ? 'text-gold-300' : 'text-slate-500')}>
                  {idx + 1}
                </span>
                <span className="truncate font-medium text-slate-200" title={entry.label}>
                  {entry.label}
                </span>
                <span
                  className={cn(
                    'text-right font-semibold tabular-nums',
                    entry.totalScore > 0 ? 'text-emerald-400' : entry.totalScore < 0 ? 'text-red-400' : 'text-slate-500',
                  )}
                >
                  {formatScore(entry.totalScore)}
                </span>
                <span className="text-right tabular-nums text-slate-400">{entry.games}</span>
                <span className="text-right tabular-nums text-slate-400">{entry.wins}</span>
                <span className="text-right tabular-nums text-slate-400">
                  {(entry.winRate * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* —— 对局列表 —— */}
      <section>
        <h2 className="app-section-title mb-2">对局记录（{records.length} 局）</h2>
        {records.length === 0 ? (
          <p className="rounded-xl border border-dashed border-white/15 bg-white/[0.03] px-4 py-6 text-center text-sm text-slate-500">
            暂无记录。
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {records.map((rec) => {
              const open = expandedId === rec.id;
              const winnerName = nameOf(rec)(rec.winnerSeat);
              return (
                <div key={rec.id} className="app-card overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedId(open ? null : rec.id)}
                    className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-left text-sm transition-colors hover:bg-white/5"
                  >
                    <span className="tabular-nums text-slate-500">{formatTime(rec.finishedAt)}</span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 text-xs text-slate-300">
                      {modeLabel(rec.mode)}
                    </span>
                    <span className="font-medium text-slate-200">
                      胜方：{winnerName}
                      {rec.landlordWin ? '（地主）' : '（农民）'}
                    </span>
                    <span className="text-xs text-slate-500">
                      底分 {rec.baseScore} · 倍数 {formatMultiplier(rec.multiplier)}
                    </span>
                    <span className="ml-auto flex items-center gap-1">
                      {rec.seats.map((s) => (
                        <span
                          key={s.seat}
                          className={cn(
                            'rounded px-1.5 py-0.5 text-xs tabular-nums',
                            s.score > 0 ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300',
                          )}
                      title={s.name}
                    >
                      {seatAvatar(s)} {s.name.length > 4 ? `${s.name.slice(0, 4)}…` : s.name}:{formatScore(s.score)}
                    </span>
                      ))}
                    </span>
                  </button>

                  {open ? (
                    <div className="border-t border-white/10 bg-white/[0.03] px-3 py-3 text-xs text-slate-400">
                      {/* 三家头像 + 名称（来自历史记录快照，确保显示各自头像） */}
                      <div className="mb-2 flex flex-wrap items-center gap-3">
                        {rec.seats.map((s) => (
                          <span key={s.seat} className="flex items-center gap-1.5">
                            <span className="text-lg leading-none">{seatAvatar(s)}</span>
                            <span className="font-medium text-slate-200">
                              {s.name}
                              {s.isLandlord ? '（地主）' : ''}
                            </span>
                          </span>
                        ))}
                      </div>

                      <div className="mb-2 flex flex-wrap gap-2">
                        {rec.multiplierDetail.map((item, i) => (
                          <span key={`${item.reason}-${i}`} className="rounded bg-white/10 px-2 py-0.5 text-slate-300">
                            {item.reason} ×{item.factor}
                          </span>
                        ))}
                        {rec.isSpring ? <span className="rounded bg-pink-500/20 px-2 py-0.5 text-pink-300 ring-1 ring-pink-400/30">🌸 春天</span> : null}
                        {rec.isAntiSpring ? (
                          <span className="rounded bg-emerald-500/20 px-2 py-0.5 text-emerald-300 ring-1 ring-emerald-400/30">🌿 反春天</span>
                        ) : null}
                      </div>

                      {rec.bidHistory.length > 0 ? (
                        <div className="mb-2">
                          <p className="mb-1 font-medium text-slate-500">叫分</p>
                          <p className="leading-relaxed">
                            {rec.bidHistory.map((b, i) => (
                              <span key={i} className="after:content-['、'] last:after:content-['']">
                                <span className="inline-flex items-center gap-1">
                                  <span className="text-base leading-none">{avatarOfSeat(rec, b.seat)}</span>
                                  <span>{bidText(b, nameOf(rec))}</span>
                                </span>
                                {b.reason ? (
                                  <span className="ml-1 text-[11px] text-slate-500">{b.reason}</span>
                                ) : null}
                              </span>
                            ))}
                          </p>
                        </div>
                      ) : null}

                      <div>
                        <p className="mb-1 font-medium text-slate-500">出牌过程（{rec.playHistory.length} 手）</p>
                        <ol className="scrollbar-thin max-h-64 space-y-1 overflow-y-auto leading-relaxed">
                          {rec.playHistory.map((p, i) => {
                            const isAI: boolean | undefined = rec.seats.find((s) => s.seat === p.seat)?.kind === 'AI';
                            return (
                              <li key={i} className={cn('leading-snug', p.isPass && 'text-slate-500')}>
                                <div className="flex items-center gap-1">
                                  <span className="text-base leading-none">{avatarOfSeat(rec, p.seat)}</span>
                                  <span>
                                    {i + 1}. {playText(p, nameOf(rec))}
                                  </span>
                                </div>
                                {isAI && p.reason ? (
                                  <div className="whitespace-pre-wrap pl-4 text-[11px] text-slate-500">
                                    {p.reason}
                                  </div>
                                ) : null}
                              </li>
                            );
                          })}
                        </ol>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

export default HistoryPage;
