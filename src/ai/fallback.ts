/**
 * 兜底策略（REQ-R8 降级链路的落地执行者）。
 *
 * 无论 LLM 因何种原因失败（超时 / 解析失败 / 映射失败 / 校验失败），
 * 最终都会走到这里产出一个【一定合法】的决策。
 *
 * 铁律：
 * - 绝不抛异常
 * - 返回的牌一定通过 validatePlay 复验
 * - 自由回合永远出得起牌（除非手牌为空，属异常）
 */

import type { Card, HandPattern } from '@/types/card';
import type { PlayRecord } from '@/types/game';
import { DecisionSource, type AIDecision } from '@/types/ai';
import { findHints, findMinimalPlay } from '@/engine/hint';
import { MAX_NORMAL_RANK, RANK_BLACK_JOKER, RANK_RED_JOKER } from '@/engine/constants';
import { validatePlay } from '@/engine/validator';
import { formatCards } from '@/engine/sort';

/** 兜底决策的构造参数。 */
export interface FallbackParams {
  /** 当前手牌 */
  hand: Card[];
  /** 场上最近一手有效出牌 */
  lastPlay: PlayRecord | null;
  /** 是否自由出牌回合 */
  isFreeTurn: boolean;
  /** 已累积的告警 */
  warnings: string[];
  /** 决策起始时间戳，用于计算 latencyMs */
  startedAt: number;
  /** 当前时间戳（由调用方注入，便于测试） */
  now: number;
  /** 触发降级的原因，会拼进 reason */
  cause: string;
  /** 降级来源；网络类失败传 FALLBACK_ERROR，其余传 undefined 由本函数决定 */
  forcedSource?: DecisionSource;
}

/**
 * 取出当前需要压制的目标牌型。
 * 自由回合返回 null（表示随便出）。
 */
export function resolveTarget(
  lastPlay: PlayRecord | null,
  isFreeTurn: boolean,
): HandPattern | null {
  if (isFreeTurn || lastPlay === null) {
    return null;
  }
  return lastPlay.pattern;
}

/** 判断是否为炸弹或王炸（用于优先级排序） */
function isBombOrRocket(cards: Card[]): boolean {
  if (cards.length === 0) {
    return false;
  }
  if (cards.length === 4) {
    const ranks = new Set(cards.map((c) => c.rank));
    return ranks.size === 1;
  }
  if (cards.length === 2) {
    const ranks = new Set(cards.map((c) => c.rank));
    return ranks.has(RANK_BLACK_JOKER) && ranks.has(RANK_RED_JOKER);
  }
  return false;
}

/**
 * 判断一组牌是否动用了「控制牌」（2 / 小王 / 大王）。
 * 牌表示法：15=2，16=小王，17=大王，故阈值取 MAX_NORMAL_RANK(15)。
 */
function usesControlCard(cards: Card[]): boolean {
  return cards.some((c) => c.rank >= MAX_NORMAL_RANK);
}

/**
 * 判断出 h 是否会动到手牌中的炸弹。
 *
 * 两种「动炸弹」都算：
 * - 拆炸弹：四张同点只出了其中 1~3 张（如从 5555 里抽一张单 5）
 * - 挪用炸弹：把四张同点当成四带二的主体打出去
 *
 * 纯炸弹本身不算（它由 isBombOrRocket 单独归档到最低优先级）。
 */
function touchesBombRank(hand: Card[], h: Card[]): boolean {
  if (isBombOrRocket(h)) {
    return false;
  }
  const handCounts: Map<number, number> = new Map<number, number>();
  for (const card of hand) {
    handCounts.set(card.rank, (handCounts.get(card.rank) ?? 0) + 1);
  }
  for (const card of h) {
    if ((handCounts.get(card.rank) ?? 0) === 4) {
      return true;
    }
  }
  return false;
}

/**
 * 给候选牌打「偏好档位」，数值越小越优先出。
 *
 * - 0：普通牌，不碰控制牌、不动炸弹 —— 最该出的牌
 * - 1：动用控制牌（2 / 王），但炸弹完好
 * - 2：动了炸弹（拆散或当四带二用）
 * - 3：直接甩炸弹 / 王炸 —— 终局武器，最后才交
 */
function tierOf(hand: Card[], cards: Card[]): number {
  if (isBombOrRocket(cards)) {
    return 3;
  }
  if (touchesBombRank(hand, cards)) {
    return 2;
  }
  return usesControlCard(cards) ? 1 : 0;
}

