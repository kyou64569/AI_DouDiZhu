/**
 * LLM 提示词构造（PRD D4）。
 *
 * 产出 system + user 双消息。user 消息必须包含 PRD D4 要求的全部要素：
 * 完整手牌、身份（地主/农民）、三家剩牌数、最近一手牌、是否必须压制、
 * 倍数与底分、规则说明、严格 JSON 输出格式要求。
 *
 * 纯函数模块：只做字符串拼装，不发请求、不读 store。
 */

import type { Card, HandPattern } from '@/types/card';
import type { BidRecord, PlayRecord, SeatIndex } from '@/types/game';
import type { ChatMessage } from '@/types/api';
import type { AIBidInput, AIPlayInput } from '@/types/ai';
import { getCardTypeName, identifyPattern } from '@/engine/cardType';
import { countByRank } from '@/engine/cards';
import { formatCards, sortDesc } from '@/engine/sort';
import { getLegalBids } from '@/engine/bidding';
import { findHints } from '@/engine/hint';
import { getRankLabel, RANK_BLACK_JOKER, RANK_RED_JOKER } from '@/engine/constants';

/** 斗地主规则说明，出牌与叫分提示词共用。 */
const RULES_TEXT: string = [
  '【牌型规则】',
  '- 单张、对子、三张',
  '- 三带一（三张+任意单张）、三带一对（三张+一个对子）',
  '- 顺子：至少 5 张连续单牌，如 3-4-5-6-7、10-J-Q-K-A',
  '- 连对：至少 3 个连续对子，如 33-44-55',
  '- 飞机：至少 2 组连续三张，可不带牌、带等量单张或带等量对子',
  '- 四带二：四张同点数 + 两张单牌，或 + 两个对子',
  '- 炸弹：四张同点数，可压任何非炸弹牌型',
  '- 王炸：大王+小王，最大牌型，压一切',
  '',
  '【铁律 · 极其重要】',
  '- 牌力顺序：3 < 4 < 5 < 6 < 7 < 8 < 9 < 10 < J < Q < K < A < 2 < 小王 < 大王',
  '- 2、小王、大王【绝对不能】参与顺子、连对、飞机等任何连续牌型！',
  '  最大的顺子只能到 A，即 10-J-Q-K-A。像 J-Q-K-A-2 这样的牌是非法的。',
  '- 同类型牌型比大小时，张数必须完全相同才能比。5 张顺子压不过 6 张顺子。',
  '- 只能出自己手牌里真实拥有的牌，不能凭空捏造。',
].join('\n');

/** JSON 输出格式要求，出牌提示词专用。 */
const JSON_FORMAT_TEXT: string = [
  '【输出格式 · 必须严格遵守】',
  '只输出一个 JSON 对象，不要任何解释文字，不要 markdown 代码围栏，不要 ```json 标记。',
  '格式：',
  '{"action":"play","cards":["3","3","K"],"reason":"简要说明出牌理由"}',
  '或：',
  '{"action":"pass","cards":[],"reason":"简要说明过牌理由"}',
  '',
  'cards 数组里写牌面文字，大小写与中文均可：',
  '3 4 5 6 7 8 9 10 J Q K A 2 小王 大王',
  '出两张 3 就写 ["3","3"]，出一个王炸就写 ["小王","大王"]。',
  'reason 请控制在 60 字以内，用中文。',
].join('\n');

/** 把座位号转成「你 / 上家 / 下家」的相对称呼。 */
function seatAlias(target: number, self: number): string {
  if (target === self) {
    return '你';
  }
  // 斗地主逆时针：(self + 1) % 3 是下家
  if (target === (self + 1) % 3) {
    return '下家';
  }
  return '上家';
}

/** 生成身份描述。 */
function describeIdentity(seat: SeatIndex, landlordSeat: SeatIndex): string {
  if (seat === landlordSeat) {
    return '你是【地主】，目标是先出完手牌，独自对抗两个农民。';
  }
  const partnerSeat: number = [0, 1, 2].find(
    (s) => s !== seat && s !== landlordSeat,
  ) as number;
  return [
    '你是【农民】，需要和另一个农民配合，阻止地主先出完牌。',
    `地主在座位 ${landlordSeat}（${seatAlias(landlordSeat, seat)}），`,
    `你的农民队友在座位 ${partnerSeat}（${seatAlias(partnerSeat, seat)}）。`,
    '注意：队友出大牌时不要抢压，应该让队友走牌。',
  ].join('');
}

