// @vitest-environment jsdom
/**
 * 端到端验证：一局结束后 gameStore.settle() 真的把对局写进 historyStore，
 * 且 HistoryPage 能正常渲染（不抛错、含关键文案、AI 思考被展示）。
 *
 * 用 jsdom 提供 window（localStorage 可用），并桩掉音频模块避免 AudioContext 缺失报错。
 * 渲染用 createRoot + act（客户端渲染）而非 renderToString —— 后者在 zustand v5 下
 * 只能读到模块加载时的初始空 store，无法反映落库后的实时状态。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/audio/soundService', () => ({
  playSfx: () => {},
  startBackground: () => {},
  stopBackground: () => {},
  speak: () => {},
}));

import { useGameStore, registerAIDrivers, resetAIDrivers } from '@/store/gameStore';
import { GamePhase, type BidScore } from '@/types/game';
import { DecisionSource } from '@/types/ai';
import { findMinimalPlay } from '@/engine';
import { useRoomStore } from '@/store/roomStore';
import { useHistoryStore } from '@/store/historyStore';
import { usePlayerStore } from '@/store/playerStore';
import { HistoryPage } from '@/pages/HistoryPage';

// React 18 act 环境标志
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 客户端挂载战绩页并读回 innerHTML（能反映实时 store 状态）。expand=true 会先点开第一条对局详情。 */
function renderHistory(expand = false): string {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(MemoryRouter, null, React.createElement(HistoryPage)));
  });
  if (expand) {
    const btn = Array.from(container.querySelectorAll('button')).find((b) =>
      (b.textContent ?? '').includes('胜方'),
    );
    if (btn) {
      act(() => {
        btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      });
    }
  }
  const html: string = container.innerHTML;
  act(() => {
    root.unmount();
  });
  container.remove();
  return html;
}

function setupRoom(): void {
  useRoomStore.setState({
    room: {
      id: 'smoke-room',
      mode: 'AI_SPECTATE',
      seats: [
        { index: 0, kind: 'AI', aiPlayerId: undefined },
        { index: 1, kind: 'AI', aiPlayerId: undefined },
        { index: 2, kind: 'AI', aiPlayerId: undefined },
      ],
    } as never,
  });
}

