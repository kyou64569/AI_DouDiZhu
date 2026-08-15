import { describe, it, expect, beforeEach } from 'vitest';
import { useGameStore } from '@/store/gameStore';
import { useRoomStore } from '@/store/roomStore';
import { GamePhase } from '@/types/game';

/** 构造一个已激活的观战房间（沿用既有测试的 as never 形态，仅用于驱动 startGame） */
function setupRoom(): void {
  useRoomStore.setState({
    room: {
      id: 'exit-room',
      mode: 'AI_SPECTATE',
      seats: [
        { index: 0, kind: 'AI', aiPlayerId: undefined },
        { index: 1, kind: 'AI', aiPlayerId: undefined },
        { index: 2, kind: 'AI', aiPlayerId: undefined },
      ],
    } as never,
  });
}

/** 等价于 GameTablePage 的 onExit：清牌桌 + 清已激活房间 */
function simulateExit(): void {
  useGameStore.getState().resetGame();
  useRoomStore.getState().clearRoom();
}

describe('退出对局清空已激活房间（防自动再开一局）', () => {
  beforeEach(() => {
    useGameStore.getState().resetGame();
    useRoomStore.setState({ room: null });
  });

  it('开局后再退出：room 置空、phase 回到 IDLE', () => {
    setupRoom();
    useGameStore.getState().startGame();
    expect(useGameStore.getState().phase).not.toBe(GamePhase.IDLE);
    expect(useRoomStore.getState().room).not.toBeNull();

    simulateExit();

    expect(useGameStore.getState().phase).toBe(GamePhase.IDLE);
    expect(useRoomStore.getState().room).toBeNull();
  });

  it('退出后 GameTablePage 自动开局条件不再满足', () => {
    setupRoom();
    useGameStore.getState().startGame();
    simulateExit();

    // GameTablePage 自动开局 effect 的判定：`room && phase === IDLE`
    const canAutoStart =
      useRoomStore.getState().room !== null && useGameStore.getState().phase === GamePhase.IDLE;
    expect(canAutoStart).toBe(false);
  });

  it('退出后即使回到 /table，也不会自动发牌（房间为空时 startGame 直接拒绝）', () => {
    setupRoom();
    useGameStore.getState().startGame();
    simulateExit();

    // 模拟「再次进入 /table」时自动开局 effect 调用 startGame()
    const started = useGameStore.getState().startGame();
    expect(started).toBe(false);
    // 牌桌仍停在 IDLE，没有新的一局被开出来
    expect(useGameStore.getState().phase).toBe(GamePhase.IDLE);
  });

  it('clearRoom 仅清 room，保留模式与座位配置（便于快速再来）', () => {
    useRoomStore.setState({
      mode: 'HUMAN_VS_AI',
      seatPlayerIds: ['p1', 'p2', null] as never,
    });
    useRoomStore.getState().clearRoom();

    expect(useRoomStore.getState().room).toBeNull();
    expect(useRoomStore.getState().mode).toBe('HUMAN_VS_AI');
    expect(useRoomStore.getState().seatPlayerIds[0]).toBe('p1');
  });
});