/** 生成三家剩牌数描述。 */
function describeHandCounts(
  handCounts: [number, number, number],
  seat: SeatIndex,
  landlordSeat: SeatIndex,
): string {
  const lines: string[] = [];
  for (let s = 0; s < handCounts.length; s += 1) {
    const role: string = s === landlordSeat ? '地主' : '农民';
    const alias: string = seatAlias(s, seat);
    const warn: string = s !== seat && handCounts[s] <= 2 ? '  ← 危险！即将出完，必须拦截' : '';
    lines.push(`  座位${s}（${alias}，${role}）：剩 ${handCounts[s]} 张${warn}`);
  }
  return lines.join('\n');
}

/** 生成「最近一手牌」描述。 */
function describeLastPlay(
  lastPlay: PlayRecord | null,
  seat: SeatIndex,
  landlordSeat: SeatIndex,
  isFreeTurn: boolean,
): string {
  if (isFreeTurn || lastPlay === null || lastPlay.pattern === null) {
    return '当前是【自由出牌】回合，场上没有需要压制的牌，你可以出任意合法牌型。';
  }
  const pattern: HandPattern = lastPlay.pattern;
  const role: string = lastPlay.seat === landlordSeat ? '地主' : '农民';
  const alias: string = seatAlias(lastPlay.seat, seat);
  return [
    `上一手牌由 座位${lastPlay.seat}（${alias}，${role}）打出：`,
    `  牌面：${formatCards(lastPlay.cards)}`,
    `  牌型：${getCardTypeName(pattern.type)}（${pattern.cards.length} 张）`,
    '你【必须】出同类型且同张数的更大牌，或者出炸弹/王炸，否则只能选择 pass 过牌。',
  ].join('\n');
}

/** 生成手牌结构提要，帮助模型看清对子/三张/炸弹。 */
function describeHandStructure(hand: Card[]): string {
  const counter: Map<number, number> = countByRank(hand);
  const bombs: string[] = [];
  const triples: string[] = [];
  const pairs: string[] = [];
  const ranks: number[] = Array.from(counter.keys()).sort((a, b) => b - a);

  for (const rank of ranks) {
    const count: number = counter.get(rank) ?? 0;
    const label: string = getRankLabel(rank);
    if (count === 4) {
      bombs.push(label);
    } else if (count === 3) {
      triples.push(label);
    } else if (count === 2) {
      pairs.push(label);
    }
  }

  const hasSmallJoker: boolean = hand.some((c) => c.rank === RANK_BLACK_JOKER);
  const hasBigJoker: boolean = hand.some((c) => c.rank === RANK_RED_JOKER);

  const parts: string[] = [];
  if (bombs.length > 0) {
    parts.push(`炸弹：${bombs.join('、')}`);
  }
  if (hasSmallJoker && hasBigJoker) {
    parts.push('王炸：小王+大王（你手上有王炸！）');
  }
  if (triples.length > 0) {
    parts.push(`三张：${triples.join('、')}`);
  }
  if (pairs.length > 0) {
    parts.push(`对子：${pairs.join('、')}`);
  }
  return parts.length > 0 ? parts.join('\n  ') : '无对子、三张或炸弹，均为单牌';
}

/** 自由/压制回合展示合法出牌选项时，单次最多列举的组合数（防止组合爆炸撑爆提示词）。 */
const LEGAL_MOVE_SHOW_LIMIT = 40;

/**
 * 把规则引擎算好的合法出牌组合整理成可读列表，直接喂给模型。
 *
 * 目的：模型在「从原始牌列表自己数结构」时极易产生幻觉（如明明有对子却说没有）。
 * 这里由确定性引擎 findHints 算出「一定能压过上家」的所有合法组合，避免模型误判。
 *
 * @param hand   当前手牌
 * @param target 待压制的牌型；null 表示自由出牌，返回所有合法组合
 */
function describeLegalMoves(hand: Card[], target: HandPattern | null): string {
  const hints: Card[][] = findHints(hand, target);
  if (hints.length === 0) {
    return '  你手上没有任何能压过上家的合法牌型，只能选择 pass（action="pass"）。';
  }

  const shown: Card[][] = hints.slice(0, LEGAL_MOVE_SHOW_LIMIT);
  const lines: string[] = shown.map((cards, index) => {
    const p = identifyPattern(cards);
    const typeName: string = p ? getCardTypeName(p.type) : '未知牌型';
    return `  ${index + 1}. ${formatCards(cards)}（${typeName}）`;
  });

  const total: number = hints.length;
  const footer: string =
    total > LEGAL_MOVE_SHOW_LIMIT
      ? `\n  共 ${total} 种合法组合，仅展示前 ${LEGAL_MOVE_SHOW_LIMIT} 种；请从中挑选最合适的一手。`
      : `\n  共 ${total} 种合法组合，均可直接打出（action="play"）。`;

  return lines.join('\n') + footer;
}

