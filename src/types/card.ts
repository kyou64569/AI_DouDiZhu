/**
 * 扑克牌与牌型的基础类型定义。
 *
 * 该文件是整个规则引擎的类型基石，src/types/game.ts、src/types/ai.ts
 * 以及 src/engine/** 全部依赖此处的定义。
 *
 * 点数（rank）编码约定：
 *   3 ~ 14 → 3、4、5、6、7、8、9、10、J、Q、K、A
 *   15     → 2（大牌，不参与任何连续牌型）
 *   16     → 小王
 *   17     → 大王
 */

/** 花色。JOKER 为大小王专用花色。 */
export type Suit = 'SPADE' | 'HEART' | 'CLUB' | 'DIAMOND' | 'JOKER';

/** 单张扑克牌。 */
export interface Card {
  /** 全局唯一标识，形如 "SPADE-3-a1b2"，用于 React key 与去重 */
  id: string;
  /** 花色 */
  suit: Suit;
  /** 点数：3~14 = 3~A，15 = 2，16 = 小王，17 = 大王 */
  rank: number;
  /** 展示文案："3" "J" "2" "小王" "大王" */
  label: string;
}

/** 斗地主全部 13 种合法牌型。 */
export enum CardType {
  /** 单张 */
  SINGLE = 'SINGLE',
  /** 对子 */
  PAIR = 'PAIR',
  /** 三张 */
  TRIPLE = 'TRIPLE',
  /** 三带一 */
  TRIPLE_WITH_SINGLE = 'TRIPLE_WITH_SINGLE',
  /** 三带一对 */
  TRIPLE_WITH_PAIR = 'TRIPLE_WITH_PAIR',
  /** 顺子（≥5 张连续单牌，上界 A） */
  STRAIGHT = 'STRAIGHT',
  /** 连对（≥3 个连续对子，上界 A） */
  DOUBLE_STRAIGHT = 'DOUBLE_STRAIGHT',
  /** 飞机（≥2 组连续三张，不带牌） */
  PLANE = 'PLANE',
  /** 飞机带单张 */
  PLANE_WITH_SINGLES = 'PLANE_WITH_SINGLES',
  /** 飞机带对子 */
  PLANE_WITH_PAIRS = 'PLANE_WITH_PAIRS',
  /** 四带二（带两张单牌或两个对子） */
  FOUR_WITH_TWO = 'FOUR_WITH_TWO',
  /** 炸弹（四张同点数） */
  BOMB = 'BOMB',
  /** 王炸（大王 + 小王） */
  ROCKET = 'ROCKET',
}

/** 一次出牌所构成的牌型描述。 */
export interface HandPattern {
  /** 牌型种类 */
  type: CardType;
  /** 主牌点数，用于同类型之间比大小（顺子取最大一张，三带取三张的点数） */
  mainRank: number;
  /** 连续牌型的长度/组数；非连续牌型固定为 1 */
  length: number;
  /** 构成该牌型的原始卡牌 */
  cards: Card[];
}
