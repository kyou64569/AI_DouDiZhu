/**
 * 对局结算。
 *
 * 契约：底分 = 最高叫分；炸弹 / 王炸 / 春天 / 反春天各 ×2 且可叠加；
 * 春天 = 地主赢且两农民一次都没出过牌；反春天 = 农民赢且地主只出过恰好 1 次牌；
 * 三家得分之和恒为 0。
 */

import { describe, expect, it } from 'vitest';
import type { SeatIndex, SettlementResult } from '@/types/game';
import {
  calculateMultiplier,
  calculateSettlement,
  countBombs,
  countEffectivePlays,
  countRockets,
  findWinnerSeat,
  isAntiSpring,
  isLandlordWin,
  isSpring,
  type SettlementPlay,
} from '@/engine/score';
import { pattern } from '../helpers/cards';

/** 构造一次出牌记录。 */
function play(seat: number, spec: string): SettlementPlay {
  return { seat, pattern: pattern(spec), isPass: false };
}

/** 构造一次过牌记录。 */
function pass(seat: number): SettlementPlay {
  return { seat, pattern: null, isPass: true };
}

/** 三家得分之和必须恒为 0。 */
function expectZeroSum(result: SettlementResult): void {
  expect(result.seatScores.reduce((sum, value) => sum + value, 0)).toBe(0);
}

describe('countEffectivePlays / countBombs / countRockets', () => {
  const history: SettlementPlay[] = [
    play(0, '3 3 3 3'),
    pass(1),
    play(2, 'BJ RJ'),
    pass(0),
    play(2, '5'),
  ];

  it('过牌不计入有效出牌次数', () => {
    expect(countEffectivePlays(history, 0)).toBe(1);
    expect(countEffectivePlays(history, 1)).toBe(0);
    expect(countEffectivePlays(history, 2)).toBe(2);
  });

  it('炸弹与王炸分别统计，互不混淆', () => {
    expect(countBombs(history)).toBe(1);
    expect(countRockets(history)).toBe(1);
  });

  it('空历史全部为 0', () => {
    expect(countEffectivePlays([], 0)).toBe(0);
    expect(countBombs([])).toBe(0);
    expect(countRockets([])).toBe(0);
  });

  it('标记为 pass 但带 pattern 的脏数据不计数', () => {
    const dirty: SettlementPlay[] = [{ seat: 0, pattern: pattern('3 3 3 3'), isPass: true }];
    expect(countBombs(dirty)).toBe(0);
    expect(countEffectivePlays(dirty, 0)).toBe(0);
  });
});

describe('isSpring · 春天', () => {
  it('地主赢且两农民都没出过牌 → 春天', () => {
    const history: SettlementPlay[] = [play(0, '3'), pass(1), pass(2), play(0, '4')];
    expect(isSpring(history, 0, true)).toBe(true);
  });

  it('只要有一个农民出过牌就不是春天', () => {
    const history: SettlementPlay[] = [play(0, '3'), play(1, '5'), pass(2)];
    expect(isSpring(history, 0, true)).toBe(false);
  });

  it('地主输了绝不可能是春天', () => {
    const history: SettlementPlay[] = [play(0, '3'), pass(1), pass(2)];
    expect(isSpring(history, 0, false)).toBe(false);
  });

  it('地主不在 0 号座位时同样成立', () => {
    const history: SettlementPlay[] = [play(2, '3'), pass(0), pass(1), play(2, '4')];
    expect(isSpring(history, 2, true)).toBe(true);
  });
});

describe('isAntiSpring · 反春天', () => {
  it('农民赢且地主只出过 1 次牌 → 反春天', () => {
    const history: SettlementPlay[] = [play(0, '3'), play(1, '5'), play(1, '6')];
    expect(isAntiSpring(history, 0, false)).toBe(true);
  });

  it('地主出过 2 次牌就不是反春天', () => {
    const history: SettlementPlay[] = [play(0, '3'), play(0, '4'), play(1, '5')];
    expect(isAntiSpring(history, 0, false)).toBe(false);
  });

  it('地主一次都没出过（异常数据）也不算反春天', () => {
    expect(isAntiSpring([play(1, '5')], 0, false)).toBe(false);
  });

  it('地主赢了绝不可能是反春天', () => {
    expect(isAntiSpring([play(0, '3')], 0, true)).toBe(false);
  });
});

