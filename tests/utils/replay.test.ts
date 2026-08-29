/**
 * 回放帧构建测试（建议清单 #13）。
 */

import { describe, expect, it } from 'vitest';
import { CardType, type Card, type HandPattern } from '@/types/card';
import type { GameRecord } from '@/types/history';
import type { PlayRecord } from '@/types/game';
import { buildReplayFrames, initialHandCounts } from '@/utils/replay';

/** 构造测试牌（rank 决定 label） */
function card(rank: number, seq: number): Card {
  const labels: Record<number, string> = { 3: '3', 15: '2', 17: '大王' };
  return { id: `c-${seq}`, suit: 'SPADE', rank, label: labels[rank] ?? String(rank) };
}

function bomb(cards: Card[]): HandPattern {
  return { type: CardType.BOMB, mainRank: 3, length: 1, cards };
}

function single(c: Card): HandPattern {
  return { type: CardType.SINGLE, mainRank: c.rank, length: 1, cards: [c] };
}

/** 夹具：地主座位 0，出牌序列 炸弹 → 过 → 过 → 单张（随后自由） */
function makeRecord(playHistory: PlayRecord[]): GameRecord {
  return {
    id: 'rec-1',
    finishedAt: 0,
    mode: 'HUMAN_VS_AI',
    landlordWin: true,
    winnerSeat: 0,
    baseScore: 3,
    multiplier: 1,
    unitScore: 3,
    isSpring: false,
    isAntiSpring: false,
    multiplierDetail: [],
    seats: [
      { seat: 0, name: '地主', kind: 'AI', isLandlord: true, model: 'm1', score: 6 },
      { seat: 1, name: '农A', kind: 'AI', isLandlord: false, model: 'm2', score: -3 },
      { seat: 2, name: '农B', kind: 'HUMAN', isLandlord: false, model: null, score: -3 },
    ],
    bidHistory: [],
    playHistory,
  };
}

describe('回放帧构建', () => {
  it('初始手牌数：地主 20、农民 17', () => {
    expect(initialHandCounts(makeRecord([]))).toEqual([20, 17, 17]);
  });

  it('逐帧扣减剩牌数，lastPlay 随有效出牌推进', () => {
    const bombCards = [card(3, 1), card(3, 2), card(3, 3), card(3, 4)];
    const tail = card(15, 5);
    const record = makeRecord([
      { seat: 0, cards: bombCards, pattern: bomb(bombCards), isPass: false, turn: 0 },
      { seat: 1, cards: [], pattern: null, isPass: true, turn: 1 },
      { seat: 2, cards: [], pattern: null, isPass: true, turn: 2 },
      { seat: 0, cards: [tail], pattern: single(tail), isPass: false, turn: 3 },
    ]);
    const frames = buildReplayFrames(record);
    expect(frames).toHaveLength(4);

    // 帧 0：地主出炸弹 4 张，20 → 16；开局即自由出牌
    expect(frames[0].isFreeTurn).toBe(true);
    expect(frames[0].handCounts).toEqual([16, 17, 17]);
    expect(frames[0].lastPlay?.cards.length).toBe(4);

    // 帧 1：过牌不扣牌数，非自由态
    expect(frames[1].record.isPass).toBe(true);
    expect(frames[1].handCounts).toEqual([16, 17, 17]);
    expect(frames[1].isFreeTurn).toBe(false);

    // 帧 2：第二家过牌，仍未到自由态
    expect(frames[2].isFreeTurn).toBe(false);

    // 帧 3：连续两家过牌后回到地主 → 自由出牌，单张 2 走完
    expect(frames[3].isFreeTurn).toBe(true);
    expect(frames[3].handCounts).toEqual([15, 17, 17]);
    expect(frames[3].lastPlay?.cards.length).toBe(1);
  });

  it('lastPlay 是快照：后续帧更新不影响早前帧', () => {
    const bombCards = [card(3, 1), card(3, 2), card(3, 3), card(3, 4)];
    const tail = card(15, 5);
    const record = makeRecord([
      { seat: 0, cards: bombCards, pattern: bomb(bombCards), isPass: false, turn: 0 },
      { seat: 0, cards: [tail], pattern: single(tail), isPass: false, turn: 1 },
    ]);
    const frames = buildReplayFrames(record);
    expect(frames[0].lastPlay?.cards.length).toBe(4);
    expect(frames[1].lastPlay?.cards.length).toBe(1);
  });

  it('空出牌记录产出空帧序列', () => {
    expect(buildReplayFrames(makeRecord([]))).toEqual([]);
  });
});
