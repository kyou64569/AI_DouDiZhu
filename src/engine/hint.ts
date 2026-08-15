/**
 * 出牌提示：枚举手牌中所有能压过目标牌型的合法组合。
 *
 * 两个核心 API：
 *   - findHints(hand, target)       → 所有能压过 target 的合法出牌（按从小到大排序）
 *   - findMinimalPlay(hand, target) → 能压过 target 的「最小」合法牌组，无解返回 null
 *
 * 所有生成的候选都会再经过 identifyPattern + canBeat 复核，杜绝生成非法组合。
 *
 * 纯函数模块，无任何副作用（不使用 Math.random / Date.now）。
 */

import { CardType } from '../types/card';
import type { Card, HandPattern } from '../types/card';
import { groupByRank } from './cards';
import { identifyPattern } from './cardType';
import { canBeat, comparePatterns } from './compare';
import {
  MAX_STRAIGHT_RANK,
  MIN_DOUBLE_STRAIGHT_LENGTH,
  MIN_PLANE_LENGTH,
  MIN_STRAIGHT_LENGTH,
  RANK_BLACK_JOKER,
  RANK_RED_JOKER,
} from './constants';
import { sortAsc } from './sort';

/** 单次提示计算最多返回的候选数量，防止组合爆炸。 */
const MAX_HINTS = 400;

/** 带牌组合枚举的上限。 */
const MAX_ATTACH_COMBOS = 80;

/** 按点数升序排列的分组视图。 */
interface RankGroup {
  rank: number;
  cards: Card[];
}

/**
 * 把手牌整理成「按点数升序 + 组内按花色稳定排序」的分组。
 */
function buildGroups(hand: Card[]): RankGroup[] {
  const map: Map<number, Card[]> = groupByRank(hand);
  const groups: RankGroup[] = [];
  map.forEach((cards, rank) => {
    groups.push({ rank, cards: sortAsc(cards) });
  });
  groups.sort((a, b) => a.rank - b.rank);
  return groups;
}

/** 从分组中按点数取牌，不存在时返回空数组。 */
function takeFromRank(groups: RankGroup[], rank: number, count: number): Card[] {
  for (const group of groups) {
    if (group.rank === rank) {
      return group.cards.length >= count ? group.cards.slice(0, count) : [];
    }
  }
  return [];
}

/**
 * 枚举 items 中所有大小为 k 的组合，通过回调消费。
 * 回调返回 false 时提前终止枚举。
 */
function forEachCombination<T>(
  items: T[],
  k: number,
  visit: (combo: T[]) => boolean,
): void {
  if (k <= 0 || k > items.length) {
    return;
  }
  const buffer: T[] = new Array<T>(k);
  let stopped = false;

  const walk = (start: number, depth: number): void => {
    if (stopped) {
      return;
    }
    if (depth === k) {
      if (!visit(buffer.slice())) {
        stopped = true;
      }
      return;
    }
    for (let i = start; i <= items.length - (k - depth); i += 1) {
      buffer[depth] = items[i];
      walk(i + 1, depth + 1);
      if (stopped) {
        return;
      }
    }
  };

  walk(0, 0);
}

/** 生成候选牌组的唯一签名，用于去重（按点数多重集）。 */
function signatureOf(cards: Card[]): string {
  return cards
    .map((card) => card.rank)
    .sort((a, b) => a - b)
    .join(',');
}

/** 收集器：负责去重与容量控制。 */
class HintCollector {
  private readonly seen = new Set<string>();

  private readonly results: Card[][] = [];

  /** 添加一个候选，返回是否仍可继续添加。 */
  public add(cards: Card[]): boolean {
    if (this.results.length >= MAX_HINTS) {
      return false;
    }
    const key: string = signatureOf(cards);
    if (this.seen.has(key)) {
      return true;
    }
    this.seen.add(key);
    this.results.push(cards);
    return this.results.length < MAX_HINTS;
  }

  /** 是否已达上限。 */
  public isFull(): boolean {
    return this.results.length >= MAX_HINTS;
  }

  /** 取出全部结果。 */
  public values(): Card[][] {
    return this.results;
  }
}

/** 找出所有「count 张同点数」的组合（可选最小点数下限）。 */
function collectSameRank(
  groups: RankGroup[],
  count: number,
  minRankExclusive: number,
  collector: HintCollector,
): void {
  for (const group of groups) {
    if (group.rank <= minRankExclusive) {
      continue;
    }
    if (group.cards.length >= count) {
      if (!collector.add(group.cards.slice(0, count))) {
        return;
      }
    }
  }
}

