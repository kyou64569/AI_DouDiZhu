/**
 * 难度分级决策参数测试（建议清单 #1）。
 */

import { describe, expect, it } from 'vitest';
import { resolveDifficultyTemperature, resolveDifficultyThinking } from '@/ai/difficulty';
import { DEFAULT_TEMPERATURE } from '@/types/config';

describe('难度 → 采样温度', () => {
  it('简单档固定 0.8，忽略配置温度', () => {
    expect(resolveDifficultyTemperature('easy', 0.1)).toBe(0.8);
  });

  it('普通档沿用配置温度；未配置时回落默认', () => {
    expect(resolveDifficultyTemperature('normal', 0.7)).toBe(0.7);
    expect(resolveDifficultyTemperature('normal', undefined)).toBe(DEFAULT_TEMPERATURE);
    expect(resolveDifficultyTemperature(undefined, undefined)).toBe(DEFAULT_TEMPERATURE);
  });

  it('困难 / 大师档压低温度（低于默认）', () => {
    expect(resolveDifficultyTemperature('hard', 0.9)).toBe(0.2);
    expect(resolveDifficultyTemperature('master', 0.9)).toBe(0.15);
    expect(resolveDifficultyTemperature('hard', undefined)).toBeLessThan(DEFAULT_TEMPERATURE);
  });
});

describe('难度 → 思考强度', () => {
  it('大师档把 auto 升级为 high', () => {
    expect(resolveDifficultyThinking('master', 'auto')).toBe('high');
  });

  it('用户显式设置（含 off）始终优先，不被静默覆盖', () => {
    expect(resolveDifficultyThinking('master', 'off')).toBe('off');
    expect(resolveDifficultyThinking('master', 'low')).toBe('low');
    expect(resolveDifficultyThinking(undefined, 'auto')).toBe('auto');
    expect(resolveDifficultyThinking('easy', 'auto')).toBe('auto');
  });
});
