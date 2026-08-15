/**
 * 喊牌文案生成器单测（纯函数，无 window 依赖）。
 * 验证各牌型都能产出可念的自然语言文案，且不抛异常。
 */

import { describe, expect, it } from 'vitest';
import { CardType, type HandPattern } from '@/engine';
import { describePass, describePlay } from '@/audio/cardSpeech';
import type { Card } from '@/types/card';

/** 造一张指定点数的牌（用于构造 HandPattern.cards，本测试只关心 type/mainRank/length） */
function card(rank: number): Card {
  return { id: `c-${rank}`, suit: 'SPADE', rank, label: String(rank) };
}

/** 用 type/mainRank/length 构造 HandPattern */
function pat(type: CardType, mainRank: number, length: number): HandPattern {
  return { type, mainRank, length, cards: [card(mainRank)] };
}

describe('describePlay — 各牌型喊牌文案', () => {
  it('单张 → 出X', () => {
    expect(describePlay(pat(CardType.SINGLE, 14, 1))).toBe('出A');
  });

  it('对子 → 出一对X', () => {
    expect(describePlay(pat(CardType.PAIR, 7, 1))).toBe('出一对七');
  });

  it('三张 → 出三个X', () => {
    expect(describePlay(pat(CardType.TRIPLE, 9, 1))).toBe('出三个九');
  });

  it('三带一 → 出三带一，X带单', () => {
    expect(describePlay(pat(CardType.TRIPLE_WITH_SINGLE, 13, 1))).toBe('出三带一，K带单');
  });

  it('三带二 → 出三带二，X带对', () => {
    expect(describePlay(pat(CardType.TRIPLE_WITH_PAIR, 13, 1))).toBe('出三带二，K带对');
  });

  it('顺子 → 出顺子，起点到终点', () => {
    // 3 4 5 6 7，mainRank=7，length=5
    expect(describePlay(pat(CardType.STRAIGHT, 7, 5))).toBe('出顺子，三到七');
  });

  it('连对 → 出连对，起点到终点', () => {
    // 33 44 55，mainRank=5，length=3
    expect(describePlay(pat(CardType.DOUBLE_STRAIGHT, 5, 3))).toBe('出连对，三到五');
  });

  it('飞机 → 出飞机，起点到终点', () => {
    // 333 444，mainRank=4，length=2
    expect(describePlay(pat(CardType.PLANE, 4, 2))).toBe('出飞机，三到四');
  });

  it('飞机带单 → 出飞机带单，起点到终点', () => {
    expect(describePlay(pat(CardType.PLANE_WITH_SINGLES, 4, 2))).toBe('出飞机带单，三到四');
  });

  it('飞机带对 → 出飞机带对，起点到终点', () => {
    expect(describePlay(pat(CardType.PLANE_WITH_PAIRS, 4, 2))).toBe('出飞机带对，三到四');
  });

  it('四带二 → 出四带二，X', () => {
    expect(describePlay(pat(CardType.FOUR_WITH_TWO, 6, 1))).toBe('出四带二，六');
  });

  it('炸弹 → 炸弹，四个X', () => {
    expect(describePlay(pat(CardType.BOMB, 8, 1))).toBe('炸弹，四个八');
  });

  it('王炸 → 王炸', () => {
    expect(describePlay(pat(CardType.ROCKET, 17, 1))).toBe('王炸');
  });

  it('pattern 为 null 时返回空串', () => {
    expect(describePlay(null)).toBe('');
  });
});

describe('describePass', () => {
  it('返回"过"', () => {
    expect(describePass()).toBe('过');
  });
});