/** 生成近期出牌历史（最多取最后 8 条）。 */
function describeHistory(
  playHistory: PlayRecord[],
  seat: SeatIndex,
  landlordSeat: SeatIndex,
): string {
  const recent: PlayRecord[] = playHistory.slice(-8);
  if (recent.length === 0) {
    return '  （本局尚无出牌记录）';
  }
  const lines: string[] = recent.map((record) => {
    const role: string = record.seat === landlordSeat ? '地主' : '农民';
    const alias: string = seatAlias(record.seat, seat);
    if (record.isPass || record.pattern === null) {
      return `  座位${record.seat}（${alias}，${role}）：过牌`;
    }
    return `  座位${record.seat}（${alias}，${role}）：${formatCards(record.cards)}（${getCardTypeName(record.pattern.type)}）`;
  });
  return lines.join('\n');
}

/** 出牌决策的 system 提示词。 */
export function buildPlaySystemPrompt(): string {
  return [
    '你是一位顶级的斗地主 AI 玩家，牌技高超、算路精准、配合意识极强。',
    '你需要根据当前牌局形势，做出最优的出牌决策。',
    '',
    RULES_TEXT,
    '',
    '【决策要点】',
    '- 记牌：留意各家已出的牌，推断对手手上还剩什么。',
    '- 控场：手上有大牌时不要急着出，留着关键时刻压制。',
    '- 队友配合：作为农民，队友出牌走得顺时不要抢压自己人。',
    '- 拦截：任何一家剩牌 ≤2 张时必须全力拦截，必要时动用炸弹。',
    '- 走牌：优先打出零散小牌，把手牌结构理顺，避免留下打不出去的单张。',
    '- 可信清单：你的「合法出牌选项」已由规则引擎确定性算好，直接参考它做选择，不要凭空怀疑自己有没有某种牌型（例如明明有对子却说没有）。',
    '- 必胜：若你某一手牌能直接清空手牌（出牌后你手上 0 张），action 必须 是 "play"，绝对不能选 pass——这是直接获胜，没有任何理由放弃。',
    '',
    JSON_FORMAT_TEXT,
  ].join('\n');
}

/** 出牌决策的 user 提示词（PRD D4 全要素）。 */
export function buildPlayUserPrompt(input: AIPlayInput): string {
  const {
    seat,
    playerName,
    hand,
    landlordSeat,
    bottomCards,
    handCounts,
    lastPlay,
    isFreeTurn,
    playHistory,
    multiplier,
    baseScore,
  } = input;

  const sortedHand: Card[] = sortDesc(hand);

  const sections: string[] = [
    '===== 当前牌局 =====',
    '',
    `你是：${playerName}（座位 ${seat}）`,
    describeIdentity(seat, landlordSeat),
    '',
    '【你的完整手牌】',
    `  ${formatCards(sortedHand)}`,
    `  （共 ${hand.length} 张）`,
    '',
    '【你的手牌结构】',
    `  ${describeHandStructure(hand)}`,
    '',
    '【你的合法出牌选项（已用规则引擎为你算好，一定合法，可直接打出）】',
    `  ${describeLegalMoves(hand, isFreeTurn ? null : (lastPlay?.pattern ?? null))}`,
    '',
    '【三家剩牌数】',
    describeHandCounts(handCounts, seat, landlordSeat),
    '',
    '【底牌（已明牌）】',
    `  ${bottomCards.length > 0 ? formatCards(bottomCards) : '（未明牌）'}`,
    '',
    '【场上形势】',
    describeLastPlay(lastPlay, seat, landlordSeat, isFreeTurn),
    '',
    '【近期出牌记录】',
    describeHistory(playHistory, seat, landlordSeat),
    '',
    '【本局赌注】',
    `  底分 ${baseScore} 分，当前倍数 ${multiplier} 倍，单局基础分 ${baseScore * multiplier} 分。`,
    multiplier >= 4 ? '  倍数已经很高，请谨慎决策，避免大额失分。' : '',
    '',
    '===== 请决策 =====',
  ];

  if (isFreeTurn) {
    sections.push(
      '当前是自由出牌回合，你【必须出牌】，action 只能是 "play"，绝对不能是 "pass"。',
      '请从上面【你的合法出牌选项】中挑选最合适的一手打出。',
    );
  } else {
    sections.push(
      '你可以选择出牌压过上家（action="play"），或者过牌（action="pass"）。',
      '上面【你的合法出牌选项】已经逐条枚举好：只要该列表非空，action 就选 "play" 并从中挑一手最合适的；列表明确为空才选 pass。',
      '不要凭空猜测自己"没有能压的牌"——若列表里有牌，就一定压得过，直接选 play。',
      '注意：出的牌必须真的能压过上家，牌型和张数都要对得上。',
      '若你有一手牌能一手出完、直接获胜（出完后手上 0 张），action 必须 是 "play"，绝不能 pass。',
    );
  }

  sections.push('', '请只输出 JSON，不要有任何其他内容。');

  return sections.filter((line) => line !== '').join('\n');
}