describe('对局结束落库历史（端到端）', () => {
  beforeEach(() => {
    useHistoryStore.getState().clear();
    useGameStore.getState().resetGame();
  });

  afterEach(() => {
    resetAIDrivers();
  });

  it('完整 AI 观战一局后产生历史记录，且战绩页可渲染', async () => {
    setupRoom();
    const started: boolean = useGameStore.getState().startGame();
    expect(started).toBe(true);

    let guard = 0;
    while (useGameStore.getState().phase !== GamePhase.SETTLED && guard < 6000) {
      // 直接驱动 AI 决策（本地兜底驱动器），无需 UI 定时器
      await useGameStore.getState().aiAct();
      guard += 1;
    }

    expect(useGameStore.getState().phase).toBe(GamePhase.SETTLED);
    expect(guard).toBeLessThan(6000);

    const recs = useHistoryStore.getState().records;
    expect(recs.length).toBeGreaterThanOrEqual(1);
    expect(recs[0].seats.length).toBe(3);
    expect(recs[0].finishedAt).toBeGreaterThan(0);
    expect(typeof recs[0].mode).toBe('string');

    // AI 思考（reason）应被写入出牌记录
    const withReason = recs[0].playHistory.filter((p) => typeof p.reason === 'string' && p.reason.length > 0);
    expect(withReason.length).toBeGreaterThan(0);

    // 战绩页可渲染，且含排行榜、对局记录区与展开后的详情区
    const html: string = renderHistory(true);
    expect(html).toContain('模型排行榜');
    expect(html).toContain('对局记录');
    expect(html).toContain('出牌过程');
  }, 30000);

  it('driver 返回的 reason 会随历史持久化，且战绩页渲染该思考内容', async () => {
    // 用带特定标记 reason 的驱动器替换，证明「AI 思考过程」字段被真实记录
    registerAIDrivers(
      async (input) => {
        const target = input.isFreeTurn ? null : input.lastPlay?.pattern ?? null;
        const cards = findMinimalPlay(input.hand, target);
        return {
          isPass: cards === null,
          cards: cards ?? [],
          reason: 'MARKER_THINK_123',
          source: DecisionSource.LLM,
          warnings: [],
          latencyMs: 1,
        };
      },
      async (_input) => ({
        score: 0 as BidScore,
        reason: 'MARKER_BID_456',
        source: DecisionSource.LLM,
        warnings: [],
        latencyMs: 1,
      }),
    );

    setupRoom();
    expect(useGameStore.getState().startGame()).toBe(true);

    let guard = 0;
    while (useGameStore.getState().phase !== GamePhase.SETTLED && guard < 6000) {
      await useGameStore.getState().aiAct();
      guard += 1;
    }
    expect(useGameStore.getState().phase).toBe(GamePhase.SETTLED);

    const rec = useHistoryStore.getState().records[0];
    expect(rec.playHistory.some((p) => p.reason === 'MARKER_THINK_123')).toBe(true);
    expect(rec.bidHistory.some((b) => b.reason === 'MARKER_BID_456')).toBe(true);

    const html: string = renderHistory(true);
    expect(html).toContain('MARKER_THINK_123');
  }, 30000);

  it('结算记录保存各家 AI 头像，战绩页渲染各自头像（而非同一默认）', async () => {
    // 绑定三个头像各不相同的 AI 玩家
    usePlayerStore.setState({
      players: [
        { id: 'p0', name: '猫', modelConfigId: 'c', modelId: '', remark: '', avatar: '🐱', createdAt: 0, updatedAt: 0 },
        { id: 'p1', name: '狗', modelConfigId: 'c', modelId: '', remark: '', avatar: '🐶', createdAt: 0, updatedAt: 0 },
        { id: 'p2', name: '狐', modelConfigId: 'c', modelId: '', remark: '', avatar: '🦊', createdAt: 0, updatedAt: 0 },
      ],
    });
    useRoomStore.setState({
      room: {
        id: 'avatar-room',
        mode: 'AI_SPECTATE',
        seats: [
          { index: 0, kind: 'AI', aiPlayerId: 'p0' },
          { index: 1, kind: 'AI', aiPlayerId: 'p1' },
          { index: 2, kind: 'AI', aiPlayerId: 'p2' },
        ],
      } as never,
    });

    registerAIDrivers(
      async (input) => {
        const target = input.isFreeTurn ? null : input.lastPlay?.pattern ?? null;
        const cards = findMinimalPlay(input.hand, target);
        return {
          isPass: cards === null,
          cards: cards ?? [],
          reason: 'AVATAR_PLAY',
          source: DecisionSource.LLM,
          warnings: [],
          latencyMs: 1,
        };
      },
      async () => ({ score: 0 as BidScore, reason: 'AVATAR_BID', source: DecisionSource.LLM, warnings: [], latencyMs: 1 }),
    );

    expect(useGameStore.getState().startGame()).toBe(true);
    let guard = 0;
    while (useGameStore.getState().phase !== GamePhase.SETTLED && guard < 6000) {
      await useGameStore.getState().aiAct();
      guard += 1;
    }
    expect(useGameStore.getState().phase).toBe(GamePhase.SETTLED);

    const rec = useHistoryStore.getState().records[0];
    const bySeat: Map<number, (typeof rec.seats)[number]> = new Map(rec.seats.map((s) => [s.seat, s]));
    expect(bySeat.get(0)?.avatar).toBe('🐱');
    expect(bySeat.get(1)?.avatar).toBe('🐶');
    expect(bySeat.get(2)?.avatar).toBe('🦊');

    // 战绩页（展开详情）应分别渲染三家各自头像
    const expandedHtml: string = renderHistory(true);
    expect(expandedHtml).toContain('🐱');
    expect(expandedHtml).toContain('🐶');
    expect(expandedHtml).toContain('🦊');

    // 折叠态座位 chips 也应带各自头像
    const collapsedHtml: string = renderHistory(false);
    expect(collapsedHtml).toContain('🐱');
    expect(collapsedHtml).toContain('🐶');
    expect(collapsedHtml).toContain('🦊');
  }, 30000);

  it('历史记录缺头像时按身份回退（AI→🤖，人类→🧑），不会复用同一图标', () => {
    // 直接注入一条缺 avatar 的旧记录（模拟升级前落库的数据）
    useHistoryStore.getState().addRecord({
      id: 'legacy-1',
      finishedAt: Date.now(),
      mode: 'HUMAN_VS_AI',
      landlordWin: true,
      winnerSeat: 0,
      baseScore: 1,
      multiplier: 1,
      unitScore: 1,
      isSpring: false,
      isAntiSpring: false,
      multiplierDetail: [],
      seats: [
        { seat: 0, name: '地主', kind: 'AI', isLandlord: true, model: 'm1', score: 2 },
        { seat: 1, name: '农民甲', kind: 'AI', isLandlord: false, model: 'm2', score: -1 },
        { seat: 2, name: '我', kind: 'HUMAN', isLandlord: false, model: null, score: -1 },
      ],
      bidHistory: [],
      playHistory: [],
    } as never);

    const collapsedHtml: string = renderHistory(false);
    expect(collapsedHtml).toContain('🤖'); // AI 回退
    expect(collapsedHtml).toContain('🧑'); // 人类回退
  });

  it('旧记录既无 avatar 也无 aiPlayerId、但名称与 AI 玩家页配置一致时，按名称还原各自头像', () => {
    // 模拟更早的落库记录：座位只有 name/model，没有 avatar 与 aiPlayerId 字段。
    // 只要用户没改过玩家名字，就能按名称从 AI 玩家页配置找回各自头像。
    usePlayerStore.setState({
      players: [
        { id: 'pa', name: '猫', modelConfigId: 'c', modelId: '', remark: '', avatar: '🐱', createdAt: 0, updatedAt: 0 },
        { id: 'pb', name: '狗', modelConfigId: 'c', modelId: '', remark: '', avatar: '🐶', createdAt: 0, updatedAt: 0 },
        { id: 'pc', name: '狐', modelConfigId: 'c', modelId: '', remark: '', avatar: '🦊', createdAt: 0, updatedAt: 0 },
      ],
    });
    useHistoryStore.getState().addRecord({
      id: 'legacy-name',
      finishedAt: Date.now(),
      mode: 'HUMAN_VS_AI',
      landlordWin: true,
      winnerSeat: 0,
      baseScore: 1,
      multiplier: 1,
      unitScore: 1,
      isSpring: false,
      isAntiSpring: false,
      multiplierDetail: [],
      seats: [
        { seat: 0, name: '猫', kind: 'AI', isLandlord: true, model: 'm1', score: 2 },
        { seat: 1, name: '狗', kind: 'AI', isLandlord: false, model: 'm2', score: -1 },
        { seat: 2, name: '狐', kind: 'AI', isLandlord: false, model: 'm3', score: -1 },
      ],
      bidHistory: [],
      playHistory: [],
    } as never);

    const expandedHtml: string = renderHistory(true);
    expect(expandedHtml).toContain('🐱'); // 按名称「猫」解析
    expect(expandedHtml).toContain('🐶'); // 按名称「狗」解析
    expect(expandedHtml).toContain('🦊'); // 按名称「狐」解析
    expect(expandedHtml).not.toContain('🤖🤖🤖');
  });

  it('旧记录仅有 aiPlayerId（无 avatar）时，按 AI 玩家页配置渲染各自头像', () => {
    // 模拟升级前落库的旧记录：座位有 aiPlayerId 但没存 avatar 字段。
    // 同时 AI 玩家页配置里每家头像各不相同（用户单独配置好的）。
    usePlayerStore.setState({
      players: [
        { id: 'p0', name: '猫', modelConfigId: 'c', modelId: '', remark: '', avatar: '🐱', createdAt: 0, updatedAt: 0 },
        { id: 'p1', name: '狗', modelConfigId: 'c', modelId: '', remark: '', avatar: '🐶', createdAt: 0, updatedAt: 0 },
        { id: 'p2', name: '狐', modelConfigId: 'c', modelId: '', remark: '', avatar: '🦊', createdAt: 0, updatedAt: 0 },
      ],
    });
    useHistoryStore.getState().addRecord({
      id: 'legacy-2',
      finishedAt: Date.now(),
      mode: 'AI_SPECTATE',
      landlordWin: true,
      winnerSeat: 0,
      baseScore: 1,
      multiplier: 1,
      unitScore: 1,
      isSpring: false,
      isAntiSpring: false,
      multiplierDetail: [],
      seats: [
        { seat: 0, name: '猫', kind: 'AI', aiPlayerId: 'p0', isLandlord: true, model: 'm1', score: 2 },
        { seat: 1, name: '狗', kind: 'AI', aiPlayerId: 'p1', isLandlord: false, model: 'm2', score: -1 },
        { seat: 2, name: '狐', kind: 'AI', aiPlayerId: 'p2', isLandlord: false, model: 'm3', score: -1 },
      ],
      bidHistory: [],
      playHistory: [],
    } as never);

    const expandedHtml: string = renderHistory(true);
    expect(expandedHtml).toContain('🐱'); // 按 p0 配置
    expect(expandedHtml).toContain('🐶'); // 按 p1 配置
    expect(expandedHtml).toContain('🦊'); // 按 p2 配置（证明按 aiPlayerId 实时解析）
    // 不应再统一回退成同一个 🤖（三家各自有独立、用户配置的 avatar）
    expect(expandedHtml).not.toMatch(/🤖.*🤖.*🤖/);
  });

  it('bid/play 记录行首头像按座位解析，不会统一显示为同一个头像', () => {
    // 模拟截图场景：三家座位头像已配置好，但展开详情里 bid/play 行首
    // 若按错误逻辑会全部显示成第一个 AI 头像。这里直接注入手工记录验证。
    usePlayerStore.setState({
      players: [
        { id: 'p0', name: '鲸鱼', modelConfigId: 'c', modelId: '', remark: '', avatar: '🐳', createdAt: 0, updatedAt: 0 },
        { id: 'p1', name: '阶跃', modelConfigId: 'c', modelId: '', remark: '', avatar: '📈', createdAt: 0, updatedAt: 0 },
        { id: 'p2', name: '我', modelConfigId: 'c', modelId: '', remark: '', avatar: '🧑', createdAt: 0, updatedAt: 0 },
      ],
    });
    useHistoryStore.getState().addRecord({
      id: 'row-avatar',
      finishedAt: Date.now(),
      mode: 'HUMAN_VS_AI',
      landlordWin: true,
      winnerSeat: 0,
      baseScore: 1,
      multiplier: 1,
      unitScore: 1,
      isSpring: false,
      isAntiSpring: false,
      multiplierDetail: [],
      seats: [
        { seat: 0, name: '鲸鱼', kind: 'AI', aiPlayerId: 'p0', isLandlord: true, model: 'm1', score: 2, avatar: '🐳' },
        { seat: 1, name: '阶跃', kind: 'AI', aiPlayerId: 'p1', isLandlord: false, model: 'm2', score: -1, avatar: '📈' },
        { seat: 2, name: '我', kind: 'HUMAN', isLandlord: false, model: null, score: -1 },
      ],
      bidHistory: [
        { seat: 0, score: 2 as BidScore, reason: 'whale-bid' },
        { seat: 1, score: 0 as BidScore, reason: 'step-bid-pass' },
        { seat: 2, score: 0 as BidScore, reason: 'human-bid-pass' },
      ],
      playHistory: [
        {
          seat: 0,
          isPass: false,
          cards: [{ id: 'c1', suit: 'SPADE', rank: 4, label: '4' }],
          pattern: { type: 'SINGLE' as const, mainRank: 4, length: 1, cards: [{ id: 'c1', suit: 'SPADE', rank: 4, label: '4' }] },
          reason: 'whale-play',
        },
        { seat: 1, isPass: true, cards: [], pattern: null, reason: 'step-pass' },
        { seat: 2, isPass: true, cards: [], pattern: null, reason: 'human-pass' },
      ],
    } as never);

    const html: string = renderHistory(true);
    // 三家头像都应出现在行首
    expect(html).toContain('🐳');
    expect(html).toContain('📈');
    expect(html).toContain('🧑');
    // 每个头像至少同时出现在座位头部 + 行首（≥2 次），证明不是只出现在头部
    expect((html.match(/🐳/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((html.match(/📈/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect((html.match(/🧑/g) ?? []).length).toBeGreaterThanOrEqual(2);
    // 关键：每个座位的行首头像应对应其 own emoji（例如鲸鱼行首不是 📈 或 🧑）
    // HTML 中 bid/play 行顺序是 鲸鱼/阶跃/我，渲染后顺序内应包含三种不同头像
    const orderRe = /🐳.*📈.*🧑/s;
    expect(html).toMatch(orderRe);
  });
});


