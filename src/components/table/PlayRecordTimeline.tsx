/**
 * 出牌记录时间线（人机对战模式专用侧栏，视觉重构）。
 *
 * 需求：人机模式下牌桌隐藏 AI 思考过程与手牌，仅以时间线展示本局公开进程
 * —— 叫分 + 逐手出牌/过牌。AI 思考与手牌仅于观战模式在牌桌实时显示，
 * 对局结束后的完整思考过程在战绩详情中查看。
 *
 * 本组件只读取 gameStore 的 bidHistory / playHistory（均为已公开信息），
 * 不展示任何 AI 思考(reason)，也不读取未出手的 AI 手牌。
 *
 * 视觉重构：面板改为深色玻璃拟态（侧边抽屉场景），行内文字适配深色。
 */

import { useGameStore } from '@/store/gameStore';
import type { BidRecord, PlayRecord, SeatIndex } from '@/types/game';
import type { Card, HandPattern } from '@/types/card';
import { CardGroup } from '@/components/card/CardGroup';
import { cn } from '@/utils/cn';

/** 座位色标，与牌桌座位、思考日志保持一致 */
const SEAT_DOT: Record<0 | 1 | 2, string> = {
  0: 'bg-sky-500',
  1: 'bg-amber-500',
  2: 'bg-violet-500',
};

/** 单条时间线行 */
function TimelineRow({
  seat,
  name,
  children,
}: {
  seat: SeatIndex;
  name: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <li className="flex gap-2.5 border-b border-white/8 px-3 py-2.5 last:border-b-0">
      <span className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', SEAT_DOT[seat])} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <span className="text-xs font-semibold text-slate-200">{name}</span>
        <div className="mt-0.5">{children}</div>
      </div>
    </li>
  );
}

/** 叫分文案 */
function bidText(score: number): string {
  return score > 0 ? `叫 ${score} 分` : '不叫';
}

/** 牌型 → 中文名（用于文字模式下的括号提示）。 */
const PATTERN_LABELS: Readonly<Record<string, string>> = {
  SINGLE: '单张',
  PAIR: '对子',
  TRIPLE: '三张',
  TRIPLE_WITH_SINGLE: '三带一',
  TRIPLE_WITH_PAIR: '三带一对',
  STRAIGHT: '顺子',
  DOUBLE_STRAIGHT: '连对',
  PLANE: '飞机',
  PLANE_WITH_SINGLES: '飞机带单',
  PLANE_WITH_PAIRS: '飞机带对',
  FOUR_WITH_TWO: '四带二',
  BOMB: '炸弹',
  ROCKET: '王炸',
};

/**
 * 把一手出牌转成纯文字描述，如「出 3 4 5 6 7（顺子）」。
 * 不渲染任何牌图，紧凑适合侧边抽屉。牌按点数升序排列便于阅读。
 */
function describePlay(cards: Card[], pattern: HandPattern | null): string {
  const ordered: Card[] = cards.slice().sort((a, b) => a.rank - b.rank);
  const labels: string = ordered.map((c) => c.label).join(' ');
  const typeName: string | undefined = pattern ? PATTERN_LABELS[pattern.type] : undefined;
  return typeName ? `出 ${labels}（${typeName}）` : `出 ${labels}`;
}

export interface PlayRecordTimelineProps {
  /** 附加类名 */
  className?: string;
  /**
   * 渲染形态：
   *  - 'cards'（默认）：以牌面小图(CardGroup)展示出牌，信息直观，适合桌面常驻面板；
   *  - 'text'：以纯文字描述每一手出牌，不渲染牌图，适合侧边抽屉等紧凑场景。
   */
  variant?: 'cards' | 'text';
  /** 提供则显示「关闭」按钮（抽屉场景下用于收起面板） */
  onClose?: () => void;
}

/**
 * 出牌记录时间线面板。
 */
export function PlayRecordTimeline({
  className,
  variant = 'cards',
  onClose,
}: PlayRecordTimelineProps): JSX.Element {
  const players = useGameStore((state) => state.players);
  const bidHistory: BidRecord[] = useGameStore((state) => state.bidHistory);
  const playHistory: PlayRecord[] = useGameStore((state) => state.playHistory);

  const nameOf = (seat: SeatIndex): string => players[seat]?.name ?? `座位 ${seat + 1}`;

  return (
    <section
      className={cn(
        'flex flex-col overflow-hidden rounded-2xl border border-white/15 bg-felt-950/80 shadow-panel backdrop-blur-xl',
        className,
      )}
      aria-label="出牌记录时间线"
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-white/10 px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-white">出牌记录</h3>
          <span className="rounded bg-white/10 px-1.5 py-0.5 text-[11px] text-slate-300 tabular-nums">
            {bidHistory.length + playHistory.length}
          </span>
        </div>
        <span className="text-[11px] text-slate-500">叫分 + 逐手</span>
        {onClose ? (
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭出牌记录"
            className="rounded-md bg-white/10 px-2 py-1 text-xs text-slate-300 transition-colors hover:bg-white/15 hover:text-white"
          >
            关闭
          </button>
        ) : null}
      </header>

      <div className="scrollbar-thin min-h-0 flex-1 overflow-y-auto" role="log" aria-live="polite">
        {bidHistory.length === 0 && playHistory.length === 0 ? (
          <p className="px-3 py-8 text-center text-xs text-slate-500">
            本局尚未开始，叫分与出牌会在这里依次记录。
          </p>
        ) : (
          <ul className="divide-y divide-white/8">
            {bidHistory.map((bid: BidRecord, i: number) => (
              <TimelineRow key={`bid-${i}`} seat={bid.seat} name={nameOf(bid.seat)}>
                <span className="text-xs text-slate-300">{bidText(bid.score)}</span>
              </TimelineRow>
            ))}
            {playHistory.map((play: PlayRecord, i: number) => (
              <TimelineRow key={`play-${i}`} seat={play.seat} name={nameOf(play.seat)}>
                {play.isPass ? (
                  <span className="text-xs text-slate-500">过牌</span>
                ) : variant === 'text' ? (
                  <span className="text-xs text-slate-200">
                    {describePlay(play.cards, play.pattern)}
                  </span>
                ) : (
                  <CardGroup cards={play.cards} size="sm" emptyText="空" />
                )}
              </TimelineRow>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

export default PlayRecordTimeline;
