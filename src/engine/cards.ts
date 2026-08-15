/**
 * 牌堆构造、洗牌与发牌。
 *
 * 纯函数模块：随机源一律通过参数注入（rng: () => number），
 * 内部绝不调用 Math.random() / Date.now()，保证 QA 可写确定性测试。
 */

import type { Card, Suit } from '../types/card';
import {
  BOTTOM_CARD_COUNT,
  DECK_SIZE,
  HAND_SIZE,
  MAX_NORMAL_RANK,
  MIN_RANK,
  PLAYER_COUNT,
  RANK_BLACK_JOKER,
  RANK_RED_JOKER,
  SUITS,
  getRankLabel,
} from './constants';

/** 发牌结果。 */
export interface DealResult {
  /** 三位玩家的手牌，索引 0/1/2 对应座位号 */
  hands: Card[][];
  /** 三张底牌 */
  bottomCards: Card[];
}

/**
 * 生成一张牌的唯一 id。
 * 不使用随机数或时间戳，改用「花色-点数-序号」保证确定性与唯一性。
 */
function makeCardId(suit: Suit, rank: number, seq: number): string {
  return `${suit}-${rank}-${seq.toString(36).padStart(2, '0')}`;
}

/**
 * 创建一副完整的 54 张扑克牌（52 张普通牌 + 大小王）。
 *
 * @returns 有序的新牌堆，每张牌 id 唯一。
 */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  let seq = 0;

  for (let rank = MIN_RANK; rank <= MAX_NORMAL_RANK; rank += 1) {
    for (const suit of SUITS) {
      deck.push({
        id: makeCardId(suit, rank, seq),
        suit,
        rank,
        label: getRankLabel(rank),
      });
      seq += 1;
    }
  }

  deck.push({
    id: makeCardId('JOKER', RANK_BLACK_JOKER, seq),
    suit: 'JOKER',
    rank: RANK_BLACK_JOKER,
    label: getRankLabel(RANK_BLACK_JOKER),
  });
  seq += 1;

  deck.push({
    id: makeCardId('JOKER', RANK_RED_JOKER, seq),
    suit: 'JOKER',
    rank: RANK_RED_JOKER,
    label: getRankLabel(RANK_RED_JOKER),
  });

  return deck;
}

/**
 * Fisher-Yates 洗牌。不修改入参，返回新数组。
 *
 * @param deck 待洗的牌堆
 * @param rng  随机源，需返回 [0, 1) 之间的数；必须由调用方注入
 * @returns 洗好的新数组
 */
export function shuffle(deck: Card[], rng: () => number): Card[] {
  const result: Card[] = deck.slice();
  for (let i = result.length - 1; i > 0; i -= 1) {
    const raw: number = rng();
    // 防御性处理：把随机值夹在 [0, 1) 区间内，避免越界索引
    const bounded: number = Number.isFinite(raw) ? Math.min(Math.max(raw, 0), 0.999999999) : 0;
    const j: number = Math.floor(bounded * (i + 1));
    const tmp: Card = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}

/**
 * 发牌：三家各 17 张，剩余 3 张为底牌。
 *
 * @param deck 已洗好的 54 张牌
 * @throws 当牌堆张数不等于 54 时抛出错误
 */
export function deal(deck: Card[]): DealResult {
  if (deck.length !== DECK_SIZE) {
    throw new Error(`发牌失败：牌堆应为 ${DECK_SIZE} 张，实际 ${deck.length} 张`);
  }

  const hands: Card[][] = [];
  for (let seat = 0; seat < PLAYER_COUNT; seat += 1) {
    hands.push(deck.slice(seat * HAND_SIZE, (seat + 1) * HAND_SIZE));
  }

  const bottomCards: Card[] = deck.slice(PLAYER_COUNT * HAND_SIZE, DECK_SIZE);
  if (bottomCards.length !== BOTTOM_CARD_COUNT) {
    throw new Error(`发牌失败：底牌应为 ${BOTTOM_CARD_COUNT} 张，实际 ${bottomCards.length} 张`);
  }

  return { hands, bottomCards };
}

/**
 * 一步完成「建堆 → 洗牌 → 发牌」。
 *
 * @param rng 注入的随机源
 */
export function createShuffledDeal(rng: () => number): DealResult {
  return deal(shuffle(createDeck(), rng));
}

/**
 * 统计每个点数出现的次数。
 *
 * @returns Map<rank, count>
 */
export function countByRank(cards: Card[]): Map<number, number> {
  const counter = new Map<number, number>();
  for (const card of cards) {
    counter.set(card.rank, (counter.get(card.rank) ?? 0) + 1);
  }
  return counter;
}

/**
 * 按点数分组。
 *
 * @returns Map<rank, Card[]>
 */
export function groupByRank(cards: Card[]): Map<number, Card[]> {
  const groups = new Map<number, Card[]>();
  for (const card of cards) {
    const bucket: Card[] = groups.get(card.rank) ?? [];
    bucket.push(card);
    groups.set(card.rank, bucket);
  }
  return groups;
}

/** 判断两张牌是否为同一张（按 id 比较）。 */
export function isSameCard(a: Card, b: Card): boolean {
  return a.id === b.id;
}

/**
 * 从手牌中移除指定的牌（按 id 精确匹配），返回新数组。
 *
 * @param hand    原手牌
 * @param removed 要移除的牌
 */
export function removeCards(hand: Card[], removed: Card[]): Card[] {
  const removedIds = new Set<string>(removed.map((card) => card.id));
  return hand.filter((card) => !removedIds.has(card.id));
}

/** 判断 cards 是否全部包含在 hand 中（按 id）。 */
export function containsAll(hand: Card[], cards: Card[]): boolean {
  const handIds = new Set<string>(hand.map((card) => card.id));
  return cards.every((card) => handIds.has(card.id));
}
