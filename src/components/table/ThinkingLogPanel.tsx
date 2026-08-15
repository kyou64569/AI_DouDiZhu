/**
 * AI 思考日志面板（REQ-U2，视觉重构）。
 *
 * 展示每条日志：座位色标 + 玩家名 + 时间 + 正文 + source 徽标。
 * 新日志自动滚动到底部，支持清空，移动端可折叠。
 *
 * 约束：只依赖 logStore，【不 import gameStore】，保证与 T04 零耦合。
 *
 * 视觉重构：`glass` 变体改为深色玻璃拟态（牌桌抽屉场景），文字/徽标适配深色。
 */

import { useEffect, useRef, useState } from 'react';
import { DecisionSource, type LogLevel, type ThinkingLog } from '@/types/ai';
import { useLogStore } from '@/store/logStore';
import { Button } from '@/components/common/Button';
import { cn } from '@/utils/cn';

/** 每个座位的强调色，与牌桌座位色保持一致。 */
const SEAT_ACCENT: Record<0 | 1 | 2, string> = {
  0: 'bg-sky-500',
  1: 'bg-amber-500',
  2: 'bg-violet-500',
};

/** 座位文字色（深色玻璃面板内的浅色版本）。 */
const SEAT_TEXT: Record<0 | 1 | 2, string> = {
  0: 'text-sky-300',
  1: 'text-amber-300',
  2: 'text-violet-300',
};

/** 决策来源徽标的文案与配色。 */
const SOURCE_BADGE: Record<DecisionSource, { label: string; className: string }> = {
  [DecisionSource.LLM]: {
    label: 'LLM',
    className: 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/30',
  },
  [DecisionSource.FALLBACK_MINIMAL]: {
    label: '兜底·出牌',
    className: 'bg-amber-500/20 text-amber-300 ring-1 ring-amber-400/30',
  },
  [DecisionSource.FALLBACK_PASS]: {
    label: '兜底·过牌',
    className: 'bg-orange-500/20 text-orange-300 ring-1 ring-orange-400/30',
  },
  [DecisionSource.FALLBACK_ERROR]: {
    label: '兜底·异常',
    className: 'bg-red-500/20 text-red-300 ring-1 ring-red-400/30',
  },
};

/** 日志级别对应的正文颜色。 */
const LEVEL_TEXT: Record<LogLevel, string> = {
  info: 'text-slate-200',
  warn: 'text-amber-300',
  error: 'text-red-300',
};

/**
 * 把时间戳格式化为 HH:mm:ss。
 */
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hh: string = String(date.getHours()).padStart(2, '0');
  const mm: string = String(date.getMinutes()).padStart(2, '0');
  const ss: string = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** 单条日志行。 */
function LogRow({ log }: { log: ThinkingLog }): JSX.Element {
  const badge = log.source === undefined ? null : SOURCE_BADGE[log.source];

  return (
    <li className="flex gap-2.5 border-b border-white/8 px-3 py-2.5 last:border-b-0">
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', SEAT_ACCENT[log.seat])} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn('text-xs font-semibold', SEAT_TEXT[log.seat])}>{log.playerName}</span>
          <span className="font-mono text-[11px] text-slate-500">{formatTime(log.timestamp)}</span>
          {badge !== null && (
            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', badge.className)}>
              {badge.label}
            </span>
          )}
        </div>
        <p className={cn('mt-0.5 break-words text-xs leading-relaxed', LEVEL_TEXT[log.level])}>
          {log.message}
        </p>
      </div>
    </li>
  );
}

export interface ThinkingLogPanelProps {
  /** 附加类名 */
  className?: string;
  /** 移动端默认是否折叠，默认 false */
  defaultCollapsed?: boolean;
  /** 外观：`solid` 普通白底卡片（默认）；`glass` 半透明深色玻璃拟态，用于侧边抽屉场景 */
  variant?: 'solid' | 'glass';
  /** 提供则显示「关闭」按钮（抽屉场景下用于收起面板），否则在移动端显示「折叠」按钮 */
  onClose?: () => void;
}

/**
 * 思考日志面板。
 *
 * 新日志到达时自动滚到底部；用户手动向上滚动查看历史时暂停自动滚动，
 * 滚回底部后恢复。
 */
export function ThinkingLogPanel({
  className,
  defaultCollapsed = false,
  variant = 'solid',
  onClose,
}: ThinkingLogPanelProps): JSX.Element {
  const logs: ThinkingLog[] = useLogStore((state) => state.logs);
  const clear = useLogStore((state) => state.clear);

  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef<boolean>(true);

  // 新日志到达时自动滚到底部
  useEffect(() => {
    const element: HTMLDivElement | null = scrollRef.current;
    if (element === null || collapsed) {
      return;
    }
    if (stickToBottomRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [logs, collapsed]);

  /** 记录用户是否停留在底部。 */
  const handleScroll = (): void => {
    const element: HTMLDivElement | null = scrollRef.current;
    if (element === null) {
      return;
    }
    const distanceToBottom: number =
      element.scrollHeight - element.scrollTop - element.clientHeight;
    stickToBottomRef.current = distanceToBottom < 24;
  };

  const glass: boolean = variant === 'glass';

  return (
    <section
      className={cn(
        'flex flex-col overflow-hidden rounded-2xl border shadow-panel',
        glass
          ? 'border-white/15 bg-felt-950/80 backdrop-blur-xl'
          : 'border-slate-200 bg-white shadow-sm',
        className,
      )}
      aria-label="AI 思考日志"
    >
      <header
        className={cn(
          'flex shrink-0 items-center justify-between gap-2 border-b px-3.5 py-2.5',
          glass ? 'border-white/10' : 'border-slate-200',
        )}
      >
        <div className="flex items-center gap-2">
          <h3 className={cn('text-sm font-semibold', glass ? 'text-white' : 'text-slate-800')}>
            AI 思考日志
          </h3>
          <span
            className={cn(
              'rounded px-1.5 py-0.5 text-[11px] tabular-nums',
              glass ? 'bg-white/10 text-slate-300' : 'bg-slate-100 text-slate-500',
            )}
          >
            {logs.length}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={clear}
            disabled={logs.length === 0}
            aria-label="清空日志"
            className={glass ? 'text-slate-300 hover:bg-white/10 hover:text-white' : undefined}
          >
            清空
          </Button>
          {onClose ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              aria-label="关闭思考日志"
              className={glass ? 'text-slate-300 hover:bg-white/10 hover:text-white' : undefined}
            >
              关闭
            </Button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className={cn('md:hidden', glass ? 'text-slate-300 hover:bg-white/10 hover:text-white' : undefined)}
              onClick={() => setCollapsed((prev) => !prev)}
              aria-expanded={!collapsed}
              aria-label={collapsed ? '展开日志' : '折叠日志'}
            >
              {collapsed ? '展开' : '折叠'}
            </Button>
          )}
        </div>
      </header>

      {!collapsed && (
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="scrollbar-thin min-h-0 flex-1 overflow-y-auto"
          role="log"
          aria-live="polite"
        >
          {logs.length === 0 ? (
            <p className="px-3 py-8 text-center text-xs text-slate-500">
              暂无日志。AI 决策时会在这里实时显示思考过程与降级告警。
            </p>
          ) : (
            <ul className="divide-y divide-white/8">
              {logs.map((log: ThinkingLog) => (
                <LogRow key={log.id} log={log} />
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

export default ThinkingLogPanel;
