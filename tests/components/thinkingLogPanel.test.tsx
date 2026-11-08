// @vitest-environment jsdom
/**
 * 思考日志面板双标签测试。
 * 验证：
 *  - 默认「对局日志」标签显示 logStore 内容；
 *  - 可切到「思考日志」标签，历史记录与流式中的思考均正确渲染；
 *  - 新的思考流开始时自动切换到思考标签；
 *  - 两个标签各自的导出按钮生成正确文件名并触发下载（mock Blob URL）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react';

// react act() 环境标志，消除 jsdom 下的 act 警告
(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
import { ThinkingLogPanel } from '@/components/table/ThinkingLogPanel';
import { useLogStore } from '@/store/logStore';
import { useThinkingStore } from '@/store/thinkingStore';
import type { ThinkingLog } from '@/types/ai';

const LOGS: ThinkingLog[] = [
  {
    id: 'log-1',
    seat: 1,
    playerName: '小明',
    level: 'info',
    message: '叫 1 分',
    source: undefined,
    timestamp: Date.now(),
  },
];

function render(): { unmount: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(<ThinkingLogPanel />);
  });
  return {
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

/** 按文本找按钮并点击 */
function clickButton(text: string): void {
  const btn: HTMLButtonElement | undefined = [...document.body.querySelectorAll('button')].find(
    (b: HTMLButtonElement): boolean => b.textContent?.trim() === text,
  );
  expect(btn, `按钮「${text}」应存在`).toBeDefined();
  act(() => {
    btn!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('ThinkingLogPanel 双标签', () => {
  beforeEach(() => {
    // jsdom 未实现 createObjectURL/revokeObjectURL，直接以 mock 函数赋值
    (URL as unknown as Record<string, unknown>).createObjectURL = vi.fn(() => 'blob:mock');
    (URL as unknown as Record<string, unknown>).revokeObjectURL = vi.fn(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    act(() => {
      useLogStore.setState({ logs: LOGS });
      useThinkingStore.setState({ live: null, entries: [] });
    });
  });

  afterEach(() => {
    act(() => {
      useLogStore.setState({ logs: [] });
      useThinkingStore.getState().clear();
    });
    vi.restoreAllMocks();
  });

  it('默认对局日志标签：显示 logStore 的日志行', () => {
    const t = render();
    expect(document.body.textContent).toContain('叫 1 分');
    expect(document.body.textContent).not.toContain('（该模型未返回思考内容）');
    t.unmount();
  });

  it('切到思考标签：历史记录渲染，导出可用', () => {
    act(() => {
      useThinkingStore.setState({
        entries: [
          {
            id: 'thk-1',
            seat: 1,
            playerName: '小明',
            phase: 'play',
            round: '第 2 手',
            startedAt: Date.now(),
            durationMs: 1234,
            thinking: '对手剩两张，压单张风险低',
            truncated: false,
            status: 'ok',
          },
        ],
      });
    });
    const t = render();
    clickButton('思考日志');
    expect(document.body.textContent).toContain('对手剩两张，压单张风险低');
    expect(document.body.textContent).toContain('第 2 手');
    t.unmount();
  });

  it('流式中的思考：显示「思考中」与实时文本', () => {
    const t = render();
    act(() => {
      useThinkingStore.getState().begin({ seat: 2, playerName: '小红', phase: 'bid', round: '叫分' });
      useThinkingStore.getState().appendThinking('牌力一般，先不叫');
    });
    // 新流开始自动切到思考标签
    expect(document.body.textContent).toContain('思考中');
    expect(document.body.textContent).toContain('牌力一般，先不叫');
    expect(document.body.textContent).toContain('叫分');
    t.unmount();
  });

  it('对局日志导出：生成 txt 文件名并触发下载', () => {
    const t = render();
    clickButton('导出');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob: Blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blob.type).toContain('text/plain');
    const anchor = (HTMLAnchorElement.prototype.click as ReturnType<typeof vi.fn>).mock;
    expect(anchor.instances).toBeDefined();
    t.unmount();
  });

  it('思考日志导出：生成 markdown 文件', () => {
    const t = render();
    act(() => {
      useThinkingStore.setState({
        entries: [
          {
            id: 'thk-1',
            seat: 1,
            playerName: '小明',
            phase: 'play',
            round: '第 2 手',
            startedAt: Date.now(),
            durationMs: 1000,
            thinking: '思考内容',
            truncated: false,
            status: 'ok',
          },
        ],
      });
    });
    clickButton('思考日志');
    clickButton('导出');
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob: Blob = (URL.createObjectURL as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blob.type).toContain('text/markdown');
    t.unmount();
  });

  it('无数据时导出按钮禁用', () => {
    const t = render();
    act(() => {
      useLogStore.setState({ logs: [] });
    });
    const exportBtn: HTMLButtonElement | undefined = [...document.body.querySelectorAll('button')].find(
      (b: HTMLButtonElement): boolean => b.textContent?.trim() === '导出',
    );
    expect(exportBtn?.disabled).toBe(true);
    t.unmount();
  });
});
