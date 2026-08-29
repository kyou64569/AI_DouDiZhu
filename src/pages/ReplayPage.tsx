/**
 * 对局动画回放页（建议清单 #13）。
 *
 * 从战绩页进入，按时间线逐帧还原当时的出牌场景：
 *  - 每帧展示：行动座位、出牌牌面（或过牌）、各家剩余张数；
 *  - 支持 播放/暂停、单步前进/后退、跳到首尾、拖动进度条、点击胶片帧跳转、变速；
 *  - 暗牌不可知（历史记录不存初始手牌），座位显示「剩 N 张」牌背堆叠而非具体牌面。
 */

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Button } from '@/components/common/Button';
import { CardGroup } from '@/components/card/CardGroup';
import { getCardTypeName } from '@/engine/cardType';
import { formatDateTime, formatMultiplier } from '@/utils/format';
import { buildReplayFrames, type ReplayFrame } from '@/utils/replay';
import { useHistoryStore } from '@/store/historyStore';
import { ROOM_MODE_LABEL } from '@/store/roomStore';
import { ROUTES } from '@/routes';
import type { GameRecord, SeatSummary } from '@/types/history';
import type { SeatIndex } from '@/types/game';
import { cn } from '@/utils/cn';

/** 播放速度档位（帧间隔毫秒） */
const SPEEDS: readonly { label: string; intervalMs: number }[] = [
  { label: '慢速', intervalMs: 1600 },
  { label: '常速', intervalMs: 850 },
  { label: '快速', intervalMs: 400 },
] as const;

/** 座位展示色（与牌桌 opponent 布局一致：左 / 中 / 右不区分，仅区分身份色） */
function seatRoleLabel(seat: SeatSummary): string {
  return seat.isLandlord ? '地主' : '农民';
}

function seatAvatar(seat: SeatSummary): string {
  return seat.avatar && seat.avatar.length > 0 ? seat.avatar : seat.kind === 'HUMAN' ? '🧑' : '🤖';
}

/** 牌背堆叠（剩 N 张的视觉表达） */
function CardBackStack({ count }: { count: number }): JSX.Element {
  const shown: number = Math.min(count, 20);
  return (
    <span className="flex items-end" aria-hidden="true">
      {Array.from({ length: shown }, (_, i: number) => (
        <span
          key={i}
          className={cn('card-back h-6 w-4 rounded-[3px] border border-white/25', i > 0 && '-ml-2.5')}
          style={{ zIndex: i }}
        />
      ))}
      {shown === 0 ? <span className="text-xs text-white/35">已出完</span> : null}
    </span>
  );
}

/**
 * 对局回放页。
 */
