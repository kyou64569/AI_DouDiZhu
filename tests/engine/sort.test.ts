/**
 * 手牌排序与格式化。UI 与 AI 提示词共用，要求同输入必同输出。
 */

import { describe, expect, it } from 'vitest';
import type { Card } from '@/types/card';
import { distinctRanks, formatCards, sortAsc, sortByGroupSize, sortCards, sortDesc } from '@/engine/sort';
import { hand, ranksOf } from '../helpers/cards';

describe('sortCards', () => {
  it('默认降序：大牌在前', () => {
    const sorted: Card[] = sortCards(hand('3 RJ 9 2 BJ A'));
    expect(sorted.map((card) => card.rank)).toEqual([17, 16, 15, 14, 9, 3]);
  });

  it('升序模式', () => {
    expect(sortAsc(hand('K 3 9')).map((card) => card.rank)).toEqual([3, 9, 13]);
  });

  it('不修改入参', () => {
    const cards: Card[] = hand('K 3 9');
    const before: string[] = cards.map((card) => card.id);
    sortDesc(cards);
    expect(cards.map((card) => card.id)).toEqual(before);
  });

  it('同点数按花色权重稳定排序，多次调用结果一致', () => {
    const cards: Card[] = hand('7 7 7 7');
    const first: string[] = sortDesc(cards).map((card) => card.id);
    const second: string[] = sortDesc(cards.slice().reverse()).map((card) => card.id);
    expect(first).toEqual(second);
    expect(sortDesc(cards).map((card) => card.suit)).toEqual(['SPADE', 'HEART', 'CLUB', 'DIAMOND']);
  });

  it('空数组安全', () => {
    expect(sortDesc([])).toEqual([]);
  });
});

describe('sortByGroupSize', () => {
  it('张数多的分组排前面，张数相同按点数降序', () => {
    const sorted: Card[] = sortByGroupSize(hand('3 9 9 9 9 K K 5'));
    expect(sorted.map((card) => card.rank)).toEqual([9, 9, 9, 9, 13, 13, 5, 3]);
  });

  it('总张数不变', () => {
    const cards: Card[] = hand('3 3 4 5 5 5 BJ');
    expect(sortByGroupSize(cards)).toHaveLength(cards.length);
  });
});

describe('formatCards', () => {
  it('按降序输出中文牌面，空格分隔', () => {
    expect(formatCards(hand('3 BJ A RJ 10'))).toBe('大王 小王 A 10 3');
  });

  it('可指定升序', () => {
    expect(formatCards(hand('K 3 J'), 'asc')).toBe('3 J K');
  });

  it('空手牌返回空串', () => {
    expect(formatCards([])).toBe('');
  });
});

describe('distinctRanks', () => {
  it('去重并升序', () => {
    expect(distinctRanks(hand('K 3 3 K 2 BJ'))).toEqual([3, 13, 15, 16]);
  });

  it('空数组返回空数组', () => {
    expect(distinctRanks([])).toEqual([]);
  });

  it('与 ranksOf 的去重结果一致', () => {
    const cards: Card[] = hand('5 5 6');
    expect(distinctRanks(cards)).toEqual([...new Set(ranksOf(cards))]);
  });
});
