import { describe, it, expect, beforeEach } from 'vitest';
import { useConfigStore, validateConfigInput, toConfigInput } from '@/store/configStore';
import type { ModelConfigInput } from '@/store/configStore';

const baseInput: ModelConfigInput = {
  name: '测试配置',
  provider: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  apiKey: 'sk-test',
  availableModels: ['gpt-4o'],
  selectedModel: 'gpt-4o',
  thinkingMode: 'medium',
  temperature: 0.3,
};

describe('configStore 思考模式与温度', () => {
  beforeEach(() => {
    useConfigStore.getState().clearConfigs();
  });

  it('validateConfigInput 校验温度区间 0~2', () => {
    expect(validateConfigInput({ ...baseInput, temperature: -1 })).toContain('温度');
    expect(validateConfigInput({ ...baseInput, temperature: 3 })).toContain('温度');
    expect(validateConfigInput({ ...baseInput, temperature: 0 })).toBeNull();
    expect(validateConfigInput({ ...baseInput, temperature: 2 })).toBeNull();
    expect(validateConfigInput({ ...baseInput, temperature: 0.3 })).toBeNull();
  });

  it('validateConfigInput 校验思考模式合法性', () => {
    expect(validateConfigInput({ ...baseInput, thinkingMode: 'weird' as never })).toContain('思考模式');
    expect(validateConfigInput({ ...baseInput, thinkingMode: 'off' })).toBeNull();
    expect(validateConfigInput({ ...baseInput, thinkingMode: 'auto' })).toBeNull();
  });

  it('addConfig 保存 thinkingMode 与 temperature', () => {
    const res = useConfigStore.getState().addConfig(baseInput);
    expect(res.ok).toBe(true);
    const cfg = res.config!;
    expect(cfg.thinkingMode).toBe('medium');
    expect(cfg.temperature).toBeCloseTo(0.3);
  });

  it('updateConfig 更新思考模式与温度', () => {
    const added = useConfigStore.getState().addConfig(baseInput).config!;
    const res = useConfigStore.getState().updateConfig(added.id, {
      ...baseInput,
      thinkingMode: 'high',
      temperature: 0.1,
    });
    expect(res.ok).toBe(true);
    expect(res.config!.thinkingMode).toBe('high');
    expect(res.config!.temperature).toBeCloseTo(0.1);
  });

  it('toConfigInput 回写思考/温度字段', () => {
    const added = useConfigStore.getState().addConfig(baseInput).config!;
    const back = toConfigInput(added);
    expect(back.thinkingMode).toBe('medium');
    expect(back.temperature).toBeCloseTo(0.3);
  });

  it('温度越界时 addConfig 被拦截，非法值不会落库', () => {
    const res = useConfigStore.getState().addConfig({ ...baseInput, temperature: 5 });
    expect(res.ok).toBe(false);
    expect(useConfigStore.getState().configs).toHaveLength(0);
  });
});
