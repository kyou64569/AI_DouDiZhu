/**
 * AI 出牌编排层（四层降级链路 + 永不 reject 契约）。
 *
 * 通过 vi.mock('@/api/llm') 把 chatCompletion 替换成可控桩，
 * 覆盖四层降级：L0 无绑定/网络异常、L1 解析失败、L2 映射失败、L3 校验失败。
 *
 * 铁律：decidePlay 返回的 Promise【永远 resolve，永不 reject】。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decidePlay } from '@/ai/aiOrchestrator';
import { DecisionSource, type AIPlayInput, type AIDecision } from '@/types/ai';
import type { PlayRecord, SeatIndex } from '@/types/game';
import { hand, isSubsetByIdentity, pattern } from '../helpers/cards';

// 把网络调用替换成可控 mock，避免真实请求。
vi.mock('@/api/llm', () => ({
  chatCompletion: vi.fn(),
  AI_TIMEOUT_MS: 8000,
}));

import { chatCompletion } from '@/api/llm';
const mockedChat = vi.mocked(chatCompletion);

/** 构造一条有效出牌记录。 */
function record(seat: number, spec: string): PlayRecord {
  return { seat: seat as SeatIndex, cards: hand(spec), pattern: pattern(spec), isPass: false, turn: 0 };
}

/** 标准输入构造器。 */
function baseInput(overrides: Partial<AIPlayInput> = {}): AIPlayInput {
  const myHand = hand('3 4 5');
  return {
    seat: 0,
    playerName: 'AI-0',
    binding: { baseUrl: 'http://llm.test', apiKey: 'k', model: 'm' },
    hand: myHand,
    landlordSeat: 0,
    bottomCards: [],
    handCounts: [3, 17, 17],
    lastPlay: null,
    isFreeTurn: true,
    playHistory: [],
    multiplier: 1,
    baseScore: 1,
    ...overrides,
  };
}

/** 让下一次 LLM 调用返回指定文本。 */
function llmReturns(content: string): void {
  mockedChat.mockResolvedValue({ content, latencyMs: 5 });
}

beforeEach(() => {
  mockedChat.mockReset();
});

describe('decidePlay · 第 0 层（无绑定 / 网络异常）', () => {
  it('binding 为 null → 本地兜底 FALLBACK_ERROR，Promise 不 reject', async () => {
    const promise = decidePlay(baseInput({ binding: null }));
    const decision: AIDecision = await promise; // 若 reject 则此处抛错导致用例失败
    expect(decision.source).toBe(DecisionSource.FALLBACK_ERROR);
    expect(decision.isPass).toBe(false);
    expect(decision.warnings.join()).toContain('未绑定');
  });

  it('LLM 请求抛异常 → FALLBACK_ERROR', async () => {
    mockedChat.mockRejectedValue(new Error('ECONNREFUSED'));
    const input = baseInput();
    const decision = await decidePlay(input);
    expect(decision.source).toBe(DecisionSource.FALLBACK_ERROR);
    expect(decision.isPass).toBe(false);
    expect(isSubsetByIdentity(input.hand, decision.cards)).toBe(true);
  });
});

describe('decidePlay · 第 1 层（解析失败）', () => {
  it('返回非 JSON 文本 → 降级 FALLBACK_MINIMAL', async () => {
    llmReturns('抱歉我不太会出牌，随便说说');
    const decision = await decidePlay(baseInput());
    expect(decision.source).toBe(DecisionSource.FALLBACK_MINIMAL);
    expect(decision.isPass).toBe(false);
    expect(decision.warnings.length).toBeGreaterThan(0);
  });
});

describe('decidePlay · 第 2 层（映射失败）', () => {
  it('模型想出的牌不在手牌里 → 降级', async () => {
    // 手牌只有 3 4 5，模型却要出两张 K
    llmReturns('{"action":"play","cards":["K","K"],"reason":"出对K"}');
    const decision = await decidePlay(baseInput({ hand: hand('3 4 5') }));
    expect(decision.source).toBe(DecisionSource.FALLBACK_MINIMAL);
    // L2 降级原因「牌面映射失败」写入 decision.reason（cause 不进 warnings）
    expect(decision.reason).toContain('映射');
  });
});

