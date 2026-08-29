/**
 * 残局关卡数据与牌面解析（建议清单 #3）。
 *
 * 纯数据 + 纯函数模块：解析器把「牌面文本」转成确定性的 Card 实例，
 * 同一关卡每次解析产出完全一致的 id（`${levelId}-${seat}-${序号}`），
 * 保证重开局 / store 去重 / removeCards 的身份比较稳定可靠。
 *
 * 关卡设计口径：
 * - parMoves 与「挑战方有效出牌次数」（非过牌）同口径；
 * - 全部关卡已人工验证可解（挑战方存在必胜路线）；
 * - 对手为内置本地策略 AI（自由回合出最小牌、跟牌出最小可压牌），不消耗模型调用。
 */

import type { Card, Suit } from '@/types/card';
import type { SeatIndex } from '@/types/game';
import type { PuzzleLevel } from '@/types/puzzle';
import { RANK_BLACK_JOKER, RANK_RED_JOKER, SUITS, getRankLabel } from '@/engine/constants';

/** 牌面记号 → rank 映射（与测试 helpers 相同口径，另支持中文王）。 */
const TOKEN_RANK: Readonly<Record<string, number>> = {
  '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10,
  J: 11, Q: 12, K: 13, A: 14, '2': 15,
  BJ: RANK_BLACK_JOKER, RJ: RANK_RED_JOKER,
  小王: RANK_BLACK_JOKER, 大王: RANK_RED_JOKER,
};

/** 记号 → rank；无法识别时抛错（关卡数据写错应当立刻在测试中暴露）。 */
function tokenToRank(token: string): number {
  const rank: number | undefined = TOKEN_RANK[token.toUpperCase()] ?? TOKEN_RANK[token];
  if (rank === undefined) {
    throw new Error(`残局数据错误：无法识别的牌面记号 "${token}"`);
  }
  return rank;
}

/**
 * 解析一关的三家手牌。
 *
 * 同一关卡内按「花色顺序循环」分配同点数牌的花色，保证 id 与花色都不重复；
 * 任一点数超过一副牌的持有上限（普通牌 4 张、王各 1 张）时返回 null。
 *
 * @returns 三家手牌，索引即座位；数据非法返回 null
 */
export function parsePuzzleHands(level: PuzzleLevel): [Card[], Card[], Card[]] | null {
  const used: Map<number, number> = new Map<number, number>();
  const hands: [Card[], Card[], Card[]] = [[], [], []];

  try {
    for (const seat of [0, 1, 2] as SeatIndex[]) {
      const tokens: string[] = level.hands[seat].trim().split(/\s+/).filter((t) => t.length > 0);
      let index = 0;
      for (const token of tokens) {
        const rank: number = tokenToRank(token);
        const usedCount: number = used.get(rank) ?? 0;
        const maxCount: number = rank >= RANK_BLACK_JOKER ? 1 : 4;
        if (usedCount >= maxCount) {
          throw new Error(`点数 ${getRankLabel(rank)} 超过一副牌上限`);
        }
        used.set(rank, usedCount + 1);
        const suit: Suit = rank >= RANK_BLACK_JOKER ? 'JOKER' : SUITS[usedCount % SUITS.length];
        hands[seat].push({
          id: `${level.id}-${seat}-${index}`,
          suit,
          rank,
          label: getRankLabel(rank),
        });
        index += 1;
      }
    }
  } catch {
    return null;
  }

  // 三家都必须有牌，且先手座位必须持牌
  if (hands.some((h) => h.length === 0) || hands[level.firstSeat].length === 0) {
    return null;
  }
  return hands;
}

/* =============================================================================
 * 内置关卡（按难度递进；全部为「挑战方先手」的速攻型残局）
 * ========================================================================== */

/** 内置残局关卡目录。 */
export const PUZZLE_LEVELS: readonly PuzzleLevel[] = [
  {
    id: 'pz-rocket-intro',
    name: '王炸在手',
    stars: 1,
    playSeat: 0,
    landlordSeat: 0,
    firstSeat: 0,
    hands: ['2 小王 大王', 'A A K', 'K Q J'],
    parMoves: 2,
    goal: '你是地主（剩 3 张），两手之内用 2 与双王完成清盘。',
    tip: '双王合成王炸一手出掉，再单出 2 收官——两手清盘。逐张出（2 → 大王 → 小王）要三手，多花一手。',
  },
  {
    id: 'pz-bomb-clear',
    name: '炸弹清场',
    stars: 1,
    playSeat: 0,
    landlordSeat: 0,
    firstSeat: 0,
    hands: ['9 9 9 9 3', '2 A K', '2 5 8'],
    parMoves: 2,
    goal: '你是地主（剩 5 张），体验「炸弹夺取牌权 → 尾张取胜」的标准两连招。',
    tip: '炸弹 9999 谁也压不住；单张 3 作为最后一手打出即立刻获胜，无需对手应答。',
  },
  {
    id: 'pz-triple-rush',
    name: '三带一速通',
    stars: 2,
    playSeat: 0,
    landlordSeat: 0,
    firstSeat: 0,
    hands: ['Q Q Q 4 A 2 2', 'K K 9 9 6', 'A A J 10'],
    parMoves: 3,
    goal: '你是地主（剩 7 张），三手之内完成清盘，注意单张 A 是安全的收尾牌。',
    tip: '三带一 QQQ+4 → 对 2（最大对）→ 单 A 收尾。农民的对 A 拆不出更大的单张，压不住你的 A。',
  },
  {
    id: 'pz-plane-strike',
    name: '飞机总攻',
    stars: 3,
    playSeat: 0,
    landlordSeat: 0,
    firstSeat: 0,
    hands: ['A A A K K K Q Q 2', '2 K Q J 10 9', '2 J 9 8 7'],
    parMoves: 2,
    goal: '你是地主（剩 9 张），用一架飞机带走 8 张，再单出 2 收官。',
    tip: '飞机 AAAKKK 带对 QQ 一次走 8 张，农民没有炸弹无法压制；剩下的单 2 是全场最大。',
  },
  {
    id: 'pz-straight-escort',
    name: '顺子护送',
    stars: 3,
    playSeat: 0,
    landlordSeat: 0,
    firstSeat: 0,
    hands: ['10 J Q K A 2 2 小王 大王', '2 A A K K Q', '2 Q Q J J 9 9 8'],
    parMoves: 3,
    goal: '你是地主（剩 9 张），把散牌组成顺子一口气送走，再收尾清盘。',
    tip: '顺子 10-J-Q-K-A → 对 2 → 王炸。顺子必须趁自由回合一次性出掉，拆散就会被 2 截住。',
  },
] as const;

/** 按 id 查找关卡。 */
export function getPuzzleLevel(id: string): PuzzleLevel | undefined {
  return PUZZLE_LEVELS.find((level: PuzzleLevel): boolean => level.id === id);
}
