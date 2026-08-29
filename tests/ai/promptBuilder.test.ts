/**
 * 出牌提示词构造测试，重点覆盖「必胜硬规则（B）」是否真正进入 system / user 文本。
 * 该规则要求：只要存在一手能清空手牌直接获胜的牌，action 必须 play，绝不 pass。
 */

import { describe, expect, it } from 'vitest';
import {
  buildBidSystemPrompt,
  buildPlayMessages,
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

describe('提示词 · 记牌器与对手建模（建议清单 #6/#7）', () => {
  it('默认难度：注入「记牌器」统计与「未见面牌」推断', () => {
    const played = hand('3 3 3 3'); // 别家出过 4 张 3
    const user: string = buildPlayUserPrompt(
      baseInput({
        hand: hand('K K 5'),
        isFreeTurn: true,
        lastPlay: null,
        playHistory: [
          { seat: 1, cards: played, pattern: pattern('3 3 3 3'), isPass: false, turn: 0 },
        ],
      }),
    );
    expect(user).toContain('记牌器');
    expect(user).toContain('3×4'); // 已出统计
    expect(user).toContain('已全部出完'); // 推断：3 出完，对手不可能再有 3
  });

  it('未见面牌扣除自己的手牌：手上 2 张 K 时提示 K×2 未见', () => {
    const user: string = buildPlayUserPrompt(
      baseInput({
        hand: hand('K K 5'),
        isFreeTurn: true,
        lastPlay: null,
        playHistory: [
          { seat: 1, cards: hand('4 4'), pattern: pattern('4 4'), isPass: false, turn: 0 },
        ],
      }),
    );
    expect(user).toContain('K×2');
  });

  it('对手建模：聚合过牌次数与炸弹使用，生成倾向标注', () => {
    const user: string = buildPlayUserPrompt(
      baseInput({
        hand: hand('3 4 5'),
        isFreeTurn: true,
        lastPlay: null,
        playHistory: [
          { seat: 1, cards: hand('8 8 8 8'), pattern: pattern('8 8 8 8'), isPass: false, turn: 0 },
          { seat: 2, cards: [], pattern: null, isPass: true, turn: 1 },
          { seat: 2, cards: [], pattern: null, isPass: true, turn: 2 },
        ],
      }),
    );
    expect(user).toContain('对手行为建模');
    expect(user).toContain('用过 1 次炸弹'); // 座位1
    expect(user).toContain('过牌 2 次'); // 座位2
  });

  it('简单难度：不注入记牌器与对手建模（刻意「看不牌」）', () => {
    const user: string = buildPlayUserPrompt(
      baseInput({
        binding: { baseUrl: 'http://llm.test', apiKey: 'k', model: 'm', difficulty: 'easy' },
        isFreeTurn: true,
        lastPlay: null,
        playHistory: [
          { seat: 1, cards: hand('4 4'), pattern: pattern('4 4'), isPass: false, turn: 0 },
        ],
      }),
    );
    expect(user).not.toContain('记牌器');
    expect(user).not.toContain('对手行为建模');
    expect(user).not.toContain('近期出牌记录');
  });
});

describe('提示词 · 难度与性格注入（建议清单 #1/#2）', () => {
  it('困难档：system 提示词包含战术压制指令；大师档包含 few-shot 示范', () => {
    const hardSys: string = buildPlaySystemPrompt({ difficulty: 'hard' });
    expect(hardSys).toContain('精确压制');

    const masterSys: string = buildPlaySystemPrompt({ difficulty: 'master' });
    expect(masterSys).toContain('示范决策');
    expect(masterSys).toContain('"action":"play"');
  });

  it('简单档：system 提示词淡化为休闲玩家口吻', () => {
    const sys: string = buildPlaySystemPrompt({ difficulty: 'easy' });
    expect(sys).toContain('休闲');
    expect(sys).not.toContain('记牌：');
  });

  it('性格注入：激进 / 保守在出牌与叫分 system 提示词中呈现相反风格', () => {
    const aggressivePlay: string = buildPlaySystemPrompt({ personality: 'aggressive' });
    expect(aggressivePlay).toContain('激进');
    const conservativePlay: string = buildPlaySystemPrompt({ personality: 'conservative' });
    expect(conservativePlay).toContain('保守');
    expect(buildPlaySystemPrompt()).toContain('均衡');

    expect(buildBidSystemPrompt({ personality: 'aggressive' })).toContain('敢于抢当地主');
    expect(buildBidSystemPrompt({ personality: 'conservative' })).toContain('从严评估牌力');
  });

  it('消息组装：难度从 binding 透传进 system 提示词', () => {
    const messages = buildPlayMessages(
      baseInput({ binding: { baseUrl: 'http://llm.test', apiKey: 'k', model: 'm', difficulty: 'master' } }),
    );
    expect(messages[0].content).toContain('示范决策');
  });
});
