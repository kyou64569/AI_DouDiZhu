/**
 * 连胜赛（多局累计积分赛制）store（建议清单 #4）。
 *
 * 语义：
 *  - start(targetRounds) 开启一个 N 局赛制；每局结束由 gameStore.finalizeSettlement
 *    调用 recordRound 累加各家得分；打满 targetRounds 后 finished=true；
 *  - 结算弹窗读取本 store 展示「第 X/Y 局」与总冠军；
 *  - 「再来一局」在 finished 后由牌桌页先 start(targetRounds) 清零再开新局；
 *  - 会话态（不持久化）：roomStore 的房间本身不跨刷新持久，刷新后必须经
 *    RoomPage 重建房间并重新选择赛制——RoomPage 每次开始都会显式 start 或 reset，
 *    已加载的任何持久化进度都会被覆盖，持久化在这里是无法被消费的死路径，
 *    因此刻意保持会话态。若未来房间改为跨刷新持久，可再一并补赛制持久化。
 *
 * 依赖方向：不 import gameStore / roomStore（与 historyStore 同向，防循环依赖）。
 */

import { create } from 'zustand';
import type { SeatIndex } from '@/types/game';

/** 单轮结果（供后续扩展展示每轮明细） */
export interface TournamentRoundResult {
  /** 第几轮（1 基） */
  round: number;
  /** 本轮获胜座位 */
  winnerSeat: SeatIndex;
  /** 本轮各家得分增量 */
  seatDeltas: [number, number, number];
}

/** 总冠军信息 */
export interface TournamentChampion {
  /** 冠军座位（并列时取先达到该分数的座位序号最小者） */
  seat: SeatIndex;
  /** 冠军累计得分 */
  score: number;
  /** 是否并列（多个座位同分且为最高） */
  tie: boolean;
}

/**
 * 由累计得分推算总冠军。
 * 三家全为 0 分（如底分为 0 的异常局）时返回 null，避免产生无意义冠军。
 */
export function computeChampion(seatScores: [number, number, number]): TournamentChampion | null {
  const max: number = Math.max(...seatScores);
  if (max <= 0) {
    return null;
  }
  const seat: SeatIndex = seatScores.indexOf(max) as SeatIndex;
  const tie: boolean = seatScores.filter((s: number): boolean => s === max).length > 1;
  return { seat, score: max, tie };
}

/** 连胜赛 store 的 state 与 actions */
export interface TournamentStoreState {
  /** 赛制是否进行中 */
  active: boolean;
  /** 目标局数（3 / 5 / 7） */
  targetRounds: number;
  /** 已完成局数 */
  completedRounds: number;
  /** 各座累计得分，索引即座位 */
  seatScores: [number, number, number];
  /** 每轮结果 */
  roundResults: TournamentRoundResult[];
  /** 是否已打满 */
  finished: boolean;

  /** 开始一个 N 局赛制（清零既有进度） */
  start: (targetRounds: number) => void;
  /** 结算一局：累加得分并推进轮次；未激活或已打满时为 no-op */
  recordRound: (input: { winnerSeat: SeatIndex; seatScores: [number, number, number] }) => void;
  /** 结束并清空赛制 */
  reset: () => void;
}

export const useTournamentStore = create<TournamentStoreState>((set, get) => ({
  active: false,
  targetRounds: 0,
  completedRounds: 0,
  seatScores: [0, 0, 0],
  roundResults: [],
  finished: false,

  start: (targetRounds: number): void => {
    const rounds: number = Number.isInteger(targetRounds) && targetRounds > 0 ? targetRounds : 0;
    set({
      active: rounds > 0,
      targetRounds: rounds,
      completedRounds: 0,
      seatScores: [0, 0, 0],
      roundResults: [],
      finished: false,
    });
  },

  recordRound: (input: { winnerSeat: SeatIndex; seatScores: [number, number, number] }): void => {
    const st = get();
    if (!st.active || st.finished) {
      return;
    }
    const deltas: [number, number, number] = [...input.seatScores] as [number, number, number];
    const seatScores: [number, number, number] = [
      st.seatScores[0] + deltas[0],
      st.seatScores[1] + deltas[1],
      st.seatScores[2] + deltas[2],
    ];
    const completedRounds: number = st.completedRounds + 1;
    set({
      completedRounds,
      seatScores,
      roundResults: [
        ...st.roundResults,
        { round: completedRounds, winnerSeat: input.winnerSeat, seatDeltas: deltas },
      ],
      finished: completedRounds >= st.targetRounds,
    });
  },

  reset: (): void => {
    set({
      active: false,
      targetRounds: 0,
      completedRounds: 0,
      seatScores: [0, 0, 0],
      roundResults: [],
      finished: false,
    });
  },
}));

export default useTournamentStore;