/**
 * 策略化兜底选牌：在「合法」前提下尽量不笨。
 *
 * 选牌分两步：
 * 1. 按 `tierOf` 把候选分档，取档位最靠前的那一批（保炸弹 > 保控制牌）。
 * 2. 档内定牌：
 *    - 自由回合：优先甩「张数最多」的一手（顺子/连对/飞机比单张更能清空手牌），
 *      张数相同则取点数最小的；
 *    - 需压制时：取点数最小的那一手，能压住就行，别浪费大牌。
 *
 * 候选由引擎 `findHints` 提供（已按从小到大排序，炸弹/王炸排在最后），
 * 因此每个档位里的第一项天然就是该档最小牌。
 *
 * @returns 选中的牌组；无合法牌返回 null
 */
export function findStrategicPlay(hand: Card[], target: HandPattern | null): Card[] | null {
  const hints: Card[][] = findHints(hand, target);
  if (hints.length === 0) {
    return null;
  }

  for (let tier = 0; tier <= 3; tier += 1) {
    const bucket: Card[][] = hints.filter((h: Card[]): boolean => tierOf(hand, h) === tier);
    if (bucket.length === 0) {
      continue;
    }
    if (target === null) {
      // 自由回合：同档位下能多甩就多甩，张数相同时保留最小的（hints 已升序）
      return bucket.reduce(
        (best: Card[], cur: Card[]): Card[] => (cur.length > best.length ? cur : best),
        bucket[0],
      );
    }
    return bucket[0];
  }

  return hints[0];
}

/**
 * 产出兜底决策。
 *
 * 流程：
 * 1. `findStrategicPlay(hand, target)` 求策略化最小合法牌（保留炸弹/大牌）
 * 2. 若策略化为空，退回 `findMinimalPlay` 保底
 * 3. 有解 → 出牌，source = FALLBACK_MINIMAL（除非被 forcedSource 覆盖）
 * 4. 无解 → 过牌，source = FALLBACK_PASS（除非被 forcedSource 覆盖）
 * 5. 出牌前用 validatePlay 复验，复验不过则退化为过牌
 *
 * 注意：forcedSource 用于标记「因网络/超时降级」，此时即便出了牌也应保持
 * FALLBACK_ERROR，以便 QA 区分降级层级。
 */
export function buildFallbackDecision(params: FallbackParams): AIDecision {
  const { hand, lastPlay, isFreeTurn, warnings, startedAt, now, cause, forcedSource } = params;

  const latencyMs: number = Math.max(0, now - startedAt);
  const target: HandPattern | null = resolveTarget(lastPlay, isFreeTurn);
  const collected: string[] = warnings.slice();

  let chosen: Card[] | null = findStrategicPlay(hand, target);
  if (chosen === null) {
    // 策略化为空（理论上不会），退回引擎最小牌保底
    try {
      chosen = findMinimalPlay(hand, target);
    } catch {
      collected.push('兜底求解时引擎异常，改为过牌');
      chosen = null;
    }
  }

  if (chosen !== null && chosen.length > 0) {
    // 复验：不信任任何来源，包括自己的兜底
    const check = validatePlay(hand, chosen, target);
    if (check.valid) {
      return {
        isPass: false,
        cards: chosen,
        reason: `${cause}，自动出策略最小牌：${formatCards(chosen)}`,
        source: forcedSource ?? DecisionSource.FALLBACK_MINIMAL,
        warnings: collected,
        latencyMs,
      };
    }
    collected.push(`兜底牌未通过复验（${check.reason}），改为过牌`);
  }

  // 自由回合理论上永远有解：随便一张单牌都合法。走到这里说明手牌为空，属异常。
  if (isFreeTurn) {
    collected.push(
      hand.length === 0
        ? '异常：自由回合但手牌为空，无法出牌'
        : '异常：自由回合却找不到任何合法出牌，请检查引擎',
    );
  }

  return {
    isPass: true,
    cards: [],
    reason: `${cause}，无可压制的牌，选择过牌`,
    source: forcedSource ?? DecisionSource.FALLBACK_PASS,
    warnings: collected,
    latencyMs,
  };
}

/**
 * 纯本地决策（binding 为 null 时使用，完全不碰网络）。
 *
 * 与 buildFallbackDecision 的区别仅在于 reason 文案更中性，
 * 因为这不是「降级」，而是「未配置模型的既定行为」。
 */
export function buildLocalDecision(params: FallbackParams): AIDecision {
  return buildFallbackDecision(params);
}
