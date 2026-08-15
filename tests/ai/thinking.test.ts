import { describe, it, expect } from 'vitest';
import { isReasoningModel, resolveThinking, isThinkingEnabled } from '@/ai/thinking';

describe('isReasoningModel', () => {
  it('识别推理模型关键词', () => {
    expect(isReasoningModel('deepseek-reasoner')).toBe(true);
    expect(isReasoningModel('DeepSeek-R1')).toBe(true);
    expect(isReasoningModel('Qwen/QwQ-32B')).toBe(true);
    expect(isReasoningModel('o3-mini')).toBe(true);
    expect(isReasoningModel('glm-z1-32b')).toBe(true);
    expect(isReasoningModel('gpt-4o')).toBe(false);
    expect(isReasoningModel('glm-4-plus')).toBe(false);
  });
});

describe('resolveThinking', () => {
  it('off 不开启思考', () => {
    expect(resolveThinking('gpt-4o', 'off')).toEqual({ thinking: false });
  });

  it('low/medium/high 开启并设置对应强度', () => {
    expect(resolveThinking('gpt-4o', 'low')).toEqual({ thinking: true, reasoningEffort: 'low' });
    expect(resolveThinking('gpt-4o', 'medium')).toEqual({ thinking: true, reasoningEffort: 'medium' });
    expect(resolveThinking('gpt-4o', 'high')).toEqual({ thinking: true, reasoningEffort: 'high' });
  });

  it('auto 对推理模型开启 medium', () => {
    expect(resolveThinking('deepseek-reasoner', 'auto')).toEqual({ thinking: true, reasoningEffort: 'medium' });
  });

  it('auto 对非推理模型关闭', () => {
    expect(resolveThinking('gpt-4o', 'auto')).toEqual({ thinking: false });
  });
});

describe('isThinkingEnabled', () => {
  it('与 resolveThinking.thinking 一致', () => {
    expect(isThinkingEnabled('off', 'gpt-4o')).toBe(false);
    expect(isThinkingEnabled('high', 'gpt-4o')).toBe(true);
    expect(isThinkingEnabled('auto', 'deepseek-r1')).toBe(true);
    expect(isThinkingEnabled('auto', 'gpt-4o')).toBe(false);
  });
});
