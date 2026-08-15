// @vitest-environment jsdom
/**
 * ThinkingLogDrawer 回归测试：验证 AI 思考日志面板
 *  - 默认隐藏（aria-hidden + translate-x-full 推出屏幕外）；
 *  - 提供悬浮触发按钮；点击后平滑滑出（aria-hidden 取消）；
 *  - 面板内渲染 AI 思考日志内容，且背景为半透明玻璃态（bg-white/80 / dark:bg-slate-900/70）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';
import { ThinkingLogDrawer } from '@/components/table/ThinkingLogDrawer';

function render(): { container: HTMLDivElement; root: Root } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(<ThinkingLogDrawer />);
  });
  return { container, root };
}

describe('ThinkingLogDrawer（AI 思考日志侧边抽屉）', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    const r = render();
    container = r.container;
    root = r.root;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('默认隐藏：触发按钮存在，面板 aria-hidden 且推出屏幕外', () => {
    const trigger = container.querySelector('[aria-label="打开 AI 思考日志"]');
    expect(trigger).not.toBeNull();

    const panel = container.querySelector('[aria-label="AI 思考日志面板"]');
    expect(panel).not.toBeNull();
    // 默认关闭
    expect(panel?.getAttribute('aria-hidden')).toBe('true');
    expect(panel?.className).toContain('translate-x-full');

    // 面板内部仍挂载着 AI 思考日志内容（仅被推到屏幕外）
    expect(container.querySelector('[aria-label="AI 思考日志"]')).not.toBeNull();
  });

  it('点击触发按钮后：面板滑出（aria-hidden 取消）', () => {
    const trigger = container.querySelector('[aria-label="打开 AI 思考日志"]') as HTMLButtonElement;
    const panel = container.querySelector('[aria-label="AI 思考日志面板"]') as HTMLElement;

    expect(panel.getAttribute('aria-hidden')).toBe('true');
    act(() => {
      trigger.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(panel.getAttribute('aria-hidden')).toBe('false');
    expect(panel.className).toContain('translate-x-0');
  });

  it('面板背景为半透明玻璃态', () => {
    const section = container.querySelector('[aria-label="AI 思考日志"]') as HTMLElement;
    // UI 重构后玻璃面板为深色半透明（bg-felt-950/80 + backdrop-blur-xl），与原 bg-white/80 同属玻璃拟态
    expect(section.className).toMatch(/bg-felt-950\/80|bg-white\/80|dark:bg-slate-900\/70/);
    expect(section.className).toMatch(/backdrop-blur-xl|backdrop-blur/);
  });
});
