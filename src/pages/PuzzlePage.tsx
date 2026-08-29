/**
 * 残局挑战页（建议清单 #3）。
 *
 * 能力：
 * - 展示内置残局关卡（难度星级 / 通关目标 / 通关进度与最佳手数）；
 * - 选择关卡后调用 gameStore.startPuzzle 进入牌桌（对手为内置本地策略 AI，
 *   不消耗模型调用；对局结果不写入战绩页，只更新本页进度）。
 */

import { useNavigate } from 'react-router-dom';
import Button from '@/components/common/Button';
import { toast } from '@/components/common/Toast';
import { ROUTES } from '@/routes';
import { PUZZLE_LEVELS } from '@/puzzle/levels';
import { useGameStore } from '@/store/gameStore';
import { usePuzzleStore } from '@/store/puzzleStore';
import { useSoundStore } from '@/store/soundStore';
import type { PuzzleLevel } from '@/types/puzzle';
import { cn } from '@/utils/cn';

/** 星级展示（金色实心 + 灰色空心） */
function Stars({ count }: { count: number }): JSX.Element {
  return (
    <span className="flex items-center gap-0.5" aria-label={`${count} 星难度`}>
      {[1, 2, 3].map((i: number): JSX.Element => (
        <span key={i} className={cn('text-sm leading-none', i <= count ? 'text-gold-400' : 'text-white/15')}>
          ★
        </span>
      ))}
    </span>
  );
}

/**
 * 残局挑战页。
 */
export function PuzzlePage(): JSX.Element {
  const navigate = useNavigate();
  const progress = usePuzzleStore((state) => state.progress);
  const activate = usePuzzleStore((state) => state.activate);
  const clearedCount: number = PUZZLE_LEVELS.filter((l: PuzzleLevel): boolean => progress[l.id]?.cleared === true).length;

  /** 开始挑战某关 */
  const startLevel = (level: PuzzleLevel): void => {
    useSoundStore.getState().unlock();
    const ok: boolean = useGameStore.getState().startPuzzle(level);
    if (!ok) {
      return;
    }
    activate(level.id);
    toast.success(`残局「${level.name}」已加载，祝你旗开得胜`);
    navigate(ROUTES.TABLE);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 页头 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="app-icon-badge" aria-hidden="true">
            🧩
          </span>
          <div>
            <h1 className="app-page-title">残局挑战</h1>
            <p className="app-page-desc">
              预设牌面 · 指定身份 · 战胜内置 AI 陪练 —— 已通关 {clearedCount} / {PUZZLE_LEVELS.length} 关
            </p>
          </div>
        </div>
      </div>

      {/* 玩法说明 */}
      <div className="app-card flex flex-col gap-1.5 p-4">
        <p className="text-sm text-slate-200">选择一个残局进入牌桌：三家手牌固定，你扮演挑战方座位，直接进入出牌阶段。</p>
        <p className="text-xs text-slate-400">
          两名陪练使用本地内置策略（自由回合出最小牌、跟牌出最小可压牌），<span className="text-slate-300">不消耗模型调用</span>；
          对局结果不写入战绩页，只记录本页的通关进度与最佳手数。
        </p>
      </div>

      {/* 关卡列表 */}
      <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {PUZZLE_LEVELS.map((level: PuzzleLevel) => {
          const prog = progress[level.id];
          const cleared: boolean = prog?.cleared === true;
          const best: number | null = prog?.bestMoves ?? null;
          return (
            <li key={level.id} className="app-card flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="truncate text-sm font-semibold text-slate-100">{level.name}</h2>
                    {cleared ? (
                      <span className="flex-none rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300 ring-1 ring-emerald-400/30">
                        ✓ 已通关
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    你执 {level.playSeat === level.landlordSeat ? '地主' : '农民'} · 参考最佳 {level.parMoves} 手
                    {best !== null ? ` · 你的纪录 ${best} 手` : ''}
                  </p>
                </div>
                <Stars count={level.stars} />
              </div>

              <p className="text-xs leading-relaxed text-slate-300">{level.goal}</p>

              {cleared ? (
                <p className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-1.5 text-[11px] leading-relaxed text-slate-400">
                  💡 思路：{level.tip}
                </p>
              ) : null}

              <div className="mt-auto flex justify-end">
                <Button size="sm" variant={cleared ? 'secondary' : 'gold'} onClick={() => startLevel(level)}>
                  {cleared ? '重新挑战' : '开始挑战'}
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default PuzzlePage;
