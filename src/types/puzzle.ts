/**
 * 残局挑战类型（建议清单 #3）。
 *
 * 残局 = 一副「预设三家手牌 + 指定地主/先手」的静态牌面，玩家扮演挑战方座位，
 * 目标是战胜两名内置 AI 陪练（本地兜底策略，不消耗模型调用）。
 */

import type { SeatIndex } from './game';

/** 残局关卡定义。hands 为牌面文本（空格分隔，如 "2 小王 大王"），加载时解析为 Card。 */
export interface PuzzleLevel {
  /** 关卡唯一 id */
  id: string;
  /** 关卡名称 */
  name: string;
  /** 难度星级 1~3 */
  stars: 1 | 2 | 3;
  /** 玩家扮演（挑战方）的座位 */
  playSeat: SeatIndex;
  /** 地主座位 */
  landlordSeat: SeatIndex;
  /** 先手座位（残局通常由挑战方先出） */
  firstSeat: SeatIndex;
  /** 三家手牌（牌面文本），索引即座位 */
  hands: [string, string, string];
  /** 参考最佳手数（挑战方有效出牌次数口径） */
  parMoves: number;
  /** 通关目标一句话描述 */
  goal: string;
  /** 通关后展示的思路提示 */
  tip: string;
}

/** 单关进度（localStorage 持久化） */
export interface PuzzleProgress {
  /** 是否已通关（挑战方获胜） */
  cleared: boolean;
  /** 通关时的最少出牌手数（挑战方口径），未通关为 null */
  bestMoves: number | null;
  /** 最近一次通关时间戳 */
  clearedAt: number | null;
}
