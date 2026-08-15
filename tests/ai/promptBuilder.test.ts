/**
 * 出牌提示词构造测试，重点覆盖「必胜硬规则（B）」是否真正进入 system / user 文本。
 * 该规则要求：只要存在一手能清空手牌直接获胜的牌，action 必须 play，绝不 pass。
 */

import { describe, expect, it } from 'vitest';
import {
  buildPlaySystemPrompt,
  buildPlayUserPrompt,
} from '@/ai/promptBuilder';
import type { AIPlayInput } from '@/types/ai';
import { hand, pattern } from '../helpers/cards';

function baseInput(overrides: Partial<AIPlayInput> = {}): AIPlayInput {
  return {
    seat: 0,
    playerName: 'AI-0',
    binding: { baseUrl: 'http://llm.test', apiKey: 'k', model: 'm' },
    hand: hand('3 4 5'),
    landlordSeat: 0,
    bottomCards: [],
    handCounts: [3, 17, 17],
    lastPlay: null,
    isFreeTurn: false,
    playHistory: [],
    multiplier: 1,
    baseScore: 1,
    ...overrides,
  };
}

describe('提示词 · 必胜硬规则（B）', () => {
  it('system 提示词包含「能清空手牌必须 play」的硬规则', () => {
    const sys: string = buildPlaySystemPrompt();
    expect(sys).toContain('能直接清空手牌');
    expect(sys).toContain('action 必须 是 "play"');
    expect(sys).toContain('绝对不能选 pass');
  });

  it('非自由回合的 user 提示词提醒「能一手出完必须 play」', () => {
    const user: string = buildPlayUserPrompt(
      baseInput({
        lastPlay: { seat: 1, cards: hand('3 3'), pattern: pattern('3 3'), isPass: false, turn: 1 },
        isFreeTurn: false,
      }),
    );
    expect(user).toContain('一手出完、直接获胜');
    expect(user).toContain('action 必须 是 "play"');
  });

  it('自由回合的 user 提示词仍强制「必须出牌，不得 pass」（原有铁律不受影响）', () => {
    const user: string = buildPlayUserPrompt(baseInput({ isFreeTurn: true, lastPlay: null }));
    expect(user).toContain('你【必须出牌】');
    expect(user).toContain('绝对不能是 "pass"');
  });
});

describe('提示词 · 合法出牌选项注入（治本：不让模型自己数牌）', () => {
  it('非自由回合：手牌有对4、上家对3 时，列表必须显式列出「4 4（对子）」', () => {
    const user: string = buildPlayUserPrompt(
      baseInput({
        hand: hand('3 3 4 4 7 9'),
        lastPlay: { seat: 1, cards: hand('3 3'), pattern: pattern('3 3'), isPass: false, turn: 1 },
        isFreeTurn: false,
      }),
    );
    expect(user).toContain('合法出牌选项');
    expect(user).toContain('4 4'); // 引擎算出来并对4列出来（用户真实 bug：模型说自己没对子）
    expect(user).toContain('对子');
    expect(user).toContain('action 就选 "play"'); // 决策指令引用该列表
  });

  it('非自由回合：手上无任何能压的牌时，明确提示只能 pass', () => {
    const user: string = buildPlayUserPrompt(
      baseInput({
        hand: hand('3 3 4 5'),
        lastPlay: { seat: 1, cards: hand('A A'), pattern: pattern('A A'), isPass: false, turn: 1 },
        isFreeTurn: false,
      }),
    );
    expect(user).toContain('只能选择 pass');
  });

  it('自由回合：同样列出合法出牌选项，并要求从中选一手打出', () => {
    const user: string = buildPlayUserPrompt(baseInput({ isFreeTurn: true, lastPlay: null }));
    expect(user).toContain('合法出牌选项');
    expect(user).toContain('挑选最合适的一手打出');
  });
});
