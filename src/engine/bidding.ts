/**
 * 叫地主（叫分制）阶段的规则。
 *
 * 规则：
 *   - 叫分选项为 0（不叫）、1、2、3 分
 *   - 只能叫比当前最高分更高的分数，或选择不叫
 *   - 有人叫到 3 分立即定地主
 *   - 一轮结束后由最高叫分者当地主，底分 = 最高叫分
 *   - 三人全部不叫 → 流局重新发牌（needRedeal: true）
 *
 * 类型复用 src/types/game.ts 中的 BidRecord / BidScore / SeatIndex，
 * 保证与 gameStore 的数据形状完全一致。
 *
 * 纯函数模块，无任何副作用。
 */

import type { BidRecord, BidScore, SeatIndex } from '../types/game';
import { BID_OPTIONS, MAX_BID, PLAYER_COUNT } from './constants';

/** 叫分阶段结算结果。 */
export interface BiddingResult {
  /** 地主座位号；流局时为 null */
  landlordSeat: SeatIndex | null;
  /** 底分（= 最高叫分）；流局时为 0 */
  baseScore: number;
  /** 是否需要重新发牌（三人均不叫） */
  needRedeal: boolean;
  /** 完整叫分记录 */
  records: BidRecord[];
}

/** 把任意数字安全收敛为 SeatIndex。 */
export function toSeatIndex(value: number): SeatIndex {
  const normalized: number = ((Math.trunc(value) % PLAYER_COUNT) + PLAYER_COUNT) % PLAYER_COUNT;
  return normalized as SeatIndex;
}

/** 把任意数字安全收敛为 BidScore（非法值一律降级为 0 = 不叫）。 */
export function toBidScore(value: number): BidScore {
  if (value === 1 || value === 2 || value === 3) {
    return value;
  }
  return 0;
}

/**
 * 获取当前可选的叫分列表。
 *
 * @param currentHighest 当前最高叫分（无人叫过时传 0）
 * @returns 合法叫分数组，总是包含 0（不叫）
 */
export function getLegalBids(currentHighest: number): BidScore[] {
  const highest: number = Number.isFinite(currentHighest) ? Math.max(0, currentHighest) : 0;
  return BID_OPTIONS.filter((bid) => bid === 0 || bid > highest).map((bid) => toBidScore(bid));
}

/**
 * 判断某个叫分是否合法。
 *
 * @param bid            想要叫的分
 * @param currentHighest 当前最高叫分
 */
export function isLegalBid(bid: number, currentHighest: number): boolean {
  return getLegalBids(currentHighest).some((legal) => legal === bid);
}

/**
 * 取当前最高叫分。无人叫分时返回 0。
 */
export function getHighestBid(records: BidRecord[]): number {
  let highest = 0;
  for (const record of records) {
    if (record.score > highest) {
      highest = record.score;
    }
  }
  return highest;
}

/**
 * 判断叫分阶段是否已经结束。
 *
 * 结束条件：
 *   - 有人叫到 3 分（最高分，无需再问）
 *   - 或所有人都已表态过一轮
 *
 * @param records    已产生的叫分记录
 * @param totalSeats 参与叫分的人数，默认 3
 */
export function isBiddingFinished(
  records: BidRecord[],
  totalSeats: number = PLAYER_COUNT,
): boolean {
  if (records.some((record) => record.score >= MAX_BID)) {
    return true;
  }
  return records.length >= totalSeats;
}

/**
 * 计算下一个该叫分的座位号。叫分已结束时返回 null。
 *
 * @param records   已产生的叫分记录
 * @param firstSeat 第一个叫分的座位号
 */
export function getNextBidder(records: BidRecord[], firstSeat: SeatIndex): SeatIndex | null {
  if (isBiddingFinished(records)) {
    return null;
  }
  return toSeatIndex(firstSeat + records.length);
}

/**
 * 结算叫分阶段，决出地主。
 *
 * @param records 全部叫分记录（按发生顺序）
 * @returns 地主座位、底分与是否需要重新发牌
 */
export function resolveBidding(records: BidRecord[]): BiddingResult {
  let landlordSeat: SeatIndex | null = null;
  let baseScore = 0;

  for (const record of records) {
    // 严格大于：先叫同分者优先，符合「只能叫更高分」的规则
    if (record.score > baseScore) {
      baseScore = record.score;
      landlordSeat = record.seat;
    }
  }

  if (landlordSeat === null || baseScore === 0) {
    return { landlordSeat: null, baseScore: 0, needRedeal: true, records: records.slice() };
  }

  return { landlordSeat, baseScore, needRedeal: false, records: records.slice() };
}

/**
 * 一次性跑完整个叫分流程（供 AI 自动叫分或确定性测试使用）。
 *
 * @param bids      每位玩家依次给出的叫分意向，按叫分顺序排列
 * @param firstSeat 首个叫分的座位号
 * @returns 叫分结算结果；非法叫分会被自动降级为 0（不叫）
 */
export function runBidding(bids: number[], firstSeat: SeatIndex = 0): BiddingResult {
  const records: BidRecord[] = [];
  let highest = 0;

  for (let i = 0; i < bids.length; i += 1) {
    if (isBiddingFinished(records)) {
      break;
    }
    const seat: SeatIndex = toSeatIndex(firstSeat + i);
    const wanted: number = bids[i];
    const actual: BidScore = isLegalBid(wanted, highest) ? toBidScore(wanted) : 0;
    records.push({ seat, score: actual });
    if (actual > highest) {
      highest = actual;
    }
  }

  return resolveBidding(records);
}
