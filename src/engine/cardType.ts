/**
 * 牌型识别：把一组牌解析成 HandPattern。
 *
 * 判定顺序至关重要（详见 identifyPattern 内注释）：
 *   1. 王炸（ROCKET）最先，避免被当成两张单牌处理
 *   2. 四张同点数必须先判 BOMB，绝不能落进三带一分支
 *   3. 8 张牌先判「四带两对」再判「飞机带对」，10 张牌先排除四张再判飞机
 *   4. 顺子 / 连对 / 飞机主体必须显式过滤 rank >= 15（2、小王、大王不参与连续牌型）
 *
 * 纯函数模块，无任何副作用。
 */

import { CardType } from '../types/card';
import type { Card, HandPattern } from '../types/card';
import { groupByRank } from './cards';
import {
  MAX_STRAIGHT_RANK,
  MIN_DOUBLE_STRAIGHT_LENGTH,
  MIN_PLANE_LENGTH,
  MIN_STRAIGHT_LENGTH,
  RANK_BLACK_JOKER,
  RANK_RED_JOKER,
} from './constants';

/** 点数 → 该点数的张数，且按点数升序排列的条目。 */
interface RankBucket {
  rank: number;
  count: number;
}

/**
 * 把牌按点数聚合并按点数升序排序。
 */
function toBuckets(cards: Card[]): RankBucket[] {
  const groups: Map<number, Card[]> = groupByRank(cards);
  const buckets: RankBucket[] = [];
  groups.forEach((list, rank) => {
    buckets.push({ rank, count: list.length });
  });
  buckets.sort((a, b) => a.rank - b.rank);
  return buckets;
}

/**
 * 判断一组点数是否连续，且全部 <= MAX_STRAIGHT_RANK（A）。
 * 这是顺子 / 连对 / 飞机的公共前置校验。
 *
 * @param ranks 已升序排列且互不相同的点数数组
 */
export function isConsecutiveRanks(ranks: number[]): boolean {
  if (ranks.length === 0) {
    return false;
  }
  for (const rank of ranks) {
    // 铁律：2（15）、小王（16）、大王（17）绝不参与任何连续牌型
    if (rank > MAX_STRAIGHT_RANK) {
      return false;
    }
  }
  for (let i = 1; i < ranks.length; i += 1) {
    if (ranks[i] !== ranks[i - 1] + 1) {
      return false;
    }
  }
  return true;
}

/** 构造 HandPattern 的小助手。 */
function makePattern(
  type: CardType,
  mainRank: number,
  length: number,
  cards: Card[],
): HandPattern {
  return { type, mainRank, length, cards };
}

/** 是否为王炸：恰好大王 + 小王。 */
function isRocket(cards: Card[]): boolean {
  if (cards.length !== 2) {
    return false;
  }
  const ranks: number[] = cards.map((c) => c.rank).sort((a, b) => a - b);
  return ranks[0] === RANK_BLACK_JOKER && ranks[1] === RANK_RED_JOKER;
}

/**
 * 从 buckets 中取出指定张数的点数集合。
 *
 * @param buckets 聚合结果
 * @param count   目标张数（1/2/3/4）
 */
function ranksWithCount(buckets: RankBucket[], count: number): number[] {
  return buckets.filter((b) => b.count === count).map((b) => b.rank);
}

/**
 * 在给定点数集合中找出「最长的连续段」；若整体不连续则返回空数组。
 * 用于飞机主体识别（要求三张部分整体连续）。
 */
function allConsecutive(ranks: number[]): boolean {
  const sorted: number[] = ranks.slice().sort((a, b) => a - b);
  return isConsecutiveRanks(sorted);
}

/**
 * 识别牌型。无法识别时返回 null。
 *
 * @param cards 待识别的牌（不要求已排序）
 */
