/**
 * 残局挑战 store（建议清单 #3）。
 *
 * 职责：
 *  - 记录当前激活的关卡 id（会话态，驱动 GameTablePage 进入残局模式）；
 *  - 持久化每关进度（是否通关 / 最少手数），键 `dz.puzzle.progress`。
 *
 * 依赖方向：不 import gameStore / roomStore（gameStore 反向调用 recordResult，
 * 与 historyStore 的落库方向一致，避免循环依赖）。
 */

import { create } from 'zustand';
import type { PuzzleProgress } from '@/types/puzzle';
import { readJson, writeJson, STORAGE_KEYS, ensureDataVersion } from './persist';

/** 进度持久化结构：levelId → 进度 */
type ProgressMap = Record<string, PuzzleProgress>;

/** 从 localStorage 载入进度；结构异常时回落空表（不抛错、不白屏）。 */
function loadProgress(): ProgressMap {
  const parsed = readJson<unknown>(STORAGE_KEYS.PUZZLE_PROGRESS, {});
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {};
  }
  const valid: ProgressMap = {};
  for (const [levelId, value] of Object.entries(parsed)) {
    if (
      typeof levelId === 'string' &&
      levelId.length > 0 &&
      value !== null &&
      typeof value === 'object' &&
      typeof (value as PuzzleProgress).cleared === 'boolean'
    ) {
      const progress = value as PuzzleProgress;
      // 验证 bestMoves 为非负整数或 null
      const bestMovesValid =
        progress.bestMoves === null ||
        (typeof progress.bestMoves === 'number' &&
         Number.isInteger(progress.bestMoves) &&
         progress.bestMoves >= 0);
      // 验证 clearedAt 为有效时间戳或 null
      const clearedAtValid =
        progress.clearedAt === null ||
        (typeof progress.clearedAt === 'number' &&
         Number.isFinite(progress.clearedAt) &&
         progress.clearedAt > 0);
      if (bestMovesValid && clearedAtValid) {
        valid[levelId] = progress;
      }
    }
  }
  return valid;
}

function persistProgress(progress: ProgressMap): void {
  ensureDataVersion();
  writeJson(STORAGE_KEYS.PUZZLE_PROGRESS, progress);
}

/** 残局 store 的 state 与 actions */
export interface PuzzleStoreState {
  /** 当前激活的关卡 id；null 表示不在残局模式 */
  activeLevelId: string | null;
  /** 各关进度 */
  progress: ProgressMap;

  /** 进入残局模式（激活关卡；开始对局由 gameStore.startPuzzle 完成） */
  activate: (levelId: string) => void;
  /** 退出残局模式 */
  clearActive: () => void;
  /** 记录一局结果：cleared=挑战方获胜；moves=挑战方有效出牌手数 */
  recordResult: (levelId: string, cleared: boolean, moves: number) => void;
  /** 清空全部进度（调试用） */
  clearProgress: () => void;
}

export const usePuzzleStore = create<PuzzleStoreState>((set, get) => ({
  activeLevelId: null,
  progress: loadProgress(),

  activate: (levelId: string): void => {
    set({ activeLevelId: levelId });
  },

  clearActive: (): void => {
    set({ activeLevelId: null });
  },

  recordResult: (levelId: string, cleared: boolean, moves: number): void => {
    const prev: PuzzleProgress | undefined = get().progress[levelId];
    const prevBest: number | null = prev?.bestMoves ?? null;
    // 仅通关时更新手数，且保留历史最少值
    const bestMoves: number | null = cleared
      ? prevBest === null
        ? moves
        : Math.min(prevBest, moves)
      : prevBest;
    const next: ProgressMap = {
      ...get().progress,
      [levelId]: {
        cleared: (prev?.cleared ?? false) || cleared,
        bestMoves,
        clearedAt: cleared ? Date.now() : (prev?.clearedAt ?? null),
      },
    };
    set({ progress: next });
    persistProgress(next);
  },

  clearProgress: (): void => {
    set({ progress: {} });
    persistProgress({});
  },
}));

export default usePuzzleStore;
