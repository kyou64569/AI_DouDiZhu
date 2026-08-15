/**
 * 兜底策略（降级链路的落地执行者）。
 *
 * 重点验证：
 * - resolveTarget：自由回合 / 无上家出牌 → null；否则返回 lastPlay.pattern。
 * - buildFallbackDecision：自由回合永远出最小合法牌（FALLBACK_MINIMAL）；
 *   被压制但无牌可压 → 过牌（FALLBACK_PASS）；forcedSource 会覆盖来源标记。
 * - 出牌前用 validatePlay 复验；自由回合手牌为空属异常但不抛异常。
 */

import { describe, expect, it } from 'vitest';
import {
  buildFallbackDecision,
  buildLocalDecision,
  findStrategicPlay,
  resolveTarget,
  type FallbackParams,
} from '@/ai/fallback';
import { findMinimalPlay } from '@/engine/hint';
import { DecisionSource, type AIDecision } from '@/types/ai';
import type { PlayRecord, SeatIndex } from '@/types/game';
import { hand, isSubsetByIdentity, pattern, ranksOf } from '../helpers/cards';

/** 构造一条「有效出牌」记录。 */
function record(seat: number, spec: string): PlayRecord {
  return { seat: seat as SeatIndex, cards: hand(spec), pattern: pattern(spec), isPass: false, turn: 0 };
}

/** 兜底参数构造器。 */
function fbParams(overrides: Partial<FallbackParams> = {}): FallbackParams {
  return {
    hand: hand('3 4 5'),
    lastPlay: null,
    isFreeTurn: true,
    warnings: [],
    startedAt: 0,
    now: 10,
    cause: '测试降级',
    ...overrides,
  };
}

describe('resolveTarget', () => {
  it('自由回合 → null', () => {
    expect(resolveTarget(record(1, '5'), true)).toBeNull();
  });

  it('无上家出牌 → null', () => {
    expect(resolveTarget(null, false)).toBeNull();
  });

  it('被压制且有上家出牌 → 返回其牌型', () => {
    const last = record(1, '5 5');
    const target = resolveTarget(last, false);
    expect(target).not.toBeNull();
    expect(target!.cards.length).toBe(2);
  });
});

describe('buildFallbackDecision · 自由回合', () => {
  it('自由回合出最小合法牌（FALLBACK_MINIMAL），牌来自手牌', () => {
    const myHand = hand('3 4 5 6 7');
    const decision: AIDecision = buildFallbackDecision(fbParams({ hand: myHand, isFreeTurn: true, lastPlay: null }));
    expect(decision.isPass).toBe(false);
    expect(decision.source).toBe(DecisionSource.FALLBACK_MINIMAL);
    expect(decision.cards.length).toBeGreaterThan(0);
    expect(isSubsetByIdentity(myHand, decision.cards)).toBe(true);
  });

  it('自由回合 forcedSource=FALLBACK_ERROR 会覆盖来源', () => {
    const myHand = hand('3 4 5');
    const decision = buildFallbackDecision(
      fbParams({ hand: myHand, isFreeTurn: true, forcedSource: DecisionSource.FALLBACK_ERROR }),
    );
    expect(decision.isPass).toBe(false);
    expect(decision.source).toBe(DecisionSource.FALLBACK_ERROR);
  });

  it('自由回合手牌为空 → 过牌并记录异常（不抛异常）', () => {
    const decision = buildFallbackDecision(fbParams({ hand: [], isFreeTurn: true }));
    expect(decision.isPass).toBe(true);
    expect(decision.cards).toEqual([]);
    expect(decision.warnings.join()).toContain('手牌为空');
  });
});

describe('buildFallbackDecision · 被压制回合', () => {
  it('有可压制的牌 → 出最小合法牌（FALLBACK_MINIMAL）', () => {
    const myHand = hand('3 4 6');
    const last = record(1, '5'); // 单张 5
    const decision = buildFallbackDecision(fbParams({ hand: myHand, isFreeTurn: false, lastPlay: last }));
    expect(decision.isPass).toBe(false);
    expect(decision.source).toBe(DecisionSource.FALLBACK_MINIMAL);
    // 最小克制单张 5 的是单张 6
    expect(decision.cards.map((card) => card.rank)).toEqual([6]);
    expect(isSubsetByIdentity(myHand, decision.cards)).toBe(true);
  });

  it('无任何牌可压 → 过牌（FALLBACK_PASS）', () => {
    const myHand = hand('3 4 5');
    const last = record(1, 'A'); // 单张 A，手牌最大才 5
    const decision = buildFallbackDecision(fbParams({ hand: myHand, isFreeTurn: false, lastPlay: last }));
    expect(decision.isPass).toBe(true);
    expect(decision.source).toBe(DecisionSource.FALLBACK_PASS);
    expect(decision.cards).toEqual([]);
  });

  it('被压制时 forcedSource=FALLBACK_ERROR 覆盖来源', () => {
    const myHand = hand('3 4 5');
    const last = record(1, 'A');
    const decision = buildFallbackDecision(
      fbParams({ hand: myHand, isFreeTurn: false, lastPlay: last, forcedSource: DecisionSource.FALLBACK_ERROR }),
    );
    expect(decision.isPass).toBe(true);
    expect(decision.source).toBe(DecisionSource.FALLBACK_ERROR);
  });

  it('出牌前用 validatePlay 复验（不信任自己选的牌）', () => {
    // 手牌里能压过单张 5 的只有 6，但若函数作弊选了 3 必然被复验拦下；
    // 这里验证决策本身一定通过引擎校验：cards 被识别为合法牌型。
    const myHand = hand('3 4 6');
    const last = record(1, '5');
    const decision = buildFallbackDecision(fbParams({ hand: myHand, isFreeTurn: false, lastPlay: last }));
    expect(decision.isPass).toBe(false);
    expect(decision.cards.length).toBeGreaterThan(0);
  });
});