/**
 * 找出所有连续牌型主体：needPerRank 张 × length 组连续点数。
 *
 * @param needPerRank 每个点数需要的张数（顺子 1 / 连对 2 / 飞机 3）
 * @param length      连续组数
 * @param minTopRank  主牌点数下限（不含）；传 0 表示不限制
 * @returns 所有主体候选（每项为已按点数升序排列的牌）
 */
function collectConsecutiveBodies(
  groups: RankGroup[],
  needPerRank: number,
  length: number,
  minTopRank: number,
): Card[][] {
  const bodies: Card[][] = [];
  const available: number[] = groups
    .filter((group) => group.cards.length >= needPerRank && group.rank <= MAX_STRAIGHT_RANK)
    .map((group) => group.rank)
    .sort((a, b) => a - b);

  if (available.length < length) {
    return bodies;
  }

  const availableSet = new Set<number>(available);

  for (const startRank of available) {
    const topRank: number = startRank + length - 1;
    if (topRank > MAX_STRAIGHT_RANK) {
      continue;
    }
    if (topRank <= minTopRank) {
      continue;
    }
    let complete = true;
    for (let r = startRank; r <= topRank; r += 1) {
      if (!availableSet.has(r)) {
        complete = false;
        break;
      }
    }
    if (!complete) {
      continue;
    }
    const body: Card[] = [];
    for (let r = startRank; r <= topRank; r += 1) {
      const picked: Card[] = takeFromRank(groups, r, needPerRank);
      for (const card of picked) {
        body.push(card);
      }
    }
    bodies.push(body);
  }

  return bodies;
}

/** 从手牌中排除指定牌后剩余的分组。 */
function excludeCards(groups: RankGroup[], excluded: Card[]): RankGroup[] {
  const excludedIds = new Set<string>(excluded.map((card) => card.id));
  const rest: RankGroup[] = [];
  for (const group of groups) {
    const remain: Card[] = group.cards.filter((card) => !excludedIds.has(card.id));
    if (remain.length > 0) {
      rest.push({ rank: group.rank, cards: remain });
    }
  }
  return rest;
}

/**
 * 为「带单张」牌型枚举附加牌：从剩余牌中挑 count 张。
 * 按点数升序优先，保证最先产出的组合最「省」。
 */
function collectSingleAttachments(rest: RankGroup[], count: number): Card[][] {
  const flat: Card[] = [];
  for (const group of rest) {
    for (const card of group.cards) {
      flat.push(card);
    }
  }
  flat.sort((a, b) => a.rank - b.rank);

  const combos: Card[][] = [];
  const seen = new Set<string>();
  forEachCombination(flat, count, (combo) => {
    const key: string = signatureOf(combo);
    if (!seen.has(key)) {
      seen.add(key);
      combos.push(combo);
    }
    return combos.length < MAX_ATTACH_COMBOS;
  });
  return combos;
}

/**
 * 为「带对子」牌型枚举附加牌：从剩余牌中挑 count 个对子。
 */
function collectPairAttachments(rest: RankGroup[], count: number): Card[][] {
  const pairRanks: RankGroup[] = rest
    .filter((group) => group.cards.length >= 2)
    .sort((a, b) => a.rank - b.rank);

  const combos: Card[][] = [];
  const seen = new Set<string>();
  forEachCombination(pairRanks, count, (combo) => {
    const cards: Card[] = [];
    for (const group of combo) {
      cards.push(group.cards[0], group.cards[1]);
    }
    const key: string = signatureOf(cards);
    if (!seen.has(key)) {
      seen.add(key);
      combos.push(cards);
    }
    return combos.length < MAX_ATTACH_COMBOS;
  });
  return combos;
}

/** 组合主体与附加牌并写入收集器。 */
function combineBodyAndAttachments(
  groups: RankGroup[],
  bodies: Card[][],
  attachSize: 1 | 2,
  attachCount: number,
  collector: HintCollector,
): void {
  for (const body of bodies) {
    if (collector.isFull()) {
      return;
    }
    const rest: RankGroup[] = excludeCards(groups, body);
    const attachments: Card[][] =
      attachSize === 1
        ? collectSingleAttachments(rest, attachCount)
        : collectPairAttachments(rest, attachCount);
    for (const attach of attachments) {
      const cards: Card[] = body.concat(attach);
      if (!collector.add(cards)) {
        return;
      }
    }
  }
}

