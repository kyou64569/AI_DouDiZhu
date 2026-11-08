import { describe, it, expect, beforeEach } from 'vitest';
import {
  useThinkingStore,
  MAX_THINKING_CHARS,
  TRUNCATED_SUFFIX,
  MAX_THINKING_ENTRIES,
} from '@/store/thinkingStore';

describe('thinkingStore 流式思考生命周期', () => {
  beforeEach(() => {
    useThinkingStore.getState().clear();
  });

  it('begin → appendThinking → settle(ok)：增量累积并落一条完成记录', () => {
    const store = useThinkingStore.getState();
    store.begin({ seat: 1, playerName: '小明', phase: 'play', round: '第 3 手' });
    expect(useThinkingStore.getState().live).not.toBeNull();

    useThinkingStore.getState().appendThinking('先数一下剩余牌');
    useThinkingStore.getState().appendThinking('，对手大概率没有炸弹');
    useThinkingStore.getState().settle(true);

    const state = useThinkingStore.getState();
    expect(state.live).toBeNull();
    expect(state.entries).toHaveLength(1);
    const entry = state.entries[0];
    expect(entry).toMatchObject({
      seat: 1,
      playerName: '小明',
      phase: 'play',
      round: '第 3 手',
      thinking: '先数一下剩余牌，对手大概率没有炸弹',
      truncated: false,
      status: 'ok',
    });
    expect(entry.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('settle(false) 落失败记录（思考可能不完整）', () => {
    useThinkingStore.getState().begin({ seat: 0, playerName: '你', phase: 'bid', round: '叫分' });
    useThinkingStore.getState().appendThinking('只推到一半');
    useThinkingStore.getState().settle(false);
    expect(useThinkingStore.getState().entries[0].status).toBe('error');
  });

  it('无进行中的流时 append/settle 均为空操作', () => {
    useThinkingStore.getState().appendThinking('孤儿增量');
    useThinkingStore.getState().settle(true);
    expect(useThinkingStore.getState().entries).toHaveLength(0);
    expect(useThinkingStore.getState().live).toBeNull();
  });

  it('重复 settle 只落一条（第二次为空操作）', () => {
    useThinkingStore.getState().begin({ seat: 2, playerName: '小红', phase: 'play', round: '第 1 手' });
    useThinkingStore.getState().settle(true);
    useThinkingStore.getState().settle(true);
    expect(useThinkingStore.getState().entries).toHaveLength(1);
  });

  it('思考正文超过 4096 字符时截断并追加指示符', () => {
    useThinkingStore.getState().begin({ seat: 1, playerName: '小明', phase: 'play', round: '第 1 手' });
    useThinkingStore.getState().appendThinking('啊'.repeat(MAX_THINKING_CHARS + 500));
    useThinkingStore.getState().settle(true);
    const entry = useThinkingStore.getState().entries[0];
    expect(entry.truncated).toBe(true);
    expect(entry.thinking.length).toBe(MAX_THINKING_CHARS + TRUNCATED_SUFFIX.length);
    expect(entry.thinking.endsWith(TRUNCATED_SUFFIX)).toBe(true);
  });

  it('恰好 4096 字符不截断', () => {
    useThinkingStore.getState().begin({ seat: 1, playerName: '小明', phase: 'play', round: '第 1 手' });
    useThinkingStore.getState().appendThinking('好'.repeat(MAX_THINKING_CHARS));
    useThinkingStore.getState().settle(true);
    expect(useThinkingStore.getState().entries[0].truncated).toBe(false);
  });

  it('历史容量上限：超出丢最旧', () => {
    for (let i = 0; i < MAX_THINKING_ENTRIES + 5; i += 1) {
      useThinkingStore.getState().begin({ seat: 1, playerName: '小明', phase: 'play', round: `第 ${i + 1} 手` });
      useThinkingStore.getState().settle(true);
    }
    const entries = useThinkingStore.getState().entries;
    expect(entries).toHaveLength(MAX_THINKING_ENTRIES);
    expect(entries[0].round).toBe(`第 6 手`);
    expect(entries[entries.length - 1].round).toBe(`第 ${MAX_THINKING_ENTRIES + 5} 手`);
  });

  it('begin 替换残留的上一条流（不产生脏状态）', () => {
    useThinkingStore.getState().begin({ seat: 0, playerName: '甲', phase: 'bid', round: '叫分' });
    useThinkingStore.getState().appendThinking('上一条的思考');
    useThinkingStore.getState().begin({ seat: 2, playerName: '乙', phase: 'play', round: '第 1 手' });
    const live = useThinkingStore.getState().live;
    expect(live?.playerName).toBe('乙');
    useThinkingStore.getState().settle(true);
    const entries = useThinkingStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].thinking).toBe('');
  });

  it('clear 清空 live 与 entries', () => {
    useThinkingStore.getState().begin({ seat: 1, playerName: '小明', phase: 'play', round: '第 1 手' });
    useThinkingStore.getState().settle(true);
    useThinkingStore.getState().clear();
    expect(useThinkingStore.getState().live).toBeNull();
    expect(useThinkingStore.getState().entries).toHaveLength(0);
  });
});
