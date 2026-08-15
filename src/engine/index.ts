/**
 * 斗地主规则引擎统一出口。
 *
 * 使用方式：
 *   import { identifyPattern, canBeat, findHints } from '@/engine';
 *
 * 引擎内所有模块均为纯函数，不依赖 React / zustand / localStorage / fetch，
 * 不调用 Math.random() 与 Date.now()，随机源一律由外部注入。
 */

// ---------- 类型 ----------
export { CardType } from '../types/card';
export type { Card, HandPattern, Suit } from '../types/card';

// ---------- 常量 ----------
export {
  BID_OPTIONS,
  BOTTOM_CARD_COUNT,
  DECK_SIZE,
  HAND_SIZE,
  MAX_BID,
  MAX_NORMAL_RANK,
  MAX_STRAIGHT_RANK,
  MIN_DOUBLE_STRAIGHT_LENGTH,
  MIN_PLANE_LENGTH,
  MIN_RANK,
  MIN_STRAIGHT_LENGTH,
  PLAYER_COUNT,
  RANK_BLACK_JOKER,
  RANK_LABELS,
  RANK_RED_JOKER,
  SUITS,
  SUIT_ORDER,
  SUIT_SYMBOLS,
  getRankLabel,
} from './constants';

// ---------- 牌堆 / 发牌 ----------
export {
  containsAll,
  countByRank,
  createDeck,
  createShuffledDeal,
  deal,
  groupByRank,
  isSameCard,
  removeCards,
  shuffle,
} from './cards';
export type { DealResult } from './cards';

// ---------- 牌型识别 ----------
export {
  CARD_TYPE_NAMES,
  getCardTypeName,
  identifyPattern,
  isBombLike,
  isConsecutiveRanks,
  isValidPattern,
} from './cardType';

// ---------- 大小比较 ----------
export { canBeat, canBeatCards, comparePatterns, getPatternPower } from './compare';

// ---------- 出牌校验 ----------
export { canPlay, validateOwnership, validatePass, validatePlay } from './validator';
export type { ValidationResult } from './validator';

// ---------- 出牌提示 ----------
export { findAllPlays, findHints, findMinimalPlay, hasPlayableHint } from './hint';

// ---------- 结算 ----------
export {
  calculateMultiplier,
  calculateSettlement,
  countBombs,
  countEffectivePlays,
  countRockets,
  findWinnerSeat,
  isAntiSpring,
  isLandlordWin,
  isSpring,
} from './score';
export type { SettlementInput, SettlementPlay } from './score';

// ---------- 叫分 ----------
export {
  getHighestBid,
  getLegalBids,
  getNextBidder,
  isBiddingFinished,
  isLegalBid,
  resolveBidding,
  runBidding,
  toBidScore,
  toSeatIndex,
} from './bidding';
export type { BiddingResult } from './bidding';

// ---------- 排序 ----------
export {
  distinctRanks,
  formatCards,
  sortAsc,
  sortByGroupSize,
  sortCards,
  sortDesc,
} from './sort';
export type { SortOrder } from './sort';
