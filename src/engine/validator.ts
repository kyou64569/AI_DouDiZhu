/**
 * 出牌合法性校验。
 *
 * 校验链路：
 *   1. 牌必须全部来自手牌（按 id 精确匹配，且不得重复引用）
 *   2. 牌必须构成合法牌型
 *   3. 若场上有待压牌型，必须能压过它
 *
 * 纯函数模块，无任何副作用。
 */

import type { Card, HandPattern } from '../types/card';
import { identifyPattern } from './cardType';
import { canBeat } from './compare';

/** 校验结果。 */
export interface ValidationResult {
  /** 是否合法 */
  valid: boolean;
  /** 不合法时的中文原因；合法时为空字符串 */
  reason: string;
  /** 合法时解析出的牌型；不合法时为 null */
  pattern: HandPattern | null;
}

/** 构造校验失败结果。 */
function fail(reason: string): ValidationResult {
  return { valid: false, reason, pattern: null };
}

/** 构造校验成功结果。 */
function ok(pattern: HandPattern): ValidationResult {
  return { valid: true, reason: '', pattern };
}

/**
 * 校验待出的牌是否确实来自手牌，且没有重复引用同一张牌。
 *
 * @param hand  玩家当前手牌
 * @param cards 待出的牌
 */
export function validateOwnership(hand: Card[], cards: Card[]): ValidationResult {
  const handIds = new Set<string>(hand.map((card) => card.id));
  const seen = new Set<string>();

  for (const card of cards) {
    if (seen.has(card.id)) {
      return fail(`重复选择了同一张牌：${card.label}`);
    }
    seen.add(card.id);
    if (!handIds.has(card.id)) {
      return fail(`手牌中不存在这张牌：${card.label}`);
    }
  }

  return { valid: true, reason: '', pattern: null };
}

/**
 * 完整校验一次出牌。
 *
 * @param hand   玩家当前手牌
 * @param cards  待出的牌
 * @param target 场上待压的牌型；为 null 表示自由出牌（首出或两家均过牌）
 */
export function validatePlay(
  hand: Card[],
  cards: Card[],
  target: HandPattern | null = null,
): ValidationResult {
  if (!Array.isArray(cards) || cards.length === 0) {
    return fail('未选择任何牌');
  }

  const ownership: ValidationResult = validateOwnership(hand, cards);
  if (!ownership.valid) {
    return ownership;
  }

  const pattern: HandPattern | null = identifyPattern(cards);
  if (pattern === null) {
    return fail('所选牌不构成合法牌型');
  }

  if (target === null) {
    return ok(pattern);
  }

  if (!canBeat(pattern, target)) {
    return fail('所选牌无法压过上家出牌');
  }

  return ok(pattern);
}

/**
 * 校验「过牌」是否合法：只有场上存在待压牌型时才允许过牌。
 *
 * @param target 场上待压的牌型
 */
export function validatePass(target: HandPattern | null): ValidationResult {
  if (target === null) {
    return fail('当前为自由出牌轮，必须出牌，不能过牌');
  }
  return { valid: true, reason: '', pattern: null };
}

/**
 * 快速判断：这组牌在当前局面下能否打出。
 */
export function canPlay(
  hand: Card[],
  cards: Card[],
  target: HandPattern | null = null,
): boolean {
  return validatePlay(hand, cards, target).valid;
}
