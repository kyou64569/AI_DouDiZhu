/**
 * 残局关卡数据测试（建议清单 #3）。
 *
 * 关卡是「手写数据」，一旦写错（点数超出一副牌、id 冲突、先手无牌）会直接
 * 导致运行时无法开局，因此用结构测试兜底。
 */

import { describe, expect, it } from 'vitest';
import { PUZZLE_LEVELS, getPuzzleLevel, parsePuzzleHands } from '@/puzzle/levels';
import { RANK_BLACK_JOKER, RANK_RED_JOKER } from '@/engine/constants';
import { findMinimalPlay } from '@/engine';
import { pattern } from '../helpers/cards';

describe('内置残局关卡 · 结构合法性', () => {
  it('关卡目录非空且 id 唯一', () => {
    expect(PUZZLE_LEVELS.length).toBeGreaterThan(0);
    const ids = PUZZLE_LEVELS.map((l) => l.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每关都能解析出三家合法手牌', () => {
    for (const level of PUZZLE_LEVELS) {
      const hands = parsePuzzleHands(level);
      expect(hands, `关卡 ${level.id} 解析失败`).not.toBeNull();
      if (hands === null) continue;
      // 三家都有牌，且先手与挑战方持牌
      for (const h of hands) {
        expect(h.length, `关卡 ${level.id} 存在空手牌`).toBeGreaterThan(0);
      }
      expect(hands[level.playSeat].length).toBeGreaterThan(0);
      expect(hands[level.firstSeat].length).toBeGreaterThan(0);
      // parMoves 必须是正数
      expect(level.parMoves).toBeGreaterThan(0);
    }
  });

  it('解析具有确定性：同关两次解析 id 完全一致', () => {
    for (const level of PUZZLE_LEVELS) {
      const a = parsePuzzleHands(level);
      const b = parsePuzzleHands(level);
      expect(a).not.toBeNull();
      expect(b).not.toBeNull();
      expect(a?.map((h) => h.map((c) => c.id))).toEqual(b?.map((h) => h.map((c) => c.id)));
    }
  });

  it('全部关卡合计不超出一副牌的点数上限（普通 4 张、王各 1 张）', () => {
    for (const level of PUZZLE_LEVELS) {
      const hands = parsePuzzleHands(level);
      expect(hands).not.toBeNull();
      if (hands === null) continue;
      const counter = new Map<number, number>();
      for (const h of hands) {
        for (const c of h) {
          counter.set(c.rank, (counter.get(c.rank) ?? 0) + 1);
        }
      }
      counter.forEach((count, rank) => {
        const max = rank >= RANK_BLACK_JOKER || rank === RANK_RED_JOKER ? 1 : 4;
        expect(count, `关卡 ${level.id} 点数 ${rank} 超限`).toBeLessThanOrEqual(max);
      });
    }
  });

  it('挑战方第一手必有合法出牌（自由回合）', () => {
    for (const level of PUZZLE_LEVELS) {
      const hands = parsePuzzleHands(level);
      expect(hands).not.toBeNull();
      if (hands === null) continue;
      expect(findMinimalPlay(hands[level.firstSeat], null), `关卡 ${level.id} 先手无合法牌`).not.toBeNull();
    }
  });

  it('「王炸在手」关卡：农民手牌压不住单张 2（可解性抽查）', () => {
    const level = getPuzzleLevel('pz-rocket-intro');
    expect(level).toBeDefined();
    if (level === undefined) return;
    const hands = parsePuzzleHands(level);
    expect(hands).not.toBeNull();
    if (hands === null) return;
    const singleTwoTarget = pattern('2');
    expect(findMinimalPlay(hands[1], singleTwoTarget)).toBeNull();
    expect(findMinimalPlay(hands[2], singleTwoTarget)).toBeNull();
  });

  it('按 id 查找：存在命中 / 不存在返回 undefined', () => {
    expect(getPuzzleLevel(PUZZLE_LEVELS[0].id)?.id).toBe(PUZZLE_LEVELS[0].id);
    expect(getPuzzleLevel('no-such-level')).toBeUndefined();
  });
});

describe('残局解析器 · 防御', () => {
  it('同点数超过 4 张时返回 null', () => {
    const bad = { ...PUZZLE_LEVELS[0], id: 'pz-bad-dup', hands: ['3 3 3 3 3', 'A', 'A'] } as typeof PUZZLE_LEVELS[0];
    expect(parsePuzzleHands(bad)).toBeNull();
  });

  it('先手座位无牌时返回 null', () => {
    const bad = { ...PUZZLE_LEVELS[0], id: 'pz-bad-empty', hands: ['2', 'A A', ''] } as typeof PUZZLE_LEVELS[0];
    // 关卡 0 的 firstSeat=0，手里有牌；把空手放到 firstSeat 才应失败
    bad.firstSeat = 2;
    expect(parsePuzzleHands(bad)).toBeNull();
  });

  it('无法识别的记号返回 null（而非抛错）', () => {
    const bad = { ...PUZZLE_LEVELS[0], id: 'pz-bad-token', hands: ['2 x', 'A A', 'K K'] } as typeof PUZZLE_LEVELS[0];
    expect(parsePuzzleHands(bad)).toBeNull();
  });
});
