// @vitest-environment jsdom
/**
 * PlayRecordDrawer 回归测试：验证人机模式的出牌记录侧边抽屉
 *  - 默认隐藏（aria-hidden + translate-x-full 推出屏幕外）；
 *  - 提供悬浮触发按钮；点击后平滑滑出（aria-hidden 取消）；
 *  - 面板内以纯文字形式渲染出牌记录（不含牌图）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { PlayRecordDrawer } from '@/components/table/PlayRecordDrawer';
import { useGameStore } from '@/store/gameStore';
import type { Card } from '@/types/card';
import { GamePhase } from '@/types/game';

function makeCard(rank: number, id: string): Card {
  return { id, rank: rank as Card['rank'], suit: 'SPADE', label: `${rank}` };
}

function render(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<PlayRecordDrawer />);
  });
  return { container, root };
}

describe('PlayRecordDrawer（人机模式出牌记录侧边抽屉）', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
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
    const r = render();
    container = r.container;
    root = r.root;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    act(() => useGameStore.getState().resetGame());
  });

  it('默认隐藏：触发按钮存在，面板 aria-hidden 且推出屏幕外', () => {
    const trigger = container.querySelector('[aria-label="打开出牌记录"]');
    expect(trigger).not.toBeNull();

    const panel = container.querySelector('[aria-label="出牌记录抽屉"]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('aria-hidden')).toBe('true');
    expect(panel?.className).toContain('translate-x-full');

    // 面板内部仍挂载着出牌记录内容（仅被推到屏幕外）
    expect(container.querySelector('[aria-label="出牌记录时间线"]')).not.toBeNull();
  });

  it('点击触发按钮后：面板滑出（aria-hidden 取消）', () => {
    const trigger = container.querySelector('[aria-label="打开出牌记录"]') as HTMLButtonElement;
    const panel = container.querySelector('[aria-label="出牌记录抽屉"]') as HTMLElement;

    expect(panel.getAttribute('aria-hidden')).toBe('true');
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(panel.getAttribute('aria-hidden')).toBe('false');
    expect(panel.className).toContain('translate-x-0');
  });

  it('以纯文字形式展示出牌记录，不渲染牌图', () => {
    act(() => {
      useGameStore.setState({
        playHistory: [
          { seat: 0, cards: [makeCard(3, 'a'), makeCard(4, 'b'), makeCard(5, 'c'), makeCard(6, 'd'), makeCard(7, 'e')], pattern: { type: 'STRAIGHT' as never, mainRank: 7, length: 5, cards: [] }, isPass: false, turn: 0 },
          { seat: 1, cards: [], pattern: null, isPass: true, turn: 1 },
        ],
      });
    });

    const text = container.textContent ?? '';
    // 文字描述：点数升序 + 牌型名
    expect(text).toContain('出 3 4 5 6 7（顺子）');
    expect(text).toContain('过牌');
    // 不应出现「牌图」语义（CardGroup 仅 cards 形态使用，本抽屉为 text）
    expect(container.querySelector('[aria-label="出牌记录时间线"] svg, [aria-label="出牌记录时间线"] img')).toBeNull();
  });
});
