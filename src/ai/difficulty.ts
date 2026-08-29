/**
 * AI 难度分级决策参数（建议清单 #1）。
 *
 * 难度通过两条通道影响决策质量：
 * 1. 采样温度：简单调高（多"人类式"失误），困难/大师调低（更稳更准）；
 *    普通沿用模型配置里的温度，尊重用户显式设置。
 * 2. 思考强度：大师档在用户未显式指定思考模式（auto）时升级为 high；
 *    用户显式选择（含 off）始终优先，不做静默覆盖。
 *
 * 提示词分层（记牌器 / 战术指令 / few-shot）见 promptBuilder.ts。
 */

import { DEFAULT_TEMPERATURE, type Difficulty, type ThinkingMode } from '@/types/config';

/** 各难度的采样温度；normal 用 NaN 占位，表示「沿用配置温度」 */
const DIFFICULTY_TEMPERATURE: Record<Difficulty, number> = {
  easy: 0.8,
  normal: Number.NaN,
  hard: 0.2,
  master: 0.15,
};

/**
 * 解析难度生效温度。
 *
 * @param difficulty 难度；undefined 视为 normal
 * @param configuredTemperature 模型配置里的温度（可能缺省/非法）
 * @returns 实际下发给 LLM 的温度
 */
export function resolveDifficultyTemperature(
  difficulty: Difficulty | undefined,
  configuredTemperature: number | undefined,
): number {
  const effective: Difficulty = difficulty ?? 'normal';
  const override: number = DIFFICULTY_TEMPERATURE[effective];
  if (Number.isFinite(override)) {
    return override;
  }
  return typeof configuredTemperature === 'number' && Number.isFinite(configuredTemperature)
    ? configuredTemperature
    : DEFAULT_TEMPERATURE;
}

/**
 * 解析难度生效的思考模式。
 * 大师档且用户为「自动」时升级为 high；其余一律尊重用户设置。
 */
export function resolveDifficultyThinking(difficulty: Difficulty | undefined, mode: ThinkingMode): ThinkingMode {
  if ((difficulty ?? 'normal') === 'master' && mode === 'auto') {
    return 'high';
  }
  return mode;
}
