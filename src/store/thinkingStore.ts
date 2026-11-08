/**
 * AI 思考流 store（思考日志标签页的数据源）。
 *
 * 职责：承载 AI 决策期间流式到达的 reasoning 增量，并把每一条完成的思考
 * 落为历史记录供回看与导出。
 *
 * 设计约定：
 * - aiAct 重入锁保证同一时刻只有一条流，live 用单对象而非按 seat 的 Map；
 * - 思考正文截断 4096 字符（指南 §7.7），避免长对局把内存/导出文件撑爆；
 *   流中缓冲另有更宽的硬上限（4 倍），到达后停止累积但继续接收事件直至结束；
 * - 不持久化：与 logStore 同策略，单局临时数据，刷新即清空。
 */

import { create } from 'zustand';
import { createId } from '@/utils/id';
import type { SeatIndex } from '@/types/game';

/** 思考发生的阶段 */
export type ThinkingPhase = 'bid' | 'play';

/** 一条已完成的思考记录 */
export interface ThinkingRecord {
  id: string;
  seat: SeatIndex;
  playerName: string;
  phase: ThinkingPhase;
  /** 轮次描述（如「叫分」「第 3 手」），仅用于展示 */
  round: string;
  startedAt: number;
  durationMs: number;
  /** 思考正文（超长截断，见 MAX_THINKING_CHARS） */
  thinking: string;
  /** 思考正文是否因超长被截断 */
  truncated: boolean;
  /** ok=正常拿到答案；error=失败（上游错误/超时/被中止，思考可能不完整） */
  status: 'ok' | 'error';
}

/** 进行中的一条流式思考 */
export interface LiveThinkingStream {
  seat: SeatIndex;
  playerName: string;
  phase: ThinkingPhase;
  round: string;
  startedAt: number;
  thinking: string;
}

/** 单条记录思考正文上限（指南 §7.7） */
export const MAX_THINKING_CHARS: number = 4096;

/** 截断指示符（追加在正文末尾，不计入预算，落库阶段追加） */
export const TRUNCATED_SUFFIX: string = '…（思考内容过长已截断）';

/** 历史记录容量上限（超出丢最旧） */
export const MAX_THINKING_ENTRIES: number = 100;

/** 流中缓冲硬上限：到达后停止累积（仍接收事件直至结束），防失控模型打爆内存 */
const MAX_LIVE_CHARS: number = MAX_THINKING_CHARS * 4;

/** 超长截断：保留头部 + 指示符 */
function truncateThinking(text: string): { text: string; truncated: boolean } {
  if (text.length <= MAX_THINKING_CHARS) {
    return { text, truncated: false };
  }
  return { text: text.slice(0, MAX_THINKING_CHARS) + TRUNCATED_SUFFIX, truncated: true };
}

export interface ThinkingBeginInput {
  seat: SeatIndex;
  playerName: string;
  phase: ThinkingPhase;
  round: string;
}

interface ThinkingState {
  /** 进行中的流式思考（aiAct 重入锁保证至多一条）；null = 当前无思考 */
  live: LiveThinkingStream | null;
  /** 已完成的思考记录（时间升序，最新在末尾） */
  entries: ThinkingRecord[];
  /** 开始一条新的流式思考（替换可能残留的上一条） */
  begin: (input: ThinkingBeginInput) => void;
  /** 追加思考增量；无进行中的流时忽略 */
  appendThinking: (delta: string) => void;
  /** 结束当前流并落历史；无进行中的流时忽略 */
  settle: (ok: boolean) => void;
  /** 清空全部（新开局时调用） */
  clear: () => void;
}

export const useThinkingStore = create<ThinkingState>((set, get) => ({
  live: null,
  entries: [],

  begin: (input: ThinkingBeginInput): void => {
    set({
      live: {
        seat: input.seat,
        playerName: input.playerName,
        phase: input.phase,
        round: input.round,
        startedAt: Date.now(),
        thinking: '',
      },
    });
  },

  appendThinking: (delta: string): void => {
    const live: LiveThinkingStream | null = get().live;
    if (live === null || delta.length === 0) {
      return;
    }
    if (live.thinking.length >= MAX_LIVE_CHARS) {
      return; // 硬上限：停止累积，流继续直到 settle
    }
    const capped: string = live.thinking + delta;
    set({ live: { ...live, thinking: capped.length > MAX_LIVE_CHARS ? capped.slice(0, MAX_LIVE_CHARS) : capped } });
  },

  settle: (ok: boolean): void => {
    const live: LiveThinkingStream | null = get().live;
    if (live === null) {
      return;
    }
    const { text, truncated } = truncateThinking(live.thinking);
    const entry: ThinkingRecord = {
      id: createId('thk'),
      seat: live.seat,
      playerName: live.playerName,
      phase: live.phase,
      round: live.round,
      startedAt: live.startedAt,
      durationMs: Math.max(0, Date.now() - live.startedAt),
      thinking: text,
      truncated,
      status: ok ? 'ok' : 'error',
    };
    const entries: ThinkingRecord[] = [...get().entries, entry].slice(-MAX_THINKING_ENTRIES);
    set({ live: null, entries });
  },

  clear: (): void => {
    set({ live: null, entries: [] });
  },
}));

/** 便捷判断：当前是否有流式思考在进行（面板用于显示「思考中」徽标） */
export function isThinkingStreaming(): boolean {
  return useThinkingStore.getState().live !== null;
}
