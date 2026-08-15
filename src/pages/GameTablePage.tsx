/**
 * 牌桌页（T04 真实现，UI 重构）。
 *
 * 职责：
 *  - 从 useRoomStore.room 初始化对局；房间为空则引导用户回房间页（防白屏）；
 *  - 编排 gameStore 的各类 action，驱动 AI 自动行动（含观战模式节流）；
 *  - 人类回合启用 30s 倒计时，归零自动出最小牌或过牌；
 *  - 桌面三栏 / 移动端纵向堆叠的响应式布局，四要素齐备（手牌数 / 出牌区 / 地主标识 / 倒计时）；
 *  - 预留 T05 思考日志面板插槽（AI_LOG_PANEL_SLOT），不 import 任何 T05 文件。
 *
 * 视觉重构（沉浸式牌桌）：
 *  - 全屏绒布背景（.table-felt），顶栏/底栏由 AppLayout 在 /table 路由下隐藏；
 *  - 桌面端三栏：对家（玻璃拟态卡片）→ 中央舞台（底牌 + 出牌区 + 操作）→ 对家；
 *  - 人类回合在底部手牌区显示金色倒计时环，补齐原「人类无倒计时指示」的体验缺口；
 *  - 出牌区、底牌出现时逐张交错弹入动画。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';

import { GamePhase, type BidScore, type SeatIndex } from '@/types/game';
import type { Room } from '@/types/config';
import { useRoomStore } from '@/store/roomStore';
import { useGameStore, AI_STEP_MS, SPECTATE_STEP_MS } from '@/store/gameStore';
import { useCountdown } from '@/hooks/useCountdown';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { HandCards } from '@/components/card/HandCards';
import { CardGroup } from '@/components/card/CardGroup';
import { TableHeader } from '@/components/table/TableHeader';
import { OpponentPanel } from '@/components/table/OpponentPanel';
import { PlayArea } from '@/components/table/PlayArea';
import { ActionBar } from '@/components/table/ActionBar';
import { BiddingPanel } from '@/components/table/BiddingPanel';
import { SettlementModal } from '@/components/table/SettlementModal';
import { SpectatorSeatSwitcher } from '@/components/table/SpectatorSeatSwitcher';
import ThinkingLogDrawer from '@/components/table/ThinkingLogDrawer';
import PlayRecordDrawer from '@/components/table/PlayRecordDrawer';
import { ROUTES } from '@/routes';
import { cn } from '@/utils/cn';
import { findHints } from '@/engine';

/** 人类回合倒计时总时长（与 PRD D4 一致） */
const HUMAN_TURN_SECONDS = 30;
/** M7：AI 回合展示倒计时秒数（对应 PRD D4 AI 8s 硬超时，纯展示） */
const AI_TURN_SECONDS = 8;

/** 倒计时进度环（金色，最后 5s 转红） */
function TurnRing({ remaining }: { remaining: number }): JSX.Element {
  const size = 42;
  const stroke = 3.5;
  const r = (size - stroke) / 2;
  const circumference = 2 * Math.PI * r;
  const frac = Math.max(0, Math.min(1, remaining / HUMAN_TURN_SECONDS));
  const urgent = remaining <= 5;
  const color = urgent ? '#ef4444' : '#fbbf24';

  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-full border px-2 py-1 pr-3 backdrop-blur-sm',
        urgent ? 'border-red-400/50 bg-red-500/15' : 'border-gold-400/40 bg-black/25',
      )}
      role="timer"
      aria-label={`剩余 ${remaining} 秒`}
    >
      <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.16)" strokeWidth={stroke} fill="none" />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            stroke={color}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - frac)}
            className="transition-[stroke-dashoffset] duration-1000 ease-linear"
          />
        </svg>
        <span
          className={cn(
            'absolute text-sm font-bold leading-none tabular-nums',
            urgent ? 'text-red-400' : 'text-gold-300',
          )}
        >
          {remaining}
        </span>
      </div>
      <span className={cn('text-xs font-medium', urgent ? 'text-red-200' : 'text-white/85')}>
        {urgent ? '请尽快出牌' : '轮到你出牌'}
      </span>
    </div>
  );
}

