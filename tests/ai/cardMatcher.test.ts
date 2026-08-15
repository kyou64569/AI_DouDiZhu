/**
 * 牌面标签 → 手牌真实 Card 实例映射。
 *
 * 重点：
 * - labelToRank 覆盖各种模型写法（英文 / 数字 / 全角 / 花色前缀 / 大小王变体）。
 * - matchCards 必须返回 hand 数组里的【原始对象引用】，绝不新造 Card。
 * - 同点多张：从手牌里取多张不同 id 的同点牌。
 * - 手牌不足 / 标签无法识别 → 返回 null 并记录 warning。
 */

import { describe, expect, it } from 'vitest';
import { labelToRank, matchCards } from '@/ai/cardMatcher';
import type { Card } from '@/types/card';
import { RANK_BLACK_JOKER, RANK_RED_JOKER } from '@/engine/constants';
import { hand, isSubsetByIdentity, makeCard } from '../helpers/cards';

describe('labelToRank · 各种记法归一化', () => {
  const cases: Array<[string, number]> = [
    ['3', 3],
    ['10', 10],
    ['T', 10],
    ['１０', 10], // 全角 10
    ['J', 11],
    ['11', 11],
    ['JACK', 11],
    ['Q', 12],
    ['12', 12],
    ['QUEEN', 12],
    ['K', 13],
    ['13', 13],
    ['KING', 13],
    ['A', 14],
    ['14', 14],
    ['1', 14], // 部分模型把 A 写成 1
    ['ACE', 14],
    ['2', 15],
    ['15', 15],
    ['TWO', 15],
    ['小王', RANK_BLACK_JOKER],
    ['BJ', RANK_BLACK_JOKER],
    ['BLACKJOKER', RANK_BLACK_JOKER],
    ['大王', RANK_RED_JOKER],
    ['RJ', RANK_RED_JOKER],
    ['REDJOKER', RANK_RED_JOKER],
    ['17', RANK_RED_JOKER],
    ['王炸', RANK_RED_JOKER],
  ];

  it.each(cases)('"%s" → rank %i', (label, rank) => {
    expect(labelToRank(label)).toBe(rank);
  });

  it('大小写与空白不敏感', () => {
    expect(labelToRank('  jack ')).toBe(11);
    expect(labelToRank('RED JOKER')).toBe(RANK_RED_JOKER);
  });

  it('裸 "JOKER" 与 "王" 按小王兜底', () => {
    expect(labelToRank('JOKER')).toBe(RANK_BLACK_JOKER);
    expect(labelToRank('王')).toBe(RANK_BLACK_JOKER);
  });

  it('带花色前缀的标签可剥离', () => {
    expect(labelToRank('黑桃J')).toBe(11);
    expect(labelToRank('♠10')).toBe(10);
    expect(labelToRank('SPADE K')).toBe(13);
    expect(labelToRank('红桃5')).toBe(5);
  });

  it('无法识别的标签返回 null', () => {
    expect(labelToRank('XX')).toBeNull();
    expect(labelToRank('')).toBeNull();
    expect(labelToRank('   ')).toBeNull();
  });
});

describe('matchCards · 映射到手牌真实引用', () => {
  it('返回手牌中的原始对象引用', () => {
    const myHand: Card[] = hand('3 4 5');
    const result = matchCards(myHand, ['3']);
    expect(result.cards).not.toBeNull();
    expect(result.cards!.length).toBe(1);
    expect(isSubsetByIdentity(myHand, result.cards!)).toBe(true);
  });

  it('同点多张：从手牌取多张不同 id 的同点牌', () => {
    const myHand: Card[] = hand('3 3 4');
    const result = matchCards(myHand, ['3', '3']);
    expect(result.cards).not.toBeNull();
    expect(result.cards!.length).toBe(2);
    const ids = new Set(result.cards!.map((card) => card.id));
    expect(ids.size).toBe(2); // 两张不同牌
    expect(result.cards!.every((card) => card.rank === 3)).toBe(true);
    expect(isSubsetByIdentity(myHand, result.cards!)).toBe(true);
  });

  it('大小王变体映射到正确 joker', () => {
    const myHand: Card[] = hand('BJ RJ 3');
    const result = matchCards(myHand, ['小王', '大王']);
    expect(result.cards).not.toBeNull();
    expect(result.cards!.map((card) => card.rank).sort((a, b) => a - b)).toEqual(
      [RANK_BLACK_JOKER, RANK_RED_JOKER].sort((a, b) => a - b),
    );
    expect(isSubsetByIdentity(myHand, result.cards!)).toBe(true);
  });

  it('带花色前缀的标签可映射', () => {
    const myHand: Card[] = hand('J 3 4');
    const result = matchCards(myHand, ['黑桃J']);
    expect(result.cards).not.toBeNull();
    expect(result.cards![0].rank).toBe(11);
    expect(isSubsetByIdentity(myHand, result.cards!)).toBe(true);
  });

  it('手牌数量不足返回 null 并记 warning', () => {
    const myHand: Card[] = hand('3 4');
    const result = matchCards(myHand, ['3', '3']);
    expect(result.cards).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.join()).toContain('不足');
  });

  it('无法识别的标签返回 null 并记 warning', () => {
    const myHand: Card[] = hand('3 4');
    const result = matchCards(myHand, ['ZZ']);
    expect(result.cards).toBeNull();
    expect(result.warnings.join()).toContain('无法识别');
  });

  it('空标签数组返回 null', () => {
    const result = matchCards(hand('3 4'), []);
    expect(result.cards).toBeNull();
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('空手牌无法映射返回 null', () => {
    const result = matchCards([], ['3']);
    expect(result.cards).toBeNull();
  });

  it('同一对象映射结果可复现（确定性）', () => {
    const myHand: Card[] = hand('3 3 3 4');
    const a = matchCards(myHand, ['3', '3']);
    const b = matchCards(myHand, ['3', '3']);
    expect(a.cards!.map((card) => card.id)).toEqual(b.cards!.map((card) => card.id));
  });

  it('非 hand 来源的牌不会被误映射', () => {
    const myHand: Card[] = hand('3 4 5');
    const foreign: Card = makeCard(3); // 与手牌点数相同但 id 不同
    const result = matchCards(myHand, ['3']);
    expect(result.cards).not.toBeNull();
    expect(result.cards!.some((card) => card.id === foreign.id)).toBe(false);
  });
});
