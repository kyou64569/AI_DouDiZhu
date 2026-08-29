// @vitest-environment jsdom
/**
 * 残局挑战端到端（建议清单 #3）：
 * startPuzzle 用预设手牌直接进入出牌阶段 → 人类连出三手、AI 陪练全程过牌 →
 * 结算后「不落库战绩、只更新残局进度」。
 *
 * jsdom 提供 window（localStorage），音频模块桩掉。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('@/audio/soundService', () => ({
  playSfx: () => {},
  startBackground: () => {},
  stopBackground: () => {},
  speak: () => {},
}));

import { useGameStore, registerAIDrivers, resetAIDrivers } from '@/store/gameStore';
import { usePuzzleStore } from '@/store/puzzleStore';
import { useHistoryStore } from '@/store/historyStore';
import { useRoomStore } from '@/store/roomStore';
import { getPuzzleLevel, parsePuzzleHands } from '@/puzzle/levels';
import { GamePhase } from '@/types/game';
import { DecisionSource } from '@/types/ai';
import type { Card } from '@/types/card';
import type { AIDecision, AIBidDecision } from '@/types/ai';

/** 恒定过牌的 AI 驱动器（残局陪练只要求「状态可推进」，过牌即合法推进） */
const passPlayDriver = async (): Promise<AIDecision> => ({
  isPass: true,
  cards: [],
  reason: '测试：过牌',
  source: DecisionSource.FALLBACK_PASS,
  warnings: [],
  latencyMs: 0,
});
const bidDriver = async (): Promise<AIBidDecision> => ({
  score: 0,
  reason: '测试：不叫',
  source: DecisionSource.FALLBACK_MINIMAL,
  warnings: [],
  latencyMs: 0,
});

describe('残局挑战端到端', () => {
  beforeEach(() => {
    useHistoryStore.getState().clear();
    usePuzzleStore.getState().clearProgress();
    usePuzzleStore.getState().clearActive();
    useGameStore.getState().resetGame();
    registerAIDrivers(passPlayDriver, bidDriver);
  });

  afterEach(() => {
    resetAIDrivers();
    useGameStore.getState().resetGame();
  });

  it('startPuzzle 直接进入出牌阶段且不需要房间', async () => {
    const level = getPuzzleLevel('pz-rocket-intro');
    expect(level).toBeDefined();
    if (level === undefined) return;

    expect(useRoomStore.getState().room).toBeNull();

    const ok: boolean = useGameStore.getState().startPuzzle(level);
    expect(ok).toBe(true);

    const st = useGameStore.getState();
    expect(st.phase).toBe(GamePhase.PLAYING);
    expect(st.puzzleLevelId).toBe(level.id);
    expect(st.humanSeat).toBe(0);
    expect(st.landlordSeat).toBe(0);
    expect(st.currentSeat).toBe(0);
    expect(st.isFreeTurn).toBe(true);
    expect(st.players.map((p) => p.hand.length)).toEqual([3, 3, 3]);
    expect(st.players[0].isLandlord).toBe(true);
    expect(st.players[1].kind).toBe('AI');
    expect(st.players[1].aiPlayerId).toBeUndefined();
  });

  it('完整通关：出完三手获胜，进度记录 3 手，战绩页不落库', async () => {
    const level = getPuzzleLevel('pz-rocket-intro');
    expect(level).toBeDefined();
    if (level === undefined) return;
    const hands = parsePuzzleHands(level);
    expect(hands).not.toBeNull();
    if (hands === null) return;

    useGameStore.getState().startPuzzle(level);
    usePuzzleStore.getState().activate(level.id);

    const playHuman = async (rank: number): Promise<void> => {
      const st = useGameStore.getState();
      const target: Card | undefined = st.players[0].hand.find((c: Card): boolean => c.rank === rank);
      expect(target, `手上应有 rank=${rank}`).toBeDefined();
      if (target === undefined) return;
      expect(st.playCards([target], 0)).toBe(true);
    };

    // 第一手：单张 2（全场最大普通单张）
    await playHuman(15);
    // 两名陪练依次过牌
    await useGameStore.getState().aiAct();
    await useGameStore.getState().aiAct();
    expect(useGameStore.getState().currentSeat).toBe(0);
    expect(useGameStore.getState().isFreeTurn).toBe(true);

    // 第二手：大王
    await playHuman(17);
    await useGameStore.getState().aiAct();
    await useGameStore.getState().aiAct();

    // 第三手：小王 → 手牌清空，立即结算
    await playHuman(16);
    const st = useGameStore.getState();
    expect(st.phase).toBe(GamePhase.SETTLED);
    expect(st.settlement).not.toBeNull();
    expect(st.settlement?.landlordWin).toBe(true);
    expect(st.players[0].hand).toHaveLength(0);

    // 残局结果只进残局进度，不进战绩（避免污染历史页与模型排行榜）
    expect(useHistoryStore.getState().records).toHaveLength(0);
    const progress = usePuzzleStore.getState().progress[level.id];
    expect(progress?.cleared).toBe(true);
    expect(progress?.bestMoves).toBe(3);
  });

  it('非法关卡数据：startPuzzle 返回 false 且不改变对局状态', () => {
    const broken = { ...getPuzzleLevel('pz-rocket-intro')!, hands: ['3 3 3 3 3', 'A', 'A'] as [string, string, string] };
    const ok: boolean = useGameStore.getState().startPuzzle(broken);
    expect(ok).toBe(false);
    expect(useGameStore.getState().phase).toBe(GamePhase.IDLE);
    expect(useGameStore.getState().puzzleLevelId).toBeNull();
  });
});
