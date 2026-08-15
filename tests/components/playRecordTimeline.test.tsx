// @vitest-environment jsdom
/**
 * PlayRecordTimeline 渲染测试（人机模式侧栏）。
 * 验证：按时间线展示叫分 + 逐手出牌/过牌；不展示 AI 思考(reason)；空局有占位提示。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { PlayRecordTimeline } from '@/components/table/PlayRecordTimeline';
import { useGameStore } from '@/store/gameStore';
import type { Card } from '@/types/card';
import { GamePhase } from '@/types/game';

function makeCard(rank: number, id: string): Card {
  return { id, rank: rank as Card['rank'], suit: 'SPADE', label: `${rank}` };
}

describe('PlayRecordTimeline', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    // 清零历史
    act(() => {
      useGameStore.setState({
        phase: GamePhase.PLAYING,
        bidHistory: [],
        playHistory: [],
        players: [
          { seat: 0, name: '你', kind: 'HUMAN', hand: [], isLandlord: true },
          { seat: 1, name: '小明', kind: 'AI', hand: [], isLandlord: false },
          { seat: 2, name: '小红', kind: 'AI', hand: [], isLandlord: false },
        ] as never,
      });
    });
  });

  it('空局显示占位提示', () => {
    act(() => {
      root.render(<PlayRecordTimeline />);
    });
    expect(container.querySelector('[aria-label="出牌记录时间线"]')).not.toBeNull();
    expect(container.textContent).toContain('本局尚未开始');
  });

  it('按时间线展示叫分与逐手出牌/过牌，且不包含 AI 思考', () => {
    act(() => {
      useGameStore.setState({
        bidHistory: [
          { seat: 0, score: 0 },
          { seat: 1, score: 2 },
          { seat: 2, score: 3 },
        ],
        playHistory: [
          { seat: 2, cards: [makeCard(5, 'c1')], pattern: null, isPass: false, turn: 0 },
          { seat: 0, cards: [], pattern: null, isPass: true, turn: 1 },
          { seat: 1, cards: [makeCard(7, 'c2'), makeCard(7, 'c3')], pattern: null, isPass: false, turn: 2 },
        ],
      });
    });
    act(() => {
      root.render(<PlayRecordTimeline />);
    });

    const text = container.textContent ?? '';
    expect(text).toContain('不叫'); // seat0
    expect(text).toContain('叫 2 分'); // seat1
    expect(text).toContain('叫 3 分'); // seat2
    expect(text).toContain('过牌'); // seat0 pass
    // 出牌以牌面渲染（CardView 展示点数文本）
    expect(text).toContain('5');
    expect(text).toContain('7');
    // 关键：人机模式侧栏不得泄露 AI 思考过程
    expect(text).not.toContain('思考');
    expect(text).not.toContain('reason');
  });

  it('variant="text"：以纯文字描述出牌（含牌型名），不渲染牌图', () => {
    act(() => {
      useGameStore.setState({
        bidHistory: [
          { seat: 0, score: 0 },
          { seat: 1, score: 2 },
          { seat: 2, score: 3 },
        ],
        playHistory: [
          { seat: 2, cards: [makeCard(3, 'c1'), makeCard(4, 'c2'), makeCard(5, 'c3'), makeCard(6, 'c4'), makeCard(7, 'c5')], pattern: { type: 'STRAIGHT' as never, mainRank: 7, length: 5, cards: [] }, isPass: false, turn: 0 },
          { seat: 0, cards: [], pattern: null, isPass: true, turn: 1 },
          { seat: 1, cards: [makeCard(7, 'c6'), makeCard(7, 'c7')], pattern: { type: 'PAIR' as never, mainRank: 7, length: 1, cards: [] }, isPass: false, turn: 2 },
        ],
      });
    });
    act(() => {
      root.render(<PlayRecordTimeline variant="text" />);
    });

    const text = container.textContent ?? '';
    expect(text).toContain('不叫');
    expect(text).toContain('叫 2 分');
    expect(text).toContain('叫 3 分');
    // 文字模式：牌按点数升序 + 牌型名
    expect(text).toContain('出 3 4 5 6 7（顺子）');
    expect(text).toContain('过牌');
    expect(text).toContain('出 7 7（对子）');
    // 关键：文字模式不得渲染牌图（CardGroup 仅 cards 形态使用）
    expect(container.querySelector('[aria-label="出牌记录时间线"] svg, [aria-label="出牌记录时间线"] img')).toBeNull();
  });
});
