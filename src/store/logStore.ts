/**
 * AI 思考日志切片（REQ-U2）。
 *
 * 职责：收集 AI 编排层吐出的思考日志，供 ThinkingLogPanel 实时展示。
 *
 * 设计要点：
 * - 环形容量：超过 maxSize 时丢弃最旧的，避免长对局内存无限增长
 * - 不持久化：日志是单局临时数据，刷新即清空
 * - 不依赖 gameStore：编排层通过 onLog 回调注入，store 之间零耦合
 */

import { create } from 'zustand';
import type { LogLevel, ThinkingLog } from '@/types/ai';
import { DecisionSource } from '@/types/ai';
import { createId } from '@/utils/id';

/** 日志条数默认上限，超出后丢弃最旧的 */
export const DEFAULT_MAX_LOG_SIZE: number = 200;

/** append 的入参：id 与 timestamp 由 store 自动补全 */
export type ThinkingLogInput = Omit<ThinkingLog, 'id' | 'timestamp'>;

/** 日志 store 的状态与操作 */
export interface LogState {
  /** 日志列表，按时间升序（最新的在末尾） */
  logs: ThinkingLog[];
  /** 容量上限 */
  maxSize: number;
  /** 追加一条日志，自动补 id 与 timestamp */
  append: (log: ThinkingLogInput) => void;
  /** 清空全部日志 */
  clear: () => void;
  /** 调整容量上限，并立即按新上限裁剪 */
  setMaxSize: (size: number) => void;
}

/**
 * 按上限裁剪日志，保留最新的 maxSize 条。
 */
function trimLogs(logs: ThinkingLog[], maxSize: number): ThinkingLog[] {
  if (logs.length <= maxSize) {
    return logs;
  }
  return logs.slice(logs.length - maxSize);
}

/** 思考日志 store */
export const useLogStore = create<LogState>((set) => ({
  logs: [],
  maxSize: DEFAULT_MAX_LOG_SIZE,

  append: (log: ThinkingLogInput): void => {
    set((state: LogState) => {
      const entry: ThinkingLog = {
        id: createId('log'),
        // store 层允许使用 Date.now()，引擎层才禁止
        timestamp: Date.now(),
        seat: log.seat,
        playerName: log.playerName,
        level: log.level,
        message: log.message,
        source: log.source,
      };
      return { logs: trimLogs([...state.logs, entry], state.maxSize) };
    });
  },

  clear: (): void => {
    set({ logs: [] });
  },

  setMaxSize: (size: number): void => {
    const safeSize: number =
      Number.isFinite(size) && size > 0 ? Math.floor(size) : DEFAULT_MAX_LOG_SIZE;
    set((state: LogState) => ({
      maxSize: safeSize,
      logs: trimLogs(state.logs, safeSize),
    }));
  },
}));

/**
 * 供 AI 编排层使用的日志回调（AILogSink 形状）。
 *
 * 用法：`llmPlayDriver({ ...input, onLog: logSink })`
 */
export function logSink(log: ThinkingLogInput): void {
  useLogStore.getState().append(log);
}

/**
 * 便捷方法：直接写一条日志（非 React 环境亦可调用）。
 */
export function appendLog(
  seat: 0 | 1 | 2,
  playerName: string,
  level: LogLevel,
  message: string,
  source?: DecisionSource,
): void {
  useLogStore.getState().append({ seat, playerName, level, message, source });
}

/** 清空日志的便捷方法（对局重开时调用）。 */
export function clearLogs(): void {
  useLogStore.getState().clear();
}
