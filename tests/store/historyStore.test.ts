import { describe, it, expect } from 'vitest';
import { computeLeaderboard, isGameRecord, useHistoryStore } from '@/store/historyStore';
import type { GameRecord, SeatSummary } from '@/types/history';
import type { SeatIndex } from '@/types/game';

function seat(seat: SeatIndex, name: string, kind: 'HUMAN' | 'AI', model: string | null, score: number): SeatSummary {
  return { seat, name, kind, isLandlord: seat === 0, model, score };
}

function record(id: string, seats: SeatSummary[], finishedAt = 1): GameRecord {
  return {
    id,
    finishedAt,
    mode: 'HUMAN_VS_AI',
    landlordWin: true,
    winnerSeat: 0,
    baseScore: 1,
    multiplier: 1,
    unitScore: 1,
    isSpring: false,
    isAntiSpring: false,
    multiplierDetail: [],
    seats,
    bidHistory: [],
    playHistory: [],
  };
}

describe('computeLeaderboard', () => {
  it('按模型聚合净胜分并降序排列', () => {
    const r1 = record('r1', [
      seat(0, 'A', 'AI', 'm1', 2),
      seat(1, 'B', 'AI', 'm2', -1),
      seat(2, 'C', 'AI', 'm2', -1),
    ]);
    const r2 = record('r2', [
      seat(0, 'A', 'AI', 'm1', 2),
      seat(1, 'B', 'AI', 'm2', -1),
      seat(2, 'C', 'AI', 'm2', -1),
    ]);
    const board = computeLeaderboard([r1, r2]);
    expect(board[0].key).toBe('m1');
    expect(board[0].totalScore).toBe(4);
    expect(board[0].games).toBe(2);
    expect(board[0].wins).toBe(2);
    expect(board[1].key).toBe('m2');
    expect(board[1].totalScore).toBe(-4);
    expect(board[1].games).toBe(4);
    expect(board[1].wins).toBe(0);
  });

  it('人类座位归入单独一组（label=人类）', () => {
    const r = record('r1', [
      seat(0, '我', 'HUMAN', null, 2),
      seat(1, 'B', 'AI', 'm2', -1),
      seat(2, 'C', 'AI', 'm2', -1),
    ]);
    const board = computeLeaderboard([r]);
    const human = board.find((e) => e.key === '__human__');
    expect(human).toBeDefined();
    expect(human!.label).toBe('人类');
    expect(human!.totalScore).toBe(2);
  });

  it('同一模型兼地主与农民时合并累计', () => {
    const r1 = record('r1', [
      seat(0, 'A', 'AI', 'm1', 2),
      seat(1, 'B', 'AI', 'm1', -1),
      seat(2, 'C', 'AI', 'm1', -1),
    ]);
    const board = computeLeaderboard([r1]);
    expect(board.length).toBe(1);
    expect(board[0].key).toBe('m1');
    expect(board[0].totalScore).toBe(0); // 2-1-1
    expect(board[0].games).toBe(3);
  });
});

describe('isGameRecord 守卫', () => {
  it('合法记录通过', () => {
    const r = record('r1', [seat(0, 'A', 'AI', 'm1', 1), seat(1, 'B', 'AI', 'm2', -1), seat(2, 'C', 'AI', 'm3', 0)]);
    expect(isGameRecord(r)).toBe(true);
  });

  it('残缺记录被拒绝', () => {
    expect(isGameRecord(null)).toBe(false);
    expect(isGameRecord({})).toBe(false);
    // seats 不足 3
    expect(isGameRecord(record('r1', [seat(0, 'A', 'AI', 'm1', 1)]) )).toBe(false);
    // 非法 mode
    expect(isGameRecord({ ...record('r1', [seat(0, 'A', 'AI', 'm1', 1), seat(1, 'B', 'AI', 'm2', 0), seat(2, 'C', 'AI', 'm3', 0)]), mode: 'X' })).toBe(false);
  });
});

describe('useHistoryStore.addRecord', () => {
  it('最新记录在前，并封顶 100 条', () => {
    useHistoryStore.getState().clear();
    for (let i = 0; i < 101; i += 1) {
      useHistoryStore.getState().addRecord(
        record(`g${i}`, [seat(0, 'A', 'AI', 'm1', 1), seat(1, 'B', 'AI', 'm2', -1), seat(2, 'C', 'AI', 'm3', 0)], i),
      );
    }
    const recs = useHistoryStore.getState().records;
    expect(recs.length).toBe(100);
    // 最新（finishedAt 最大的 100）应在最前
    expect(recs[0].finishedAt).toBe(100);
    expect(recs[recs.length - 1].finishedAt).toBe(1);
  });
});
