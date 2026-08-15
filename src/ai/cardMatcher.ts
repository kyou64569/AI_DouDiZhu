/**
 * 牌面标签 → 手牌真实 Card 实例映射。
 *
 * 这是最容易出 bug 的环节：返回的必须是 hand 数组里的【原始对象引用】，
 * 因为后续 removeCards / validatePlay 都依赖 Card.id 精确匹配。
 * 绝不能凭标签新造 Card 对象。
 *
 * 纯函数模块，不抛异常，失败返回带 warning 的结果对象。
 */

import type { Card } from '@/types/card';
import { groupByRank } from '@/engine/cards';
import { sortAsc } from '@/engine/sort';
import { RANK_BLACK_JOKER, RANK_RED_JOKER } from '@/engine/constants';

/** 映射结果。 */
export interface MatchResult {
  /** 成功时为映射到的真实 Card 实例；失败为 null */
  cards: Card[] | null;
  /** 失败原因 / 告警信息 */
  warnings: string[];
}

/**
 * 牌面标签 → rank 的归一化表。
 * 键统一为大写去空格后的形式。
 */
const LABEL_TO_RANK: Readonly<Record<string, number>> = {
  '3': 3,
  '4': 4,
  '5': 5,
  '6': 6,
  '7': 7,
  '8': 8,
  '9': 9,
  '10': 10,
  T: 10,
  '１０': 10,
  J: 11,
  '11': 11,
  JACK: 11,
  Q: 12,
  '12': 12,
  QUEEN: 12,
  K: 13,
  '13': 13,
  KING: 13,
  A: 14,
  '14': 14,
  '1': 14, // 部分模型把 A 写成 1
  ACE: 14,
  '2': 15,
  '15': 15,
  TWO: 15,
  // 小王
  小王: RANK_BLACK_JOKER,
  小: RANK_BLACK_JOKER,
  BJ: RANK_BLACK_JOKER,
  BLACKJOKER: RANK_BLACK_JOKER,
  SMALLJOKER: RANK_BLACK_JOKER,
  LITTLEJOKER: RANK_BLACK_JOKER,
  黑桃JOKER: RANK_BLACK_JOKER,
  '16': RANK_BLACK_JOKER,
  鬼: RANK_BLACK_JOKER,
  // 大王
  大王: RANK_RED_JOKER,
  大: RANK_RED_JOKER,
  RJ: RANK_RED_JOKER,
  REDJOKER: RANK_RED_JOKER,
  BIGJOKER: RANK_RED_JOKER,
  LARGEJOKER: RANK_RED_JOKER,
  '17': RANK_RED_JOKER,
  王炸: RANK_RED_JOKER,
};

/** 需要在归一化时剥离的花色前缀（模型有时会写「黑桃J」）。 */
const SUIT_PREFIXES: readonly string[] = [
  '黑桃',
  '红桃',
  '红心',
  '梅花',
  '方块',
  '方片',
  '草花',
  '♠',
  '♥',
  '♣',
  '♦',
  'S',
  'H',
  'C',
  'D',
  'SPADE',
  'HEART',
  'CLUB',
  'DIAMOND',
];

/**
 * 把任意牌面标签归一化为 rank。
 *
 * @param label 原始标签，如 "3" / "小王" / "黑桃J" / "joker"
 * @returns 对应的 rank；无法识别返回 null
 */