/** 组装出牌决策的完整消息数组。 */
export function buildPlayMessages(input: AIPlayInput): ChatMessage[] {
  return [
    { role: 'system', content: buildPlaySystemPrompt() },
    { role: 'user', content: buildPlayUserPrompt(input) },
  ];
}

/** 叫分决策的 system 提示词。 */
export function buildBidSystemPrompt(): string {
  return [
    '你是一位顶级的斗地主 AI 玩家，现在处于【叫地主】阶段。',
    '你需要根据手上这 17 张牌的强度，决定叫多少分。',
    '',
    RULES_TEXT,
    '',
    '【叫分规则】',
    '- 可选分值：0（不叫）、1 分、2 分、3 分',
    '- 只能叫比当前最高分更高的分，或者选择不叫',
    '- 叫分最高者成为地主，获得 3 张底牌（共 20 张），底分即为叫分',
    '- 地主赢则赢两家的分，输则赔两家的分，风险与收益都翻倍',
    '',
    '【牌力评估要点】',
    '- 王炸（大小王齐全）是极强信号，通常值得叫 3 分',
    '- 炸弹（四张同点）每个都大幅提升牌力',
    '- 2 的数量、A 的数量决定控场能力',
    '- 手牌散乱、单张过多、缺乏大牌则应该少叫或不叫',
    '',
    '【输出格式 · 必须严格遵守】',
    '只输出一个 JSON 对象，不要任何解释文字，不要 markdown 围栏。',
    '格式：{"score":2,"reason":"简要说明理由"}',
    'score 必须是 0、1、2、3 中的一个整数。reason 用中文，60 字以内。',
  ].join('\n');
}

/** 叫分决策的 user 提示词。 */
export function buildBidUserPrompt(input: AIBidInput): string {
  const { seat, playerName, hand, bidHistory, highestBid } = input;
  const legalBids: number[] = getLegalBids(highestBid);

  const historyText: string =
    bidHistory.length === 0
      ? '  （你是第一个叫分的）'
      : bidHistory
          .map((record: BidRecord) =>
            record.score === 0
              ? `  座位${record.seat}：不叫`
              : `  座位${record.seat}：叫 ${record.score} 分`,
          )
          .join('\n');

  return [
    '===== 叫地主阶段 =====',
    '',
    `你是：${playerName}（座位 ${seat}）`,
    '',
    '【你的 17 张手牌】',
    `  ${formatCards(sortDesc(hand))}`,
    '',
    '【你的手牌结构】',
    `  ${describeHandStructure(hand)}`,
    '',
    '【已有叫分记录】',
    historyText,
    '',
    `【当前最高叫分】${highestBid} 分`,
    `【你可以叫的分数】${legalBids.map((b) => (b === 0 ? '0（不叫）' : `${b} 分`)).join('、')}`,
    '',
    '===== 请决策 =====',
    `你的 score 必须从 [${legalBids.join(', ')}] 中选择，其他数值都是非法的。`,
    '请只输出 JSON，不要有任何其他内容。',
  ].join('\n');
}

/** 组装叫分决策的完整消息数组。 */
export function buildBidMessages(input: AIBidInput): ChatMessage[] {
  return [
    { role: 'system', content: buildBidSystemPrompt() },
    { role: 'user', content: buildBidUserPrompt(input) },
  ];
}
