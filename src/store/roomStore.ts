/**
 * 房间与座位切片（REQ-R1 / G1 / G2）。
 *
 * 职责：对局模式选择、三个座位的 AI 分配、开始条件校验、生成 Room 快照。
 *
 * 明确不持久化（DESIGN §8.5）：房间是一次性的会话概念，刷新即重置。
 * 本文件不 import 任何其他 store，处于依赖链最底层。
 */

import { create } from 'zustand';
import type { Room, RoomMode, Seat } from '@/types/config';
import { createId } from '@/utils/id';

/** 座位索引 */
export type SeatSlot = 0 | 1 | 2;

/** 三个座位上的 AI 玩家 id，人类座位固定为 null */
export type SeatPlayerIds = [string | null, string | null, string | null];

/** 全部座位索引常量，便于页面遍历渲染 */
export const SEAT_SLOTS: readonly SeatSlot[] = [0, 1, 2] as const;

/** 人机模式下人类固定占用的座位 */
export const HUMAN_SEAT: SeatSlot = 0;

/** 默认对局模式 */
export const DEFAULT_ROOM_MODE: RoomMode = 'HUMAN_VS_AI';

/** 模式的中文展示名 */
export const ROOM_MODE_LABEL: Record<RoomMode, string> = {
  HUMAN_VS_AI: '人机模式',
  AI_SPECTATE: '观战模式',
};

/** 模式说明文案 */
export const ROOM_MODE_DESC: Record<RoomMode, string> = {
  HUMAN_VS_AI: '你固定占 1 席，需选择 2 个 AI 玩家入座',
  AI_SPECTATE: '3 席全部为 AI，全自动对战，你只需观看',
};

/** 空座位模板 */
const EMPTY_SEATS: SeatPlayerIds = [null, null, null];

/**
 * 判断某个座位在指定模式下是否为人类座位。
 *
 * @param mode 对局模式
 * @param seat 座位索引
 */
export function isHumanSeatOf(mode: RoomMode, seat: SeatSlot): boolean {
  return mode === 'HUMAN_VS_AI' && seat === HUMAN_SEAT;
}

/**
 * 指定模式下需要分配的 AI 座位索引列表。
 *
 * @param mode 对局模式
 * @returns 人机模式 `[1,2]`；观战模式 `[0,1,2]`
 */
export function aiSeatsOf(mode: RoomMode): SeatSlot[] {
  return SEAT_SLOTS.filter((seat: SeatSlot): boolean => !isHumanSeatOf(mode, seat));
}

/**
 * 指定模式下需要选择的 AI 数量。
 *
 * @param mode 对局模式
 * @returns 人机模式 2；观战模式 3
 */
export function requiredAICountOf(mode: RoomMode): number {
  return aiSeatsOf(mode).length;
}

/**
 * 由模式 + 座位分配构造标准 Seat 数组。
 *
 * @param mode 对局模式
 * @param seatPlayerIds 座位上的 AI 玩家 id
 */
export function buildSeats(mode: RoomMode, seatPlayerIds: SeatPlayerIds): [Seat, Seat, Seat] {
  const make = (seat: SeatSlot): Seat => {
    if (isHumanSeatOf(mode, seat)) {
      return { index: seat, kind: 'HUMAN' };
    }
    const aiPlayerId: string | null = seatPlayerIds[seat];
    return {
      index: seat,
      kind: 'AI',
      aiPlayerId: aiPlayerId ?? undefined,
    };
  };
  return [make(0), make(1), make(2)];
}

/** roomStore 的 state 与 action */
export interface RoomStoreState {
  /** 当前选择的对局模式 */
  mode: RoomMode;

  /** 三个座位上的 AI 玩家 id，人类座位为 null */
  seatPlayerIds: SeatPlayerIds;

  /** 已创建的房间快照，未创建为 null。牌桌页据此启动对局 */
  room: Room | null;

  /** 切换模式。切换时清空座位分配，避免遗留脏数据 */
  setMode: (mode: RoomMode) => void;

  /** 给某个座位分配 AI 玩家；传 null 表示清空该座位 */
  assignSeat: (seat: SeatSlot, aiPlayerId: string | null) => boolean;

  /** 清空全部座位分配 */
  clearSeats: () => void;

  /**
   * 剔除已不存在的 AI 玩家占位（例如玩家被删除后）。
   *
   * @param validPlayerIds 当前仍存在的玩家 id 集合
   * @returns 被剔除的座位数量
   */
  pruneSeats: (validPlayerIds: string[]) => number;

