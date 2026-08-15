/**
 * AI 编排层统一出口（T05）。
 *
 * 对外只暴露两个驱动器与一个注入函数，gameStore 不直接 import 本目录下的
 * 任何实现细节 —— 而是在 App 启动时由 installLLMDrivers() 注入。
 */

import type {
  AIBidDecision,
  AIBidDriver,
  AIBidInput,
  AIDecision,
  AIPlayDriver,
  AIPlayInput,
} from '@/types/ai';
import { registerAIDrivers } from '@/store/gameStore';
import { decidePlay } from './aiOrchestrator';
import { decideBid } from './bidStrategy';

// ---------- 驱动器实现 ----------

/**
 * 出牌驱动器：符合 AIPlayDriver 契约，永远 resolve。
 */
export const llmPlayDriver: AIPlayDriver = (input: AIPlayInput): Promise<AIDecision> =>
  decidePlay(input);

/**
 * 叫分驱动器：符合 AIBidDriver 契约，永远 resolve。
 */
export const llmBidDriver: AIBidDriver = (input: AIBidInput): Promise<AIBidDecision> =>
  decideBid(input);

/**
 * 供 App 启动时调用，把 LLM 驱动注入 gameStore。
 *
 * gameStore 默认使用本地兜底驱动，调用本函数后替换为 LLM 驱动。
 * 建议在 `src/main.tsx` 或 `App.tsx` 顶层调用一次。
 *
 * 注意：`registerAIDrivers` 是两个位置参数（play, bid），不是对象参数。
 */
export function installLLMDrivers(): void {
  registerAIDrivers(llmPlayDriver, llmBidDriver);
}

// ---------- 子模块公开 API ----------

export { decidePlay } from './aiOrchestrator';
export { decideBid, evaluateHandStrength, heuristicBid } from './bidStrategy';
export type { HandStrength } from './bidStrategy';

export {
  buildBidMessages,
  buildBidSystemPrompt,
  buildBidUserPrompt,
  buildPlayMessages,
  buildPlaySystemPrompt,
  buildPlayUserPrompt,
} from './promptBuilder';

export { parseBidResponse, parsePlayResponse } from './responseParser';
export type { ParsedBid, ParsedPlay } from './responseParser';

export { labelToRank, matchCards } from './cardMatcher';
export type { MatchResult } from './cardMatcher';

export { buildFallbackDecision, buildLocalDecision, resolveTarget } from './fallback';
export type { FallbackParams } from './fallback';

// ---------- 类型透传 ----------
export { DecisionSource } from '@/types/ai';
export type {
  AIBidDecision,
  AIBidDriver,
  AIBidInput,
  AIDecision,
  AILogSink,
  AIModelBinding,
  AIPlayDriver,
  AIPlayInput,
  AIRawResponse,
  ThinkingLog,
} from '@/types/ai';
