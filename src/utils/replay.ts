/**
 * 对局回放帧构建（建议清单 #13，纯函数模块）。
 *
 * GameRecord 只保留每手的出牌记录，不含初始手牌（暗牌信息本就不可知），
 * 因此回放不还原「具体哪张牌在谁手上」，而是逐帧推演：
 *  - 各家剩余张数：初始 17 张（地主 +3 张底牌）逐手扣减；
 *  - 场上最近一手有效出牌（lastPlay）与自由出牌态；
 *  - 每帧的动作（出牌 / 过牌）与 AI 决策理由。
 *
 * 该模块只依赖类型，不做任何 IO / 随机 / Date，方便单测覆盖。
 */

import type { GameRecord } from '@/types/history';
import type { PlayRecord, SeatIndex } from '@/types/game';

/** 单帧回放状态 */
export interface ReplayFrame {
  /** 帧序号（0 基，等于 playHistory 索引） */
  index: number;
  /** 该帧行动座位 */
  seat: SeatIndex;
  /** 该帧动作记录（出牌或过牌） */
  record: PlayRecord;
  /** 该帧动作后的各家剩牌数，索引即座位 */
  handCounts: [number, number, number];
  /** 场上最近一手有效出牌（尚无则为 null） */
  lastPlay: PlayRecord | null;
  /** 该帧行动时是否处于自由出牌（无需压过上家） */
  isFreeTurn: boolean;
}

/** 初始手牌数（叫分前每人 17 张） */
export const INITIAL_HAND_COUNT = 17;

/** 底牌张数（地主并入） */
export const BOTTOM_CARD_COUNT = 3;

/** 推算初始各家手牌数：地主 17+3，农民 17 */
export function initialHandCounts(record: GameRecord): [number, number, number] {
  const counts: [number, number, number] = [
    INITIAL_HAND_COUNT,
    INITIAL_HAND_COUNT,
    INITIAL_HAND_COUNT,
  ];
  const landlord = record.seats.find((s) => s.isLandlord);
  if (landlord) {
    counts[landlord.seat] += BOTTOM_CARD_COUNT;
  }
  return counts;
}

/**
 * 把一局记录展开为逐帧回放序列。
 *
 * 自由出牌判定与引擎 advanceTurn 同口径：开局第一手，或上一手出牌后
 * 连续两家过牌，则当前行动者处于自由出牌态。
 * 防御：记录被篡改导致某家扣成负数时按 0 处理（不抛错）。
 */
export function buildReplayFrames(record: GameRecord): ReplayFrame[] {
  const counts: [number, number, number] = initialHandCounts(record);
  let lastPlay: PlayRecord | null = null;
  let passesSincePlay: number = 0;

  const frames: ReplayFrame[] = [];
  record.playHistory.forEach((rec: PlayRecord, index: number): void => {
    const isFreeTurn: boolean = lastPlay === null || passesSincePlay >= 2;

    if (!rec.isPass && rec.cards.length > 0) {
      counts[rec.seat] = Math.max(0, counts[rec.seat] - rec.cards.length);
      lastPlay = rec;
      passesSincePlay = 0;
    } else {
      passesSincePlay = Math.min(2, passesSincePlay + 1);
    }

    frames.push({
      index,
      seat: rec.seat,
      record: rec,
      handCounts: [counts[0], counts[1], counts[2]],
      // 快照：后续帧修改 lastPlay 不影响已生成帧
      lastPlay: lastPlay === null ? null : { ...lastPlay },
      isFreeTurn,
    });
  });

  return frames;
}
