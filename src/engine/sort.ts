/**
 * 手牌排序工具。UI 渲染与 AI 提示词构造共用。
 *
 * 纯函数模块：所有函数均返回新数组，不修改入参。
 */

import type { Card } from '../types/card';
import { SUIT_ORDER } from './constants';
import { groupByRank } from './cards';

/** 排序方向。 */
export type SortOrder = 'asc' | 'desc';

/**
 * 基础比较器：先比点数，同点数按花色权重稳定排序。
 *
 * @param order 'desc' 为点数降序（大牌在前），'asc' 为升序
 */
function makeComparator(order: SortOrder): (a: Card, b: Card) => number {
  const sign: number = order === 'desc' ? -1 : 1;
  return (a: Card, b: Card): number => {
    if (a.rank !== b.rank) {
      return (a.rank - b.rank) * sign;
    }
    const suitDiff: number = SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
    if (suitDiff !== 0) {
      return suitDiff;
    }
    // 最终以 id 兜底，保证排序完全确定（同输入必同输出）
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };
}

/**
 * 按点数排序手牌。
 *
 * @param cards 待排序的牌
 * @param order 默认 'desc'（大牌在左，符合斗地主习惯）
 */
export function sortCards(cards: Card[], order: SortOrder = 'desc'): Card[] {
  return cards.slice().sort(makeComparator(order));
}

/** 点数升序排序的便捷方法。 */
export function sortAsc(cards: Card[]): Card[] {
  return sortCards(cards, 'asc');
}

/** 点数降序排序的便捷方法。 */
export function sortDesc(cards: Card[]): Card[] {
  return sortCards(cards, 'desc');
}

/**
 * 按「张数分组」排序：同点数张数多的排前面（炸弹 → 三张 → 对子 → 单张），
 * 张数相同再按点数降序。适合 AI 观察手牌结构。
 */
export function sortByGroupSize(cards: Card[]): Card[] {
  const groups: Map<number, Card[]> = groupByRank(cards);
  const entries: Card[][] = [];
  groups.forEach((list) => {
    entries.push(sortDesc(list));
  });
  entries.sort((a, b) => {
    if (a.length !== b.length) {
      return b.length - a.length;
    }
    return b[0].rank - a[0].rank;
  });
  const result: Card[] = [];
  for (const group of entries) {
    for (const card of group) {
      result.push(card);
    }
  }
  return result;
}

/**
 * 把手牌格式化成简短文本，例如「大王 小王 2 A A K」。
 * 供 AI 提示词与日志使用。
 */
export function formatCards(cards: Card[], order: SortOrder = 'desc'): string {
  return sortCards(cards, order)
    .map((card) => card.label)
    .join(' ');
}

/**
 * 提取手牌中所有点数（去重，升序）。
 */
export function distinctRanks(cards: Card[]): number[] {
  const set = new Set<number>();
  for (const card of cards) {
    set.add(card.rank);
  }
  return Array.from(set).sort((a, b) => a - b);
}
