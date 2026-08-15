/**
 * 牌型识别 identifyPattern 的完整覆盖。
 *
 * 重点验证三条最容易写错的领域规则：
 * 1. 四张同点数必须先判 BOMB，绝不能落进三带一 / 四带二以外的分支
 * 2. 2（15）与大小王（16/17）绝不参与顺子 / 连对 / 飞机
 * 3. 王炸优先级最高
 */

import { describe, expect, it } from 'vitest';
import { CardType } from '@/types/card';
import type { HandPattern } from '@/types/card';
import {
  CARD_TYPE_NAMES,
  getCardTypeName,
  identifyPattern,
  isBombLike,
  isConsecutiveRanks,
  isValidPattern,
} from '@/engine/cardType';
import { hand } from '../helpers/cards';

/** 断言某组牌被识别为指定牌型，并返回牌型以便继续断言。 */
function expectType(spec: string, type: CardType, mainRank: number, length = 1): HandPattern {
  const parsed: HandPattern | null = identifyPattern(hand(spec));
  expect(parsed, `"${spec}" 应被识别为 ${type}`).not.toBeNull();
  const result = parsed as HandPattern;
  expect(result.type).toBe(type);
  expect(result.mainRank).toBe(mainRank);
  expect(result.length).toBe(length);
  return result;
}

describe('identifyPattern · 基础牌型', () => {
  it('单张：mainRank 即该牌点数', () => {
    expectType('7', CardType.SINGLE, 7);
    expectType('2', CardType.SINGLE, 15);
    expectType('RJ', CardType.SINGLE, 17);
  });

  it('对子：两张同点数', () => {
    expectType('9 9', CardType.PAIR, 9);
  });

  it('两张不同点数不是对子', () => {
    expect(identifyPattern(hand('9 10'))).toBeNull();
  });

  it('三张：三张同点数', () => {
    expectType('Q Q Q', CardType.TRIPLE, 12);
  });

  it('三张里混入杂牌则非法', () => {
    expect(identifyPattern(hand('Q Q K'))).toBeNull();
  });

  it('空数组与非数组输入返回 null 且不抛异常', () => {
    expect(identifyPattern([])).toBeNull();
    expect(identifyPattern(null as unknown as never)).toBeNull();
  });
});

describe('identifyPattern · 三带与四带', () => {
  it('三带一：mainRank 取三张的点数而非带牌', () => {
    const parsed: HandPattern = expectType('5 5 5 K', CardType.TRIPLE_WITH_SINGLE, 5);
    expect(parsed.cards).toHaveLength(4);
  });

  it('三带一对：5 张', () => {
    expectType('5 5 5 K K', CardType.TRIPLE_WITH_PAIR, 5);
  });

  it('三带二里带的不是对子则非法', () => {
    expect(identifyPattern(hand('5 5 5 K Q'))).toBeNull();
  });

  it('四带两单：length 记为 1', () => {
    expectType('9 9 9 9 3 4', CardType.FOUR_WITH_TWO, 9, 1);
  });

  it('四带两对：length 记为 2，用于与四带两单区分', () => {
    expectType('9 9 9 9 3 3 4 4', CardType.FOUR_WITH_TWO, 9, 2);
  });

  it('四张 + 1 张（5 张）不构成任何合法牌型', () => {
    expect(identifyPattern(hand('9 9 9 9 3'))).toBeNull();
  });

  it('四带两对但只有一个对子（四带一对 + 两单）按四带两单处理不了 8 张 → 非法', () => {
    expect(identifyPattern(hand('9 9 9 9 3 3 4 5'))).toBeNull();
  });
});

describe('identifyPattern · 炸弹与王炸（最高优先级）', () => {
  it('四张同点必须判为炸弹，不能被识别成三带一', () => {
    const parsed: HandPattern = expectType('8 8 8 8', CardType.BOMB, 8);
    expect(parsed.type).not.toBe(CardType.TRIPLE_WITH_SINGLE);
    expect(isBombLike(parsed)).toBe(true);
  });

  it('王炸：小王 + 大王，mainRank 取 17', () => {
    const parsed: HandPattern = expectType('BJ RJ', CardType.ROCKET, 17);
    expect(isBombLike(parsed)).toBe(true);
  });

  it('大王 + 2 不是王炸，也不是对子', () => {
    expect(identifyPattern(hand('RJ 2'))).toBeNull();
  });

  it('普通牌型不是炸弹类', () => {
    expect(isBombLike(expectType('3 3', CardType.PAIR, 3))).toBe(false);
  });
});

