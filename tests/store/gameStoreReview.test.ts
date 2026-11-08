// @vitest-environment jsdom
/**
 * AI 复盘端到端（建议清单 #8 / #9）：
 * 三个绑定模型的 AI 观战对局（脚本化 LLM 驱动器）跑完整局 → 结算后自动触发复盘 →
 * gameStore.aiReview 与历史记录都回填 done；SeatSummary 携带决策质量统计。
 *
 * chatCompletion 被桩掉（返回固定复盘 JSON），音频与台词模块全部桩掉。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/audio/soundService', () => ({
  playSfx: () => {},
  startBackground: () => {},
  stopBackground: () => {},
  speak: () => {},
}));

vi.mock('@/audio/banter', () => ({
  templateBanter: () => '（台词）',
  getCachedBanter: () => null,
  generateBanter: async () => '（台词）',
  warmBanterPool: () => {},
  resetBanterPool: () => {},
}));

vi.mock('@/api/llm', async () => {
  const actual = await vi.importActual<typeof import('@/api/llm')>('@/api/llm');
  return {
    ...actual,
    // 复盘（review.ts）仍走非流式 chatCompletion
    chatCompletion: vi.fn(async () => ({
      content: '{"summary":"整体思路清晰，降级手需要修正。","comments":["最小牌处理合理","压制时机正确","收官干脆"]}',
      latencyMs: 5,
    })),
    // AI 决策走流式（本测试用脚本驱动器，实际不会调用；保底防真实网络）
    chatCompletionStream: vi.fn(async () => ({
      content: '',
      latencyMs: 0,
    })),
  };
});

import { useGameStore, registerAIDrivers, resetAIDrivers } from '@/store/gameStore';
import { useHistoryStore, computeLeaderboard } from '@/store/historyStore';
import { useConfigStore } from '@/store/configStore';
import { usePlayerStore } from '@/store/playerStore';
import { useRoomStore } from '@/store/roomStore';
import { GamePhase } from '@/types/game';
import { DecisionSource, type AIPlayInput, type AIBidInput, type AIDecision, type AIBidDecision } from '@/types/ai';
import { findMinimalPlay } from '@/engine';
import type { ModelConfig } from '@/types/config';

/** 出牌脚本：LLM 来源 + 最小合法牌 / 过牌（保证对局确定性推进直至结束） */
async function scriptedPlayDriver(input: AIPlayInput): Promise<AIDecision> {
  const target = input.isFreeTurn ? null : input.lastPlay ? input.lastPlay.pattern : null;
  const play = findMinimalPlay(input.hand, target);
  if (play === null) {
    return { isPass: true, cards: [], reason: '脚本：过牌', source: DecisionSource.LLM, warnings: [], latencyMs: 12 };
  }
  return { isPass: false, cards: play, reason: '脚本：最小合法牌', source: DecisionSource.LLM, warnings: [], latencyMs: 12 };
}

async function scriptedBidDriver(input: AIBidInput): Promise<AIBidDecision> {
  return {
    score: input.highestBid === 0 ? 1 : 0,
    reason: '脚本：首轮叫 1 分',
    source: DecisionSource.LLM,
    warnings: [],
    latencyMs: 10,
  };
}

function setupBoundPlayers(): void {
  const config: ModelConfig = {
    id: 'cfg-review',
    name: '复盘测试配置',
    provider: 'Test',
    baseUrl: 'http://llm.test',
    apiKey: 'k-test',
    apiFormat: 'openai',
    availableModels: ['test-model'],
    selectedModel: 'test-model',
    thinkingMode: 'off',
    thinkingProfile: 'auto',
    thinkingCapability: 'graded',
    maxTokens: null,
    temperature: 0.3,
    createdAt: 0,
    updatedAt: 0,
  };
  useConfigStore.setState({ configs: [config] });
  usePlayerStore.setState({
    players: [
      { id: 'ply-a', name: 'AI-A', modelConfigId: 'cfg-review', createdAt: 0, updatedAt: 0 },
      { id: 'ply-b', name: 'AI-B', modelConfigId: 'cfg-review', createdAt: 0, updatedAt: 0 },
      { id: 'ply-c', name: 'AI-C', modelConfigId: 'cfg-review', createdAt: 0, updatedAt: 0 },
    ],
  });
  useRoomStore.setState({
    room: {
      id: 'review-room',
      mode: 'AI_SPECTATE',
      seats: [
        { index: 0, kind: 'AI', aiPlayerId: 'ply-a' },
        { index: 1, kind: 'AI', aiPlayerId: 'ply-b' },
        { index: 2, kind: 'AI', aiPlayerId: 'ply-c' },
      ],
    } as never,
  });
}

