/**
 * 叫分阶段规则。
 *
 * 契约：1/2/3 严格递增，每人一次；有人叫 3 立即结束；三家全不叫 → 重新发牌。
 */

import { describe, expect, it } from 'vitest';
import type { BidRecord, SeatIndex } from '@/types/game';
import {
  getHighestBid,
  getLegalBids,
  getNextBidder,
  isBiddingFinished,
  isLegalBid,
  resolveBidding,
  runBidding,
  toBidScore,
  toSeatIndex,
} from '@/engine/bidding';

/** 构造叫分记录。 */
function rec(seat: SeatIndex, score: 0 | 1 | 2 | 3): BidRecord {
  return { seat, score };
}

describe('getLegalBids / isLegalBid', () => {
  it('无人叫分时四个选项都可选', () => {
    expect(getLegalBids(0)).toEqual([0, 1, 2, 3]);
  });

  it('只能叫比当前最高分更高的分，0 永远可选', () => {
    expect(getLegalBids(1)).toEqual([0, 2, 3]);
    expect(getLegalBids(2)).toEqual([0, 3]);
    expect(getLegalBids(3)).toEqual([0]);
  });

  it('异常入参降级为 0 处理', () => {
    expect(getLegalBids(Number.NaN)).toEqual([0, 1, 2, 3]);
    expect(getLegalBids(-5)).toEqual([0, 1, 2, 3]);
  });

  it('isLegalBid 与 getLegalBids 一致', () => {
    expect(isLegalBid(2, 1)).toBe(true);
    expect(isLegalBid(1, 1)).toBe(false);
    expect(isLegalBid(0, 3)).toBe(true);
    expect(isLegalBid(4, 0)).toBe(false);
  });
});

describe('toBidScore / toSeatIndex', () => {
  it('非法叫分一律降级为不叫', () => {
    expect(toBidScore(1)).toBe(1);
    expect(toBidScore(3)).toBe(3);
    expect(toBidScore(4)).toBe(0);
    expect(toBidScore(-1)).toBe(0);
    expect(toBidScore(2.5)).toBe(0);
  });

  it('座位号按 3 取模并处理负数', () => {
    expect(toSeatIndex(0)).toBe(0);
    expect(toSeatIndex(3)).toBe(0);
    expect(toSeatIndex(4)).toBe(1);
    expect(toSeatIndex(-1)).toBe(2);
  });
});

describe('getHighestBid', () => {
  it('取记录中的最大值', () => {
    expect(getHighestBid([rec(0, 1), rec(1, 3), rec(2, 0)])).toBe(3);
  });

  it('无记录或全不叫时为 0', () => {
    expect(getHighestBid([])).toBe(0);
    expect(getHighestBid([rec(0, 0), rec(1, 0)])).toBe(0);
  });
});

describe('isBiddingFinished / getNextBidder', () => {
  it('有人叫到 3 分立即结束，无需问完三家', () => {
    expect(isBiddingFinished([rec(0, 3)])).toBe(true);
    expect(getNextBidder([rec(0, 3)], 0)).toBeNull();
  });

  it('三家都表态过即结束', () => {
    expect(isBiddingFinished([rec(0, 0), rec(1, 1), rec(2, 0)])).toBe(true);
    expect(isBiddingFinished([rec(0, 0), rec(1, 1)])).toBe(false);
  });

  it('下一个叫分者按起始座位顺延并回绕', () => {
    expect(getNextBidder([], 1)).toBe(1);
    expect(getNextBidder([rec(1, 1)], 1)).toBe(2);
    expect(getNextBidder([rec(1, 1), rec(2, 0)], 1)).toBe(0);
  });
});

describe('resolveBidding', () => {
  it('最高分者当地主，底分等于最高叫分', () => {
    const result = resolveBidding([rec(0, 1), rec(1, 2), rec(2, 0)]);
    expect(result.landlordSeat).toBe(1);
    expect(result.baseScore).toBe(2);
    expect(result.needRedeal).toBe(false);
  });

  it('三家全不叫 → 需要重新发牌，地主为 null，底分 0', () => {
    const result = resolveBidding([rec(0, 0), rec(1, 0), rec(2, 0)]);
    expect(result.needRedeal).toBe(true);
    expect(result.landlordSeat).toBeNull();
    expect(result.baseScore).toBe(0);
  });

  it('空记录同样视为流局', () => {
    expect(resolveBidding([]).needRedeal).toBe(true);
  });

  it('返回的 records 是副本，外部改动不影响结果', () => {
    const records: BidRecord[] = [rec(0, 2)];
    const result = resolveBidding(records);
    records.push(rec(1, 3));
    expect(result.records).toHaveLength(1);
  });
});

describe('runBidding · 完整流程', () => {
  it('1→2→3 递增，最后叫 3 分者当地主', () => {
    const result = runBidding([1, 2, 3]);
    expect(result.landlordSeat).toBe(2);
    expect(result.baseScore).toBe(3);
    expect(result.records.map((item) => item.score)).toEqual([1, 2, 3]);
  });

  it('首家叫 3 分立即结束，后面两家不再叫', () => {
    const result = runBidding([3, 2, 1]);
    expect(result.records).toHaveLength(1);
    expect(result.landlordSeat).toBe(0);
    expect(result.baseScore).toBe(3);
  });

  it('叫了不高于当前最高分的非法值会被降级为不叫', () => {
    const result = runBidding([2, 1, 0]);
    expect(result.records.map((item) => item.score)).toEqual([2, 0, 0]);
    expect(result.landlordSeat).toBe(0);
    expect(result.baseScore).toBe(2);
  });

  it('三家全不叫 → needRedeal', () => {
    const result = runBidding([0, 0, 0]);
    expect(result.needRedeal).toBe(true);
    expect(result.records).toHaveLength(3);
  });

  it('起始座位不为 0 时按顺序回绕分配座位', () => {
    const result = runBidding([0, 1, 2], 2);
    expect(result.records.map((item) => item.seat)).toEqual([2, 0, 1]);
    expect(result.landlordSeat).toBe(1);
    expect(result.baseScore).toBe(2);
  });

  it('每人只叫一次：传入超过 3 个意向也只记录 3 条', () => {
    const result = runBidding([1, 0, 0, 2, 3]);
    expect(result.records).toHaveLength(3);
    expect(result.baseScore).toBe(1);
    expect(result.landlordSeat).toBe(0);
  });
});
