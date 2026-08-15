/**
 * 牌型大小比较。
 *
 * 核心契约：同类型 + 同张数才可比；炸弹压非炸弹；王炸压一切。
 */

import { describe, expect, it } from 'vitest';
import { canBeat, canBeatCards, comparePatterns, getPatternPower } from '@/engine/compare';
import { hand, pattern } from '../helpers/cards';

describe('canBeat · 同类型比较', () => {
  it('同类型同张数时比 mainRank', () => {
    expect(canBeat(pattern('K'), pattern('Q'))).toBe(true);
    expect(canBeat(pattern('Q'), pattern('K'))).toBe(false);
  });

  it('点数相同不算压过（必须严格更大）', () => {
    expect(canBeat(pattern('9 9'), pattern('9 9'))).toBe(false);
  });

  it('2 大于 A，小王大于 2，大王大于小王', () => {
    expect(canBeat(pattern('2'), pattern('A'))).toBe(true);
    expect(canBeat(pattern('BJ'), pattern('2'))).toBe(true);
    expect(canBeat(pattern('RJ'), pattern('BJ'))).toBe(true);
  });

  it('类型不同一律压不过', () => {
    expect(canBeat(pattern('K K'), pattern('Q'))).toBe(false);
    expect(canBeat(pattern('5 5 5 6'), pattern('5 5 5 6 6'))).toBe(false);
  });

  it('顺子张数不同压不过：6 张顺子不能压 5 张顺子', () => {
    expect(canBeat(pattern('4 5 6 7 8 9'), pattern('3 4 5 6 7'))).toBe(false);
    expect(canBeat(pattern('4 5 6 7 8'), pattern('3 4 5 6 7'))).toBe(true);
  });

  it('连对张数不同压不过', () => {
    expect(canBeat(pattern('5 5 6 6 7 7 8 8'), pattern('3 3 4 4 5 5'))).toBe(false);
    expect(canBeat(pattern('5 5 6 6 7 7'), pattern('3 3 4 4 5 5'))).toBe(true);
  });

  it('飞机带单不能压飞机带对', () => {
    expect(canBeat(pattern('8 8 8 9 9 9 3 4'), pattern('5 5 5 6 6 6 3 3 4 4'))).toBe(false);
  });

  it('四带两单与四带两对因 length 不同不可互压', () => {
    expect(canBeat(pattern('K K K K 3 4'), pattern('3 3 3 3 5 5 6 6'))).toBe(false);
    expect(canBeat(pattern('K K K K 3 3 4 4'), pattern('3 3 3 3 5 5 6 6'))).toBe(true);
  });
});

describe('canBeat · 炸弹与王炸', () => {
  it('炸弹压任意非炸弹牌型', () => {
    expect(canBeat(pattern('3 3 3 3'), pattern('RJ'))).toBe(true);
    expect(canBeat(pattern('3 3 3 3'), pattern('10 J Q K A'))).toBe(true);
    expect(canBeat(pattern('3 3 3 3'), pattern('A A A A 5 6'))).toBe(true);
  });

  it('非炸弹压不过炸弹', () => {
    expect(canBeat(pattern('RJ'), pattern('3 3 3 3'))).toBe(false);
    expect(canBeat(pattern('A A A A 5 6'), pattern('3 3 3 3'))).toBe(false);
  });

  it('炸弹之间比点数', () => {
    expect(canBeat(pattern('K K K K'), pattern('5 5 5 5'))).toBe(true);
    expect(canBeat(pattern('5 5 5 5'), pattern('K K K K'))).toBe(false);
  });

  it('王炸压一切，包括炸弹', () => {
    expect(canBeat(pattern('BJ RJ'), pattern('2 2 2 2'))).toBe(true);
    expect(canBeat(pattern('BJ RJ'), pattern('3'))).toBe(true);
  });

  it('任何牌型都压不过王炸', () => {
    expect(canBeat(pattern('2 2 2 2'), pattern('BJ RJ'))).toBe(false);
    expect(canBeat(pattern('BJ RJ'), pattern('BJ RJ'))).toBe(false);
  });
});

describe('canBeatCards · 直接用原始卡牌比较', () => {
  it('两边都合法时等价于 canBeat', () => {
    expect(canBeatCards(hand('K K'), hand('Q Q'))).toBe(true);
    expect(canBeatCards(hand('Q Q'), hand('K K'))).toBe(false);
  });

  it('任一方不构成合法牌型时返回 false 而不是抛异常', () => {
    expect(canBeatCards(hand('3 4'), hand('Q Q'))).toBe(false);
    expect(canBeatCards(hand('K K'), hand('3 4'))).toBe(false);
    expect(canBeatCards([], hand('K K'))).toBe(false);
  });
});

describe('getPatternPower / comparePatterns', () => {
  it('强度：普通牌型 < 炸弹 < 王炸', () => {
    const normal: number = getPatternPower(pattern('2'));
    const bomb: number = getPatternPower(pattern('3 3 3 3'));
    const rocket: number = getPatternPower(pattern('BJ RJ'));
    expect(normal).toBeLessThan(bomb);
    expect(bomb).toBeLessThan(rocket);
  });

  it('炸弹之间点数越大强度越高', () => {
    expect(getPatternPower(pattern('K K K K'))).toBeGreaterThan(getPatternPower(pattern('4 4 4 4')));
  });

  it('comparePatterns 可用于升序排序，炸弹与王炸排最后', () => {
    const list = [pattern('BJ RJ'), pattern('5 5 5 5'), pattern('K'), pattern('3')];
    const sorted = list.slice().sort(comparePatterns);
    expect(sorted.map((item) => item.type)).toEqual(['SINGLE', 'SINGLE', 'BOMB', 'ROCKET']);
    expect(sorted[0].mainRank).toBe(3);
    expect(sorted[1].mainRank).toBe(13);
  });
});