  /** 该 AI 玩家是否已占用任一座位 */
  isPlayerSeated: (aiPlayerId: string) => boolean;

  /** 当前尚未分配的 AI 座位数量 */
  missingSeatCount: () => number;

  /** 是否满足开始条件：AI 座位全部就位且无重复 */
  canStart: () => boolean;

  /** 未满足开始条件时的中文原因，满足时返回空字符串 */
  startBlockReason: () => string;

  /** 生成房间快照并写入 `room`；条件不满足返回 null */
  createRoom: () => Room | null;

  /** 清除房间快照（保留模式与座位选择） */
  clearRoom: () => void;

  /** 整体重置（模式、座位、房间） */
  reset: () => void;
}

/**
 * 房间 store。
 * 不做任何持久化 —— 刷新页面即回到初始状态，符合 DESIGN §8.5。
 */
export const useRoomStore = create<RoomStoreState>((set, get) => ({
  mode: DEFAULT_ROOM_MODE,
  seatPlayerIds: [...EMPTY_SEATS] as SeatPlayerIds,
  room: null,

  setMode: (mode: RoomMode): void => {
    if (get().mode === mode) {
      return;
    }
    set({
      mode,
      seatPlayerIds: [...EMPTY_SEATS] as SeatPlayerIds,
      room: null,
    });
  },

  assignSeat: (seat: SeatSlot, aiPlayerId: string | null): boolean => {
    const { mode, seatPlayerIds } = get();

    // 人类座位不可分配 AI
    if (isHumanSeatOf(mode, seat)) {
      return false;
    }

    // 同一个 AI 玩家不允许重复占两个座位
    if (aiPlayerId !== null) {
      const duplicated: boolean = seatPlayerIds.some(
        (id: string | null, idx: number): boolean => id === aiPlayerId && idx !== seat,
      );
      if (duplicated) {
        return false;
      }
    }

    const next: SeatPlayerIds = [...seatPlayerIds] as SeatPlayerIds;
    next[seat] = aiPlayerId;
    set({ seatPlayerIds: next });
    return true;
  },

  clearSeats: (): void => {
    set({ seatPlayerIds: [...EMPTY_SEATS] as SeatPlayerIds });
  },

  pruneSeats: (validPlayerIds: string[]): number => {
    const valid: Set<string> = new Set<string>(validPlayerIds);
    const current: SeatPlayerIds = get().seatPlayerIds;
    let removed: number = 0;

    const next: SeatPlayerIds = current.map((id: string | null): string | null => {
      if (id !== null && !valid.has(id)) {
        removed += 1;
        return null;
      }
      return id;
    }) as SeatPlayerIds;

    if (removed > 0) {
      set({ seatPlayerIds: next });
    }
    return removed;
  },

  isPlayerSeated: (aiPlayerId: string): boolean => {
    if (aiPlayerId.length === 0) {
      return false;
    }
    return get().seatPlayerIds.some((id: string | null): boolean => id === aiPlayerId);
  },

  missingSeatCount: (): number => {
    const { mode, seatPlayerIds } = get();
    return aiSeatsOf(mode).filter((seat: SeatSlot): boolean => seatPlayerIds[seat] === null).length;
  },

  canStart: (): boolean => {
    return get().startBlockReason().length === 0;
  },

  startBlockReason: (): string => {
    const { mode, seatPlayerIds } = get();
    const aiSeats: SeatSlot[] = aiSeatsOf(mode);

    const missing: number = aiSeats.filter((seat: SeatSlot): boolean => seatPlayerIds[seat] === null).length;
    if (missing > 0) {
      return `还有 ${missing} 个座位未分配 AI 玩家`;
    }

    const assigned: string[] = aiSeats.map((seat: SeatSlot): string => seatPlayerIds[seat] as string);
    const unique: Set<string> = new Set<string>(assigned);
    if (unique.size !== assigned.length) {
      return '同一个 AI 玩家不能占用多个座位';
    }

    return '';
  },

  createRoom: (): Room | null => {
    const { mode, seatPlayerIds } = get();
    if (!get().canStart()) {
      return null;
    }

    const room: Room = {
      id: createId('room'),
      mode,
      seats: buildSeats(mode, seatPlayerIds),
      createdAt: Date.now(),
    };
    set({ room });
    return room;
  },

  clearRoom: (): void => {
    set({ room: null });
  },

  reset: (): void => {
    set({
      mode: DEFAULT_ROOM_MODE,
      seatPlayerIds: [...EMPTY_SEATS] as SeatPlayerIds,
      room: null,
    });
  },
}));

export default useRoomStore;
