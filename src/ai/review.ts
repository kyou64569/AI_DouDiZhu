/**
 * AI 复盘与决策质量统计（建议清单 #8 / #9）。
 *
 * 职责：
 *  - selectReviewHands：从「出牌历史 + 决策轨迹」里选出最值得复盘的 2-3 手
 *    （降级优先 > 炸弹/王炸 > 收官手，纯函数、可测）；
 *  - generateAIReview：构造复盘 prompt 并调用 LLM，解析为 { summary, comments }；
 *  - aggregateSeatStats：把决策轨迹聚合成 SeatDecisionStats（排行榜决策质量数据）。
 *
 * 复盘是「锦上添花」的后台任务：任何失败都向上返回 null / 抛出由调用方兜底，
 * 绝不影响对局结算与历史落库。
 */

import type { Card } from '@/types/card';
import { CardType } from '@/types/card';
import type { PlayRecord, SeatIndex } from '@/types/game';
import type { AIDecisionTrace, AIModelBinding } from '@/types/ai';
import type { SeatDecisionStats } from '@/types/history';
import { chatCompletion } from '@/api/llm';
import { getCardTypeName, identifyPattern } from '@/engine/cardType';
import { formatCards } from '@/engine/sort';

/** 复盘 prompt 结构化输出的契约 */
export interface ReviewOutcome {
  /** 总体评价 */
  summary: string;
  /** 逐手点评（与 hands 一一对应；解析失败时可能为空数组） */
  comments: string[];
}

/** 复盘接口的超时（后台任务，允许比出牌决策更久） */
export const REVIEW_TIMEOUT_MS: number = 30000;

/** 默认复盘手数上限 */
export const REVIEW_HAND_LIMIT: number = 3;

/** 复盘候选手（selectReviewHands 的产物，附带给 prompt 的展示文本） */
export interface ReviewHandCandidate {
  seat: SeatIndex;
  /** 该手在 playHistory 中的下标（0 基）。注意不是回合计数——回合数含过牌会跳号 */
  playIndex: number;
  cards: Card[];
  isPass: boolean;
  reason: string;
  degraded: boolean;
  warnings: string[];
}

/**
 * 从出牌历史 + 决策轨迹中选出最值得复盘的手。
 *
 * 打分口径：
 *  - 发生降级（source 非 LLM 或带 warnings）：基础 100 分 + 每条 warning 加 10；
 *  - 炸弹 / 王炸：加 50；
 *  - 收官手（最后一次有效出牌）：加 20（通常最有决定性）；
 *  - 普通 LLM 出牌：1 分（保证「无降级无炸弹」时也有可复盘内容）。
 *
 * @returns 按出牌顺序排列的候选手（至多 limit 手）；无 AI 出牌时为空数组
 */
export function selectReviewHands(
  playHistory: PlayRecord[],
  traces: AIDecisionTrace[],
  limit: number = REVIEW_HAND_LIMIT,
): ReviewHandCandidate[] {
  // 回合序号 → 轨迹（只看出牌阶段的决策）
  const traceByTurn = new Map<number, AIDecisionTrace>();
  for (const trace of traces) {
    if (trace.phase === 'play') {
      traceByTurn.set(trace.turn, trace);
    }
  }

  // 最后一次有效出牌的序号（收官手）
  let finalPlayIndex: number = -1;
  for (let i = playHistory.length - 1; i >= 0; i -= 1) {
    if (!playHistory[i].isPass) {
      finalPlayIndex = i;
      break;
    }
  }

  const scored: Array<{ candidate: ReviewHandCandidate; score: number; order: number }> = [];
  playHistory.forEach((rec: PlayRecord, index: number): void => {
    if (rec.isPass || rec.pattern === null) {
      return;
    }
    const trace = traceByTurn.get(rec.turn);
    if (trace === undefined) {
      return; // 人类出牌或旧数据，不在 AI 复盘范围
    }
    const degraded: boolean =
      trace.source !== 'LLM' ||
      trace.warnings.length > 0;
    let score: number = degraded ? 100 + trace.warnings.length * 10 : 1;
    if (rec.pattern.type === CardType.BOMB || rec.pattern.type === CardType.ROCKET) {
      score += 50;
    }
    if (index === finalPlayIndex) {
      score += 20;
    }
    scored.push({
      candidate: {
        seat: rec.seat,
        playIndex: index,
        cards: rec.cards,
        isPass: false,
        reason: trace.reason || rec.reason || '',
        degraded,
        warnings: trace.warnings.slice(),
      },
      score,
      order: index,
    });
  });

  scored.sort((a, b) => b.score - a.score || b.order - a.order);
  // 如果没有有效的候选手（scored 为空），返回空数组而不是强制返回 1 手
  if (scored.length === 0) {
    return [];
  }
  return scored
    .slice(0, Math.max(1, limit))
    .map((item) => item.candidate)
    .sort((a, b) => a.playIndex - b.playIndex);
}

