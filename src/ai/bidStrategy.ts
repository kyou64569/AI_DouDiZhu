/**
 * 叫分决策：LLM 优先 + 手牌强度启发式兜底。
 *
 * 降级链路与出牌一致：
 *   binding 为 null / 网络异常 / 超时 → FALLBACK_ERROR
 *   解析失败 / 分数非法              → FALLBACK_MINIMAL（用启发式结果）
 *
 * 输出的 score 必须始终落在 getLegalBids(highestBid) 之内。
 */

import type { Card } from '@/types/card';
import type { BidScore } from '@/types/game';
import type { ChatMessage } from '@/types/api';
import {
  DecisionSource,
  type AIBidDecision,
  type AIBidInput,
  type AILogSink,
} from '@/types/ai';
import type { ThinkingMode } from '@/types/config';
import { DEFAULT_TEMPERATURE, DEFAULT_THINKING_MODE } from '@/types/config';
import { chatCompletion, AI_TIMEOUT_MS } from '@/api/llm';
import { toErrorMessage } from '@/api/client';
import { getLegalBids } from '@/engine/bidding';
import { countByRank } from '@/engine/cards';
import { RANK_BLACK_JOKER, RANK_RED_JOKER } from '@/engine/constants';
import { buildBidMessages } from './promptBuilder';
import { parseBidResponse, type ParsedBid } from './responseParser';
import { resolveThinking } from './thinking';

/** 手牌强度评估明细。 */
export interface HandStrength {
  /** 综合强度分（0 ~ 100+） */
  score: number;
  /** 炸弹数量 */
  bombCount: number;
  /** 是否有王炸 */
  hasRocket: boolean;
  /** 大王 / 小王数量 */
  jokerCount: number;
  /** 2 的数量 */
  twoCount: number;
  /** A 的数量 */
  aceCount: number;
  /** 单张数量（结构散乱度） */
  singleCount: number;
  /** 人类可读的评估说明 */
  summary: string;
}

/**
 * 评估 17 张手牌的强度。
 *
 * 计分模型（经验值）：
 * - 王炸 +30，单个大王 +12，单个小王 +8
 * - 每个炸弹 +20
 * - 每张 2 +6，每张 A +3
 * - 三张 +3/组，对子 +1/组
 * - 单张过多扣分：超过 6 张单牌，每多一张 -2
 */
export function evaluateHandStrength(hand: Card[]): HandStrength {
  const counter: Map<number, number> = countByRank(hand);

  let bombCount = 0;
  let tripleCount = 0;
  let pairCount = 0;
  let singleCount = 0;

  counter.forEach((count: number) => {
    if (count === 4) {
      bombCount += 1;
    } else if (count === 3) {
      tripleCount += 1;
    } else if (count === 2) {
      pairCount += 1;
    } else if (count === 1) {
      singleCount += 1;
    }
  });

  const hasSmallJoker: boolean = (counter.get(RANK_BLACK_JOKER) ?? 0) > 0;
  const hasBigJoker: boolean = (counter.get(RANK_RED_JOKER) ?? 0) > 0;
  const jokerCount: number = (hasSmallJoker ? 1 : 0) + (hasBigJoker ? 1 : 0);
  const hasRocket: boolean = hasSmallJoker && hasBigJoker;

  const twoCount: number = counter.get(15) ?? 0;
  const aceCount: number = counter.get(14) ?? 0;

  let score = 0;
  if (hasRocket) {
    score += 30;
  } else {
    if (hasBigJoker) {
      score += 12;
    }
    if (hasSmallJoker) {
      score += 8;
    }
  }
  score += bombCount * 20;
  score += twoCount * 6;
  score += aceCount * 3;
  score += tripleCount * 3;
  score += pairCount * 1;

  if (singleCount > 6) {
    score -= (singleCount - 6) * 2;
  }

  const parts: string[] = [];
  if (hasRocket) {
    parts.push('有王炸');
  } else if (jokerCount > 0) {
    parts.push(`${hasBigJoker ? '有大王' : '有小王'}`);
  }
  if (bombCount > 0) {
    parts.push(`${bombCount} 个炸弹`);
  }
  if (twoCount > 0) {
    parts.push(`${twoCount} 张 2`);
  }
  if (aceCount > 0) {
    parts.push(`${aceCount} 张 A`);
  }
  if (singleCount > 6) {
    parts.push(`单张偏多(${singleCount})`);
  }
  const summary: string = parts.length > 0 ? parts.join('、') : '手牌平平';

  return {
    score: Math.max(0, score),
    bombCount,
    hasRocket,
    jokerCount,
    twoCount,
    aceCount,
    singleCount,
    summary,
  };
}

