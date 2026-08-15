/**
 * 牌型大小比较。
 *
 * 核心规则：
 *   1. ROCKET（王炸）压一切
 *   2. BOMB 压除 ROCKET 外的一切；BOMB vs BOMB 比 mainRank
 *   3. 其余牌型必须 type 相同且 length 相同才可比，再比 mainRank
 *      —— 5 张顺子压不过 6 张顺子
 *
 * 纯函数模块，无任何副作用。
 */

import { CardType } from '../types/card';
import type { Card, HandPattern } from '../types/card';
import { identifyPattern } from './cardType';

/**
 * 判断 candidate 是否能击败 target。
 *
 * @param candidate 待出的牌型
 * @param target 要压制的牌型
 * @returns 能击败返回 true；任一参数为 null（牌型识别失败；自由出牌场景不经过本函数）时返回 false
 */
export function canBeat(candidate: HandPattern | null, target: HandPattern | null): boolean {
  // Null check for defensive programming: pattern identification can fail and return null
  if (candidate === null || target === null) {
    return false;
  }

  // 1. 王炸压一切（王炸对王炸不可能出现，一副牌只有一副王）
  if (candidate.type === CardType.ROCKET) {
    return target.type !== CardType.ROCKET;
  }

  // 2. 对方是王炸，谁也压不过
  if (target.type === CardType.ROCKET) {
    return false;
  }

  // 3. 炸弹
  if (candidate.type === CardType.BOMB) {
    if (target.type === CardType.BOMB) {
      return candidate.mainRank > target.mainRank;
    }
    // 炸弹压所有非炸弹牌型
    return true;
  }

  // 4. 对方是炸弹而自己不是，压不过
  if (target.type === CardType.BOMB) {
    return false;
  }

  // 5. 普通牌型：类型与长度都必须一致（5 张顺子压不过 6 张；
  //    四带两单/四带两对形态不同不可互压——项目规则口径，见 tests/engine/compare.test.ts）
  if (candidate.type !== target.type) {
    return false;
  }
  if (candidate.length !== target.length) {
    return false;
  }

  return candidate.mainRank > target.mainRank;
}

/**
 * 直接用原始卡牌数组比较。任一方不构成合法牌型时返回 false。
 */
export function canBeatCards(candidateCards: Card[], targetCards: Card[]): boolean {
  const candidate: HandPattern | null = identifyPattern(candidateCards);
  const target: HandPattern | null = identifyPattern(targetCards);
  if (candidate === null || target === null) {
    return false;
  }
  return canBeat(candidate, target);
}

/**
 * 牌型的「强度权重」，用于 AI 排序与提示排序。
 * 数值越大越强：普通牌型 < 炸弹 < 王炸。
 */
export function getPatternPower(pattern: HandPattern): number {
  if (pattern.type === CardType.ROCKET) {
    return 100000;
  }
  if (pattern.type === CardType.BOMB) {
    return 10000 + pattern.mainRank;
  }
  return pattern.mainRank * 10 + pattern.length;
}

/**
 * 按「从小到大」的顺序比较两个同类型牌型。
 * 返回负数表示 a < b，0 表示相等，正数表示 a > b。
 * 供 Array.prototype.sort 使用。
 */
export function comparePatterns(a: HandPattern, b: HandPattern): number {
  const powerDiff: number = getPatternPower(a) - getPatternPower(b);
  if (powerDiff !== 0) {
    return powerDiff;
  }
  // 强度相同时，牌少的排前面（出牌更「省」）
  return a.cards.length - b.cards.length;
}
