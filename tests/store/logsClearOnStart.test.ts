/**
 * 回归测试：新开局必须清空上一局残留的 AI 思考日志。
 * 场景：观战模式打完一局后重新进入牌桌，思考日志不应残留上局内容。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useGameStore } from '@/store/gameStore';
import { useLogStore } from '@/store/logStore';
import { useConfigStore } from '@/store/configStore';
import { usePlayerStore } from '@/store/playerStore';
import { DecisionSource } from '@/types/ai';
import { GamePhase } from '@/types/game';
import type { Room } from '@/types/config';

beforeEach(() => {
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  useConfigStore.getState().addConfig({
    name: '日志清理测试',
    provider: 'OpenAI',
    baseUrl: 'http://127.0.0.1:1/v1',
    apiKey: 'sk-x',
    availableModels: ['m'],
    selectedModel: 'm',
  } as never);
  const cfgId: string = useConfigStore.getState().configs[0].id;
  for (const n of ['甲', '乙', '丙']) {
    usePlayerStore.getState().addPlayer({
      name: n,
      modelConfigId: cfgId,
      modelId: '',
      remark: '',
      avatar: '',
    } as never);
  }
  useGameStore.getState().resetGame();
});

function makeSpectateRoom(): Room {
  const ids: string[] = usePlayerStore.getState().players.map((p) => p.id);
  return {
    id: 'r-log-clear',
    mode: 'AI_SPECTATE',
    seats: [
      { index: 0, kind: 'AI', aiPlayerId: ids[0] },
      { index: 1, kind: 'AI', aiPlayerId: ids[1] },
      { index: 2, kind: 'AI', aiPlayerId: ids[2] },
    ],
    createdAt: Date.now(),
  };
}

describe('AI 思考日志清理', () => {
  it('startGame 新开局清空上一局残留日志', () => {
    // 预置上一局残留的思考日志
    useLogStore.getState().append({ seat: 1, playerName: '甲', level: 'info', message: '上局 LLM 决策', source: DecisionSource.LLM });
    useLogStore.getState().append({ seat: 2, playerName: '乙', level: 'warn', message: '上局降级', source: DecisionSource.FALLBACK_ERROR });
    expect(useLogStore.getState().logs.length).toBe(2);

    const ok: boolean = useGameStore.getState().startGame(makeSpectateRoom());
    expect(ok).toBe(true);
    expect(useLogStore.getState().logs.length).toBe(0);
  });

  it('流局重发(needRedeal)时清空叫分阶段日志', () => {
    useGameStore.getState().startGame(makeSpectateRoom());
    // 模拟已产生一条叫分日志
    useLogStore.getState().append({ seat: 0, playerName: '甲', level: 'info', message: '叫分中', source: DecisionSource.LLM });
    // 按 currentSeat 顺序三家都叫 0（全不叫）→ 流局重发
    let guard = 0;
    while (useGameStore.getState().phase === GamePhase.BIDDING && guard < 5) {
      const st = useGameStore.getState();
      st.bid(0 as never, st.currentSeat);
      guard += 1;
    }
    expect(useGameStore.getState().redealCount).toBeGreaterThan(0);
    expect(useLogStore.getState().logs.length).toBe(0);
  });
});