/**
 * 把决策轨迹按座位聚合成 SeatDecisionStats（建议清单 #9）。
 */
export function aggregateSeatStats(traces: AIDecisionTrace[]): Record<SeatIndex, SeatDecisionStats> {
  const result: Record<SeatIndex, SeatDecisionStats> = {
    0: { decisions: 0, llmDecisions: 0, fallbackDecisions: 0, avgDecisionMs: 0 },
    1: { decisions: 0, llmDecisions: 0, fallbackDecisions: 0, avgDecisionMs: 0 },
    2: { decisions: 0, llmDecisions: 0, fallbackDecisions: 0, avgDecisionMs: 0 },
  };
  const latencySum: Record<SeatIndex, number> = { 0: 0, 1: 0, 2: 0 };

  for (const trace of traces) {
    const stats = result[trace.seat];
    if (stats === undefined) {
      continue;
    }
    stats.decisions += 1;
    if (trace.source === 'LLM') {
      stats.llmDecisions += 1;
    } else if (trace.source.startsWith('FALLBACK')) {
      stats.fallbackDecisions += 1;
    }
    latencySum[trace.seat] += Math.max(0, trace.latencyMs);
  }

  for (const seat of [0, 1, 2] as SeatIndex[]) {
    const stats = result[seat];
    stats.avgDecisionMs = stats.decisions > 0 ? Math.round(latencySum[seat] / stats.decisions) : 0;
  }
  return result;
}

/** 复盘 system 提示词 */
function buildReviewSystemPrompt(): string {
  return [
    '你是一位顶级的斗地主复盘教练，负责点评 AI 玩家在刚结束的对局中的关键决策。',
    '你会拿到若干「关键手」：出牌者、身份、牌面、牌型、当时的决策理由，以及是否发生了降级兜底。',
    '',
    '【点评要求】',
    '- 逐手评价：这手牌出得是否合理？结合身份（地主 / 农民）、配合与压制角度说明。',
    '- 若有更好的选择，明确给出更好的打法；若确实合理，说明为什么。',
    '- 标注「降级」的手说明模型输出非法被本地策略兜底，请指出可能的出错原因并给一句纠正建议。',
    '- 语气专业、克制，每手点评不超过 80 字，用中文。',
    '',
    '【输出格式 · 必须严格遵守】',
    '只输出一个 JSON 对象，不要 markdown 围栏，不要解释文字：',
    '{"summary":"总体评价（100 字以内）","comments":["第 1 手点评","第 2 手点评","第 3 手点评"]}',
    'comments 数组长度必须与关键手数量一致，顺序与输入一致。',
  ].join('\n');
}

/** 把候选手渲染成 prompt 里的逐条描述 */
export function describeReviewHand(hand: ReviewHandCandidate, seatNames: Record<SeatIndex, string>): string {
  const name: string = seatNames[hand.seat] ?? `座位${hand.seat + 1}`;
  const patternName: string =
    hand.cards.length > 0 ? (identifyTypeName(hand.cards) ?? `${hand.cards.length} 张`) : '过牌';
  const lines: string[] = [
    `第 ${hand.playIndex + 1} 手 · ${name}：出 ${formatCards(hand.cards)}（${patternName}）`,
  ];
  if (hand.reason.length > 0) {
    lines.push(`  当时理由：${hand.reason}`);
  }
  if (hand.degraded) {
    lines.push(`  ⚠ 该手发生了降级兜底：${hand.warnings.length > 0 ? hand.warnings.join('；') : '模型输出非法'}`);
  }
  return lines.join('\n');
}

/** 从牌列表反查牌型名（识别失败返回 null） */
function identifyTypeName(cards: Card[]): string | null {
  const pattern = identifyPattern(cards);
  return pattern === null ? null : getCardTypeName(pattern.type);
}

