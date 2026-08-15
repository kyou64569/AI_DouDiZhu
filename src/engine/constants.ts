/**
 * 规则引擎常量表。
 *
 * 纯数据模块，不含任何副作用，不引用 React / zustand / Math.random / Date。
 */

import type { Suit } from '../types/card';

/** 普通牌（非王）的四种花色，发牌时按此顺序遍历。 */
export const SUITS: readonly Suit[] = ['SPADE', 'HEART', 'CLUB', 'DIAMOND'] as const;

/** 最小点数（3）。 */
export const MIN_RANK = 3;

/** 普通牌最大点数（2 = 15）。 */
export const MAX_NORMAL_RANK = 15;

/** 小王点数。 */
export const RANK_BLACK_JOKER = 16;

/** 大王点数。 */
export const RANK_RED_JOKER = 17;

/**
 * 连续牌型（顺子 / 连对 / 飞机）允许的最大点数 —— A（14）。
 * 2（15）、小王（16）、大王（17）永远不参与连续牌型。
 */
export const MAX_STRAIGHT_RANK = 14;

/** 顺子最少张数。 */
export const MIN_STRAIGHT_LENGTH = 5;

/** 连对最少对数。 */
export const MIN_DOUBLE_STRAIGHT_LENGTH = 3;

/** 飞机最少三张组数。 */
export const MIN_PLANE_LENGTH = 2;

/** 一副牌总张数。 */
export const DECK_SIZE = 54;

/** 每位玩家的手牌数量。 */
export const HAND_SIZE = 17;

/** 底牌数量。 */
export const BOTTOM_CARD_COUNT = 3;

/** 玩家人数。 */
export const PLAYER_COUNT = 3;

/** 点数 → 展示文案 的映射表。 */
export const RANK_LABELS: Readonly<Record<number, string>> = {
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
  15: '2',
  16: '小王',
  17: '大王',
};

/** 花色 → Unicode 符号，供 UI 展示复用。 */
export const SUIT_SYMBOLS: Readonly<Record<Suit, string>> = {
  SPADE: '♠',
  HEART: '♥',
  CLUB: '♣',
  DIAMOND: '♦',
  JOKER: '🃏',
};

/**
 * 花色排序权重（数值越小越靠前），用于同点数牌的稳定排序。
 */
export const SUIT_ORDER: Readonly<Record<Suit, number>> = {
  JOKER: 0,
  SPADE: 1,
  HEART: 2,
  CLUB: 3,
  DIAMOND: 4,
};

/** 合法的叫分选项（0 表示不叫）。 */
export const BID_OPTIONS: readonly number[] = [0, 1, 2, 3] as const;

/** 最高叫分。 */
export const MAX_BID = 3;

/** 获取一个点数的展示文案，未知点数回退为字符串数字。 */
export function getRankLabel(rank: number): string {
  return RANK_LABELS[rank] ?? String(rank);
}
