/**
 * AI 复盘纯函数测试（建议清单 #8）：关键手挑选、复盘响应解析、决策统计聚合。
 */

import { describe, expect, it } from 'vitest';
import type { HandPattern } from '@/types/card';
import type { PlayRecord, SeatIndex } from '@/types/game';
import { DecisionSource, type AIDecisionTrace } from '@/types/ai';
import { aggregateSeatStats, parseReviewContent, selectReviewHands } from '@/ai/review';
import { hand, pattern } from '../helpers/cards';

function trace(overrides: Partial<AIDecisionTrace>): AIDecisionTrace {
  return {
    seat: 0,
    phase: 'play',
    turn: 0,
    isPass: false,
    cardCount: 1,
    source: DecisionSource.LLM,
    warnings: [],
    reason: '测试',
    latencyMs: 100,
    ...overrides,
  };
}

function playRec(turn: number, spec: string, seat: SeatIndex = 0): PlayRecord {
  const cards = hand(spec);
  const p: HandPattern | null = pattern(spec);
  return { seat, cards, pattern: p, isPass: false, turn };
}

describe('selectReviewHands · 关键手挑选', () => {
  it('降级手优先于普通 LLM 手；结果按出牌顺序返回', () => {
    const history = [
      playRec(0, '3'),
      playRec(2, '5'),
      playRec(4, '8'),
    ];
    const traces = [
      trace({ turn: 0 }),
      trace({ turn: 2, source: DecisionSource.FALLBACK_MINIMAL, warnings: ['牌面映射失败'] }),
      trace({ turn: 4 }),
    ];
    const picked = selectReviewHands(history, traces, 2);
    // playIndex 是 playHistory 下标（0,1,2），不是回合计数（0,2,4——含过牌会跳号）
    expect(picked.map((h) => h.playIndex)).toEqual([1, 2]); // 降级手必选，限额 2 时带上最近一手
    expect(picked[0].degraded).toBe(true);
    expect(picked[0].warnings).toContain('牌面映射失败');
  });

  it('炸弹与收官手获得加权，无降级时也能选出有意义的手', () => {
    const bombCards = hand('7 7 7 7');
    const bombRec: PlayRecord = { seat: 0, cards: bombCards, pattern: pattern('7 7 7 7'), isPass: false, turn: 2 };
    const history = [playRec(0, '3'), bombRec, playRec(4, 'A')];
    const traces = [trace({ turn: 0 }), trace({ turn: 2 }), trace({ turn: 4 })];
    const picked = selectReviewHands(history, traces, 2);
    expect(picked.map((h) => h.playIndex)).toEqual([1, 2]); // 炸弹 + 收官
    expect(picked[0].cards).toHaveLength(4);
  });

  it('人类出牌（无轨迹）不参与复盘；无任何候选返回空数组', () => {
    const history = [playRec(0, '3', 1)]; // 座位 1 人类出牌，无轨迹
    expect(selectReviewHands(history, [], 3)).toEqual([]);
  });
});

describe('parseReviewContent · 复盘响应解析', () => {
  it('合法 JSON 解析为 summary + comments', () => {
    const out = parseReviewContent('{"summary":"整体稳健","comments":["好手","可以过牌"]}');
    expect(out.summary).toBe('整体稳健');
    expect(out.comments).toEqual(['好手', '可以过牌']);
  });

  it('markdown 围栏包裹的 JSON 也能解析', () => {
    const out = parseReviewContent('```json\n{"summary":"ok","comments":["a"]}\n```');
    expect(out.summary).toBe('ok');
    expect(out.comments).toEqual(['a']);
  });

  it('非 JSON 原文退化为 summary', () => {
    const out = parseReviewContent('  这手牌  出得\n比较合理。  ');
    expect(out.summary).toBe('这手牌 出得 比较合理。');
    expect(out.comments).toEqual([]);
  });

  it('JSON 结构异常（空字段）同样退化为原文', () => {
    const out = parseReviewContent('{"summary":"","comments":[]}');
    expect(out.summary).toContain('summary');
    expect(out.comments).toEqual([]);
  });

  it('JSON 前后有寒暄文字时按首尾花括号截取解析', () => {
    const out = parseReviewContent('好的，以下是复盘：{"summary":"稳","comments":["a","b"]} 以上。');
    expect(out.summary).toBe('稳');
    expect(out.comments).toEqual(['a', 'b']);
  });

  it('容忍 {play, comment} 对象数组形态的 comments', () => {
    const out = parseReviewContent(
      '{"summary":"稳","comments":[{"play":"出 33 55","comment":"连对压制合理"},{"play":"","comment":"收官干脆"}]}',
    );
    expect(out.comments).toEqual(['出 33 55: 连对压制合理', '收官干脆']);
  });

  it('容忍 {键: 值} 记录形态的 comments', () => {
    const out = parseReviewContent('{"summary":"稳","comments":{"第1手":"配合到位","第2手":"该拦"}}');
    expect(out.comments).toEqual(['第1手: 配合到位', '第2手: 该拦']);
  });
});

describe('aggregateSeatStats · 决策统计聚合', () => {
  it('按座位聚合决策次数 / LLM 占比 / 降级次数 / 平均耗时', () => {
    const stats = aggregateSeatStats([
      trace({ seat: 0, turn: 0, latencyMs: 100 }),
      trace({ seat: 0, turn: 2, latencyMs: 300 }),
      trace({ seat: 1, turn: 1, source: DecisionSource.FALLBACK_ERROR, latencyMs: 0 }),
      trace({ seat: 2, turn: -1, phase: 'bid', latencyMs: 50 }),
    ]);
    expect(stats[0]).toEqual({ decisions: 2, llmDecisions: 2, fallbackDecisions: 0, avgDecisionMs: 200 });
    expect(stats[1]).toEqual({ decisions: 1, llmDecisions: 0, fallbackDecisions: 1, avgDecisionMs: 0 });
    expect(stats[2]).toEqual({ decisions: 1, llmDecisions: 1, fallbackDecisions: 0, avgDecisionMs: 50 });
  });

  it('空轨迹产出全零统计', () => {
    const stats = aggregateSeatStats([]);
    expect(stats[0].decisions).toBe(0);
    expect(stats[1].avgDecisionMs).toBe(0);
  });
});