describe('decidePlay · 第 3 层（校验失败）', () => {
  it('牌能映射但构不成合法牌型 → 降级', async () => {
    // 手牌 3 4，模型想出「3 4」——两张不同点数的单牌不构成合法牌型
    llmReturns('{"action":"play","cards":["3","4"],"reason":"出34"}');
    const decision = await decidePlay(baseInput({ hand: hand('3 4'), isFreeTurn: true }));
    expect([DecisionSource.FALLBACK_MINIMAL, DecisionSource.FALLBACK_PASS]).toContain(decision.source);
    expect(decision.warnings.join()).toContain('校验');
  });

  it('牌能映射但压不过上家 → 降级', async () => {
    // 上家对 K，手牌只有对 3，无法压制
    const last = record(1, 'K K');
    llmReturns('{"action":"play","cards":["3","3"],"reason":"出对3"}');
    const decision = await decidePlay(
      baseInput({ hand: hand('3 3 4'), isFreeTurn: false, lastPlay: last }),
    );
    expect([DecisionSource.FALLBACK_MINIMAL, DecisionSource.FALLBACK_PASS]).toContain(decision.source);
    expect(decision.warnings.join()).toContain('校验');
  });
});

describe('decidePlay · 采纳 LLM 合法决策', () => {
  it('自由回合出合法单牌 → LLM 来源，牌来自手牌', async () => {
    llmReturns('{"action":"play","cards":["3"],"reason":"出小牌"}');
    const input = baseInput({ hand: hand('3 4 5'), isFreeTurn: true });
    const decision = await decidePlay(input);
    expect(decision.source).toBe(DecisionSource.LLM);
    expect(decision.isPass).toBe(false);
    expect(decision.cards.map((card) => card.rank)).toEqual([3]);
    expect(isSubsetByIdentity(input.hand, decision.cards)).toBe(true);
  });

  it('被压制且能压过上家 → LLM 来源', async () => {
    const last = record(1, '5'); // 单张 5
    llmReturns('{"action":"play","cards":["6"],"reason":"压你"}');
    const input = baseInput({ hand: hand('3 4 6'), isFreeTurn: false, lastPlay: last });
    const decision = await decidePlay(input);
    expect(decision.source).toBe(DecisionSource.LLM);
    expect(decision.isPass).toBe(false);
    expect(decision.cards.map((card) => card.rank)).toEqual([6]);
  });

  it('合法过牌（非自由回合）→ LLM 来源，isPass=true', async () => {
    const last = record(1, 'A');
    llmReturns('{"action":"pass","reason":"出不起"}');
    const input = baseInput({ hand: hand('3 4 5'), isFreeTurn: false, lastPlay: last });
    const decision = await decidePlay(input);
    expect(decision.source).toBe(DecisionSource.LLM);
    expect(decision.isPass).toBe(true);
    expect(decision.cards).toEqual([]);
  });

  it('自由回合却选择过牌 → 非法，降级为出最小牌', async () => {
    llmReturns('{"action":"pass","reason":"我不想出"}');
    const input = baseInput({ hand: hand('3 4 5'), isFreeTurn: true });
    const decision = await decidePlay(input);
    expect(decision.isPass).toBe(false); // 降级后改为出最小合法牌
    expect(decision.source).toBe(DecisionSource.FALLBACK_MINIMAL);
    expect(decision.warnings.join()).toContain('非法');
  });
});

describe('decidePlay · 必胜安全网（绝不让 AI 主动扔掉必胜局）', () => {
  it('模型过牌但存在一手清空的合法牌型 → 强制改判出牌（用户贴的精确场景）', async () => {
    // 上家座位 0 打出对 3，我手牌恰为对 K，对 K 能压对 3 且一手出完直接获胜。
    // 模型在 reason 里想明白了却把 action 写成 pass。
    const last = record(0, '3 3');
    llmReturns(
      '{"action":"pass","reason":"选择过牌（手上有可压制的牌，主动战略性放弃）：当前手牌为对K...等等,对K大于对3,可以直接压过去清空手牌赢得游戏！重新审题:上家座位0打出对3,我的对K可以压过。"}',
    );
    const decision = await decidePlay(
      baseInput({ hand: hand('K K'), isFreeTurn: false, lastPlay: last }),
    );
    expect(decision.isPass).toBe(false); // 关键：没有真的过牌
    expect(decision.cards.length).toBe(2); // 出了对 K
    expect(decision.source).toBe(DecisionSource.LLM);
    expect(decision.reason).toContain('必胜');
  });

  it('模型过牌且无一手清空的牌型 → 仍允许战略性过牌（不误伤留炸弹等正常决策）', async () => {
    // 上家对 5，我手牌对 6 + 单 3：能压（对 6）但不清空手牌，安全网不应触发。
    const last = record(1, '5 5');
    llmReturns('{"action":"pass","reason":"留着大牌"}');
    const input = baseInput({ hand: hand('6 6 3'), isFreeTurn: false, lastPlay: last });
    const decision = await decidePlay(input);
    expect(decision.isPass).toBe(true); // 正常战略性过牌被保留
    expect(decision.cards).toEqual([]);
    expect(decision.source).toBe(DecisionSource.LLM);
  });

  it('自由回合模型过牌 → 仍按非法降级处理（安全网不覆盖该路径）', async () => {
    // 自由回合本就禁止过牌，走原降级链路，与必胜安全网无关。
    llmReturns('{"action":"pass","reason":"不想出"}');
    const input = baseInput({ hand: hand('3 4 5'), isFreeTurn: true });
    const decision = await decidePlay(input);
    expect(decision.isPass).toBe(false);
    expect(decision.source).toBe(DecisionSource.FALLBACK_MINIMAL);
  });
});

