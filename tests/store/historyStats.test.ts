/**
 * 排行榜决策质量与 H2H 聚合测试（建议清单 #9）。
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  computeHeadToHead,
  computeLeaderboard,
  isGameRecord,
  useHistoryStore,
} from '@/store/historyStore';
import type { GameRecord, SeatSummary } from '@/types/history';
import type { SeatIndex } from '@/types/game';

function seat(seat: SeatIndex, model: string | null, score: number, stats?: SeatSummary['stats']): SeatSummary {
  return {
    seat,
    name: model ?? '人类',
    kind: model === null ? 'HUMAN' : 'AI',
    isLandlord: seat === 0,
    model,
    score,
    ...(stats !== undefined ? { stats } : {}),
  };
}

function record(seats: SeatSummary[]): GameRecord {
  return {
    id: `g-${seats[0].score}-${Math.random().toString(36).slice(2, 8)}`,
    finishedAt: Date.now(),
    mode: 'AI_SPECTATE',
    landlordWin: seats[0].score > 0,
    winnerSeat: 0,
    baseScore: 3,
    multiplier: 1,
    unitScore: 3,
    isSpring: false,
    isAntiSpring: false,
    multiplierDetail: [],
    seats,
    bidHistory: [],
    playHistory: [],
  };
}

describe('computeLeaderboard · 决策质量聚合', () => {
  beforeEach(() => {
    useHistoryStore.getState().clear();
  });

  it('按决策次数加权聚合 LLM 成功率 / 平均耗时 / 降级次数', () => {
    const records = [
      record([
        seat(0, 'model-a', 6, { decisions: 10, llmDecisions: 9, fallbackDecisions: 1, avgDecisionMs: 1000 }),
        seat(1, 'model-b', -3, { decisions: 10, llmDecisions: 5, fallbackDecisions: 5, avgDecisionMs: 2000 }),
        seat(2, 'model-c', -3),
      ]),
      record([
        seat(0, 'model-a', -3, { decisions: 8, llmDecisions: 8, fallbackDecisions: 0, avgDecisionMs: 2000 }),
        seat(1, 'model-b', 3, { decisions: 8, llmDecisions: 7, fallbackDecisions: 1, avgDecisionMs: 1000 }),
        seat(2, 'model-c', 0),
      ]),
    ];
    const [a, b] = computeLeaderboard(records);
    // model-a：18 次决策 17 次 LLM，总耗时 10*1000+8*2000=26000 → 1444.4ms
    expect(a.llmSuccessRate).toBeCloseTo(17 / 18, 5);
    expect(a.avgLatencyMs).toBeCloseTo(26000 / 18, 5);
    expect(a.fallbackCount).toBe(1);
    // model-b：18 次决策 12 次 LLM，降级 6 次
    expect(b.llmSuccessRate).toBeCloseTo(12 / 18, 5);
    expect(b.fallbackCount).toBe(6);
  });

  it('人类座位与旧记录（无 stats）返回 null 指标，不影响胜率聚合', () => {
    const entries = computeLeaderboard([record([seat(0, null, 3), seat(1, 'model-a', -2), seat(2, 'model-b', -1)])]);
    const human = entries.find((e) => e.key === '__human__');
    const a = entries.find((e) => e.key === 'model-a');
    expect(human?.llmSuccessRate).toBeNull();
    expect(human?.avgLatencyMs).toBeNull();
    expect(human?.fallbackCount).toBe(0);
    expect(a?.llmSuccessRate).toBeNull(); // 无决策数据
    expect(a?.games).toBe(1);
    expect(a?.winRate).toBe(0);
  });
});

describe('computeHeadToHead · 模型同场对战', () => {
  it('聚合两模型的胜负平与同场局数；人类不参与', () => {
    const records = [
      // a:6 > b:-3 → a 胜；c 与 a 不在同一条记录中不会出现
      record([seat(0, 'model-a', 6), seat(1, 'model-b', -3), seat(2, null, 0)]),
      // a:-3 < b:3 → b 胜
      record([seat(0, 'model-b', 3), seat(1, 'model-a', -3), seat(2, null, 0)]),
      // a:2 = b:2 → 平
      record([seat(0, 'model-a', 2), seat(1, 'model-b', 2), seat(2, null, -4)]),
    ];
    const h2h = computeHeadToHead(records);
    expect(h2h).toHaveLength(1);
    expect(h2h[0]).toMatchObject({ modelA: 'model-a', modelB: 'model-b', aWins: 1, bWins: 1, draws: 1, games: 3 });
  });

  it('方向按模型 id 字典序固定（与记录中的座位顺序无关）', () => {
    const h2h = computeHeadToHead([
      record([seat(0, 'z-model', 6), seat(1, 'a-model', -3), seat(2, null, 0)]),
    ]);
    expect(h2h[0].modelA).toBe('a-model');
    expect(h2h[0].modelB).toBe('z-model');
    expect(h2h[0].aWins).toBe(0);
    expect(h2h[0].bWins).toBe(1);
  });

  it('无同场 AI 对战时返回空数组', () => {
    expect(computeHeadToHead([record([seat(0, null, 3), seat(1, null, 0), seat(2, null, -3)])])).toEqual([]);
  });

  it('同一模型占多座时不产生自对战条目', () => {
    const h2h = computeHeadToHead([
      // 观战模式三座绑同一配置：model 相同 → 无对战意义，整条记录跳过
      record([seat(0, 'model-a', 6), seat(1, 'model-a', -3), seat(2, 'model-a', -3)]),
      // 混合：同模型两座 + 另一模型一座，只生成跨模型的一对
      record([seat(0, 'model-a', 5), seat(1, 'model-a', 1), seat(2, 'model-b', -6)]),
    ]);
    expect(h2h).toHaveLength(1);
    expect(h2h[0]).toMatchObject({ modelA: 'model-a', modelB: 'model-b', aWins: 1, bWins: 0, draws: 0, games: 1 });
  });
});

describe('historyStore · patchAIReview', () => {
  beforeEach(() => {
    useHistoryStore.getState().clear();
  });

  it('按记录 id 回填 AI 复盘并持久化', () => {
    const rec = record([seat(0, 'model-a', 6), seat(1, 'model-b', -3), seat(2, 'model-c', -3)]);
    useHistoryStore.getState().addRecord(rec);
    useHistoryStore.getState().patchAIReview(rec.id, {
      status: 'done',
      model: 'model-a',
      summary: '总体稳健',
      comments: ['好'],
      hands: [],
      generatedAt: 1,
    });
    expect(useHistoryStore.getState().records[0].aiReview?.status).toBe('done');
    expect(useHistoryStore.getState().records[0].aiReview?.summary).toBe('总体稳健');
  });

  it('回填不存在的记录 id 是 no-op', () => {
    const rec = record([seat(0, 'model-a', 6), seat(1, 'model-b', -3), seat(2, 'model-c', -3)]);
    useHistoryStore.getState().addRecord(rec);
    useHistoryStore.getState().patchAIReview('no-such-id', { status: 'failed', generatedAt: 1 });
    expect(useHistoryStore.getState().records[0].aiReview).toBeUndefined();
  });

  it('带 aiReview 的记录仍通过 isGameRecord 守卫', () => {
    const rec = record([seat(0, 'model-a', 6), seat(1, 'model-b', -3), seat(2, 'model-c', -3)]);
    rec.aiReview = { status: 'done', generatedAt: 1 };
    expect(isGameRecord(rec)).toBe(true);
  });
});