describe('identifyPattern · 顺子（上界 A）', () => {
  it('5 张连续单牌构成顺子，mainRank 取最大牌', () => {
    expectType('3 4 5 6 7', CardType.STRAIGHT, 7, 5);
  });

  it('10-J-Q-K-A 是最大的顺子', () => {
    expectType('10 J Q K A', CardType.STRAIGHT, 14, 5);
  });

  it('J-Q-K-A-2 非法：2 不能参与顺子', () => {
    expect(identifyPattern(hand('J Q K A 2'))).toBeNull();
  });

  it('含大小王的「连续」牌非法', () => {
    expect(identifyPattern(hand('J Q K A BJ'))).toBeNull();
    expect(identifyPattern(hand('Q K A BJ RJ'))).toBeNull();
  });

  it('4 张连续牌不足以构成顺子', () => {
    expect(identifyPattern(hand('3 4 5 6'))).toBeNull();
  });

  it('断档的 5 张牌不是顺子', () => {
    expect(identifyPattern(hand('3 4 5 6 8'))).toBeNull();
  });

  it('12 张顺子 3~A 合法', () => {
    expectType('3 4 5 6 7 8 9 10 J Q K A', CardType.STRAIGHT, 14, 12);
  });
});

describe('identifyPattern · 连对（≥3 对，上界 A）', () => {
  it('三连对合法，length 为对数', () => {
    expectType('3 3 4 4 5 5', CardType.DOUBLE_STRAIGHT, 5, 3);
  });

  it('两连对不足 3 对，非法', () => {
    expect(identifyPattern(hand('3 3 4 4'))).toBeNull();
  });

  it('K-K-A-A-2-2 非法：2 不能参与连对', () => {
    expect(identifyPattern(hand('K K A A 2 2'))).toBeNull();
  });

  it('对子不连续则非法', () => {
    expect(identifyPattern(hand('3 3 4 4 6 6'))).toBeNull();
  });
});

describe('identifyPattern · 飞机系列（上界 A）', () => {
  it('纯飞机：两组连续三张', () => {
    expectType('3 3 3 4 4 4', CardType.PLANE, 4, 2);
  });

  it('三组连续三张，length 为 3', () => {
    expectType('3 3 3 4 4 4 5 5 5', CardType.PLANE, 5, 3);
  });

  it('飞机带单：额外等量单牌', () => {
    expectType('3 3 3 4 4 4 7 9', CardType.PLANE_WITH_SINGLES, 4, 2);
  });

  it('飞机带的两张恰好是一对时，仍按飞机带单处理（8 张）', () => {
    expectType('3 3 3 4 4 4 7 7', CardType.PLANE_WITH_SINGLES, 4, 2);
  });

  it('飞机带对：额外等量对子', () => {
    expectType('3 3 3 4 4 4 7 7 9 9', CardType.PLANE_WITH_PAIRS, 4, 2);
  });

  it('A-A-A-2-2-2 非法：2 不能参与飞机', () => {
    expect(identifyPattern(hand('A A A 2 2 2'))).toBeNull();
  });

  it('三张不连续则不是飞机', () => {
    expect(identifyPattern(hand('3 3 3 5 5 5'))).toBeNull();
  });

  it('飞机带牌数量不匹配则非法', () => {
    expect(identifyPattern(hand('3 3 3 4 4 4 7'))).toBeNull();
  });
});

describe('isConsecutiveRanks', () => {
  it('连续且不超过 A 时为真', () => {
    expect(isConsecutiveRanks([3, 4, 5])).toBe(true);
    expect(isConsecutiveRanks([10, 11, 12, 13, 14])).toBe(true);
  });

  it('包含 2 / 小王 / 大王 一律为假', () => {
    expect(isConsecutiveRanks([13, 14, 15])).toBe(false);
    expect(isConsecutiveRanks([15, 16, 17])).toBe(false);
  });

  it('不连续或空数组为假', () => {
    expect(isConsecutiveRanks([3, 5, 6])).toBe(false);
    expect(isConsecutiveRanks([])).toBe(false);
  });

  it('单个点数视为连续', () => {
    expect(isConsecutiveRanks([7])).toBe(true);
  });
});

describe('isValidPattern / 牌型名称', () => {
  it('isValidPattern 与 identifyPattern 结论一致', () => {
    expect(isValidPattern(hand('3 3 3'))).toBe(true);
    expect(isValidPattern(hand('3 4'))).toBe(false);
  });

  it('13 种牌型都有中文名', () => {
    const names: string[] = Object.values(CardType).map((type) => getCardTypeName(type));
    expect(names).toHaveLength(13);
    expect(names.every((name) => name.length > 0 && name !== '未知牌型')).toBe(true);
    expect(CARD_TYPE_NAMES[CardType.ROCKET]).toBe('王炸');
  });
});