/**
 * 启发式叫分：把强度分映射到 0~3 分，并裁剪到合法区间。
 *
 * 阈值：>=42 叫 3 分，>=28 叫 2 分，>=16 叫 1 分，否则不叫。
 */
export function heuristicBid(hand: Card[], highestBid: number): { score: BidScore; reason: string } {
  const strength: HandStrength = evaluateHandStrength(hand);
  const legal: BidScore[] = getLegalBids(highestBid);

  let desired: BidScore = 0;
  if (strength.score >= 42) {
    desired = 3;
  } else if (strength.score >= 28) {
    desired = 2;
  } else if (strength.score >= 16) {
    desired = 1;
  }

  // 裁剪到合法叫分：取「不超过期望值」的最大合法分
  let chosen: BidScore = 0;
  for (const candidate of legal) {
    if (candidate <= desired && candidate > chosen) {
      chosen = candidate;
    }
  }

  const reason: string =
    chosen === 0
      ? `牌力评估 ${strength.score} 分（${strength.summary}），不够强，选择不叫`
      : `牌力评估 ${strength.score} 分（${strength.summary}），叫 ${chosen} 分`;

  return { score: chosen, reason };
}

/** 把任意数字裁剪为合法 BidScore；非法返回 null。 */
function toLegalBidScore(value: number, highestBid: number): BidScore | null {
  const legal: BidScore[] = getLegalBids(highestBid);
  const found: BidScore | undefined = legal.find((item) => item === value);
  return found === undefined ? null : found;
}

/** 安全触发日志回调，回调自身异常不影响主流程。 */
function safeLog(
  onLog: AILogSink | undefined,
  seat: 0 | 1 | 2,
  playerName: string,
  level: 'info' | 'warn' | 'error',
  message: string,
  source?: DecisionSource,
): void {
  if (onLog === undefined) {
    return;
  }
  try {
    onLog({ seat, playerName, level, message, source });
  } catch {
    // 日志失败绝不影响决策
  }
}

/**
 * 叫分决策主入口（AIBidDriver 实现）。
 *
 * 永远 resolve，绝不 reject：最外层 try/catch 兜住任何未预期异常，
 * 保证 aiAct() 调用本驱动器时绝不会被 reject 中断（REQ-R8 铁律）。
 */
