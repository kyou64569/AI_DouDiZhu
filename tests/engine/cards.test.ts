/**
 * 牌堆构造、洗牌、发牌与卡牌集合工具。
 *
 * 关键契约：54 张无重无漏；洗牌接受注入 rng，同 seed 可复现；发牌 17/17/17+3。
 */

import { describe, expect, it } from 'vitest';
import type { Card } from '@/types/card';
import {
  containsAll,
  countByRank,
  createDeck,
  createShuffledDeal,
  deal,
  groupByRank,
  isSameCard,
  removeCards,
  shuffle,
} from '@/engine/cards';
import { BOTTOM_CARD_COUNT, DECK_SIZE, HAND_SIZE } from '@/engine/constants';
import { hand, seededRng } from '../helpers/cards';

/** 取出一组牌的 id 集合。 */
function idsOf(cards: readonly Card[]): string[] {
  return cards.map((card) => card.id);
}

describe('createDeck', () => {
  it('恰好 54 张牌', () => {
    expect(createDeck()).toHaveLength(DECK_SIZE);
  });

  it('所有 id 唯一', () => {
    const deck: Card[] = createDeck();
    expect(new Set(idsOf(deck)).size).toBe(DECK_SIZE);
  });

  it('3~2 每个点数各 4 张，大小王各 1 张', () => {
    const counter: Map<number, number> = countByRank(createDeck());
    for (let rank = 3; rank <= 15; rank += 1) {
      expect(counter.get(rank), `点数 ${rank} 应有 4 张`).toBe(4);
    }
    expect(counter.get(16)).toBe(1);
    expect(counter.get(17)).toBe(1);
    expect(counter.size).toBe(15);
  });

  it('大小王花色为 JOKER，普通牌不是', () => {
    const deck: Card[] = createDeck();
    const jokers: Card[] = deck.filter((card) => card.suit === 'JOKER');
    expect(jokers.map((card) => card.rank).sort((a, b) => a - b)).toEqual([16, 17]);
    expect(deck.filter((card) => card.rank < 16).every((card) => card.suit !== 'JOKER')).toBe(true);
  });

  it('label 与点数对应', () => {
    const deck: Card[] = createDeck();
    expect(deck.find((card) => card.rank === 14)?.label).toBe('A');
    expect(deck.find((card) => card.rank === 15)?.label).toBe('2');
    expect(deck.find((card) => card.rank === 16)?.label).toBe('小王');
    expect(deck.find((card) => card.rank === 17)?.label).toBe('大王');
  });

  it('每次调用返回全新数组，互不共享引用', () => {
    const a: Card[] = createDeck();
    const b: Card[] = createDeck();
    expect(a).not.toBe(b);
    expect(a[0]).not.toBe(b[0]);
  });
});

describe('shuffle', () => {
  it('同一 seed 必然产出完全相同的顺序（可复现）', () => {
    const first: Card[] = shuffle(createDeck(), seededRng(20240610));
    const second: Card[] = shuffle(createDeck(), seededRng(20240610));
    expect(idsOf(first)).toEqual(idsOf(second));
  });

  it('不同 seed 产出不同顺序', () => {
    const a: Card[] = shuffle(createDeck(), seededRng(1));
    const b: Card[] = shuffle(createDeck(), seededRng(2));
    expect(idsOf(a)).not.toEqual(idsOf(b));
  });

  it('洗牌是纯函数：不修改入参', () => {
    const deck: Card[] = createDeck();
    const before: string[] = idsOf(deck);
    shuffle(deck, seededRng(7));
    expect(idsOf(deck)).toEqual(before);
  });

  it('洗牌后仍是同一副牌（无重无漏）', () => {
    const deck: Card[] = createDeck();
    const shuffled: Card[] = shuffle(deck, seededRng(99));
    expect(shuffled).toHaveLength(DECK_SIZE);
    expect(idsOf(shuffled).slice().sort()).toEqual(idsOf(deck).slice().sort());
  });

  it('rng 返回越界值 / NaN 时不产生空洞', () => {
    for (const bad of [() => Number.NaN, () => 1.5, () => -3, () => Number.POSITIVE_INFINITY]) {
      const shuffled: Card[] = shuffle(createDeck(), bad);
      expect(shuffled).toHaveLength(DECK_SIZE);
      expect(shuffled.every((card) => card !== undefined)).toBe(true);
      expect(new Set(idsOf(shuffled)).size).toBe(DECK_SIZE);
    }
  });
});

