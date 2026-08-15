/**
 * 测试专用工具：用紧凑文本构造牌，避免每个用例手写 Card 字面量。
 *
 * 记号约定（与 src/types/card.ts 的 rank 编码保持一致）：
 *   3~10 → 3~10 | J=11 | Q=12 | K=13 | A=14 | 2=15 | BJ=小王(16) | RJ=大王(17)
 *
 * 例：hand('3 3 3 4 BJ RJ') → 6 张牌，同点数的牌花色不同、id 互不相同。
 */

import type { Card, HandPattern, Suit } from '@/types/card';
import { RANK_BLACK_JOKER, RANK_RED_JOKER, getRankLabel } from '@/engine/constants';
import { identifyPattern } from '@/engine/cardType';

/** 文本记号 → rank 映射。 */
const TOKEN_RANK: Readonly<Record<string, number>> = {
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  J: 11,
  Q: 12,
  K: 13,
  A: 14,
  '2': 15,
  BJ: RANK_BLACK_JOKER,
  RJ: RANK_RED_JOKER,
};

/** 普通牌花色循环表，保证同点数多张时 id 与花色都不重复。 */
const NORMAL_SUITS: readonly Suit[] = ['SPADE', 'HEART', 'CLUB', 'DIAMOND'];

/** 全局自增序号，保证任意两次 makeCard 产出的 id 都不同。 */
let seq = 0;

/** 把文本记号转成 rank；无法识别时直接抛错（测试数据写错应当立刻暴露）。 */
export function tokenToRank(token: string): number {
  const rank: number | undefined = TOKEN_RANK[token.toUpperCase()];
  if (rank === undefined) {
    throw new Error(`测试数据错误：无法识别的牌面记号 "${token}"`);
  }
  return rank;
}

/** 构造单张牌。 */
export function makeCard(rank: number, suit?: Suit): Card {
  const actualSuit: Suit = suit ?? (rank >= RANK_BLACK_JOKER ? 'JOKER' : 'SPADE');
  seq += 1;
  return {
    id: `${actualSuit}-${rank}-t${seq}`,
    suit: actualSuit,
    rank,
    label: getRankLabel(rank),
  };
}

/** 用紧凑文本构造一组牌，如 hand('3 3 4 BJ')。 */
export function hand(spec: string): Card[] {
  const used = new Map<number, number>();
  return spec
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0)
    .map((token) => {
      const rank: number = tokenToRank(token);
      const seen: number = used.get(rank) ?? 0;
      used.set(rank, seen + 1);
      const suit: Suit = rank >= RANK_BLACK_JOKER ? 'JOKER' : NORMAL_SUITS[seen % NORMAL_SUITS.length];
      return makeCard(rank, suit);
    });
}

/** 构造牌型；无法识别时抛错（用于「已知合法」的测试夹具）。 */
export function pattern(spec: string): HandPattern {
  const parsed: HandPattern | null = identifyPattern(hand(spec));
  if (parsed === null) {
    throw new Error(`测试数据错误："${spec}" 不构成合法牌型`);
  }
  return parsed;
}

/** 取出一组牌的 rank 并升序排列，便于断言。 */
export function ranksOf(cards: readonly Card[]): number[] {
  return cards.map((card) => card.rank).sort((a, b) => a - b);
}

/** 生成「点数多重集」签名，如 [3,3,13] → "3,3,13"。 */
export function signature(cards: readonly Card[]): string {
  return ranksOf(cards).join(',');
}

/** 判断 cards 是否全部是 source 里的【同一对象引用】。 */
export function isSubsetByIdentity(source: readonly Card[], cards: readonly Card[]): boolean {
  return cards.every((card) => source.includes(card));
}

/**
 * 确定性伪随机源（mulberry32）。同 seed 必然产出同一串数字，
 * 用于验证洗牌可复现性。
 */
export function seededRng(seed: number): () => number {
  let state: number = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t: number = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