export function ReplayPage(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  const record: GameRecord | null = useHistoryStore((state) =>
    state.records.find((r: GameRecord): boolean => r.id === id) ?? null,
  );

  const frames: ReplayFrame[] = useMemo((): ReplayFrame[] => (record ? buildReplayFrames(record) : []), [record]);

  const [frameIndex, setFrameIndex] = useState<number>(0);
  const [playing, setPlaying] = useState<boolean>(false);
  const [speedIdx, setSpeedIdx] = useState<number>(1);

  const safeIndex: number = Math.min(frameIndex, Math.max(0, frames.length - 1));
  const frame: ReplayFrame | null = frames.length > 0 ? frames[safeIndex] : null;
  const isLastFrame: boolean = frames.length > 0 && safeIndex === frames.length - 1;

  // 记录切换（URL 变了）时复位进度
  useEffect(() => {
    setFrameIndex(0);
    setPlaying(false);
  }, [id]);

  // 自动播放：到最后一帧自动暂停
  useEffect(() => {
    if (!playing) return undefined;
    if (frames.length === 0 || safeIndex >= frames.length - 1) {
      setPlaying(false);
      return undefined;
    }
    const timer = setTimeout((): void => {
      setFrameIndex((i: number): number => Math.min(i + 1, frames.length - 1));
    }, SPEEDS[speedIdx].intervalMs);
    return (): void => clearTimeout(timer);
  }, [playing, safeIndex, frames.length, speedIdx]);

  if (record === null) {
    return (
      <div className="flex flex-col items-center gap-3 py-16 text-center">
        <p className="text-4xl" aria-hidden="true">🎬</p>
        <p className="text-sm text-slate-300">没有找到这条对局记录，可能已被删除。</p>
        <Link to={ROUTES.HISTORY}>
          <Button variant="secondary">返回战绩</Button>
        </Link>
      </div>
    );
  }

  const winnerSeat: SeatSummary | undefined = record.seats.find((s) => s.seat === record.winnerSeat);

  /** 单座位面板 */
  const renderSeat = (seat: SeatIndex): JSX.Element => {
    const meta: SeatSummary | undefined = record.seats.find((s) => s.seat === seat);
    if (meta === undefined) {
      return <div key={seat} />;
    }
    const isActing: boolean = frame !== null && frame.seat === seat && !isLastFrame;
    const count: number = frame !== null ? frame.handCounts[seat] : 0;
    return (
      <div
        key={seat}
        className={cn(
          'relative flex flex-col gap-2 rounded-2xl p-3 transition-all duration-200',
          isActing && 'animate-pulse-ring rounded-2xl border border-emerald-400/60',
        )}
      >
        <span className="pointer-events-none absolute inset-0 rounded-2xl border border-white/12 bg-black/25 backdrop-blur-md shadow-innerTop" aria-hidden="true" />
        <div className="relative flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span
              className={cn(
                'flex h-9 w-9 flex-none items-center justify-center rounded-full text-lg leading-none',
                isActing ? 'bg-emerald-400/25 ring-2 ring-emerald-400/70' : 'bg-white/10 ring-1 ring-white/20',
              )}
            >
              {seatAvatar(meta)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{meta.name}</p>
              <p className="text-[11px] text-white/50">
                {seatRoleLabel(meta)}
                {meta.model !== null ? ` · ${meta.model}` : ''}
              </p>
            </div>
          </div>
          <span className="flex-none text-xs tabular-nums text-white/70">
            剩 <span className="font-semibold text-white/90">{count}</span> 张
          </span>
        </div>
        <div className="relative flex min-h-[30px] items-center">
          <CardBackStack count={count} />
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 页头 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="app-icon-badge" aria-hidden="true">🎬</span>
          <div>
            <h1 className="app-page-title">对局回放</h1>
            <p className="app-page-desc">
              {formatDateTime(record.finishedAt)} · {ROOM_MODE_LABEL[record.mode]} · 底分 {record.baseScore} · 倍数{' '}
              {formatMultiplier(record.multiplier)}
            </p>
          </div>
        </div>
        <Link to={ROUTES.HISTORY}>
          <Button variant="secondary" size="sm">返回战绩</Button>
        </Link>
      </div>

      {/* 叫分记录（静态摘要） */}
      {record.bidHistory.length > 0 ? (
        <div className="app-card flex flex-wrap items-center gap-2 px-4 py-3 text-xs text-slate-300">
          <span className="font-medium text-slate-500">叫分</span>
          {record.bidHistory.map((b, i) => (
            <span key={i} className="rounded-lg bg-white/5 px-2 py-1">
              {record.seats.find((s) => s.seat === b.seat)?.name ?? `座位${b.seat + 1}`}
              {' '}
              {b.score === 0 ? '不叫' : `叫 ${b.score} 分`}
            </span>
          ))}
        </div>
      ) : null}

      {/* 三家面板 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {([0, 1, 2] as SeatIndex[]).map((seat: SeatIndex) => renderSeat(seat))}
      </div>

      {/* 中央舞台：当前帧动作 */}
      <div className="relative flex min-h-[220px] flex-col items-center justify-center gap-3 overflow-hidden rounded-[2.5rem] border border-white/12 bg-black/20 px-5 py-8 shadow-panel backdrop-blur-sm">
        <span
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_62%_72%_at_50%_46%,rgba(255,255,255,0.055),transparent_72%)]"
          aria-hidden="true"
        />
        {frame === null ? (
          <p className="relative text-sm text-white/55">本局没有出牌记录，无法回放。</p>
        ) : (
          <>
            <span className="relative text-[11px] font-medium tracking-[0.3em] text-white/45">
              第 {safeIndex + 1} / {frames.length} 手 · {frame.isFreeTurn ? '自由出牌' : '压制回合'}
            </span>
            {frame.record.isPass || frame.record.pattern === null ? (
              <div className="relative flex flex-col items-center gap-2">
                <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 text-2xl ring-1 ring-white/10" aria-hidden="true">
                  🙅
                </span>
                <span className="text-sm text-white/70">
                  {record.seats.find((s) => s.seat === frame.seat)?.name ?? `座位${frame.seat + 1}`} 选择过牌
                </span>
              </div>
            ) : (
              <div className="relative flex flex-col items-center gap-2">
                <CardGroup cards={frame.record.cards} size="md" animate />
                <span className="rounded-full bg-gold-500/15 px-3 py-1 text-xs font-semibold text-gold-300">
                  {getCardTypeName(frame.record.pattern.type)}（{frame.record.cards.length} 张）
                </span>
              </div>
            )}
            {frame.record.reason ? (
              <p className="relative max-w-xl text-center text-xs leading-relaxed text-slate-400">
                💭 {frame.record.reason}
              </p>
            ) : null}
          </>
        )}
      </div>

      {/* 终局横幅（最后一帧） */}
      {isLastFrame && winnerSeat !== undefined ? (
        <div
          className={cn(
            'flex items-center justify-center gap-2 rounded-2xl border px-4 py-3 text-sm font-bold',
            record.landlordWin
              ? 'border-gold-400/40 bg-gold-500/10 text-gold-300'
              : 'border-emerald-400/40 bg-emerald-500/10 text-emerald-300',
          )}
          role="status"
        >
          🏆 {winnerSeat.name} 获胜（{record.landlordWin ? '地主' : '农民'}阵营获胜）
        </div>
      ) : null}

      {/* 控制条 */}
      <div className="app-card flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => { setPlaying(false); setFrameIndex(0); }} disabled={frames.length === 0} aria-label="回到开头">
            ⏮
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { setPlaying(false); setFrameIndex((i: number): number => Math.max(0, Math.min(i, frames.length - 1) - 1)); }}
            disabled={frames.length === 0 || safeIndex === 0}
            aria-label="上一手"
          >
            ◀ 上一手
          </Button>
          <Button
            variant="gold"
            onClick={() => setPlaying((p: boolean): boolean => !p)}
            disabled={frames.length === 0 || (isLastFrame && !playing)}
            aria-label={playing ? '暂停' : '播放'}
          >
            {playing ? '⏸ 暂停' : '▶ 播放'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => { setPlaying(false); setFrameIndex((i: number): number => Math.min(frames.length - 1, i + 1)); }}
            disabled={frames.length === 0 || isLastFrame}
            aria-label="下一手"
          >
            下一手 ▶
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setPlaying(false); setFrameIndex(Math.max(0, frames.length - 1)); }} disabled={frames.length === 0} aria-label="跳到结尾">
            ⏭
          </Button>
          <div className="ml-2 flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
            {SPEEDS.map((s, i: number) => (
              <button
                key={s.label}
                type="button"
                onClick={() => setSpeedIdx(i)}
                className={cn(
                  'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
                  i === speedIdx ? 'bg-gold-500/20 text-gold-300' : 'text-slate-400 hover:text-slate-200',
                )}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* 进度条 */}
        {frames.length > 0 ? (
          <input
            type="range"
            min={0}
            max={frames.length - 1}
            step={1}
            value={safeIndex}
            onChange={(e) => {
              setPlaying(false);
              setFrameIndex(Number(e.target.value));
            }}
            className="w-full accent-amber-400"
            aria-label="回放进度"
          />
        ) : null}

        {/* 胶片帧时间线：点击任意一手直接跳转 */}
        {frames.length > 0 ? (
          <div className="scrollbar-thin flex gap-1.5 overflow-x-auto pb-1">
            {frames.map((f, i: number) => {
              const passed: boolean = f.record.isPass || f.record.pattern === null;
              const isCurrent: boolean = i === safeIndex;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => { setPlaying(false); setFrameIndex(i); }}
                  title={`${record.seats.find((s) => s.seat === f.seat)?.name ?? ''} ${passed ? '过牌' : `出 ${f.record.cards.length} 张`}`}
                  className={cn(
                    'h-7 min-w-[1.75rem] flex-none rounded-lg border px-1.5 text-[11px] font-semibold tabular-nums transition-colors',
                    isCurrent
                      ? 'border-gold-400 bg-gold-500/25 text-gold-200'
                      : passed
                        ? 'border-white/10 bg-white/5 text-white/40 hover:bg-white/10'
                        : 'border-white/20 bg-white/10 text-white/75 hover:bg-white/20',
                  )}
                >
                  {i + 1}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default ReplayPage;