/**
 * 牌桌页。
 */
export function GameTablePage(): JSX.Element {
  const room: Room | null = useRoomStore((state) => state.room);
  const isDesktop: boolean = useIsDesktop();

  const game = useGameStore();
  const navigate = useNavigate();
  const {
    phase,
    players,
    bottomCards,
    bottomRevealed,
    currentSeat,
    lastPlay,
    isFreeTurn,
    baseScore,
    multiplier,
    roomMode,
    humanSeat,
    selectedCardIds,
    highestBid,
    settlement,
    autoPassEnabled,
  } = game;

  // 进入页面即尝试开局（仅在 IDLE 且房间存在时）
  useEffect(() => {
    if (room && phase === GamePhase.IDLE) {
      useGameStore.getState().startGame();
    }
    // 仅依赖 [room] 是有意为之：开局只在「房间就绪且仍为 IDLE」时触发一次，
    // 不能把 phase 纳入依赖——否则 phase 每次变化都会重跑本 effect、反复调用 startGame，
    // 造成重复开局/状态错乱。故显式禁用 exhaustive-deps 并保留最小依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room]);

  // 人类倒计时（仅人类回合、出牌阶段生效）
  const isHumanTurn: boolean = phase === GamePhase.PLAYING && humanSeat !== null && currentSeat === humanSeat;
  const countdown = useCountdown({
    seconds: HUMAN_TURN_SECONDS,
    active: isHumanTurn,
    resetKey: `${currentSeat}-${game.turn}`,
    onTimeout: () => useGameStore.getState().autoTimeout(),
  });

  // M7：AI 回合展示倒计时（观战/人机模式可视化 AI 8s 硬超时）。
  // 纯展示：AI 决策的真实超时由 store/LLM 层控制，此处不触发任何动作。
  const isAiTurn: boolean =
    (phase === GamePhase.BIDDING || phase === GamePhase.PLAYING) &&
    humanSeat !== null &&
    currentSeat !== humanSeat;
  const aiCountdown = useCountdown({
    seconds: AI_TURN_SECONDS,
    active: isAiTurn,
    resetKey: `${currentSeat}-${game.turn}-${phase}`,
  });

  /** 对家倒计时展示：人类回合走人类倒计时；AI 回合走 AI 展示倒计时 */
  const opponentCountdown = (seat: number): number | null => {
    if (currentSeat !== seat) return null;
    if (countdown.isRunning) return countdown.remaining;
    if (isAiTurn) return aiCountdown.remaining;
    return null;
  };

  // 人类出牌慢时，AI 对手催促一次（剩余 8s 触发，去重）
  useEffect(() => {
    if (isHumanTurn && countdown.remaining === 8) {
      useGameStore.getState().urgeHuman();
    }
  }, [isHumanTurn, countdown.remaining]);

  // 自动过牌：勾选开启 + 人类出牌回合 + 非自由回合 + 无牌可压 → 立即过牌。
  // 无需 AI 思考、无需等 30s 倒计时；pass 内置固定过牌音效（playSfx('pass')）+ 语音。
  // 依赖含 lastPlay/humanHand，勾选或局面变化时即时生效；pass 成功后 currentSeat 流转，
  // isHumanTurn 变 false，天然防重入。
  useEffect(() => {
    if (!autoPassEnabled || !isHumanTurn) return;
    if (isFreeTurn) return; // 自由回合不存在「要不起」
    const target = lastPlay ? lastPlay.pattern : null;
    if (!target) return;
    if (humanSeat === null) return;
    const hand = players[humanSeat].hand;
    if (findHints(hand, target).length > 0) return; // 有牌可压，不自动过
    useGameStore.getState().pass(humanSeat);
  }, [autoPassEnabled, isHumanTurn, isFreeTurn, lastPlay, players, humanSeat]);

  // AI 自动行动调度（观战 / 人机模式下的 AI 座位），带节流
  const stepMs: number = roomMode === 'AI_SPECTATE' ? SPECTATE_STEP_MS : AI_STEP_MS;
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 推进游标：任何一次状态推进都会改变它。
  // 双保险 —— 仅依赖 [phase, currentSeat] 时，若某次行动只改变了回合数 / 叫分数
  // （例如 store 侧兜底纠正后仍是同一座位继续），effect 不会重跑、定时器不再重挂，
  // 会退化成死锁。把完整游标纳入依赖可确保每次推进都重新调度。
  const progressKey: string = `${phase}|${currentSeat}|${game.bidHistory.length}|${game.playHistory.length}|${game.redealCount}|${game.turn}`;

  useEffect(() => {
    // 仅在需要 AI 行动时挂定时器；人类回合 / 结算 / 闲置不挂
    const needAi: boolean =
      (phase === GamePhase.BIDDING || phase === GamePhase.PLAYING) &&
      currentSeat !== humanSeat;
    if (!needAi) return undefined;

    aiTimerRef.current = setTimeout(() => {
      void useGameStore.getState().aiAct();
    }, stepMs);

    return () => {
      if (aiTimerRef.current !== null) {
        clearTimeout(aiTimerRef.current);
        aiTimerRef.current = null;
      }
    };
  }, [phase, currentSeat, humanSeat, stepMs, progressKey]);

  // —— 以下 3 个 Hook 必须放在早期 return 之前 ——
  // 若放到 `if (!room) return` 之后，当 clearRoom() 使 room 变 null、组件重渲染命中早期 return 时，
  // 这 3 个 Hook 不再执行，导致两次渲染的 Hook 数量不一致，
  // 触发 React "Rendered fewer hooks than expected" 白屏（P0：点「再来一局」必崩）。
  const lastPlayOf = useCallback(
    (seat: SeatIndex) => {
      // 最近一次该座位的有效出牌（非过牌）
      for (let i = game.playHistory.length - 1; i >= 0; i -= 1) {
        const rec = game.playHistory[i];
        if (rec.seat === seat && !rec.isPass) return rec;
      }
      return null;
    },
    [game.playHistory],
  );

  const legalBids: BidScore[] = useMemo<BidScore[]>(() => {
    // 与引擎一致：只能叫比最高分更高的分，或 0（不叫）
    const opts: BidScore[] = [0];
    for (const s of [1, 2, 3] as BidScore[]) {
      if (s > (highestBid as number)) opts.push(s);
    }
    return opts;
  }, [highestBid]);

  const restart = useCallback(() => {
    setSettlementDismissed(false);
    // 同房间重发：直接 startGame（沿用现有 room），不再 clearRoom，
    // 否则 room 变 null 会让牌桌退回「尚未创建房间」，给人「一局就退出」的错觉。
    useGameStore.getState().startGame();
  }, []);

  // 退出对局：清空牌桌（resetGame 重置为 IDLE、清空终局状态）+ 清掉已激活房间
  // （clearRoom 置 room:null，但保留模式与座位配置以便快速再来），再回到房间页。
  //
  // 关键：必须清掉 room，否则已激活房间残留，之后任何回到 /table 的入口
  // （顶部导航「牌桌」、战绩页链接、直接访问 URL）都会让 GameTablePage 挂载时
  // 满足 `room && phase===IDLE`，触发自动开局 effect，给人「退出后又自动开了一局」的错觉。
  const onExit = useCallback(() => {
    useGameStore.getState().resetGame();
    useRoomStore.getState().clearRoom();
    navigate(ROUTES.ROOM);
  }, [navigate]);

  // —— 观战视角（仅 AI_SPECTATE 生效）——
  // 此前视角写死为 0 号座位，用户只能看第一位 AI 的手牌；改为可切换 + 可全明。
  // 同样必须置于早期 return 之前，保证 Hook 数量恒定。
  const [spectateSeat, setSpectateSeat] = useState<SeatIndex>(0);
  const [spectateShowAll, setSpectateShowAll] = useState<boolean>(false);

  // 结算弹窗「关闭查看终局牌桌」状态：关闭后弹窗消失但本局结果仍可见，不强制重开。
  const [settlementDismissed, setSettlementDismissed] = useState<boolean>(false);

  // 换房间时复位视角，避免沿用上一局的选择
  useEffect(() => {
    setSpectateSeat(0);
    setSpectateShowAll(false);
  }, [room]);

  // 新对局开始（phase 离开 SETTLED）即复位关闭标记，下次结算重新弹窗
  useEffect(() => {
    if (phase !== GamePhase.SETTLED) {
      setSettlementDismissed(false);
    }
  }, [phase]);

  const selectSpectateSeat = useCallback((seat: SeatIndex) => {
    // 点具体座位即退出「全明」，否则高亮语义会自相矛盾
    setSpectateSeat(seat);
    setSpectateShowAll(false);
  }, []);

  const toggleSpectateShowAll = useCallback(() => {
    setSpectateShowAll((prev: boolean): boolean => !prev);
  }, []);

  // 房间为空：引导回房间页，避免白屏（深色沉浸版）
  if (!room) {
    return (
      <div className="table-felt flex min-h-screen w-full flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-gold-400/30 bg-black/25 text-3xl shadow-glowGold">
          🀄
        </div>
        <h1 className="text-xl font-semibold text-white">尚未创建房间</h1>
        <p className="max-w-md text-sm text-white/60">请先在「创建房间」页选择模式与 AI 玩家，再进入牌桌。</p>
        <Link
          to={ROUTES.ROOM}
          className="rounded-lg bg-gradient-to-br from-gold-400 to-gold-600 px-5 py-2.5 text-sm font-semibold text-gold-950 shadow-glowGold transition-transform hover:scale-105"
        >
          前往创建房间
        </Link>
      </div>
    );
  }

  // 视角座位：人类固定看自己；观战模式由用户在切换器里选择（只读）
  const isSpectator: boolean = humanSeat === null;
  const viewSeat: SeatIndex = (humanSeat ?? spectateSeat) as SeatIndex;

  // 其余两个座位作为对家展示（按座位顺序排到左 / 右）
  const opponentSeats: SeatIndex[] = ([0, 1, 2] as SeatIndex[]).filter((s) => s !== viewSeat);
  const leftSeat: SeatIndex = opponentSeats[0];
  const rightSeat: SeatIndex = opponentSeats[1];

  // 结算弹窗（关闭后仍可查看终局牌桌）
  const showSettlement: boolean = phase === GamePhase.SETTLED && settlement !== null && !settlementDismissed;

  /** 底牌徽章（定地主后常驻展示，桌面中央顶部 / 移动端出牌区下方） */
  const bottomBadge: JSX.Element | null = bottomRevealed ? (
    <div className="glass-panel flex items-center gap-3 rounded-2xl px-4 py-2">
      <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-gold-300">
        <span className="text-sm leading-none" aria-hidden="true">
          👑
        </span>
        底牌
      </span>
      <CardGroup cards={bottomCards} size="sm" animate />
    </div>
  ) : null;

  /** 人类回合指示：金色倒计时环 + 文案（渲染在手牌区顶部） */
  const humanTurnBanner: JSX.Element | null = isHumanTurn ? (
    <div className="mb-2 flex items-center justify-center border-b border-white/10 pb-2">
      <TurnRing remaining={countdown.remaining} />
    </div>
  ) : null;

  /**
   * 底部手牌区。桌面与移动共用，仅牌面尺寸不同。
   *
   * 观战模式：顶部挂视角切换器；「三家全明」开启时纵向摊开三家手牌。
   * 人机模式：行为与改造前完全一致（只渲染人类自己的手牌、可选牌）。
   */
  const renderHandSection = (size: 'md' | 'sm'): JSX.Element => {
    const seats: SeatIndex[] = isSpectator && spectateShowAll ? ([0, 1, 2] as SeatIndex[]) : [viewSeat];

    return (
      <div className="glass-panel rounded-2xl px-3 py-2.5">
        {humanTurnBanner}

        {isSpectator ? (
          <SpectatorSeatSwitcher
            players={players}
            viewSeat={viewSeat}
            currentSeat={currentSeat}
            showAll={spectateShowAll}
            onSelect={selectSpectateSeat}
            onToggleShowAll={toggleSpectateShowAll}
            className="mb-2 border-b border-white/10 pb-2"
          />
        ) : null}

        {seats.map((seat: SeatIndex) => {
          const player = players[seat];
          return (
            <div key={seat} className={seats.length > 1 ? 'mb-2 last:mb-0' : undefined}>
              <div className="mb-1 flex items-center justify-between px-1 text-xs text-white/70">
                <span className="flex items-center gap-1.5">
                  {player.isLandlord ? (
                    <span className="rounded bg-gold-500/90 px-1.5 py-px text-[10px] font-bold leading-none text-gold-950">
                      地主
                    </span>
                  ) : null}
                  <span className="truncate">{player.name}</span>
                  {isSpectator && seat === currentSeat ? (
                    <span className="flex items-center gap-1 text-emerald-300">
                      <span className="h-1.5 w-1.5 animate-pulse-ring rounded-full bg-emerald-400" />
                      行动中
                    </span>
                  ) : null}
                </span>
                <span className="tabular-nums text-white/55">
                  剩 <span className="font-semibold text-white/85">{player.hand.length}</span> 张
                </span>
              </div>
              <HandCards
                cards={player.hand}
                selectedIds={seat === humanSeat ? selectedCardIds : []}
                selectable={!isSpectator && seat === humanSeat}
                onToggle={(id) => useGameStore.getState().toggleSelect(id)}
                size={size}
              />
            </div>
          );
        })}
      </div>
    );
  };

  // ---- 电脑端三栏布局 ----
  const desktopLayout = (
    <div className="flex h-full min-h-screen flex-col gap-3 md:gap-4">
      <TableHeader
          baseScore={baseScore}
          multiplier={multiplier}
          mode={roomMode}
          onExit={onExit}
          autoPassEnabled={autoPassEnabled}
          onToggleAutoPass={() => useGameStore.getState().setAutoPassEnabled(!autoPassEnabled)}
        />

      <div className="grid flex-1 grid-cols-[1fr_2.2fr_1fr] items-start gap-3 md:gap-4">
        {/* 左侧对家 */}
        <div className="flex min-w-0 justify-start">
          <OpponentPanel
            player={players[leftSeat]}
            isCurrent={currentSeat === leftSeat}
            lastPlay={lastPlayOf(leftSeat)}
            countdown={opponentCountdown(leftSeat)}
          />
        </div>

        {/* 中央舞台：底牌 → 出牌区 → 叫分/操作 */}
        <div className="flex min-w-0 flex-col items-center gap-3 md:gap-4">
          {bottomBadge}

          <div className="flex w-full max-w-xl flex-1 items-center justify-center">
            <PlayArea lastPlay={lastPlay} isFreeTurn={isFreeTurn} className="w-full" />
          </div>

          {phase === GamePhase.BIDDING && currentSeat === humanSeat ? (
            <BiddingPanel highestBid={highestBid} legalBids={legalBids} onBid={(s) => useGameStore.getState().humanBid(s)} />
          ) : null}

          {phase === GamePhase.PLAYING && currentSeat === humanSeat ? (
            <ActionBar
              hasSelection={selectedCardIds.length > 0}
              selectedCount={selectedCardIds.length}
              isFreeTurn={isFreeTurn}
              isHumanTurn
              onPlay={() => useGameStore.getState().playSelected()}
              onPass={() => useGameStore.getState().passSelected()}
              onHint={() => useGameStore.getState().applyHint()}
              onClear={() => useGameStore.getState().clearSelection()}
            />
          ) : null}
        </div>

        {/* 右侧对家 */}
        <div className="flex min-w-0 justify-end">
          <OpponentPanel
            player={players[rightSeat]}
            isCurrent={currentSeat === rightSeat}
            lastPlay={lastPlayOf(rightSeat)}
            countdown={opponentCountdown(rightSeat)}
          />
        </div>
      </div>

      {/* 底部视角手牌（观战模式含视角切换器） */}
      {renderHandSection('md')}
    </div>
  );

  // ---- 移动端纵向堆叠 ----
  const mobileLayout = (
    <div className="flex min-h-screen flex-col gap-3">
      <TableHeader
          baseScore={baseScore}
          multiplier={multiplier}
          mode={roomMode}
          onExit={onExit}
          autoPassEnabled={autoPassEnabled}
          onToggleAutoPass={() => useGameStore.getState().setAutoPassEnabled(!autoPassEnabled)}
        />

      {phase === GamePhase.BIDDING && currentSeat === humanSeat ? (
        <BiddingPanel highestBid={highestBid} legalBids={legalBids} onBid={(s) => useGameStore.getState().humanBid(s)} />
      ) : null}

      {/* 两个对家横向排列 */}
      <div className="grid grid-cols-2 gap-3">
        <OpponentPanel
          player={players[leftSeat]}
          isCurrent={currentSeat === leftSeat}
          lastPlay={lastPlayOf(leftSeat)}
          countdown={opponentCountdown(leftSeat)}
          compact
        />
        <OpponentPanel
          player={players[rightSeat]}
          isCurrent={currentSeat === rightSeat}
          lastPlay={lastPlayOf(rightSeat)}
          countdown={opponentCountdown(rightSeat)}
          compact
        />
      </div>

      <PlayArea lastPlay={lastPlay} isFreeTurn={isFreeTurn} />

      {bottomBadge}

      {phase === GamePhase.PLAYING && currentSeat === humanSeat ? (
        <ActionBar
          hasSelection={selectedCardIds.length > 0}
          selectedCount={selectedCardIds.length}
          isFreeTurn={isFreeTurn}
          isHumanTurn
          onPlay={() => useGameStore.getState().playSelected()}
          onPass={() => useGameStore.getState().passSelected()}
          onHint={() => useGameStore.getState().applyHint()}
          onClear={() => useGameStore.getState().clearSelection()}
        />
      ) : (
        <div className="flex items-center justify-center gap-2 text-sm text-white/60">
          <span className="h-1.5 w-1.5 animate-pulse-ring rounded-full bg-emerald-400" />
          {phase === GamePhase.PLAYING
            ? `${players[currentSeat].name} 思考中…`
            : phase === GamePhase.BIDDING
              ? `等待 ${players[currentSeat].name} 叫分…`
              : ''}
        </div>
      )}

      {/* 底部视角手牌（横向滚动；观战模式含视角切换器） */}
      {renderHandSection('sm')}
    </div>
  );

  return (
    <div className="table-felt min-h-screen w-full text-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col px-3 py-3 md:px-5 md:py-4">
        {isDesktop ? desktopLayout : mobileLayout}

        {/* 右侧侧边抽屉：观战模式显示「AI 思考日志」，人机模式显示「出牌记录（文字）」，
            两者均默认隐藏、点按钮滑出，体验一致。人机模式的出牌记录不再内联在牌桌下方。 */}
        {roomMode === 'AI_SPECTATE' ? <ThinkingLogDrawer /> : <PlayRecordDrawer />}

        <SettlementModal
          open={showSettlement}
          settlement={settlement}
          players={players}
          onRestart={restart}
          onDismiss={() => setSettlementDismissed(true)}
          onExit={onExit}
        />
      </div>
    </div>
  );
}

export default GameTablePage;
