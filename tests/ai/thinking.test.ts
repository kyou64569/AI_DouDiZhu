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

describe('resolveThinking（graded 默认能力）', () => {
  it('off 显式关闭（≠ 未设置）', () => {
    expect(resolveThinking('gpt-4o', 'off')).toEqual({ level: 'off' });
  });

  it('low/medium/high 原样透传', () => {
    expect(resolveThinking('gpt-4o', 'low')).toEqual({ level: 'low' });
    expect(resolveThinking('gpt-4o', 'medium')).toEqual({ level: 'medium' });
    expect(resolveThinking('gpt-4o', 'high')).toEqual({ level: 'high' });
  });

  it('auto 对推理模型开启 medium', () => {
    expect(resolveThinking('deepseek-reasoner', 'auto')).toEqual({ level: 'medium' });
  });

  it('auto 对非推理模型为 null（未设置，不发任何思考字段）', () => {
    expect(resolveThinking('gpt-4o', 'auto')).toEqual({ level: null });
  });
});

describe('resolveThinking（能力声明折叠）', () => {
  it('binary：低/中/高全部归一成满血 high', () => {
    expect(resolveThinking('intern-s1-pro', 'low', 'binary')).toEqual({ level: 'high' });
    expect(resolveThinking('intern-s1-pro', 'medium', 'binary')).toEqual({ level: 'high' });
    expect(resolveThinking('intern-s1-pro', 'high', 'binary')).toEqual({ level: 'high' });
  });

  it('binary：off 保持显式关闭，auto 对推理模型按满血开启', () => {
    expect(resolveThinking('intern-s1-pro', 'off', 'binary')).toEqual({ level: 'off' });
    expect(resolveThinking('deepseek-reasoner', 'auto', 'binary')).toEqual({ level: 'high' });
  });

  it('none：任何模式都不发思考参数（含显式 off——无此能力的模型连禁用字段也不发）', () => {
    expect(resolveThinking('gpt-4o', 'low', 'none')).toEqual({ level: null });
    expect(resolveThinking('deepseek-reasoner', 'auto', 'none')).toEqual({ level: null });
    expect(resolveThinking('gpt-4o', 'off', 'none')).toEqual({ level: null });
  });
});

describe('isThinkingEnabled', () => {
  it('与 resolveThinking.level 一致（off 与 null 均视为未启用）', () => {
    expect(isThinkingEnabled('off', 'gpt-4o')).toBe(false);
    expect(isThinkingEnabled('high', 'gpt-4o')).toBe(true);
    expect(isThinkingEnabled('auto', 'deepseek-r1')).toBe(true);
    expect(isThinkingEnabled('auto', 'gpt-4o')).toBe(false);
  });

  it('能力声明参与判断', () => {
    expect(isThinkingEnabled('low', 'gpt-4o', 'none')).toBe(false);
    expect(isThinkingEnabled('low', 'gpt-4o', 'binary')).toBe(true);
  });
});