export async function decideBid(input: AIBidInput): Promise<AIBidDecision> {
  const startedAt: number = Date.now();
  try {
    return await runBidDecision(input, startedAt);
  } catch (error: unknown) {
    const message: string = toErrorMessage(error);
    const decision: AIBidDecision = {
      score: 0,
      reason: `编排层异常（${message}），已兜底不叫`,
      source: DecisionSource.FALLBACK_ERROR,
      warnings: [`编排层发生未预期异常：${message}`],
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
    safeLog(
      input.onLog,
      input.seat,
      input.playerName,
      'error',
      `编排层异常（${message}），已兜底不叫`,
      decision.source,
    );
    return decision;
  }
}

/**
 * 叫分实际决策流程，异常由 decideBid 统一兜住。
 */
async function runBidDecision(input: AIBidInput, startedAt: number): Promise<AIBidDecision> {
  const {
    seat,
    playerName,
    binding,
    hand,
    highestBid,
    timeoutMs = AI_TIMEOUT_MS,
    onLog,
  } = input;

  const warnings: string[] = [];

  /** 组装启发式兜底结果。 */
  const buildHeuristic = (source: DecisionSource, cause: string): AIBidDecision => {
    const { score, reason } = heuristicBid(hand, highestBid);
    return {
      score,
      reason: cause.length > 0 ? `${cause}｜${reason}` : reason,
      source,
      warnings: warnings.slice(),
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  };

  // ---------- 第 0 层：未配置模型，直接本地启发式 ----------
  if (binding === null) {
    const decision: AIBidDecision = buildHeuristic(DecisionSource.FALLBACK_ERROR, '未配置模型');
    safeLog(onLog, seat, playerName, 'warn', `未绑定模型，使用本地策略叫分：${decision.reason}`, decision.source);
    return decision;
  }

  let content = '';
  try {
    const messages: ChatMessage[] = buildBidMessages(input);
    const thinkingMode: ThinkingMode = binding.thinkingMode ?? DEFAULT_THINKING_MODE;
    const resolvedThinking = resolveThinking(binding.model, thinkingMode);
    // M4：推理模型思考耗时远超普通模型，超时随思考开启放大（默认 8s → 32s）
    const effectiveTimeoutMs: number = resolvedThinking.thinking
      ? Math.max(timeoutMs, timeoutMs * 4)
      : timeoutMs;
    const response = await chatCompletion(
      {
        baseUrl: binding.baseUrl,
        apiKey: binding.apiKey,
        model: binding.model,
        messages,
        temperature:
          typeof binding.temperature === 'number' && Number.isFinite(binding.temperature)
            ? binding.temperature
            : DEFAULT_TEMPERATURE,
        thinking: resolvedThinking.thinking,
        reasoningEffort: resolvedThinking.reasoningEffort,
        timeoutMs: effectiveTimeoutMs,
      },
      { timeoutMs: effectiveTimeoutMs },
    );
    content = response.content;
  } catch (error: unknown) {
    // ---------- 第 0 层：网络异常 / 超时 ----------
    const message: string = toErrorMessage(error);
    warnings.push(`LLM 叫分请求失败：${message}`);
    const decision: AIBidDecision = buildHeuristic(DecisionSource.FALLBACK_ERROR, '模型请求失败');
    safeLog(onLog, seat, playerName, 'error', `叫分请求失败（${message}），降级本地策略：${decision.reason}`, decision.source);
    return decision;
  }

  // ---------- 第 1 层：解析失败 ----------
  const parsed: ParsedBid | null = parseBidResponse(content);
  if (parsed === null) {
    warnings.push('LLM 叫分返回无法解析为 JSON');
    const decision: AIBidDecision = buildHeuristic(DecisionSource.FALLBACK_MINIMAL, '返回解析失败');
    safeLog(onLog, seat, playerName, 'warn', `叫分返回解析失败，降级本地策略：${decision.reason}`, decision.source);
    return decision;
  }

  // ---------- 第 2 层：分数非法 ----------
  const legalScore: BidScore | null = toLegalBidScore(parsed.score, highestBid);
  if (legalScore === null) {
    warnings.push(
      `LLM 给出的叫分 ${parsed.score} 非法（当前最高 ${highestBid} 分，合法值 [${getLegalBids(highestBid).join(', ')}]）`,
    );
    const decision: AIBidDecision = buildHeuristic(DecisionSource.FALLBACK_MINIMAL, '叫分非法');
    safeLog(onLog, seat, playerName, 'warn', `叫分 ${parsed.score} 非法，降级本地策略：${decision.reason}`, decision.source);
    return decision;
  }

  // ---------- 采纳 LLM 决策 ----------
  const reason: string = parsed.reason.length > 0 ? parsed.reason : `叫 ${legalScore} 分`;
  const decision: AIBidDecision = {
    score: legalScore,
    reason,
    source: DecisionSource.LLM,
    warnings,
    latencyMs: Math.max(0, Date.now() - startedAt),
  };
  safeLog(
    onLog,
    seat,
    playerName,
    'info',
    `${legalScore === 0 ? '不叫' : `叫 ${legalScore} 分`}：${reason}`,
    DecisionSource.LLM,
  );
  return decision;
}