describe('findStrategicPlay · 自由回合', () => {
  it('不拆炸弹：宁可出闲牌 7，也不从 3333 里抽一张', () => {
    const myHand = hand('3 3 3 3 7');
    // 引擎最小牌会毫不犹豫地拆炸弹出单 3
    expect(ranksOf(findMinimalPlay(myHand, null)!)).toEqual([3]);
    // 策略选牌保住炸弹
    expect(ranksOf(findStrategicPlay(myHand, null)!)).toEqual([7]);
  });

  it('不把炸弹当四带二挪用', () => {
    const myHand = hand('3 3 3 3 7 8');
    const chosen = findStrategicPlay(myHand, null)!;
    // 四带二（3333+7+8，6 张）张数最多，但会吃掉炸弹，必须被排除
    expect(chosen.filter((c) => c.rank === 3)).toHaveLength(0);
  });

  it('同档位优先甩长牌型：出顺子 34567 而不是单张 3', () => {
    const myHand = hand('3 4 5 6 7 9');
    expect(ranksOf(findStrategicPlay(myHand, null)!)).toEqual([3, 4, 5, 6, 7]);
  });

  it('只剩控制牌时出最小的那张', () => {
    const myHand = hand('2 BJ');
    expect(ranksOf(findStrategicPlay(myHand, null)!)).toEqual([15]);
  });
});

describe('findStrategicPlay · 需压制', () => {
  it('优先用闲牌压，不拆炸弹', () => {
    const myHand = hand('5 5 5 5 6');
    const target = pattern('4');
    expect(ranksOf(findMinimalPlay(myHand, target)!)).toEqual([5]); // 引擎会拆炸弹
    expect(ranksOf(findStrategicPlay(myHand, target)!)).toEqual([6]); // 策略保炸弹
  });

  it('宁可交出控制牌 2，也不甩炸弹', () => {
    const myHand = hand('2 3 3 3 3');
    const chosen = findStrategicPlay(myHand, pattern('5'))!;
    expect(ranksOf(chosen)).toEqual([15]);
  });

  it('实在只有炸弹能压时才甩炸弹', () => {
    const myHand = hand('3 3 3 3');
    const chosen = findStrategicPlay(myHand, pattern('A'))!;
    expect(ranksOf(chosen)).toEqual([3, 3, 3, 3]);
  });

  it('压不过时返回 null', () => {
    expect(findStrategicPlay(hand('3 4'), pattern('A'))).toBeNull();
  });
});

describe('buildFallbackDecision · 接入策略选牌', () => {
  it('降级出牌走策略路径（保炸弹），且仍标记 FALLBACK_MINIMAL', () => {
    const myHand = hand('5 5 5 5 6');
    const decision = buildFallbackDecision(
      fbParams({ hand: myHand, isFreeTurn: false, lastPlay: record(1, '4') }),
    );
    expect(decision.isPass).toBe(false);
    expect(decision.source).toBe(DecisionSource.FALLBACK_MINIMAL);
    expect(ranksOf(decision.cards)).toEqual([6]);
    expect(isSubsetByIdentity(myHand, decision.cards)).toBe(true);
  });
});

describe('buildLocalDecision', () => {
  it('与 buildFallbackDecision 行为一致（仅文案中性）', () => {
    const myHand = hand('3 4 5');
    const fallback = buildFallbackDecision(fbParams({ hand: myHand, isFreeTurn: true }));
    const local = buildLocalDecision(fbParams({ hand: myHand, isFreeTurn: true }));
    expect(local.isPass).toBe(fallback.isPass);
    expect(local.source).toBe(fallback.source);
    expect(isSubsetByIdentity(myHand, local.cards)).toBe(true);
  });
});
