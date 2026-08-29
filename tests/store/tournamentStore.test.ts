/**
 * 连胜赛 store 测试（建议清单 #4）。
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { computeChampion, useTournamentStore } from '@/store/tournamentStore';

describe('连胜赛 store', () => {
  beforeEach(() => {
    useTournamentStore.getState().reset();
  });

  it('start 开启赛制并清零进度', () => {
    useTournamentStore.getState().recordRound({ winnerSeat: 0, seatScores: [2, -1, -1] });
    // 未激活时 recordRound 是 no-op
    expect(useTournamentStore.getState().completedRounds).toBe(0);

    useTournamentStore.getState().start(3);
    const st = useTournamentStore.getState();
    expect(st.active).toBe(true);
    expect(st.targetRounds).toBe(3);
    expect(st.completedRounds).toBe(0);
    expect(st.seatScores).toEqual([0, 0, 0]);
    expect(st.finished).toBe(false);
  });

  it('逐局累加积分，打满后 finished=true', () => {
    useTournamentStore.getState().start(3);
    const record = useTournamentStore.getState().recordRound;

    record({ winnerSeat: 0, seatScores: [2, -1, -1] });
    record({ winnerSeat: 1, seatScores: [-2, 1, 1] });
    let st = useTournamentStore.getState();
    expect(st.completedRounds).toBe(2);
    expect(st.seatScores).toEqual([0, 0, 0]);
    expect(st.finished).toBe(false);

    record({ winnerSeat: 2, seatScores: [-3, -1, 4] });
    st = useTournamentStore.getState();
    expect(st.completedRounds).toBe(3);
    expect(st.seatScores).toEqual([-3, -1, 4]);
    expect(st.finished).toBe(true);
    expect(st.roundResults).toHaveLength(3);
    expect(st.roundResults[2].winnerSeat).toBe(2);
  });

  it('打满后继续 recordRound 不再累计（防超局）', () => {
    useTournamentStore.getState().start(1);
    useTournamentStore.getState().recordRound({ winnerSeat: 0, seatScores: [2, -1, -1] });
    expect(useTournamentStore.getState().finished).toBe(true);
    useTournamentStore.getState().recordRound({ winnerSeat: 1, seatScores: [-2, 1, 1] });
    expect(useTournamentStore.getState().seatScores).toEqual([2, -1, -1]);
    expect(useTournamentStore.getState().completedRounds).toBe(1);
  });

  it('reset 彻底回到未激活态', () => {
    useTournamentStore.getState().start(5);
    useTournamentStore.getState().recordRound({ winnerSeat: 0, seatScores: [1, 1, -2] });
    useTournamentStore.getState().reset();
    const st = useTournamentStore.getState();
    expect(st.active).toBe(false);
    expect(st.completedRounds).toBe(0);
    expect(st.seatScores).toEqual([0, 0, 0]);
    expect(st.roundResults).toHaveLength(0);
  });

  it('computeChampion 取累计最高分座位并识别并列', () => {
    expect(computeChampion([-3, -1, 4])).toEqual({ seat: 2, score: 4, tie: false });
    expect(computeChampion([3, 3, -6])).toEqual({ seat: 0, score: 3, tie: true });
    // 全为 0 分不产生冠军
    expect(computeChampion([0, 0, 0])).toBeNull();
  });
});
