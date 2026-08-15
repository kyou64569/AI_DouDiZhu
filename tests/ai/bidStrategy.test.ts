/**
 * 叫分决策：LLM 优先 + 手牌强度启发式兜底。
 *
 * 覆盖：
 * - evaluateHandStrength：王炸 / 炸弹 / 弱牌计分符合阈值模型。
 * - heuristicBid：分数始终落在 getLegalBids(highestBid) 之内。
 * - decideBid 四层降级（L0 无绑定 / 网络异常、L1 解析失败、L2 非法分数）
 *   以及采纳 LLM 合法叫分；Promise 永不 reject。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decideBid, evaluateHandStrength, heuristicBid } from '@/ai/bidStrategy';
import { DecisionSource, type AIBidDecision, type AIBidInput } from '@/types/ai';
import { getLegalBids } from '@/engine/bidding';
import { hand } from '../helpers/cards';

vi.mock('@/api/llm', () => ({
  chatCompletion: vi.fn(),
  AI_TIMEOUT_MS: 8000,
}));

import { chatCompletion } from '@/api/llm';
const mockedChat = vi.mocked(chatCompletion);

/** 标准叫分输入。 */
function baseBidInput(overrides: Partial<AIBidInput> = {}): AIBidInput {
  const strongHand = hand('BJ RJ 2 2 2 2 A A K K Q Q J J 10 10 9 9'); // 王炸 + 炸弹，强牌
  return {
    seat: 0,
    playerName: 'AI-0',
    binding: { baseUrl: 'http://llm.test', apiKey: 'k', model: 'm' },
    hand: strongHand,
    bidHistory: [],
    highestBid: 0,
    ...overrides,
  };
}

function llmReturns(content: string): void {
  mockedChat.mockResolvedValue({ content, latencyMs: 5 });
}

beforeEach(() => {
  mockedChat.mockReset();
});

describe('evaluateHandStrength', () => {
  it('王炸 + 炸弹给出高牌力', () => {
    const s = evaluateHandStrength(hand('BJ RJ 3 3 3 3'));
    expect(s.hasRocket).toBe(true);
    expect(s.bombCount).toBe(1);
    expect(s.score).toBeGreaterThanOrEqual(50); // 30 + 20 + 余量
  });

  it('弱牌（多为单张）牌力低', () => {
    const s = evaluateHandStrength(hand('3 4 5 6 7 8 9 10 J Q K A 2 3 4 5 6 7'));
    expect(s.bombCount).toBe(0);
    expect(s.hasRocket).toBe(false);
    expect(s.score).toBeLessThan(16);
  });
});

describe('heuristicBid', () => {
  it('强牌会叫到 3 分（不受非法分数污染）', () => {
    const hand17 = hand('BJ RJ 2 2 2 2 A A K K Q Q J J 10 10 9 9');
    const r = heuristicBid(hand17, 0);
    expect(r.score).toBe(3);
    expect(getLegalBids(0)).toContain(r.score);
  });

  it('当前最高叫 2 时强牌只能叫 3，最高叫 3 时强牌只能不叫', () => {
    const hand17 = hand('BJ RJ 2 2 2 2 A A K K Q Q J J 10 10 9 9');
    expect(heuristicBid(hand17, 2).score).toBe(3);
    expect(heuristicBid(hand17, 3).score).toBe(0);
  });

  it('弱牌永远不叫', () => {
    const weak = hand('3 4 5 6 7 8 9 10 J Q K A 2 3 4 5 6 7');
    expect(heuristicBid(weak, 0).score).toBe(0);
    expect(heuristicBid(weak, 2).score).toBe(0);
  });

  it('返回的叫分永远在合法区间内', () => {
    for (const highest of [0, 1, 2, 3]) {
      const r = heuristicBid(hand('BJ RJ 2 2 2 2'), highest);
      expect(getLegalBids(highest)).toContain(r.score);
    }
  });
});

describe('decideBid · 第 0 层', () => {
  it('binding 为 null → 用启发式，标记 FALLBACK_ERROR', async () => {
    const decision: AIBidDecision = await decideBid(baseBidInput({ binding: null }));
    expect(decision.source).toBe(DecisionSource.FALLBACK_ERROR);
    expect(getLegalBids(0)).toContain(decision.score);
  });

  it('网络异常 → FALLBACK_ERROR 且分数合法', async () => {
    mockedChat.mockRejectedValue(new Error('ETIMEDOUT'));
    const decision = await decideBid(baseBidInput());
    expect(decision.source).toBe(DecisionSource.FALLBACK_ERROR);
    expect(getLegalBids(0)).toContain(decision.score);
  });
});

describe('decideBid · 第 1 / 第 2 层', () => {
  it('解析失败 → 启发式兜底 FALLBACK_MINIMAL', async () => {
    llmReturns('我看这把牌一般般');
    const decision = await decideBid(baseBidInput());
    expect(decision.source).toBe(DecisionSource.FALLBACK_MINIMAL);
    expect(getLegalBids(0)).toContain(decision.score);
  });

  it('分数非法（超出合法范围）→ 启发式兜底 FALLBACK_MINIMAL', async () => {
    llmReturns('{"score":5,"reason":"乱叫"}'); // 合法叫分只有 0~3
    const decision = await decideBid(baseBidInput());
    expect(decision.source).toBe(DecisionSource.FALLBACK_MINIMAL);
    expect(getLegalBids(0)).toContain(decision.score);
  });
});

describe('decideBid · 采纳 LLM 合法叫分', () => {
  it('LLM 返回合法数字叫分 → LLM 来源', async () => {
    llmReturns('{"score":3,"reason":"我有王炸叫3"}');
    const decision = await decideBid(baseBidInput({ highestBid: 0 }));
    expect(decision.source).toBe(DecisionSource.LLM);
    expect(decision.score).toBe(3);
  });

  it('LLM 返回中文「不叫」→ LLM 来源 score=0', async () => {
    llmReturns('{"score":"不叫"}');
    const decision = await decideBid(baseBidInput({ highestBid: 0 }));
    expect(decision.source).toBe(DecisionSource.LLM);
    expect(decision.score).toBe(0);
  });

  it('LLM 叫分被裁剪到合法上限（最高已 2 则最多叫 3）', async () => {
    llmReturns('{"score":3,"reason":"叫3"}');
    const decision = await decideBid(baseBidInput({ highestBid: 2 }));
    expect(decision.score).toBe(3);
    expect(getLegalBids(2)).toContain(3);
  });
});

describe('decideBid · 永不 reject 契约', () => {
  it('LLM 抛异常也不 reject，回退到合法分数', async () => {
    mockedChat.mockRejectedValue(new Error('boom'));
    const promise = decideBid(baseBidInput());
    const decision = await promise;
    expect(decision).toBeDefined();
    expect(getLegalBids(0)).toContain(decision.score);
  });
});
