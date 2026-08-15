/**
 * 对局结算。
 *
 * 计分规则：
 *   - 底分 = 叫地主阶段的最高叫分（1 / 2 / 3）
 *   - 倍数初始为 1，每个炸弹 ×2、每个王炸 ×2、春天 ×2、反春天 ×2，可叠加
 *   - 春天：  地主出完所有牌获胜，且两个农民「一张牌都没出过」
 *   - 反春天：农民获胜，且地主「出牌次数恰好为 1」（只出了第一手就再没出过）
 *   - 基础分 = 底分 × 倍数
 *   - 地主胜：地主 +基础分×2，两农民各 −基础分
 *   - 地主负：地主 −基础分×2，两农民各 +基础分
 *
 * 纯函数模块，无任何副作用。
 */

import { CardType } from '../types/card';
import type { HandPattern } from '../types/card';
import type { MultiplierDetailItem, SeatIndex, SettlementResult } from '../types/game';
import { PLAYER_COUNT } from './constants';

/**
 * 结算所需的最小出牌记录形状。
 * src/types/game.ts 中的 PlayRecord 在结构上兼容此接口，可直接传入。
 */
export interface SettlementPlay {
  /** 出牌座位 */
  seat: number;
  /** 牌型；过牌时为 null */
  pattern: HandPattern | null;
  /** 是否为「过」 */
  isPass: boolean;
}

/** 结算输入参数。 */
export interface SettlementInput {
  /** 地主座位 */
  landlordSeat: SeatIndex;
  /** 地主是否获胜 */
  landlordWin: boolean;
  /** 底分（最高叫分） */
  baseScore: number;
  /** 全部出牌历史（含过牌记录） */
  playHistory: SettlementPlay[];
  /** 额外倍数（如「加倍/超级加倍」玩法），默认 1 */
  extraMultiplier?: number;
}

/** 统计有效出牌（非过牌）的次数。 */
export function countEffectivePlays(playHistory: SettlementPlay[], seat: number): number {
  let count = 0;
  for (const record of playHistory) {
    if (record.seat === seat && !record.isPass && record.pattern !== null) {
      count += 1;
    }
  }
  return count;
}

/** 统计整局出现的炸弹数量（含 BOMB）。 */
export function countBombs(playHistory: SettlementPlay[]): number {
  let count = 0;
  for (const record of playHistory) {
    if (!record.isPass && record.pattern !== null && record.pattern.type === CardType.BOMB) {
      count += 1;
    }
  }
  return count;
}

/** 统计整局出现的王炸数量（ROCKET）。 */
export function countRockets(playHistory: SettlementPlay[]): number {
  let count = 0;
  for (const record of playHistory) {
    if (!record.isPass && record.pattern !== null && record.pattern.type === CardType.ROCKET) {
      count += 1;
    }
  }
  return count;
}

/**
 * 判断是否为春天：地主获胜，且两个农民一张牌都没出过。
 */
export function isSpring(
  playHistory: SettlementPlay[],
  landlordSeat: number,
  landlordWin: boolean,
): boolean {
  if (!landlordWin) {
    return false;
  }
  for (let seat = 0; seat < PLAYER_COUNT; seat += 1) {
    if (seat === landlordSeat) {
      continue;
    }
    if (countEffectivePlays(playHistory, seat) > 0) {
      return false;
    }
  }
  return true;
}

/**
 * 判断是否为反春天：农民获胜，且地主出牌次数恰好为 1。
 */
export function isAntiSpring(
  playHistory: SettlementPlay[],
  landlordSeat: number,
  landlordWin: boolean,
): boolean {
  if (landlordWin) {
    return false;
  }
  return countEffectivePlays(playHistory, landlordSeat) === 1;
}

/**
 * 计算最终倍数及其明细。
 */
export function calculateMultiplier(
  playHistory: SettlementPlay[],
  landlordSeat: number,
  landlordWin: boolean,
  extraMultiplier: number = 1,
): { multiplier: number; detail: MultiplierDetailItem[]; spring: boolean; antiSpring: boolean } {
  const detail: MultiplierDetailItem[] = [{ reason: '基础倍数', factor: 1 }];
  let multiplier = 1;

  const bombCount: number = countBombs(playHistory);
  for (let i = 0; i < bombCount; i += 1) {
    multiplier *= 2;
    detail.push({ reason: '炸弹', factor: 2 });
  }

  const rocketCount: number = countRockets(playHistory);
  for (let i = 0; i < rocketCount; i += 1) {
    multiplier *= 2;
    detail.push({ reason: '王炸', factor: 2 });
  }

  const spring: boolean = isSpring(playHistory, landlordSeat, landlordWin);
  if (spring) {
    multiplier *= 2;
    detail.push({ reason: '春天', factor: 2 });
  }

  const antiSpring: boolean = isAntiSpring(playHistory, landlordSeat, landlordWin);
  if (antiSpring) {
    multiplier *= 2;
    detail.push({ reason: '反春天', factor: 2 });
  }

  const safeExtra: number =
    Number.isFinite(extraMultiplier) && extraMultiplier > 0 ? extraMultiplier : 1;
  if (safeExtra !== 1) {
    multiplier *= safeExtra;
    detail.push({ reason: '额外加倍', factor: safeExtra });
  }

  return { multiplier, detail, spring, antiSpring };
}

/**
 * 计算完整结算结果。
 *
 * @param input 结算输入
 * @returns 与 gameStore 直接对接的 SettlementResult
 */
export function calculateSettlement(input: SettlementInput): SettlementResult {
  const {
    landlordSeat,
    landlordWin,
    baseScore,
    playHistory,
    extraMultiplier = 1,
  } = input;

  const safeBase: number = Number.isFinite(baseScore) && baseScore > 0 ? baseScore : 1;
  const { multiplier, detail, spring, antiSpring } = calculateMultiplier(
    playHistory,
    landlordSeat,
    landlordWin,
    extraMultiplier,
  );

  const unitScore: number = safeBase * multiplier;
  const seatScores: [number, number, number] = [0, 0, 0];

  for (let seat = 0; seat < PLAYER_COUNT; seat += 1) {
    if (seat === landlordSeat) {
      seatScores[seat] = landlordWin ? unitScore * 2 : -unitScore * 2;
    } else {
      seatScores[seat] = landlordWin ? -unitScore : unitScore;
    }
  }

  return {
    landlordWin,
    baseScore: safeBase,
    multiplier,
    unitScore,
    seatScores,
    isSpring: spring,
    isAntiSpring: antiSpring,
    multiplierDetail: detail,
  };
}

/**
 * 判断对局是否结束：任一玩家手牌为空。
 *
 * @param hands 三家手牌数量（number[]，座位 i 剩余张数）
 * @returns 出完牌的座位号；无人出完返回 null（L2：原实现返回 hands.length 与 SeatIndex 混淆，且参数误用 Card[][]）
 */
export function findWinnerSeat(hands: number[]): number | null {
  let seat = 0;
  while (seat < hands.length && seat < PLAYER_COUNT && hands[seat] > 0) {
    seat += 1;
  }
  // Defensive: ensure we check all expected seats even if hands.length is corrupted
  const maxSeats = Math.min(hands.length, PLAYER_COUNT);
  if (seat < maxSeats && hands[seat] === 0) {
    return seat;
  }
  return null;
}

/**
 * 根据获胜座位判定地主是否获胜。
 */
export function isLandlordWin(winnerSeat: number, landlordSeat: number): boolean {
  return winnerSeat === landlordSeat;
}