describe('calculateMultiplier · 倍数叠加', () => {
  it('无任何加倍项时为 1 倍', () => {
    const result = calculateMultiplier([play(0, '3'), play(1, '5'), play(2, '6')], 0, true);
    expect(result.multiplier).toBe(1);
    expect(result.detail).toEqual([{ reason: '基础倍数', factor: 1 }]);
  });

  it('每个炸弹 ×2，多个炸弹连乘', () => {
    // 给地主（seat0）补一手非炸弹出牌，使 antiSpring 不触发，隔离「只测炸弹连乘」这一变量。
    const history: SettlementPlay[] = [
      play(0, '3 3 3 3'),
      play(1, '5 5 5 5'),
      play(2, '6'),
      play(0, '7'),
    ];
    const result = calculateMultiplier(history, 0, false);
    expect(result.antiSpring).toBe(false);
    expect(result.multiplier).toBe(4);
  });

  it('炸弹 + 王炸 + 春天叠加 = 8 倍', () => {
    const history: SettlementPlay[] = [play(0, '3 3 3 3'), pass(1), pass(2), play(0, 'BJ RJ')];
    const result = calculateMultiplier(history, 0, true);
    expect(result.spring).toBe(true);
    expect(result.multiplier).toBe(8);
    expect(result.detail.map((item) => item.reason)).toEqual(['基础倍数', '炸弹', '王炸', '春天']);
  });

  it('反春天单独计入 ×2', () => {
    const history: SettlementPlay[] = [play(0, '3'), play(1, '5'), play(1, '6')];
    const result = calculateMultiplier(history, 0, false);
    expect(result.antiSpring).toBe(true);
    expect(result.multiplier).toBe(2);
  });

  it('额外倍数生效并记入明细，非法额外倍数被忽略', () => {
    const history: SettlementPlay[] = [play(0, '3'), play(1, '5'), play(2, '6')];
    expect(calculateMultiplier(history, 0, true, 4).multiplier).toBe(4);
    expect(calculateMultiplier(history, 0, true, 0).multiplier).toBe(1);
    expect(calculateMultiplier(history, 0, true, Number.NaN).multiplier).toBe(1);
  });
});

