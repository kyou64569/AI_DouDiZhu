/**
 * AI 思考日志面板（REQ-U2，视觉重构）。
 *
 * 双标签结构：
 * - 「对局日志」：决策/兜底事件流（logStore），即原面板内容；
 * - 「思考日志」：AI 模型的真实 reasoning 内容（thinkingStore），流式实时显示，
 *   每条决策完成后落为历史记录；新流开始时自动切换到本标签。
 *
 * 两种日志均支持导出（对局日志 .txt / 思考日志 .md）。
 *
 * 约束：只依赖 logStore / thinkingStore，【不 import gameStore】，保证与 T04 零耦合。
 */

import { useEffect, useRef, useState } from 'react';
import { DecisionSource, type LogLevel, type ThinkingLog } from '@/types/ai';
import { useLogStore } from '@/store/logStore';
import { useThinkingStore, type ThinkingRecord } from '@/store/thinkingStore';
import { Button } from '@/components/common/Button';
import { downloadTextFile, exportTimestamp } from '@/utils/download';
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

/** 单条对局日志行。 */
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

/** 单条思考记录卡片。 */
function ThinkingRecordRow({ record }: { record: ThinkingRecord }): JSX.Element {
  return (
    <li className="border-b border-white/8 px-3 py-2.5 last:border-b-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', SEAT_ACCENT[record.seat])} aria-hidden="true" />
        <span className={cn('text-xs font-semibold', SEAT_TEXT[record.seat])}>{record.playerName}</span>
        <span className="text-[11px] text-slate-400">{record.round}</span>
        <span className="font-mono text-[11px] text-slate-500">{formatTime(record.startedAt)}</span>
        <span className="font-mono text-[11px] text-slate-500">{(record.durationMs / 1000).toFixed(1)}s</span>
        {record.status === 'error' ? (
          <span className="rounded bg-red-500/20 px-1.5 py-0.5 text-[10px] font-medium text-red-300 ring-1 ring-red-400/30">
            失败
          </span>
        ) : (
          <span className="rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-400/30">
            完成
          </span>
        )}
        {record.truncated && (
          <span className="rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-amber-400/30">
            已截断
          </span>
        )}
      </div>
      {record.thinking.length > 0 ? (
        <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-300">
          {record.thinking}
        </p>
      ) : (
        <p className="mt-1 text-xs italic text-slate-500">（该模型未返回思考内容）</p>
      )}
    </li>
  );
}

/** 对局日志导出文本：逐行 `[HH:mm:ss] [玩家] [级别] 消息`。 */
function buildGameLogText(logs: ThinkingLog[]): string {
  return logs
    .map((log: ThinkingLog): string => {
      const source: string = log.source === undefined ? '' : `[${SOURCE_BADGE[log.source].label}]`;
      return `[${formatTime(log.timestamp)}] [${log.playerName}] [${log.level}]${source} ${log.message}`;
    })
    .join('\n');
}

