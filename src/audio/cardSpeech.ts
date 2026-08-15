/**
 * 喊牌文案生成器（纯函数，无副作用、无平台依赖）。
 *
 * 把引擎识别出的牌型（HandPattern）翻译成一句自然语言，供 TTS 念出。
 * 调用方负责把文本交给 soundService.speak()。
 *
 * 设计取舍：
 * - 斗地主里"喊牌"通常只喊主牌（如"对三""顺子三到七""炸弹四个七"），
 *   不必把每一张都念出来，既清晰又不被冗长打断。
 * - 顺子/连对/飞机用"起点到终点"表达；三带/四带只点明主牌与点缀类型。
 * - 王炸单独成句，炸弹强调"四个 X"，制造冲击力。
 */

import { CardType, type HandPattern } from '@/engine';

/** 点数 → 中文念法（3~10 用中文数字，J/Q/K/A 用原字母，2/王用中文） */
function rankWord(rank: number): string {
  switch (rank) {
    case 3: return '三';
    case 4: return '四';
    case 5: return '五';
    case 6: return '六';
    case 7: return '七';
    case 8: return '八';
    case 9: return '九';
    case 10: return '十';
    case 11: return 'J';
    case 12: return 'Q';
    case 13: return 'K';
    case 14: return 'A';
    case 15: return '二';
    case 16: return '小王';
    case 17: return '大王';
    default: return String(rank);
  }
}

/** 连续牌型（顺子/连对/飞机）用"起点到终点"表达 */
function spanText(mainRank: number, length: number): string {
  const start: number = mainRank - length + 1;
  return `${rankWord(start)}到${rankWord(mainRank)}`;
}

/**
 * 依据牌型生成喊牌文案。
 * @param pattern 引擎识别出的牌型；为 null 时返回空串（交给调用方决定是否兜底）
 */
export function describePlay(pattern: HandPattern | null): string {
  if (!pattern) return '';
  const main: number = pattern.mainRank;
  const len: number = pattern.length;
  switch (pattern.type) {
    case CardType.SINGLE:
      return `出${rankWord(main)}`;
    case CardType.PAIR:
      return `出一对${rankWord(main)}`;
    case CardType.TRIPLE:
      return `出三个${rankWord(main)}`;
    case CardType.TRIPLE_WITH_SINGLE:
      return `出三带一，${rankWord(main)}带单`;
    case CardType.TRIPLE_WITH_PAIR:
      return `出三带二，${rankWord(main)}带对`;
    case CardType.STRAIGHT:
      return `出顺子，${spanText(main, len)}`;
    case CardType.DOUBLE_STRAIGHT:
      return `出连对，${spanText(main, len)}`;
    case CardType.PLANE:
      return `出飞机，${spanText(main, len)}`;
    case CardType.PLANE_WITH_SINGLES:
      return `出飞机带单，${spanText(main, len)}`;
    case CardType.PLANE_WITH_PAIRS:
      return `出飞机带对，${spanText(main, len)}`;
    case CardType.FOUR_WITH_TWO:
      return `出四带二，${rankWord(main)}`;
    case CardType.BOMB:
      return `炸弹，四个${rankWord(main)}`;
    case CardType.ROCKET:
      return '王炸';
    default:
      return `出${len}张`;
  }
}

/** 过牌文案 */
export function describePass(): string {
  return '过';
}
