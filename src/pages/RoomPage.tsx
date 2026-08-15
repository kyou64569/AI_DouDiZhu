/**
 * 房间创建页（PRD 4.3 / REQ-R1、G1、G2）。
 *
 * 能力：
 * - 模式选择：人机模式（用户固定占 1 席 + 2 个 AI）/ 观战模式（3 个 AI）
 * - 座位分配：同一个 AI 玩家不允许重复占座
 * - 未满员时「开始游戏」禁用；满员点击后写入 roomStore 并跳转 /table
 */

import { useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Button from '@/components/common/Button';
import Select, { type SelectOption } from '@/components/common/Select';
import { toast } from '@/components/common/Toast';
import { ROUTES } from '@/routes';
import { cn } from '@/utils/cn';
import type { AIPlayer, ModelConfig, Room, RoomMode } from '@/types/config';
import { usePlayerStore } from '@/store/playerStore';
import { useConfigStore } from '@/store/configStore';
import { useSoundStore } from '@/store/soundStore';
import {
  ROOM_MODE_DESC,
  ROOM_MODE_LABEL,
  SEAT_SLOTS,
  aiSeatsOf,
  isHumanSeatOf,
  requiredAICountOf,
  useRoomStore,
  type SeatSlot,
} from '@/store/roomStore';

/** 可选模式列表 */
const MODES: readonly RoomMode[] = ['HUMAN_VS_AI', 'AI_SPECTATE'] as const;

/**
 * 房间创建页。
 */
export function RoomPage(): JSX.Element {
  const navigate = useNavigate();

  const players: AIPlayer[] = usePlayerStore((state) => state.players);
  const configs: ModelConfig[] = useConfigStore((state) => state.configs);

  const mode: RoomMode = useRoomStore((state) => state.mode);
  const seatPlayerIds = useRoomStore((state) => state.seatPlayerIds);
  const setMode = useRoomStore((state) => state.setMode);
  const assignSeat = useRoomStore((state) => state.assignSeat);
  const clearSeats = useRoomStore((state) => state.clearSeats);
  const pruneSeats = useRoomStore((state) => state.pruneSeats);
  const createRoom = useRoomStore((state) => state.createRoom);

  /** 玩家 id → 玩家对象 */
  const playerMap: Map<string, AIPlayer> = useMemo((): Map<string, AIPlayer> => {
    return new Map<string, AIPlayer>(players.map((p: AIPlayer): [string, AIPlayer] => [p.id, p]));
  }, [players]);

  /** 配置 id → 配置对象，用于展示每个 AI 的模型来源 */
  const configMap: Map<string, ModelConfig> = useMemo((): Map<string, ModelConfig> => {
    return new Map<string, ModelConfig>(configs.map((c: ModelConfig): [string, ModelConfig] => [c.id, c]));
  }, [configs]);

  // 玩家被删除后，剔除座位上的悬空引用
  useEffect(() => {
    const validIds: string[] = players.map((p: AIPlayer): string => p.id);
    const removed: number = pruneSeats(validIds);
    if (removed > 0) {
      toast.warning(`有 ${removed} 个座位上的 AI 玩家已被删除，座位已自动清空`);
    }
  }, [players, pruneSeats]);

  /** 需要分配的 AI 座位 */
  const aiSeats: SeatSlot[] = useMemo((): SeatSlot[] => aiSeatsOf(mode), [mode]);

  /** 需要的 AI 数量 */
  const requiredCount: number = requiredAICountOf(mode);

  /** 已分配的 AI 座位数 */
  const filledCount: number = aiSeats.filter((seat: SeatSlot): boolean => seatPlayerIds[seat] !== null).length;

  /** 是否存在重复占座 */
  const hasDuplicate: boolean = useMemo((): boolean => {
    const assigned: string[] = aiSeats
      .map((seat: SeatSlot): string | null => seatPlayerIds[seat])
      .filter((id: string | null): id is string => id !== null);
    return new Set<string>(assigned).size !== assigned.length;
  }, [aiSeats, seatPlayerIds]);

  /** 是否满足开始条件 */
  const canStart: boolean = filledCount === requiredCount && !hasDuplicate;

  /** 未满足时的原因文案 */
  const blockReason: string = !canStart
    ? hasDuplicate
      ? '同一个 AI 玩家不能占用多个座位'
      : `还需选择 ${requiredCount - filledCount} 个 AI 玩家`
    : '';

  /** AI 玩家数量是否足够 */
  const hasEnoughPlayers: boolean = players.length >= requiredCount;

  /**
   * 生成某个座位的下拉选项。
   * 已被其他座位占用的玩家会被禁用，从源头杜绝重复占座。
   */
  const buildSeatOptions = (seat: SeatSlot): SelectOption[] => {
    return players.map((p: AIPlayer): SelectOption => {
      const usedElsewhere: boolean = seatPlayerIds.some(
        (id: string | null, idx: number): boolean => id === p.id && idx !== seat,
      );
      const config: ModelConfig | undefined = configMap.get(p.modelConfigId);
      const modelText: string =
        config === undefined ? '配置已删除' : (p.modelId ?? config.selectedModel) || '未指定模型';
      return {
        value: p.id,
        label: `${p.name}（${modelText}）${usedElsewhere ? ' · 已占座' : ''}`,
        disabled: usedElsewhere,
      };
    });
  };

  /** 处理座位选择 */
  const handleSeatChange = (seat: SeatSlot, value: string): void => {
    const ok: boolean = assignSeat(seat, value.length > 0 ? value : null);
    if (!ok && value.length > 0) {
      toast.warning('该 AI 玩家已在其他座位，请换一个');
    }
  };

  /** 开始游戏 */
  const handleStart = (): void => {
    // 用户点击即一次明确手势，借此解锁浏览器音频（自动播放策略要求）
    useSoundStore.getState().unlock();
    const room: Room | null = createRoom();
    if (room === null) {
      toast.error(blockReason.length > 0 ? blockReason : '座位尚未满员，无法开始');
      return;
    }
    toast.success('房间已创建，正在进入牌桌');
    navigate(ROUTES.TABLE);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 页头 */}
      <div className="flex items-center gap-3">
        <span className="app-icon-badge" aria-hidden="true">
          🎴
        </span>
        <div>
          <h1 className="app-page-title">创建房间</h1>
          <p className="app-page-desc">选择对局模式并为座位分配 AI 玩家，满员后即可开始</p>
        </div>
      </div>

      {/* 模式选择 */}
      <section className="app-card p-5">
        <h2 className="app-section-title mb-3">对局模式</h2>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {MODES.map((item: RoomMode) => {
            const active: boolean = mode === item;
            return (
              <button
                key={item}
                type="button"
                onClick={() => setMode(item)}
                aria-pressed={active}
                className={cn(
                  'flex flex-col items-start gap-1 rounded-xl border p-4 text-left transition-all duration-150 active:scale-[0.99]',
                  active
                    ? 'border-gold-400/70 bg-brand-500/15 shadow-glowGold ring-1 ring-gold-400/50'
                    : 'border-white/10 bg-white/[0.03] hover:-translate-y-0.5 hover:border-white/25 hover:bg-white/[0.06] hover:shadow-md',
                )}
              >
                <span className="flex items-center gap-2 text-sm font-semibold text-slate-100">
                  <span
                    className={cn(
                      'flex h-4 w-4 items-center justify-center rounded-full border',
                      active ? 'border-gold-400' : 'border-slate-500',
                    )}
                  >
                    {active ? <span className="h-2 w-2 rounded-full bg-gold-400" /> : null}
                  </span>
                  {ROOM_MODE_LABEL[item]}
                </span>
                <span className="text-xs text-slate-400">{ROOM_MODE_DESC[item]}</span>
              </button>
            );
          })}
        </div>
      </section>

      {/* AI 玩家不足的引导 */}
      {!hasEnoughPlayers ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-amber-400/40 bg-amber-500/10 px-4 py-8 text-center">
          <p className="text-sm text-amber-300">
            {ROOM_MODE_LABEL[mode]}需要 {requiredCount} 个 AI 玩家，当前只有 {players.length} 个
          </p>
          <Link to={ROUTES.PLAYERS} className="text-sm font-medium text-gold-300 underline underline-offset-4 hover:text-gold-200">
            前往「AI 玩家」页创建
          </Link>
        </div>
      ) : null}

      {/* 座位分配 */}
      <section className="app-card p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="app-section-title">
            座位分配
            <span className="ml-2 text-xs font-normal text-slate-500">
              已就位 {filledCount} / {requiredCount}
            </span>
          </h2>
          <Button size="sm" variant="ghost" onClick={clearSeats} disabled={filledCount === 0}>
            清空座位
          </Button>
        </div>

        <div className="flex flex-col gap-3">
          {SEAT_SLOTS.map((seat: SeatSlot) => {
            if (isHumanSeatOf(mode, seat)) {
              return (
                <div
                  key={seat}
                  className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-3"
                >
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white/10 text-lg ring-1 ring-gold-400/40">
                    👤
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-100">座位 {seat + 1}（你）</p>
                    <p className="text-xs text-slate-400">人机模式下由你固定占用，无需选择</p>
                  </div>
                </div>
              );
            }

            const currentId: string | null = seatPlayerIds[seat];
            const current: AIPlayer | undefined = currentId !== null ? playerMap.get(currentId) : undefined;

            return (
              <div key={seat} className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 lg:flex-row lg:items-center lg:gap-4">
                <div className="flex flex-none items-center gap-3 lg:w-44">
                  <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-white/10 text-lg ring-1 ring-white/10">
                    {current?.avatar && current.avatar.length > 0 ? current.avatar : '🤖'}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-slate-100">座位 {seat + 1}（AI）</p>
                    <p className="text-xs text-slate-500">{current !== undefined ? '已就位' : '待分配'}</p>
                  </div>
                </div>

                <div className="flex-1">
                  <Select
                    options={buildSeatOptions(seat)}
                    value={currentId ?? ''}
                    placeholder="请选择 AI 玩家"
                    onChange={(e) => handleSeatChange(seat, e.target.value)}
                    aria-label={`座位 ${seat + 1} 的 AI 玩家`}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 开始游戏 */}
      <div className="app-card flex flex-col items-stretch gap-2 p-5 lg:flex-row lg:items-center lg:justify-between">
        <p className={canStart ? 'flex items-center gap-1.5 text-xs font-medium text-emerald-300' : 'text-xs text-slate-500'}>
          {canStart ? (
            <>
              <span className="h-1.5 w-1.5 animate-pulse-ring rounded-full bg-emerald-400" aria-hidden="true" />
              座位已满员，可以开始游戏
            </>
          ) : (
            blockReason
          )}
        </p>
        <Button size="lg" variant="gold" disabled={!canStart} onClick={handleStart} className="lg:w-40">
          开始游戏
        </Button>
      </div>
    </div>
  );
}

export default RoomPage;