/** 收集手牌中所有炸弹。 */
function collectBombs(groups: RankGroup[], collector: HintCollector): void {
  for (const group of groups) {
    if (group.cards.length >= 4) {
      if (!collector.add(group.cards.slice(0, 4))) {
        return;
      }
    }
  }
}

/** 收集王炸（若手中同时有大小王）。 */
function collectRocket(groups: RankGroup[], collector: HintCollector): void {
  const small: Card[] = takeFromRank(groups, RANK_BLACK_JOKER, 1);
  const big: Card[] = takeFromRank(groups, RANK_RED_JOKER, 1);
  if (small.length === 1 && big.length === 1) {
    collector.add([small[0], big[0]]);
  }
}

/** 收集所有四带二候选（length 1 = 带两单，length 2 = 带两对）。 */
function collectFourWithTwo(
  groups: RankGroup[],
  minRankExclusive: number,
  attachIsPair: boolean,
  collector: HintCollector,
): void {
  const quads: Card[][] = [];
  for (const group of groups) {
    if (group.cards.length >= 4 && group.rank > minRankExclusive) {
      quads.push(group.cards.slice(0, 4));
    }
  }
  combineBodyAndAttachments(groups, quads, attachIsPair ? 2 : 1, 2, collector);
}

/**
 * 自由出牌（无需压制）时，枚举手牌中所有合法的出牌组合。
 *
 * @param hand 当前手牌
 */
export function findAllPlays(hand: Card[]): Card[][] {
  const groups: RankGroup[] = buildGroups(hand);
  const collector = new HintCollector();

  // L1：炸弹与王炸必须前置收集——MAX_HINTS 截断时若排在最后，
  // 极端手牌下唯一能压的组合会被丢弃，提示漏报炸弹
  collectBombs(groups, collector);
  collectRocket(groups, collector);

  // 单张 / 对子 / 三张
  collectSameRank(groups, 1, 0, collector);
  collectSameRank(groups, 2, 0, collector);
  collectSameRank(groups, 3, 0, collector);

  // 三带一 / 三带一对
  const triples: Card[][] = [];
  for (const group of groups) {
    if (group.cards.length >= 3) {
      triples.push(group.cards.slice(0, 3));
    }
  }
  combineBodyAndAttachments(groups, triples, 1, 1, collector);
  combineBodyAndAttachments(groups, triples, 2, 1, collector);

  // 顺子
  for (let len = MIN_STRAIGHT_LENGTH; len <= 12; len += 1) {
    const bodies: Card[][] = collectConsecutiveBodies(groups, 1, len, 0);
    for (const body of bodies) {
      if (!collector.add(body)) {
        break;
      }
    }
  }

  // 连对
  for (let len = MIN_DOUBLE_STRAIGHT_LENGTH; len <= 10; len += 1) {
    const bodies: Card[][] = collectConsecutiveBodies(groups, 2, len, 0);
    for (const body of bodies) {
      if (!collector.add(body)) {
        break;
      }
    }
  }

  // 飞机（纯 / 带单 / 带对）
  for (let len = MIN_PLANE_LENGTH; len <= 6; len += 1) {
    const bodies: Card[][] = collectConsecutiveBodies(groups, 3, len, 0);
    for (const body of bodies) {
      if (!collector.add(body)) {
        break;
      }
    }
    combineBodyAndAttachments(groups, bodies, 1, len, collector);
    combineBodyAndAttachments(groups, bodies, 2, len, collector);
  }

  // 四带二
  collectFourWithTwo(groups, 0, false, collector);
  collectFourWithTwo(groups, 0, true, collector);

  return finalize(collector.values(), null);
}

/**
 * 生成针对特定目标牌型的候选组合（尚未复核）。
 */