/** 思考日志导出文本（Markdown）：每条记录一个小节。 */
function buildThinkingMarkdown(entries: ThinkingRecord[]): string {
  const sections: string[] = entries.map((record: ThinkingRecord): string => {
    const head: string = `## ${record.playerName} · ${record.round}`;
    const meta: string = `- 时间：${formatTime(record.startedAt)} / 耗时：${(record.durationMs / 1000).toFixed(1)}s / 状态：${
      record.status === 'ok' ? '完成' : '失败（思考可能不完整）'
    }${record.truncated ? ' / 内容超长已截断' : ''}`;
    const body: string = record.thinking.length > 0 ? record.thinking : '（该模型未返回思考内容）';
    return `${head}\n${meta}\n\n${body}`;
  });
  return sections.join('\n\n---\n\n');
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

/** 面板内标签 */
type PanelTab = 'game' | 'thinking';

/**
 * 思考日志面板（对局日志 + 思考日志 双标签）。
 *
 * 对局日志新条目到达时自动滚到底部；思考标签下流式增量同样自动贴底；
 * 用户手动向上滚动查看历史时暂停自动滚动，滚回底部后恢复。
 * 新的思考流开始时自动切到「思考日志」标签（观战观看 AI 思考的主场景）。
 */
export function ThinkingLogPanel({
  className,
  defaultCollapsed = false,
  variant = 'solid',
  onClose,
}: ThinkingLogPanelProps): JSX.Element {
  const logs: ThinkingLog[] = useLogStore((state) => state.logs);
  const clearLogs = useLogStore((state) => state.clear);
  const live = useThinkingStore((state) => state.live);
  const entries = useThinkingStore((state) => state.entries);
  const clearThinking = useThinkingStore((state) => state.clear);

  const [collapsed, setCollapsed] = useState<boolean>(defaultCollapsed);
  const [tab, setTab] = useState<PanelTab>('game');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef<boolean>(true);

  // 新的思考流开始时自动切到思考标签
  const hadLiveRef = useRef<boolean>(false);
  useEffect((): void => {
    const now: boolean = live !== null;
    if (now && !hadLiveRef.current) {
      setTab('thinking');
    }
    hadLiveRef.current = now;
  }, [live]);

  // 当前标签内容变化时自动滚到底部（对局日志新条目 / 思考流增量 / 历史落库）
  useEffect(() => {
    const element: HTMLDivElement | null = scrollRef.current;
    if (element === null || collapsed) {
      return;
    }
    if (stickToBottomRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [logs, entries, live, tab, collapsed]);

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
  const streaming: boolean = live !== null;

  /** 导出当前标签的日志 */
  const handleExport = (): void => {
    if (tab === 'game') {
      downloadTextFile(buildGameLogText(logs), `doudizhu-game-log-${exportTimestamp()}.txt`);
      return;
    }
    downloadTextFile(
      buildThinkingMarkdown(entries),
      `doudizhu-thinking-log-${exportTimestamp()}.md`,
      'text/markdown;charset=utf-8',
    );
  };

  /** 清空当前标签的日志 */
  const handleClear = (): void => {
    if (tab === 'game') {
      clearLogs();
    } else {
      clearThinking();
    }
  };

  const canExport: boolean = tab === 'game' ? logs.length > 0 : entries.length > 0;
  const canClear: boolean = canExport;

  const tabButtonClass = (active: boolean): string =>
    cn(
      'rounded-lg px-2.5 py-1 text-xs font-medium transition-colors',
      active
        ? glass
          ? 'bg-white/15 text-white'
          : 'bg-slate-200 text-slate-800'
        : glass
          ? 'text-slate-400 hover:bg-white/10 hover:text-slate-200'
          : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700',
    );

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
        <div className="flex min-w-0 items-center gap-2">
          <h3 className={cn('shrink-0 text-sm font-semibold', glass ? 'text-white' : 'text-slate-800')}>
            AI 思考日志
          </h3>
          <div className="flex items-center gap-1" role="tablist" aria-label="日志类型">
            <button type="button" role="tab" aria-selected={tab === 'game'} className={tabButtonClass(tab === 'game')} onClick={() => setTab('game')}>
              对局日志
            </button>
            <button type="button" role="tab" aria-selected={tab === 'thinking'} className={tabButtonClass(tab === 'thinking')} onClick={() => setTab('thinking')}>
              思考日志
              {streaming && (
                <span className="ml-1 inline-flex items-center gap-1" aria-label="思考进行中">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden="true" />
                </span>
              )}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleExport}
            disabled={!canExport}
            aria-label={tab === 'game' ? '导出对局日志' : '导出思考日志'}
            className={glass ? 'text-slate-300 hover:bg-white/10 hover:text-white' : undefined}
          >
            导出
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleClear}
            disabled={!canClear}
            aria-label={tab === 'game' ? '清空对局日志' : '清空思考日志'}
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
          {tab === 'game' ? (
            logs.length === 0 ? (
              <p className="px-3 py-8 text-center text-xs text-slate-500">
                暂无对局日志。AI 决策时会在这里实时显示决策过程与降级告警。
              </p>
            ) : (
              <ul className="divide-y divide-white/8">
                {logs.map((log: ThinkingLog) => (
                  <LogRow key={log.id} log={log} />
                ))}
              </ul>
            )
          ) : (
            <div>
              {entries.length === 0 && live === null ? (
                <p className="px-3 py-8 text-center text-xs text-slate-500">
                  暂无思考记录。AI 决策时，模型的推理内容会在这里实时流出。
                </p>
              ) : (
                <ul className="divide-y divide-white/8">
                  {entries.map((record: ThinkingRecord) => (
                    <ThinkingRecordRow key={record.id} record={record} />
                  ))}
                </ul>
              )}
              {live !== null && (
                <div className="border-t border-emerald-400/20 bg-emerald-500/5 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={cn('h-2 w-2 shrink-0 rounded-full', SEAT_ACCENT[live.seat])} aria-hidden="true" />
                    <span className={cn('text-xs font-semibold', SEAT_TEXT[live.seat])}>{live.playerName}</span>
                    <span className="text-[11px] text-slate-400">{live.round}</span>
                    <span className="flex items-center gap-1 rounded bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-medium text-emerald-300 ring-1 ring-emerald-400/30">
                      <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" aria-hidden="true" />
                      思考中
                    </span>
                  </div>
                  <p className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-200">
                    {live.thinking}
                    <span className="animate-pulse text-emerald-300" aria-hidden="true">▍</span>
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default ThinkingLogPanel;
