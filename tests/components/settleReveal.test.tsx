// @vitest-environment jsdom
/**
 * 终局摊牌测试（2026-11-18）。
 *
 * 回归的问题：人机模式（HUMAN_VS_AI）下对局结束（phase=SETTLED）后，
 * 牌桌只显示「剩 N 张」，看不到其他两家到底剩什么牌——结算后应摊开三家手牌。
 *
 * 断言：
 *  - 对局进行中：只渲染自己（viewSeat）的手牌，对家的牌不可见；
 *  - 进入 SETTLED：三家手牌全部摊开，并出现「终局摊牌」提示；
 *  - 进入 SETTLED：自己的牌不再可点选（避免结算后还能选牌）；
 *  - 进入 SETTLED：结算前选中的牌不再保持高亮（selectedCardIds 不再透传）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { GameTablePage } from '@/pages/GameTablePage';
import { useGameStore } from '@/store/gameStore';
import { useRoomStore } from '@/store/roomStore';
import { GamePhase, type Player, type SettlementResult } from '@/types/game';
import type { Room } from '@/types/config';
import { hand } from '../helpers/cards';

function roomOf(): Room {
  return {
    id: 'settle-room',
    mode: 'HUMAN_VS_AI',
    seats: [
      { index: 0, kind: 'HUMAN' },
      { index: 1, kind: 'AI', aiPlayerId: 'a1' },
      { index: 2, kind: 'AI', aiPlayerId: 'a2' },
    ],
    createdAt: Date.now(),
  };
}

function playersOf(humanHand: string, leftHand: string, rightHand: string): [Player, Player, Player] {
  return [
    { seat: 0, name: '你', kind: 'HUMAN', hand: hand(humanHand), isLandlord: true },
    { seat: 1, name: '小明', kind: 'AI', hand: hand(leftHand), isLandlord: false },
    { seat: 2, name: '小红', kind: 'AI', hand: hand(rightHand), isLandlord: false },
  ];
}

const SETTLEMENT: SettlementResult = {
  landlordWin: true,
  baseScore: 3,
  multiplier: 2,
  unitScore: 6,
  seatScores: [12, -6, -6],
  isSpring: false,
  isAntiSpring: false,
  multiplierDetail: [{ reason: '炸弹', factor: 2 }],
};

/** 手牌区的牌面按钮 aria-label（形如 `A♠`）；对家面板里的小牌同样命中，故按数量判断。 */
function cardButtonLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('button[aria-label]'))
    .map((el) => el.getAttribute('aria-label') ?? '')
    .filter((label) => /^(10|[3-9JQKA2]|BJ|RJ)[♠♥♣♦]$/.test(label));
}

/**
 * 处于「选中」态的牌面按钮标签。
 * 必须过滤牌面格式：操作栏里也有带 aria-label + aria-pressed 的按钮，不能一起数。
 */
function pressedCardLabels(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('button[aria-label][aria-pressed="true"]'))
    .map((el) => el.getAttribute('aria-label') ?? '')
    .filter((label) => /^(10|[3-9JQKA2]|BJ|RJ)[♠♥♣♦]$/.test(label));
}

describe('终局摊牌：SETTLED 后展示其他玩家剩余手牌', () => {
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

  function render(): void {
    act(() => {
      root = createRoot(container);
      root.render(
        <MemoryRouter>
          <GameTablePage />
        </MemoryRouter>,
      );
    });
  }

  it('对局进行中：只渲染自己的手牌，对家的牌不可见', () => {
    act(() => {
      useRoomStore.setState({ room: roomOf() });
      useGameStore.setState({
        phase: GamePhase.PLAYING,
        roomMode: 'HUMAN_VS_AI',
        humanSeat: 0,
        currentSeat: 0,
        players: playersOf('3 4 5', 'A K', 'Q J') as never,
        settlement: null,
      });
    });
    render();

    const labels: string[] = cardButtonLabels(container);
    // 自己的 3 张在
    expect(labels).toContain('3♠');
    expect(labels).toContain('5♠');
    // 对家的牌不在
    expect(labels).not.toContain('A♠');
    expect(labels).not.toContain('Q♠');
    // 没有终局提示
    expect(container.textContent ?? '').not.toContain('终局摊牌');
  });

  it('SETTLED：三家剩余手牌全部摊开，并给出终局提示', () => {
    act(() => {
      useRoomStore.setState({ room: roomOf() });
      useGameStore.setState({
        phase: GamePhase.SETTLED,
        roomMode: 'HUMAN_VS_AI',
        humanSeat: 0,
        currentSeat: 0,
        players: playersOf('3 4 5', 'A K', 'Q J') as never,
        settlement: SETTLEMENT,
      });
    });
    render();

    const labels: string[] = cardButtonLabels(container);
    // 自己、左家、右家的牌都应出现（3 + 2 + 2 = 7 张）
    expect(labels).toContain('3♠');
    expect(labels).toContain('A♠');
    expect(labels).toContain('K♠');
    expect(labels).toContain('Q♠');
    expect(labels).toContain('J♠');
    expect(container.textContent ?? '').toContain('终局摊牌');
  });

  it('SETTLED：自己的牌不再可点选', () => {
    act(() => {
      useRoomStore.setState({ room: roomOf() });
      useGameStore.setState({
        phase: GamePhase.SETTLED,
        roomMode: 'HUMAN_VS_AI',
        humanSeat: 0,
        currentSeat: 0,
        players: playersOf('3 4 5', 'A', 'Q') as never,
        settlement: SETTLEMENT,
      });
    });
    render();

    const own = Array.from(container.querySelectorAll('button[aria-label="3♠"]'));
    expect(own.length).toBeGreaterThan(0);
    // HandCards 通过 disabled 关闭交互
    expect(own.every((el) => (el as HTMLButtonElement).disabled)).toBe(true);
  });

  it('SETTLED：结算前选中的牌不再带选中高亮', () => {
    const players = playersOf('3 4 5', 'A', 'Q');
    const selectedId: string = players[0].hand[0].id;

    // 对照组：PLAYING 时选中态正常体现（aria-pressed=true）
    act(() => {
      useRoomStore.setState({ room: roomOf() });
      useGameStore.setState({
        phase: GamePhase.PLAYING,
        roomMode: 'HUMAN_VS_AI',
        humanSeat: 0,
        currentSeat: 0,
        players: players as never,
        settlement: null,
        selectedCardIds: [selectedId],
      });
    });
    render();
    const pressedInPlay: string[] = pressedCardLabels(container);
    expect(pressedInPlay).toHaveLength(1);
    expect(pressedInPlay[0]).toBe('3♠');

    // 终局：同一份 selectedCardIds，但不应再有任何选中样式
    act(() => {
      useGameStore.setState({ phase: GamePhase.SETTLED, settlement: SETTLEMENT });
    });
    expect(pressedCardLabels(container)).toHaveLength(0);
  });
});
