/**
 * AI 出牌编排层（REQ-R8 四层降级链路的命门）。
 *
 * 降级链路：
 *   第 0 层：binding 为 null / 网络异常 / 8s 硬超时 → FALLBACK_ERROR
 *   第 1 层：JSON 解析失败                          → FALLBACK_MINIMAL / FALLBACK_PASS
 *   第 2 层：牌面映射手牌失败                        → FALLBACK_MINIMAL / FALLBACK_PASS
 *   第 3 层：合法性校验失败                          → FALLBACK_MINIMAL / FALLBACK_PASS
 *
 * 铁律：
 * - 返回的 Promise【永远 resolve，永不 reject】，绝不允许抛异常中断对局
 * - 即使 LLM 返回看起来合法，也必须再跑一遍 validatePlay / canBeat 才认账
 * - 每一层降级都 push warning 并通过 onLog 吐一条 warn 级日志
 */

import type { Card, HandPattern } from '@/types/card';
import type { ChatMessage } from '@/types/api';
import {
  DecisionSource,
  type AIDecision,
  type AILogSink,
  type AIPlayInput,
  type AIRawResponse,
} from '@/types/ai';
import type { ThinkingMode } from '@/types/config';
import { DEFAULT_TEMPERATURE, DEFAULT_THINKING_MODE } from '@/types/config';
import { chatCompletion, AI_TIMEOUT_MS } from '@/api/llm';
import { toErrorMessage } from '@/api/client';
import { validatePlay, type ValidationResult } from '@/engine/validator';
import { hasPlayableHint, findHints } from '@/engine/hint';
import { formatCards } from '@/engine/sort';
import { getCardTypeName } from '@/engine/cardType';
import { buildPlayMessages } from './promptBuilder';
import { parsePlayResponse } from './responseParser';
import { matchCards, type MatchResult } from './cardMatcher';
import { buildFallbackDecision, resolveTarget } from './fallback';
import { resolveThinking } from './thinking';

/** 日志级别别名。 */
type Level = 'info' | 'warn' | 'error';

/**
 * 安全触发日志回调：回调自身抛异常也不影响决策主流程。
 */
