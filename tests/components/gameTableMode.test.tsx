// @vitest-environment jsdom
/**
 * GameTablePage 模式条件渲染 + 中途退出测试。
 * 验证：
 *  - 人机模式(HUMAN_VS_AI)：侧栏显示「出牌记录时间线」，不显示「AI 思考日志」；
 *  - 观战模式(AI_SPECTATE)：侧栏显示「AI 思考日志」；
 *  - 中途点「退出对局」：resetGame + clearRoom，房间清空、phase 回 IDLE。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { GameTablePage } from '@/pages/GameTablePage';
import { useGameStore } from '@/store/gameStore';
import { useRoomStore } from '@/store/roomStore';
import { GamePhase } from '@/types/game';
import type { Room } from '@/types/config';

function basePlayers() {
  return [
    { seat: 0, name: '你', kind: 'HUMAN' as const, hand: [], isLandlord: true },
    { seat: 1, name: '小明', kind: 'AI' as const, hand: [], isLandlord: false },
    { seat: 2, name: '小红', kind: 'AI' as const, hand: [], isLandlord: false },
  ];
}

function setHumanMode() {
  const room: Room = {
    id: 'r1',
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
      players: basePlayers() as never,
      settlement: null,
    });
  });
}

function setSpectateMode() {
  const room: Room = {
    id: 'r2',
    mode: 'AI_SPECTATE',
    seats: [
      { index: 0, kind: 'AI', aiPlayerId: 'a1' },
      { index: 1, kind: 'AI', aiPlayerId: 'a2' },
      { index: 2, kind: 'AI', aiPlayerId: 'a3' },
    ],
    createdAt: Date.now(),
  };
  act(() => {
    useRoomStore.setState({ room });
    useGameStore.setState({
      phase: GamePhase.PLAYING,
      roomMode: 'AI_SPECTATE',
      humanSeat: null,
      currentSeat: 0,
      players: basePlayers() as never,
      settlement: null,
    });
  });
}

describe('GameTablePage 模式条件渲染与退出', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    act(() => {
      useGameStore.getState().resetGame();
      useRoomStore.getState().clearRoom();
    });
  });

  it('人机模式：侧栏显示「出牌记录」而非「AI 思考日志」', () => {
    setHumanMode();
    act(() => {
      root = createRoot(container);
      root.render(
        <MemoryRouter>
          <GameTablePage />
        </MemoryRouter>,
      );
    });
    expect(container.querySelector('[aria-label="出牌记录时间线"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="AI 思考日志"]')).toBeNull();
  });

  it('观战模式：侧栏显示「AI 思考日志」', () => {
    setSpectateMode();
    act(() => {
      root = createRoot(container);
      root.render(
        <MemoryRouter>
          <GameTablePage />
        </MemoryRouter>,
      );
    });
    expect(container.querySelector('[aria-label="AI 思考日志"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="出牌记录时间线"]')).toBeNull();
  });

  it('中途点击「退出对局」：清空房间且 phase 回 IDLE', () => {
    setHumanMode();
    act(() => {
      root = createRoot(container);
      root.render(
        <MemoryRouter>
          <GameTablePage />
        </MemoryRouter>,
      );
    });

    const exitBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => (b.textContent ?? '').trim() === '退出对局',
    );
    expect(exitBtn).not.toBeUndefined();

    act(() => {
      exitBtn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // 退出后应真正清局：房间为空 + 牌桌回到 IDLE，不再残留冻结旧局
    expect(useRoomStore.getState().room).toBeNull();
    expect(useGameStore.getState().phase).toBe(GamePhase.IDLE);
  });
});