describe('decidePlay · 思考模式与温度透传', () => {
  /** 取出最近一次 chatCompletion 收到的请求体。 */
  function lastRequest(): Record<string, unknown> {
    const call = mockedChat.mock.calls.at(-1);
    expect(call).toBeDefined();
    return call![0] as unknown as Record<string, unknown>;
  }

  it('binding 未指定温度 → 回落到 0.3（不再是 0.7）', async () => {
    llmReturns('{"action":"play","cards":["3"],"reason":"ok"}');
    await decidePlay(baseInput());
    expect(lastRequest().temperature).toBeCloseTo(0.3);
  });

  it('binding 指定温度 → 原样透传', async () => {
    llmReturns('{"action":"play","cards":["3"],"reason":"ok"}');
    await decidePlay(
      baseInput({ binding: { baseUrl: 'http://llm.test', apiKey: 'k', model: 'm', temperature: 1.2 } }),
    );
    expect(lastRequest().temperature).toBeCloseTo(1.2);
  });

  it('thinkingMode=high → 透传 thinking + reasoningEffort', async () => {
    llmReturns('{"action":"play","cards":["3"],"reason":"ok"}');
    await decidePlay(
      baseInput({ binding: { baseUrl: 'http://llm.test', apiKey: 'k', model: 'gpt-4o', thinkingMode: 'high' } }),
    );
    const req = lastRequest();
    expect(req.thinking).toBe(true);
    expect(req.reasoningEffort).toBe('high');
  });

  it('thinkingMode=off → 关闭思考且不带强度', async () => {
    llmReturns('{"action":"play","cards":["3"],"reason":"ok"}');
    await decidePlay(
      baseInput({
        binding: { baseUrl: 'http://llm.test', apiKey: 'k', model: 'deepseek-reasoner', thinkingMode: 'off' },
      }),
    );
    const req = lastRequest();
    expect(req.thinking).toBe(false);
    expect(req.reasoningEffort).toBeUndefined();
  });

  it('thinkingMode=auto → 推理模型自动开启，普通模型不开', async () => {
    llmReturns('{"action":"play","cards":["3"],"reason":"ok"}');
    await decidePlay(
      baseInput({
        binding: { baseUrl: 'http://llm.test', apiKey: 'k', model: 'deepseek-reasoner', thinkingMode: 'auto' },
      }),
    );
    expect(lastRequest().thinking).toBe(true);

    await decidePlay(
      baseInput({ binding: { baseUrl: 'http://llm.test', apiKey: 'k', model: 'gpt-4o', thinkingMode: 'auto' } }),
    );
    expect(lastRequest().thinking).toBe(false);
  });
});

describe('decidePlay · 永不 reject 契约', () => {
  it('即便 LLM 返回乱码且手牌为空也不 reject', async () => {
    mockedChat.mockResolvedValue({ content: '### 完全不是json', latencyMs: 1 });
    const promise = decidePlay(baseInput({ hand: [], isFreeTurn: true }));
    await expect(promise).resolves.toBeDefined();
  });

  it('链式降级后仍 resolve 且带 human-readable warning', async () => {
    llmReturns('{"action":"play","cards":["Z"],"reason":"瞎出"}'); // 解析成功但映射失败
    const decision = await decidePlay(baseInput({ hand: hand('3 4 5') }));
    expect(decision).toBeDefined();
    expect(decision.warnings.length).toBeGreaterThan(0);
  });
});