describe('deal', () => {
  it('三家各 17 张 + 3 张底牌', () => {
    const result = deal(createDeck());
    expect(result.hands).toHaveLength(3);
    for (const seatHand of result.hands) {
      expect(seatHand).toHaveLength(HAND_SIZE);
    }
    expect(result.bottomCards).toHaveLength(BOTTOM_CARD_COUNT);
  });

  it('发出的 54 张牌无重复无遗漏', () => {
    const deck: Card[] = createDeck();
    const result = deal(deck);
    const all: string[] = [...result.hands.flat(), ...result.bottomCards].map((card) => card.id);
    expect(all).toHaveLength(DECK_SIZE);
    expect(new Set(all).size).toBe(DECK_SIZE);
    expect(all.slice().sort()).toEqual(idsOf(deck).slice().sort());
  });

  it('牌堆张数不对时抛出明确错误', () => {
    expect(() => deal(createDeck().slice(0, 53))).toThrow(/54/);
    expect(() => deal([])).toThrow();
  });
});

describe('createShuffledDeal', () => {
  it('同 seed 三家手牌完全一致（确定性对局的基础）', () => {
    const a = createShuffledDeal(seededRng(2025));
    const b = createShuffledDeal(seededRng(2025));
    expect(a.hands.map(idsOf)).toEqual(b.hands.map(idsOf));
    expect(idsOf(a.bottomCards)).toEqual(idsOf(b.bottomCards));
  });

  it('三家手牌互不相交，且与底牌合起来正好是一整副', () => {
    const result = createShuffledDeal(seededRng(31));
    const all: string[] = [...result.hands.flat(), ...result.bottomCards].map((card) => card.id);
    expect(new Set(all).size).toBe(DECK_SIZE);
  });
});

describe('countByRank / groupByRank', () => {
  it('countByRank 统计每个点数的张数', () => {
    const counter: Map<number, number> = countByRank(hand('3 3 3 K BJ'));
    expect(counter.get(3)).toBe(3);
    expect(counter.get(13)).toBe(1);
    expect(counter.get(16)).toBe(1);
    expect(counter.get(7)).toBeUndefined();
  });

  it('groupByRank 分组后各组张数之和等于总数', () => {
    const cards: Card[] = hand('4 4 5 5 5 RJ');
    const groups: Map<number, Card[]> = groupByRank(cards);
    expect(groups.get(4)).toHaveLength(2);
    expect(groups.get(5)).toHaveLength(3);
    expect([...groups.values()].reduce((sum, list) => sum + list.length, 0)).toBe(cards.length);
  });

  it('空数组返回空 Map', () => {
    expect(countByRank([]).size).toBe(0);
    expect(groupByRank([]).size).toBe(0);
  });
});

describe('removeCards / containsAll / isSameCard', () => {
  it('removeCards 按 id 精确移除，同点数其他牌不受影响', () => {
    const cards: Card[] = hand('7 7 7 9');
    const rest: Card[] = removeCards(cards, [cards[0]]);
    expect(rest).toHaveLength(3);
    expect(rest.some((card) => card.id === cards[0].id)).toBe(false);
    expect(rest.filter((card) => card.rank === 7)).toHaveLength(2);
  });

  it('removeCards 不修改原数组', () => {
    const cards: Card[] = hand('7 7 9');
    removeCards(cards, [cards[0]]);
    expect(cards).toHaveLength(3);
  });

  it('移除不存在的牌时原样返回', () => {
    const cards: Card[] = hand('7 9');
    expect(removeCards(cards, hand('K'))).toHaveLength(2);
  });

  it('containsAll 按 id 判断归属', () => {
    const cards: Card[] = hand('7 8 9');
    expect(containsAll(cards, [cards[0], cards[2]])).toBe(true);
    expect(containsAll(cards, hand('7'))).toBe(false);
    expect(containsAll(cards, [])).toBe(true);
  });

  it('isSameCard 只看 id，不看点数', () => {
    const cards: Card[] = hand('7 7');
    expect(isSameCard(cards[0], cards[0])).toBe(true);
    expect(isSameCard(cards[0], cards[1])).toBe(false);
  });
});