function generateCandidates(groups: RankGroup[], target: HandPattern): Card[][] {
  const collector = new HintCollector();
  const minRank: number = target.mainRank;
  const len: number = target.length;

  switch (target.type) {
    case CardType.SINGLE:
      collectSameRank(groups, 1, minRank, collector);
      break;

    case CardType.PAIR:
      collectSameRank(groups, 2, minRank, collector);
      break;

    case CardType.TRIPLE:
      collectSameRank(groups, 3, minRank, collector);
      break;

    case CardType.TRIPLE_WITH_SINGLE: {
      const bodies: Card[][] = [];
      for (const group of groups) {
        if (group.cards.length >= 3 && group.rank > minRank) {
          bodies.push(group.cards.slice(0, 3));
        }
      }
      combineBodyAndAttachments(groups, bodies, 1, 1, collector);
      break;
    }

    case CardType.TRIPLE_WITH_PAIR: {
      const bodies: Card[][] = [];
      for (const group of groups) {
        if (group.cards.length >= 3 && group.rank > minRank) {
          bodies.push(group.cards.slice(0, 3));
        }
      }
      combineBodyAndAttachments(groups, bodies, 2, 1, collector);
      break;
    }

    case CardType.STRAIGHT: {
      const bodies: Card[][] = collectConsecutiveBodies(groups, 1, len, minRank);
      for (const body of bodies) {
        if (!collector.add(body)) {
          break;
        }
      }
      break;
    }

    case CardType.DOUBLE_STRAIGHT: {
      const bodies: Card[][] = collectConsecutiveBodies(groups, 2, len, minRank);
      for (const body of bodies) {
        if (!collector.add(body)) {
          break;
        }
      }
      break;
    }

    case CardType.PLANE: {
      const bodies: Card[][] = collectConsecutiveBodies(groups, 3, len, minRank);
      for (const body of bodies) {
        if (!collector.add(body)) {
          break;
        }
      }
      break;
    }

    case CardType.PLANE_WITH_SINGLES: {
      const bodies: Card[][] = collectConsecutiveBodies(groups, 3, len, minRank);
      combineBodyAndAttachments(groups, bodies, 1, len, collector);
      break;
    }

    case CardType.PLANE_WITH_PAIRS: {
      const bodies: Card[][] = collectConsecutiveBodies(groups, 3, len, minRank);
      combineBodyAndAttachments(groups, bodies, 2, len, collector);
      break;
    }

    case CardType.FOUR_WITH_TWO:
      collectFourWithTwo(groups, minRank, len === 2, collector);
      break;

    case CardType.BOMB:
      // 只有更大的炸弹或王炸能压
      collectBombs(groups, collector);
      collectRocket(groups, collector);
      return collector.values();

    case CardType.ROCKET:
      // 王炸无解
      return [];

    default:
      break;
  }

  // 普通牌型：炸弹与王炸永远可压
  collectBombs(groups, collector);
  collectRocket(groups, collector);

  return collector.values();
}

/**
 * 复核候选：必须构成合法牌型，且（有目标时）确实能压过目标。
 * 最终按「从小到大」排序，炸弹/王炸排在最后。
 */
function finalize(candidates: Card[][], target: HandPattern | null): Card[][] {
  const valid: Array<{ cards: Card[]; pattern: HandPattern }> = [];

  for (const cards of candidates) {
    const pattern: HandPattern | null = identifyPattern(cards);
    if (pattern === null) {
      continue;
    }
    if (target !== null && !canBeat(pattern, target)) {
      continue;
    }
    valid.push({ cards: sortAsc(cards), pattern });
  }

  valid.sort((a, b) => {
    const diff: number = comparePatterns(a.pattern, b.pattern);
    if (diff !== 0) {
      return diff;
    }
    return a.cards.length - b.cards.length;
  });

  return valid.map((item) => item.cards);
}

/**
 * 找出手牌中所有能压过 target 的合法出牌组合。
 *
 * @param hand   当前手牌
 * @param target 场上待压的牌型；传 null 表示自由出牌，返回所有合法组合
 * @returns 按「从小到大」排序的候选列表；无解时返回空数组
 */
export function findHints(hand: Card[], target: HandPattern | null): Card[][] {
  if (!Array.isArray(hand) || hand.length === 0) {
    return [];
  }
  if (target === null) {
    return findAllPlays(hand);
  }
  const groups: RankGroup[] = buildGroups(hand);
  return finalize(generateCandidates(groups, target), target);
}

/**
 * 找出能压过 target 的「最小」合法牌组。
 *
 * 排序优先级：普通牌型 → 炸弹 → 王炸；同级别按 mainRank 升序、张数升序。
 * 后续 AI 兜底策略会复用该方法。
 *
 * @param hand   当前手牌
 * @param target 场上待压的牌型；传 null 表示自由出牌，返回最小的一手牌
 * @returns 最小合法牌组；无解返回 null
 */
export function findMinimalPlay(hand: Card[], target: HandPattern | null): Card[] | null {
  const hints: Card[][] = findHints(hand, target);
  if (hints.length === 0) {
    return null;
  }
  return hints[0];
}

/**
 * 判断手牌中是否存在能压过 target 的组合。
 */
export function hasPlayableHint(hand: Card[], target: HandPattern | null): boolean {
  return findMinimalPlay(hand, target) !== null;
}