/** 生成复盘 prompt 的 user 消息 */
function buildReviewUserPrompt(
  hands: ReviewHandCandidate[],
  seatNames: Record<SeatIndex, string>,
  landlordSeat: SeatIndex,
  landlordWin: boolean,
): string {
  const sections: string[] = [
    '===== 对局背景 =====',
    '',
    `本局已结束，${landlordWin ? '地主获胜' : '农民获胜'}（地主是 ${seatNames[landlordSeat] ?? `座位${landlordSeat + 1}`}）。`,
    '以下是从本局挑出的关键手（按出牌顺序）：',
    '',
  ];
  hands.forEach((hand, i) => {
    sections.push(`【关键手 ${i + 1}】`);
    sections.push(describeReviewHand(hand, seatNames));
    sections.push('');
  });
  sections.push(
    '===== 请复盘 =====',
    `请对以上 ${hands.length} 手逐一点评，并给出总体评价。只输出 JSON。`,
  );
  return sections.join('\n');
}

/**
 * 从 LLM 返回内容解析复盘结论。
 * 容错链：剥 markdown 围栏 → JSON.parse（整段 → 首{到尾}截取）→ 字段校验。
 * comments 同时容忍三种形态——提示词契约是字符串数组，后两种是对模型自由发挥的容忍：
 * 字符串数组、{play, comment} 对象数组、{键: 值} 记录。
 * 全部失败时把原文截断当作 summary，并 warn 便于调试（不静默吞错）。
 */
export function parseReviewContent(content: string): ReviewOutcome {
  let text: string = content.trim();

  // 剥掉 markdown 围栏
  const fenced: RegExpMatchArray | null = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced !== null && fenced[1] !== undefined) {
    text = fenced[1].trim();
  }

  // 依次尝试：整段解析 → 首 { 到尾 } 截取解析（容忍 JSON 前后有寒暄文字）
  const candidates: string[] = [text];
  const startIdx: number = text.indexOf('{');
  const endIdx: number = text.lastIndexOf('}');
  if (startIdx !== -1 && endIdx > startIdx) {
    candidates.push(text.slice(startIdx, endIdx + 1));
  }
  for (const candidate of candidates) {
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        continue;
      }
      const obj = parsed as Record<string, unknown>;
      const summary: string = typeof obj.summary === 'string' ? obj.summary.trim() : '';
      const comments: string[] = parseReviewComments(obj.comments);
      if (summary.length > 0 || comments.length > 0) {
        return { summary, comments };
      }
    } catch {
      // 该候选不是合法 JSON：尝试下一个候选
    }
  }

  // 兜底：把原文清理后作为 summary（comments 留空，UI 只展示总体评价）。
  // 有意 warn：走到这里说明模型输出格式漂移，静默吞掉会让「为什么没有逐手点评」难以排查。
  // eslint-disable-next-line no-console
  console.warn('[ai/review] parseReviewContent: 未解析出结构化复盘，退化为纯文本 summary');
  const fallback: string = text.replace(/\s+/g, ' ').slice(0, 300);
  return {
    summary: fallback.length > 0 ? fallback : '（模型未返回有效复盘内容）',
    comments: [],
  };
}

/** comments 字段的三种容忍形态 → string[]；空 / 全非法时返回空数组 */
function parseReviewComments(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    const parts: string[] = [];
    for (const item of raw) {
      if (typeof item === 'string') {
        if (item.trim().length > 0) {
          parts.push(item.trim());
        }
      } else if (item !== null && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const play: string = typeof obj.play === 'string' ? obj.play.trim() : '';
        const comment: string = typeof obj.comment === 'string' ? obj.comment.trim() : '';
        if (comment.length > 0) {
          parts.push(play.length > 0 ? `${play}: ${comment}` : comment);
        }
      }
    }
    return parts;
  }
  if (raw !== null && typeof raw === 'object') {
    return Object.entries(raw as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
      .map(([k, v]) => `${k.trim()}: ${v.trim()}`);
  }
  return [];
}

/**
 * 调用 LLM 生成复盘。
 *
 * @throws ApiError / 解析异常由调用方捕获兜底（本函数不吞错误，便于区分失败原因）
 */
export async function generateAIReview(params: {
  binding: AIModelBinding;
  hands: ReviewHandCandidate[];
  seatNames: Record<SeatIndex, string>;
  landlordSeat: SeatIndex;
  landlordWin: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<ReviewOutcome> {
  const response = await chatCompletion(
    {
      baseUrl: params.binding.baseUrl,
      apiKey: params.binding.apiKey,
      model: params.binding.model,
      messages: [
        { role: 'system', content: buildReviewSystemPrompt() },
        {
          role: 'user',
          content: buildReviewUserPrompt(params.hands, params.seatNames, params.landlordSeat, params.landlordWin),
        },
      ],
      timeoutMs: params.timeoutMs ?? REVIEW_TIMEOUT_MS,
    },
    { timeoutMs: (params.timeoutMs ?? REVIEW_TIMEOUT_MS) + 2000, signal: params.signal },
  );
  return parseReviewContent(response.content);
}
