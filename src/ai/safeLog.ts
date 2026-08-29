/**
 * 安全触发日志回调：回调自身抛异常也不影响决策主流程。
 * 供 aiOrchestrator / bidStrategy 共用（L-6：消除重复定义）。
 */
import type { AILogSink, DecisionSource, LogLevel } from '@/types/ai';

export function safeLog(
  onLog: AILogSink | undefined,
  seat: 0 | 1 | 2,
  playerName: string,
  level: LogLevel,
  message: string,
  source?: DecisionSource,
): void {
  if (onLog === undefined) {
    return;
  }
  try {
    onLog({ seat, playerName, level, message, source });
  } catch {
    // 日志失败绝不影响决策
  }
}