function safeLog(
  onLog: AILogSink | undefined,
  seat: 0 | 1 | 2,
  playerName: string,
  level: Level,
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
 * AI 出牌决策主入口（AIPlayDriver 实现）。
 *
 * @param input 决策输入快照
 * @returns 永远 resolve 的合法决策
 */
export async function decidePlay(input: AIPlayInput): Promise<AIDecision> {
  const startedAt: number = Date.now();

  // 最外层兜底：任何未预期的异常都不允许逃逸出去
  try {
    return await runDecision(input, startedAt);
  } catch (error: unknown) {
    const message: string = toErrorMessage(error);
    const decision: AIDecision = buildFallbackDecision({
      hand: input.hand,
      lastPlay: input.lastPlay,
      isFreeTurn: input.isFreeTurn,
      warnings: [`编排层发生未预期异常：${message}`],
      startedAt,
      now: Date.now(),
      cause: '编排层异常',
      forcedSource: DecisionSource.FALLBACK_ERROR,
    });
    safeLog(
      input.onLog,
      input.seat,
      input.playerName,
      'error',
      `编排层异常（${message}），已兜底：${describeDecision(decision)}`,
      decision.source,
    );
    return decision;
  }
}

/** 把决策渲染成一句人类可读的日志文案。 */
function describeDecision(decision: AIDecision): string {
  if (decision.isPass) {
    return '过牌';
  }
  return `出牌 ${formatCards(decision.cards)}`;
}

/**
 * 实际的决策流程，异常由 decidePlay 统一兜住。
 */
async function runDecision(input: AIPlayInput, startedAt: number): Promise<AIDecision> {
  const {
    seat,
    playerName,
    binding,
    hand,
    lastPlay,
    isFreeTurn,
    timeoutMs = AI_TIMEOUT_MS,
    onLog,
  } = input;

  const warnings: string[] = [];
  const target: HandPattern | null = resolveTarget(lastPlay, isFreeTurn);

  /** 统一的降级出口。 */
  const degrade = (cause: string, forcedSource?: DecisionSource, level: Level = 'warn'): AIDecision => {
    const decision: AIDecision = buildFallbackDecision({
      hand,
      lastPlay,
      isFreeTurn,
      warnings,
      startedAt,
      now: Date.now(),
      cause,
      forcedSource,
    });
    safeLog(onLog, seat, playerName, level, `${cause}，已兜底：${describeDecision(decision)}`, decision.source);
    return decision;
  };

  // ======== 第 0 层 · A：未配置模型，直接本地兜底 ========
  if (binding === null) {
    // 与其余降级分支保持一致：降级原因必须进 warnings，供 UI 与 QA 读取
    warnings.push('该 AI 玩家未绑定可用模型配置，已改用本地兜底策略');
    return degrade('未绑定模型', DecisionSource.FALLBACK_ERROR);
  }

  // ======== 调用 LLM ========
  let content = '';
  try {
    const messages: ChatMessage[] = buildPlayMessages(input);
    const thinkingMode: ThinkingMode = binding.thinkingMode ?? DEFAULT_THINKING_MODE;
    const resolvedThinking = resolveThinking(binding.model, thinkingMode);
    // M4：推理模型思考耗时远超普通模型，超时随思考开启放大（默认 8s → 32s），
    // 否则 thinking 模型几乎必然在固定 8s 内 abort，LLM 驱动形同虚设
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
    // ======== 第 0 层 · B：网络异常 / 8s 硬超时 ========
    const message: string = toErrorMessage(error);
    warnings.push(`LLM 请求失败：${message}`);
    return degrade(`模型请求失败（${message}）`, DecisionSource.FALLBACK_ERROR, 'error');
  }

  // ======== 第 1 层：JSON 解析失败 ========
  const parsed: AIRawResponse | null = parsePlayResponse(content);
  if (parsed === null) {
    const preview: string = content.slice(0, 120).replace(/\s+/g, ' ');
    warnings.push(`LLM 返回无法解析为 JSON，原始片段："${preview}"`);
    return degrade('返回内容解析失败');
  }

    // ======== 模型选择过牌 ========
    if (parsed.action === 'pass') {
      // 自由回合过牌是非法的，必须降级
      if (isFreeTurn) {
        warnings.push('自由出牌回合模型却选择过牌，属非法决策');
        return degrade('自由回合非法过牌');
      }

      // ======== 必胜安全网 ========
      // 若存在一个能「一手清空手牌」的合法牌型（hint 张数 == 手牌张数），
      // 绝不允许模型主动过牌把必胜局让掉。这是「推理正确但 action 写错」的最终兜底，
      // 只针对「直接获胜」的极端情况，不影响任何正常的战略性过牌（如留炸弹）。
      const winningMove: Card[] | undefined = findHints(hand, target).find(
        (h: Card[]) => h.length === hand.length,
      );
      if (winningMove !== undefined) {
        const winCheck: ValidationResult = validatePlay(hand, winningMove, target);
        if (winCheck.valid) {
          safeLog(
            onLog,
            seat,
            playerName,
            'warn',
            `模型选择过牌会丢掉必胜局（${formatCards(winningMove)} 可一手出完直接获胜），已强制改判出牌`,
            DecisionSource.LLM,
          );
          return {
            isPass: false,
            cards: winningMove,
            reason: `强制采纳必胜出牌：${formatCards(winningMove)}`,
            source: DecisionSource.LLM,
            warnings,
            latencyMs: Math.max(0, Date.now() - startedAt),
          };
        }
      }

      // 合法过牌。但如果手上明明有牌能压，只做记录不强制改判——这是策略选择而非错误。
      const couldPlay: boolean = hasPlayableHint(hand, target);
      if (couldPlay) {
        safeLog(
          onLog,
          seat,
          playerName,
          'info',
          `选择过牌（手上有可压制的牌，主动战略性放弃）：${parsed.reason}`,
          DecisionSource.LLM,
        );
      } else {
        safeLog(onLog, seat, playerName, 'info', `选择过牌：${parsed.reason}`, DecisionSource.LLM);
      }

      return {
        isPass: true,
        cards: [],
        reason: parsed.reason.length > 0 ? parsed.reason : '无牌可压，选择过牌',
        source: DecisionSource.LLM,
        warnings,
        latencyMs: Math.max(0, Date.now() - startedAt),
      };
    }

  // ======== 第 2 层：牌面映射手牌失败 ========
  const matched: MatchResult = matchCards(hand, parsed.cards);
  if (matched.cards === null) {
    for (const warning of matched.warnings) {
      warnings.push(warning);
    }
    const labels: string = parsed.cards.join(' ');
    return degrade(`牌面映射失败（模型想出「${labels}」）`);
  }

  const picked: Card[] = matched.cards;

  // ======== 第 3 层：合法性校验失败 ========
  // 绝不信任模型，即使前面都通过了也要用引擎复验一遍
  const check: ValidationResult = validatePlay(hand, picked, target);
  if (!check.valid) {
    warnings.push(`校验未通过：${check.reason}（模型出牌 ${formatCards(picked)}）`);
    return degrade(`出牌不合法（${check.reason}）`);
  }

  // ======== 采纳 LLM 决策 ========
  const pattern: HandPattern | null = check.pattern;
  const typeName: string = pattern === null ? '未知牌型' : getCardTypeName(pattern.type);
  const reason: string = parsed.reason.length > 0 ? parsed.reason : `打出${typeName}`;

  safeLog(
    onLog,
    seat,
    playerName,
    'info',
    `出牌 ${formatCards(picked)}（${typeName}）：${reason}`,
    DecisionSource.LLM,
  );

  return {
    isPass: false,
    cards: picked,
    reason,
    source: DecisionSource.LLM,
    warnings,
    latencyMs: Math.max(0, Date.now() - startedAt),
  };
}