describe('calculateSettlement · 完整结算', () => {
  it('地主胜：地主 +2 份，两农民各 -1 份', () => {
    const result: SettlementResult = calculateSettlement({
      landlordSeat: 0,
      landlordWin: true,
      baseScore: 3,
      playHistory: [play(0, '3'), play(1, '5'), play(2, '6')],
    });
    expect(result.multiplier).toBe(1);
    expect(result.unitScore).toBe(3);
    expect(result.seatScores).toEqual([6, -3, -3]);
    expectZeroSum(result);
  });

  it('地主负：地主 -2 份，两农民各 +1 份', () => {
    // 给地主（seat1）补一手出牌，使 antiSpring 不触发，隔离「只测地主负基础分」这一变量。
    const result: SettlementResult = calculateSettlement({
      landlordSeat: 1,
      landlordWin: false,
      baseScore: 2,
      playHistory: [play(1, '3'), play(2, '5'), play(0, '6'), play(2, '7'), play(1, '8')],
    });
    expect(result.isAntiSpring).toBe(false);
    expect(result.multiplier).toBe(1);
    expect(result.seatScores).toEqual([2, -4, 2]);
    expectZeroSum(result);
  });

  it('春天 + 炸弹叠加后分数正确（底分 2 × 4 倍 = 8）', () => {
    const result: SettlementResult = calculateSettlement({
      landlordSeat: 1,
      landlordWin: true,
      baseScore: 2,
      playHistory: [play(1, '3 3 3 3'), pass(2), pass(0), play(1, '4')],
    });
    expect(result.isSpring).toBe(true);
    expect(result.multiplier).toBe(4);
    expect(result.unitScore).toBe(8);
    expect(result.seatScores).toEqual([-8, 16, -8]);
    expectZeroSum(result);
  });

  it('反春天：农民赢且地主只出过一次', () => {
    const result: SettlementResult = calculateSettlement({
      landlordSeat: 2,
      landlordWin: false,
      baseScore: 1,
      playHistory: [play(2, '3'), play(0, '5'), play(0, '6')],
    });
    expect(result.isAntiSpring).toBe(true);
    expect(result.multiplier).toBe(2);
    expect(result.multiplierDetail.map((item) => item.reason)).toContain('反春天');
    expect(result.seatScores).toEqual([2, 2, -4]);
    expectZeroSum(result);
  });

  it('反春天端到端：地主恰好出 1 手后农民走完（盲区补全）', () => {
    // 地主 seat0 只出了第一手 '3'，之后两家农民交替出完，地主再未出牌 → 反春天。
    const result: SettlementResult = calculateSettlement({
      landlordSeat: 0,
      landlordWin: false,
      baseScore: 2,
      playHistory: [play(0, '3'), play(1, '5'), play(2, '6'), play(1, '7'), play(2, '8')],
    });
    expect(result.isAntiSpring).toBe(true);
    expect(result.isSpring).toBe(false);
    expect(result.multiplier).toBe(2);
    const reasons: string[] = result.multiplierDetail.map((item) => item.reason);
    expect(reasons).toContain('反春天');
    // 基础分 = 底分 × 倍数 = 2 × 2 = 4；地主负 → 地主 -8，两农民各 +4。
    expect(result.unitScore).toBe(4);
    expect(result.seatScores).toEqual([-8, 4, 4]);
    expectZeroSum(result);
  });

  it('底分非法时兜底为 1', () => {
    const base = { landlordSeat: 0 as SeatIndex, landlordWin: true, playHistory: [play(0, '3'), play(1, '4'), play(2, '5')] };
    expect(calculateSettlement({ ...base, baseScore: 0 }).baseScore).toBe(1);
    expect(calculateSettlement({ ...base, baseScore: -3 }).baseScore).toBe(1);
    expect(calculateSettlement({ ...base, baseScore: Number.NaN }).baseScore).toBe(1);
  });

  it('额外倍数参与最终分数计算', () => {
    const result: SettlementResult = calculateSettlement({
      landlordSeat: 0,
      landlordWin: true,
      baseScore: 1,
      playHistory: [play(0, '3'), play(1, '4'), play(2, '5')],
      extraMultiplier: 3,
    });
    expect(result.multiplier).toBe(3);
    expect(result.seatScores).toEqual([6, -3, -3]);
    expectZeroSum(result);
  });

  it('任意组合下三家得分之和恒为 0', () => {
    for (const landlordSeat of [0, 1, 2] as SeatIndex[]) {
      for (const landlordWin of [true, false]) {
        for (const baseScore of [1, 2, 3]) {
          const result: SettlementResult = calculateSettlement({
            landlordSeat,
            landlordWin,
            baseScore,
            playHistory: [play(landlordSeat, '3 3 3 3'), pass((landlordSeat + 1) % 3), play((landlordSeat + 2) % 3, 'BJ RJ')],
          });
          expectZeroSum(result);
          expect(Math.abs(result.seatScores[landlordSeat])).toBe(result.unitScore * 2);
        }
      }
    }
  });
});

describe('findWinnerSeat / isLandlordWin', () => {
  it('手牌为 0 的座位即为赢家', () => {
    expect(findWinnerSeat([5, 0, 3])).toBe(1);
    expect(findWinnerSeat([0, 2, 3])).toBe(0);
  });

  it('无人出完时返回 null', () => {
    expect(findWinnerSeat([1, 2, 3])).toBeNull();
  });

  it('赢家是地主则地主胜', () => {
    expect(isLandlordWin(1, 1)).toBe(true);
    expect(isLandlordWin(2, 1)).toBe(false);
  });
});
