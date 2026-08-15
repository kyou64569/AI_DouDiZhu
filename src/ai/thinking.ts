/**
 * 思考模式（推理强度）解析。
 *
 * 把「模型 id + 用户选定的思考模式」翻译成下游真正要发给上游的参数：
 *   - thinking: boolean（是否开启推理）
 *   - reasoningEffort?: 'low' | 'medium' | 'high'（推理强度）
 *
 * 纯函数，无副作用，便于单测。
 */

import type { ThinkingMode } from '@/types/config';

/** 推理型模型的 model id 关键词（命中任一词即视为推理模型，auto 模式据此判断） */
const REASONING_KEYWORDS: readonly string[] = [
  'reasoner',
  'deepseek-r1',
  'r1-',
  '-r1',
  'qwq',
  'qwen-qwq',
  'thinking',
  'o1',
  'o3',
  'o4',
  'glm-z1',
  'hunyuan-t1',
  'step-r',
  'kimi-thinking',
  'ernie-4.5',
];

/** 判断某个 model id 是否指向推理型模型（用于 auto 模式） */
export function isReasoningModel(model: string): boolean {
  const m: string = model.toLowerCase();
  return REASONING_KEYWORDS.some((kw: string): boolean => m.includes(kw));
}

/** 解析结果 */
export interface ResolvedThinking {
  /** 是否开启推理 */
  thinking: boolean;
  /** 推理强度，仅 thinking 为 true 时有意义 */
  reasoningEffort?: 'low' | 'medium' | 'high';
}

/**
 * 把（model, 思考模式）解析为下游参数。
 *
 * @param model 实际使用的模型 id（用于 auto 模式判定）
 * @param mode 用户选定的思考模式
 */
export function resolveThinking(model: string, mode: ThinkingMode): ResolvedThinking {
  switch (mode) {
    case 'off':
      return { thinking: false };
    case 'low':
    case 'medium':
    case 'high':
      return { thinking: true, reasoningEffort: mode };
    case 'auto':
    default:
      return isReasoningModel(model)
        ? { thinking: true, reasoningEffort: 'medium' }
        : { thinking: false };
  }
}

/** 便捷判断：该绑定是否启用了思考（供超时延长等复用） */
export function isThinkingEnabled(mode: ThinkingMode, model: string): boolean {
  return resolveThinking(model, mode).thinking;
}