/** 驱动整局直至结算（脚本驱动器保证每步状态推进） */
async function driveToSettlement(): Promise<void> {
  let guard = 0;
  for (;;) {
    const st = useGameStore.getState();
    if (st.phase !== GamePhase.BIDDING && st.phase !== GamePhase.PLAYING) break;
    if (guard > 600) throw new Error('对局未能在限定步数内结束');
    guard += 1;
    await useGameStore.getState().aiAct();
  }
}

describe('AI 复盘端到端', () => {
  beforeEach(() => {
    useHistoryStore.getState().clear();
    useGameStore.getState().resetGame();
    setupBoundPlayers();
    registerAIDrivers(scriptedPlayDriver, scriptedBidDriver);
  });

  afterEach(() => {
    resetAIDrivers();
    useGameStore.getState().resetGame();
  });

  it('整局结束后自动复盘并回填 gameStore 与历史记录', async () => {
    expect(useGameStore.getState().startGame()).toBe(true);

    await driveToSettlement();
    expect(useGameStore.getState().phase).toBe(GamePhase.SETTLED);
    expect(useHistoryStore.getState().records.length).toBe(1);

    // 复盘异步完成：gameStore.aiReview 与 records[0].aiReview 均为 done
    await vi.waitFor(
      () => {
        expect(useGameStore.getState().aiReview?.status).toBe('done');
      },
      { timeout: 5000, interval: 50 },
    );

    const review = useGameStore.getState().aiReview;
    expect(review?.model).toBe('test-model');
    expect(review?.summary).toContain('整体思路清晰');
    expect(review?.comments).toHaveLength(3);
    expect(review?.hands?.length).toBeGreaterThan(0);
    // 关键手非空：play 文本与座位信息齐备
    expect(review?.hands?.[0]?.play.length).toBeGreaterThan(0);

    // 历史记录同步回填
    const record = useHistoryStore.getState().records[0];
    expect(record.aiReview?.status).toBe('done');
    expect(record.aiReview?.model).toBe('test-model');

    // 决策质量统计（#9）：全部为 LLM 决策 → 成功率 100%，有平均耗时
    const withStats = record.seats.filter((s) => s.stats !== undefined);
    expect(withStats.length).toBe(3);
    expect(withStats.every((s) => (s.stats?.llmDecisions ?? 0) > 0)).toBe(true);
    const entry = computeLeaderboard(useHistoryStore.getState().records).find((e) => e.key === 'test-model');
    expect(entry?.llmSuccessRate).toBe(1);
    expect(entry?.fallbackCount).toBe(0);
    expect(entry?.avgLatencyMs).toBe(12);
  });

  it('重开局后复盘仍回填历史记录，且不污染新局的弹窗状态', async () => {
    expect(useGameStore.getState().startGame()).toBe(true);
    await driveToSettlement();
    const recordId: string | undefined = useHistoryStore.getState().records[0]?.id;
    expect(recordId).toBeDefined();

    // 立即重开新局：复盘不再被中止或按 gameId 丢弃
    expect(useGameStore.getState().startGame()).toBe(true);
    expect(useGameStore.getState().aiReview).toBeNull();

    // 旧局复盘完成：历史记录回填 done；gameId 守卫使新局的 aiReview 保持 null
    await vi.waitFor(
      () => {
        const record = useHistoryStore.getState().records.find((r) => r.id === recordId);
        expect(record?.aiReview?.status).toBe('done');
      },
      { timeout: 5000, interval: 50 },
    );
    expect(useGameStore.getState().aiReview).toBeNull();
  });
});
