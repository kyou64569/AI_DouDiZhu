// @vitest-environment jsdom
/**
 * 自动过牌功能集成测试。
 * 验证：
 *  - 勾选自动过牌 + 人类回合 + 无牌可压 → 渲染后立即自动过牌（无需手动/AI）；
 *  - 有牌可压时 → 不自动过牌；
 *  - 自由回合（首出）→ 不自动过牌；
 *  - 未勾选 → 不自动过牌。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { GameTablePage } from '@/pages/GameTablePage';
import { useGameStore } from '@/store/gameStore';
import { useRoomStore } from '@/store/roomStore';
import { GamePhase, type PlayRecord } from '@/types/game';
import { CardType, type Card } from '@/types/card';
import type { Room } from '@/types/config';

function makeCards(ranks: number[]): Card[] {
  return ranks.map((rank, i) => ({
    id: `c${i}-${rank}`,
    suit: 0 as never,
    rank,
    label: String(rank),
  }));
}

/** 对子 QQ 作为上家牌（人类手牌若无 ≥Q 的对子则「要不起」） */
const qqPair: PlayRecord = {
  seat: 1,
  cards: makeCards([12, 12]),
  pattern: { type: CardType.PAIR, mainRank: 12, length: 1, cards: makeCards([12, 12]) },
  isPass: false,
  turn: 0,
};

function setupGame(handRanks: number[], opts: { freeTurn?: boolean; autoPass?: boolean } = {}) {
  const room: Room = {
    id: 'r-auto-pass',
    mode: 'HUMAN_VS_AI',
    seats: [
      { index: 0, kind: 'HUMAN' },
      { index: 1, kind: 'AI', aiPlayerId: 'a1' },
      { index: 2, kind: 'AI', aiPlayerId: 'a2' },
    ],
    createdAt: Date.now(),
  };
  act(() => {
    useRoomStore.setState({ room });
    useGameStore.setState({
      phase: GamePhase.PLAYING,
      roomMode: 'HUMAN_VS_AI',
      humanSeat: 0,
      currentSeat: 0,
      isFreeTurn: opts.freeTurn ?? false,
      lastPlay: opts.freeTurn ? null : qqPair,
      players: [
        { seat: 0, name: '你', kind: 'HUMAN', hand: makeCards(handRanks), isLandlord: true },
        { seat: 1, name: '小明', kind: 'AI', hand: makeCards([3, 4]), isLandlord: false },
        { seat: 2, name: '小红', kind: 'AI', hand: makeCards([3, 4]), isLandlord: false },
      ] as never,
      playHistory: [],
      settlement: null,
    });
    useGameStore.getState().setAutoPassEnabled(opts.autoPass ?? true);
  });
}

function renderTable() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(
      <MemoryRouter>
        <GameTablePage />
      </MemoryRouter>,
    );
  });
  return {
    container,
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

describe('自动过牌', () => {
  beforeEach(() => {
    act(() => useGameStore.getState().resetGame());
  });

  afterEach(() => {
    act(() => {
      useGameStore.getState().resetGame();
      useRoomStore.getState().clearRoom();
    });
  });

  it('勾选 + 人类回合要不起 → 渲染后自动过牌', () => {
    // 手牌无 ≥Q 的对子：3 3 5 6 7 8，压不过 QQ
    setupGame([3, 3, 5, 6, 7, 8]);
    const t = renderTable();
    const st = useGameStore.getState();
    expect(st.playHistory.length).toBeGreaterThan(0);
    expect(st.playHistory[st.playHistory.length - 1].isPass).toBe(true);
    expect(st.playHistory[st.playHistory.length - 1].seat).toBe(0);
    t.unmount();
  });

  it('勾选 + 有牌可压（KK 对子）→ 不自动过牌', () => {
    setupGame([3, 3, 13, 13, 7, 8]);
    const t = renderTable();
    expect(useGameStore.getState().playHistory.length).toBe(0);
    t.unmount();
  });

  it('自由回合（首出）→ 不自动过牌', () => {
    setupGame([3, 3, 5, 6, 7, 8], { freeTurn: true });
    const t = renderTable();
    expect(useGameStore.getState().playHistory.length).toBe(0);
    t.unmount();
  });

  it('未勾选 → 不自动过牌', () => {
    setupGame([3, 3, 5, 6, 7, 8], { autoPass: false });
    const t = renderTable();
    expect(useGameStore.getState().playHistory.length).toBe(0);
    t.unmount();
  });
});