export function identifyPattern(cards: Card[]): HandPattern | null {
  if (!Array.isArray(cards) || cards.length === 0) {
    return null;
  }

  const total: number = cards.length;

  // ---------- 1. 王炸最优先 ----------
  if (isRocket(cards)) {
    return makePattern(CardType.ROCKET, RANK_RED_JOKER, 1, cards);
  }

  const buckets: RankBucket[] = toBuckets(cards);
  const quadRanks: number[] = ranksWithCount(buckets, 4);
  const tripleRanks: number[] = ranksWithCount(buckets, 3);
  const pairRanks: number[] = ranksWithCount(buckets, 2);
  const singleRanks: number[] = ranksWithCount(buckets, 1);

  // ---------- 2. 炸弹：4 张同点数，必须在三带一之前判定 ----------
  if (total === 4 && quadRanks.length === 1) {
    return makePattern(CardType.BOMB, quadRanks[0], 1, cards);
  }

  // ---------- 3. 基础牌型 ----------
  if (total === 1) {
    return makePattern(CardType.SINGLE, cards[0].rank, 1, cards);
  }

  if (total === 2) {
    if (pairRanks.length === 1) {
      return makePattern(CardType.PAIR, pairRanks[0], 1, cards);
    }
    return null;
  }

  if (total === 3) {
    if (tripleRanks.length === 1) {
      return makePattern(CardType.TRIPLE, tripleRanks[0], 1, cards);
    }
    return null;
  }

  // ---------- 4. 三带一（4 张，且此时已确认不是炸弹） ----------
  if (total === 4) {
    if (tripleRanks.length === 1 && singleRanks.length === 1) {
      return makePattern(CardType.TRIPLE_WITH_SINGLE, tripleRanks[0], 1, cards);
    }
    return null;
  }

  // ---------- 5. 三带一对（5 张） ----------
  if (total === 5 && tripleRanks.length === 1 && pairRanks.length === 1) {
    return makePattern(CardType.TRIPLE_WITH_PAIR, tripleRanks[0], 1, cards);
  }

  // ---------- 6. 四带二：四带两单（6 张） / 四带两对（8 张） ----------
  //    必须放在「飞机带对」之前，避免 8 张牌被误判
  if (quadRanks.length === 1) {
    const quadRank: number = quadRanks[0];

    // 四带两张单牌（两张单牌不能是同一对，允许是一对吗？标准规则允许带一对拆成两张，
    // 这里统一按「剩余 2 张任意牌」处理）
    if (total === 6 && buckets.length >= 2) {
      const restCount: number = total - 4;
      if (restCount === 2) {
        return makePattern(CardType.FOUR_WITH_TWO, quadRank, 1, cards);
      }
    }

    // 四带两对（8 张）
    if (total === 8 && pairRanks.length === 2) {
      return makePattern(CardType.FOUR_WITH_TWO, quadRank, 2, cards);
    }
  }

  // ---------- 7. 顺子：≥5 张，全为单张，连续，且 <= A ----------
  if (
    total >= MIN_STRAIGHT_LENGTH &&
    singleRanks.length === total &&
    isConsecutiveRanks(singleRanks)
  ) {
    return makePattern(
      CardType.STRAIGHT,
      singleRanks[singleRanks.length - 1],
      total,
      cards,
    );
  }

  // ---------- 8. 连对：≥3 个连续对子，且 <= A ----------
  if (
    total >= MIN_DOUBLE_STRAIGHT_LENGTH * 2 &&
    total % 2 === 0 &&
    pairRanks.length === total / 2 &&
    isConsecutiveRanks(pairRanks)
  ) {
    return makePattern(
      CardType.DOUBLE_STRAIGHT,
      pairRanks[pairRanks.length - 1],
      pairRanks.length,
      cards,
    );
  }

  // ---------- 9. 飞机系列：三张部分必须 ≥2 组且连续、<= A ----------
  const planePattern: HandPattern | null = identifyPlane(
    cards,
    total,
    tripleRanks,
    pairRanks,
    singleRanks,
    quadRanks,
  );
  if (planePattern !== null) {
    return planePattern;
  }

  return null;
}

/**
 * 飞机（含带牌）识别。
 *
 * 三种形态：
 *   - PLANE：            3n 张，全为连续三张
 *   - PLANE_WITH_SINGLES：4n 张，n 组连续三张 + n 张单牌
 *   - PLANE_WITH_PAIRS：  5n 张，n 组连续三张 + n 个对子
 */
function identifyPlane(
  cards: Card[],
  total: number,
  tripleRanks: number[],
  pairRanks: number[],
  singleRanks: number[],
  quadRanks: number[],
): HandPattern | null {
  // 出现四张同点数时，只有「四张可拆成三张+单张」的极端情况，
  // 为避免歧义与误判，统一不把含四张的牌组识别为飞机。
  if (quadRanks.length > 0) {
    return null;
  }

  const groupCount: number = tripleRanks.length;
  if (groupCount < MIN_PLANE_LENGTH) {
    return null;
  }
  if (!allConsecutive(tripleRanks)) {
    return null;
  }

  const sortedTriples: number[] = tripleRanks.slice().sort((a, b) => a - b);
  const mainRank: number = sortedTriples[sortedTriples.length - 1];

  // 纯飞机
  if (total === groupCount * 3) {
    return makePattern(CardType.PLANE, mainRank, groupCount, cards);
  }

  // 飞机带单：额外 groupCount 张任意牌（可以是单牌，也可以是拆开的对子）
  if (total === groupCount * 4) {
    const attachCount: number = singleRanks.length + pairRanks.length * 2;
    if (attachCount === groupCount) {
      return makePattern(CardType.PLANE_WITH_SINGLES, mainRank, groupCount, cards);
    }
  }

  // 飞机带对：额外 groupCount 个对子
  if (total === groupCount * 5) {
    if (pairRanks.length === groupCount && singleRanks.length === 0) {
      return makePattern(CardType.PLANE_WITH_PAIRS, mainRank, groupCount, cards);
    }
  }

  return null;
}

/** 便捷判断：这组牌是否构成合法牌型。 */
export function isValidPattern(cards: Card[]): boolean {
  return identifyPattern(cards) !== null;
}

/** 便捷判断：该牌型是否为炸弹类（BOMB 或 ROCKET）。 */
export function isBombLike(pattern: HandPattern): boolean {
  return pattern.type === CardType.BOMB || pattern.type === CardType.ROCKET;
}

/** 牌型的中文名称，供 UI 与 AI 提示词复用。 */
export const CARD_TYPE_NAMES: Readonly<Record<CardType, string>> = {
  [CardType.SINGLE]: '单张',
  [CardType.PAIR]: '对子',
  [CardType.TRIPLE]: '三张',
  [CardType.TRIPLE_WITH_SINGLE]: '三带一',
  [CardType.TRIPLE_WITH_PAIR]: '三带一对',
  [CardType.STRAIGHT]: '顺子',
  [CardType.DOUBLE_STRAIGHT]: '连对',
  [CardType.PLANE]: '飞机',
  [CardType.PLANE_WITH_SINGLES]: '飞机带单',
  [CardType.PLANE_WITH_PAIRS]: '飞机带对',
  [CardType.FOUR_WITH_TWO]: '四带二',
  [CardType.BOMB]: '炸弹',
  [CardType.ROCKET]: '王炸',
};

/** 取牌型的中文名。 */
export function getCardTypeName(type: CardType): string {
  return CARD_TYPE_NAMES[type] ?? '未知牌型';
}