export function labelToRank(label: string): number | null {
  if (typeof label !== 'string') {
    return null;
  }

  const raw: string = label.trim();
  if (raw.length === 0) {
    return null;
  }

  // 直接命中（保留中文原样，英文转大写并去空格/连字符）
  const upper: string = raw.toUpperCase().replace(/[\s_-]/g, '');

  if (Object.prototype.hasOwnProperty.call(LABEL_TO_RANK, raw)) {
    return LABEL_TO_RANK[raw];
  }
  if (Object.prototype.hasOwnProperty.call(LABEL_TO_RANK, upper)) {
    return LABEL_TO_RANK[upper];
  }

  // 裸 "JOKER"：无法区分大小王，按小王处理并由调用方兜底
  if (upper === 'JOKER' || upper === '王' || raw === '王') {
    return RANK_BLACK_JOKER;
  }

  // 剥掉花色前缀后重试，如「黑桃J」→「J」、「♠10」→「10」
  for (const prefix of SUIT_PREFIXES) {
    const upperPrefix: string = prefix.toUpperCase();
    if (upper.length > upperPrefix.length && upper.startsWith(upperPrefix)) {
      const rest: string = upper.slice(upperPrefix.length);
      if (Object.prototype.hasOwnProperty.call(LABEL_TO_RANK, rest)) {
        return LABEL_TO_RANK[rest];
      }
    }
    if (raw.length > prefix.length && raw.startsWith(prefix)) {
      const restRaw: string = raw.slice(prefix.length);
      const restUpper: string = restRaw.toUpperCase().replace(/[\s_-]/g, '');
      if (Object.prototype.hasOwnProperty.call(LABEL_TO_RANK, restRaw)) {
        return LABEL_TO_RANK[restRaw];
      }
      if (Object.prototype.hasOwnProperty.call(LABEL_TO_RANK, restUpper)) {
        return LABEL_TO_RANK[restUpper];
      }
    }
  }

  // 剥掉花色后缀，如「J黑桃」
  for (const prefix of SUIT_PREFIXES) {
    const upperSuffix: string = prefix.toUpperCase();
    if (upper.length > upperSuffix.length && upper.endsWith(upperSuffix)) {
      const rest: string = upper.slice(0, upper.length - upperSuffix.length);
      if (Object.prototype.hasOwnProperty.call(LABEL_TO_RANK, rest)) {
        return LABEL_TO_RANK[rest];
      }
    }
  }

  return null;
}

/**
 * 把牌面标签数组映射为手牌中的真实 Card 实例。
 *
 * 处理要点：
 * - 同点多张：AI 说两个 3，从手牌里取两张不同 id 的 3
 * - 手牌数量不足：映射失败，返回 null 并记录 warning
 * - 标签无法识别：映射失败
 *
 * @param hand   玩家当前手牌
 * @param labels 模型给出的牌面标签，如 ["3","3","K"]
 * @returns 映射结果；失败时 cards 为 null
 */
export function matchCards(hand: Card[], labels: string[]): MatchResult {
  const warnings: string[] = [];

  if (!Array.isArray(labels) || labels.length === 0) {
    warnings.push('AI 未给出任何牌面');
    return { cards: null, warnings };
  }

  if (!Array.isArray(hand) || hand.length === 0) {
    warnings.push('手牌为空，无法映射');
    return { cards: null, warnings };
  }

  // 先把标签全部转成 rank，任一失败即整体失败
  const wantedRanks: number[] = [];
  for (const label of labels) {
    const rank: number | null = labelToRank(label);
    if (rank === null) {
      warnings.push(`无法识别的牌面标签："${String(label)}"`);
      return { cards: null, warnings };
    }
    wantedRanks.push(rank);
  }

  // 按 rank 分组手牌，组内按花色稳定排序，保证同输入同输出
  const groups: Map<number, Card[]> = groupByRank(hand);
  const pools = new Map<number, Card[]>();
  groups.forEach((cards, rank) => {
    pools.set(rank, sortAsc(cards));
  });

  const picked: Card[] = [];
  const usedIds = new Set<string>();

  for (const rank of wantedRanks) {
    const pool: Card[] = pools.get(rank) ?? [];
    // 从池里找第一张尚未被选走的
    const candidate: Card | undefined = pool.find((card) => !usedIds.has(card.id));

    if (candidate === undefined) {
      const owned: number = pool.length;
      const needed: number = wantedRanks.filter((r) => r === rank).length;
      warnings.push(
        `手牌中「${rankLabelForWarning(rank)}」数量不足：需要 ${needed} 张，实际只有 ${owned} 张`,
      );
      return { cards: null, warnings };
    }

    usedIds.add(candidate.id);
    picked.push(candidate);
  }

  return { cards: picked, warnings };
}

/** 生成告警文案用的牌面名。 */
function rankLabelForWarning(rank: number): string {
  if (rank === RANK_BLACK_JOKER) {
    return '小王';
  }
  if (rank === RANK_RED_JOKER) {
    return '大王';
  }
  if (rank === 15) {
    return '2';
  }
  if (rank === 14) {
    return 'A';
  }
  if (rank === 13) {
    return 'K';
  }
  if (rank === 12) {
    return 'Q';
  }
  if (rank === 11) {
    return 'J';
  }
  return String(rank);
}
