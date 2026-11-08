/**
 * 思考模式（推理强度）解析。
 *
 * 两步走（指南 §2 三段式的前两段）：
 * 1. 「模型 id + 用户选定的思考模式」解析成抽象档位（auto 按模型关键词判断是否推理）；
 * 2. 按「模型思考能力声明」折叠：binary 的低/中/高归一成满血（high）、none 直接不发。
 *
 * 产出统一为 `level: 'off' | 'low' | 'medium' | 'high' | null`：
 *   - 'off'  = 用户显式关闭 → 服务端按所选方言发禁用字段；
 *   - null   = 未设置/不适用 → 服务端不发任何思考字段（跟随模型默认，≠ off）；
 *   - low~high = 分档思考 → 服务端按方言翻译成 enable + reasoning_effort 等。
 * 「方言 → 字段」的翻译在服务端 thinkingAdapter（THINKING_PROFILES 注册表）完成。
 *
 * 纯函数，无副作用，便于单测。
 */

import type { ThinkingCapability, ThinkingMode } from '@/types/config';

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

/** 思考档位（能力折叠后的最终意图，与发给代理的 thinkingLevel 同形） */
export type ThinkingLevel = 'off' | 'low' | 'medium' | 'high';

/** 解析结果：level 为 null 表示「未设置/不适用」，不发任何思考字段 */
export interface ResolvedThinking {
  level: ThinkingLevel | null;
}

/** 判断某个 model id 是否指向推理型模型（用于 auto 模式） */
export function isReasoningModel(model: string): boolean {
  const m: string = model.toLowerCase();
  return REASONING_KEYWORDS.some((kw: string): boolean => m.includes(kw));
}

/**
 * 按模型思考能力折叠档位（指南 §5）。
 *
 * @param level 用户意图档位
 * @param capability 模型能力声明
 * @returns 折叠后的档位；none 时返回 null（不发任何思考参数）
 */
function foldByCapability(level: ThinkingLevel, capability: ThinkingCapability): ThinkingLevel | null {
  if (capability === 'none') {
    return null;
  }
  // binary 模型传 low/medium/high 往往「不报错却都满血思考」，归一成满血档，
  // 配合方言侧的 enable 开关语义，避免「假装分级」的误导
  if (capability === 'binary') {
    return 'high';
  }
  return level;
}

/**
 * 把（model, 思考模式, 能力声明）解析为最终思考档位。
 *
 * @param model 实际使用的模型 id（用于 auto 模式判定）
 * @param mode 用户选定的思考模式
 * @param capability 模型思考能力声明（缺省按 graded 处理，兼容存量绑定）
 */
export function resolveThinking(
  model: string,
  mode: ThinkingMode,
  capability: ThinkingCapability = 'graded',
): ResolvedThinking {
  switch (mode) {
    case 'off':
      // 显式关闭：按方言发禁用字段（默认开思考的模型才能真正关掉）；
      // 但 none（无思考能力）连禁用字段也不发（指南 §5：一个思考参数都不发）
      return { level: capability === 'none' ? null : 'off' };
    case 'low':
    case 'medium':
    case 'high':
      return { level: foldByCapability(mode, capability) };
    case 'auto':
    default:
      // 未显式指定：推理模型按中档开启（再按能力折叠），其余模型不发任何字段
      return isReasoningModel(model)
        ? { level: foldByCapability('medium', capability) }
        : { level: null };
  }
}

/** 便捷判断：该绑定是否启用思考（供超时延长等复用）。显式 off 与未设置均视为不启用 */
export function isThinkingEnabled(
  mode: ThinkingMode,
  model: string,
  capability: ThinkingCapability = 'graded',
): boolean {
  const level: ThinkingLevel | null = resolveThinking(model, mode, capability).level;
  return level !== null && level !== 'off';
}
