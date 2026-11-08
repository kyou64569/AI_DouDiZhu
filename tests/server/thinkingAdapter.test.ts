import { describe, it, expect } from 'vitest';
import {
  applyThinkingBudget,
  buildThinkingBody,
  detectProfileKey,
  THINKING_PROFILE_SELECTIONS,
  THINKING_LEVELS,
} from '../../server/services/thinkingAdapter';

/** 便捷断言：按（方言, 档位）构建请求体片段 */
function fragment(profile: Parameters<typeof buildThinkingBody>[0], level: Parameters<typeof buildThinkingBody>[1]) {
  return buildThinkingBody(profile, level, 'https://gw.test/v1', 'test-model');
}

describe('applyThinkingBudget（输出预算抬升）', () => {
  it('low/medium/high → 分级预算 4096/8192/24576（思考 token 计入输出上限，防业务 JSON 截断）', () => {
    expect(applyThinkingBudget('openai-native', 'low', undefined)).toBe(4096);
    expect(applyThinkingBudget('openai-native', 'medium', undefined)).toBe(8192);
    expect(applyThinkingBudget('openai-native', 'high', undefined)).toBe(24576);
  });

  it('off 与未设置（null）一律不动预算 → 不发送 max_tokens 字段', () => {
    expect(applyThinkingBudget('openai-native', 'off', undefined)).toBeUndefined();
    expect(applyThinkingBudget('openai-native', null, undefined)).toBeUndefined();
  });

  it('调用方显式填写的值永远优先（无论思考是否开启）', () => {
    expect(applyThinkingBudget('openai-native', 'high', 2048)).toBe(2048);
    expect(applyThinkingBudget('openai-native', null, 2048)).toBe(2048);
    expect(applyThinkingBudget('openai-native', 'off', 2048)).toBe(2048);
  });

  it('effort-only 方言（OpenAI o 系）不自动抬预算：真实 API 对推理模型只收 max_completion_tokens', () => {
    expect(applyThinkingBudget('effort-only', 'high', undefined)).toBeUndefined();
    expect(applyThinkingBudget('effort-only', 'medium', undefined)).toBeUndefined();
    // 但用户显式填写仍然发送（那是用户自己的选择）
    expect(applyThinkingBudget('effort-only', 'high', 4096)).toBe(4096);
  });

  it('auto 检测不出方言（null）时 fail-safe 不动预算', () => {
    expect(applyThinkingBudget(null, 'high', undefined)).toBeUndefined();
  });

  it('binary 折叠后的满血档同样受惠于预算抬升（thinking-mode 这类无强度方言也抬）', () => {
    expect(applyThinkingBudget('thinking-mode', 'high', undefined)).toBe(24576);
    expect(applyThinkingBudget('nvidia', 'high', undefined)).toBe(24576);
    expect(applyThinkingBudget('deepseek-thinking', 'medium', undefined)).toBe(8192);
  });
});

describe('未设置档位（level=null）', () => {
  it('任何方言都不发任何思考字段（存量配置请求体逐字节不变的保证）', () => {
    for (const profile of THINKING_PROFILE_SELECTIONS) {
      expect(fragment(profile, null)).toEqual({});
    }
  });
});

describe('openai-native（Qwen3 / vLLM）', () => {
  it('off → 顶层 enable_thinking:false', () => {
    expect(fragment('openai-native', 'off')).toEqual({ enable_thinking: false });
  });

  it('low/medium/high → enable_thinking:true + reasoning_effort（补齐 qwen 分支丢失的强度）', () => {
    expect(fragment('openai-native', 'high')).toEqual({ enable_thinking: true, reasoning_effort: 'high' });
    expect(fragment('openai-native', 'low')).toEqual({ enable_thinking: true, reasoning_effort: 'low' });
    expect(fragment('openai-native', 'medium')).toEqual({ enable_thinking: true, reasoning_effort: 'medium' });
  });
});

describe('chat-template（小红书 Dots / Agnes）', () => {
  it('off → 嵌套位置的 chat_template_kwargs.enable_thinking:false（顶层写法会被静默忽略）', () => {
    expect(fragment('chat-template', 'off')).toEqual({ chat_template_kwargs: { enable_thinking: false } });
  });

  it('high → 嵌套开启 + reasoning_effort', () => {
    expect(fragment('chat-template', 'high')).toEqual({
      chat_template_kwargs: { enable_thinking: true },
      reasoning_effort: 'high',
    });
  });
});

describe('thinking-flag（MiniMax-M3，字符串形状）', () => {
  it('off → thinking:"disabled"', () => {
    expect(fragment('thinking-flag', 'off')).toEqual({ thinking: 'disabled' });
  });

  it('high → thinking:"enabled" + reasoning_effort', () => {
    expect(fragment('thinking-flag', 'high')).toEqual({ thinking: 'enabled', reasoning_effort: 'high' });
  });
});

describe('thinking-type（腾讯混元，对象形状）', () => {
  it('off → thinking:{"type":"disabled"}（与字符串形状同名字段、互不通用）', () => {
    expect(fragment('thinking-type', 'off')).toEqual({ thinking: { type: 'disabled' } });
  });

  it('high → thinking:{"type":"enabled"} + reasoning_effort', () => {
    expect(fragment('thinking-type', 'high')).toEqual({
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    });
  });
});

describe('effort-only（OpenAI o 系）', () => {
  it('off → reasoning_effort:"none"', () => {
    expect(fragment('effort-only', 'off')).toEqual({ reasoning_effort: 'none' });
  });

  it('low/medium/high → reasoning_effort 直传', () => {
    expect(fragment('effort-only', 'low')).toEqual({ reasoning_effort: 'low' });
    expect(fragment('effort-only', 'high')).toEqual({ reasoning_effort: 'high' });
  });
});

describe('thinking-mode（Intern-S1，布尔且无强度档）', () => {
  it('off → thinking_mode:false（布尔，非字符串）', () => {
    expect(fragment('thinking-mode', 'off')).toEqual({ thinking_mode: false });
  });

  it('任何非关闭档位都只发 true，绝不发 reasoning_effort（该方言没有强度字段）', () => {
    for (const level of THINKING_LEVELS) {
      if (level === 'off') continue;
      expect(fragment('thinking-mode', level)).toEqual({ thinking_mode: true });
    }
  });
});

describe('nvidia（NVIDIA NIM / Nemotron，布尔且无强度档）', () => {
  it('off → thinking:false（布尔，非字符串；字符串写法网关直接 400）', () => {
    expect(fragment('nvidia', 'off')).toEqual({ thinking: false });
  });

  it('任何非关闭档位都只发 true，绝不发 reasoning_effort（网关不认强度字段）', () => {
    for (const level of THINKING_LEVELS) {
      if (level === 'off') continue;
      expect(fragment('nvidia', level)).toEqual({ thinking: true });
    }
  });
});

describe('deepseek-thinking（旧式布尔，兼容保留）', () => {
  it('非关闭档位 → thinking:true', () => {
    expect(fragment('deepseek-thinking', 'medium')).toEqual({ thinking: true });
  });

  it('off → 省略（无已知禁用字段，fail-safe）', () => {
    expect(fragment('deepseek-thinking', 'off')).toEqual({});
  });
});

describe("detectProfileKey（'auto' 的解析规则）", () => {
  it('host 优先：deepseek → deepseek-thinking；dashscope/aliyun → openai-native', () => {
    expect(detectProfileKey('https://api.deepseek.com/v1', 'anything')).toBe('deepseek-thinking');
    expect(detectProfileKey('https://dashscope.aliyuncs.com/compatible-mode/v1', 'gpt-4o')).toBe('openai-native');
  });

  it('host 优先：integrate.api.nvidia.com → nvidia 方言（NIM 托管端点）', () => {
    expect(
      detectProfileKey('https://integrate.api.nvidia.com/v1', 'nvidia/nemotron-3.5-super-vl-120b-a12b'),
    ).toBe('nvidia');
  });

  it('host 优先：intern 两端点分家——discovery 聚合网关 → chat-template，chat.intern-ai → thinking-mode', () => {
    expect(detectProfileKey('https://discovery-api.intern-ai.org.cn/v1', 'Sage-A1.5')).toBe('chat-template');
    // 该网关下挂 deepseek-v4 / qwen3.8 等异构模型：host 判定先于 model 关键词，防误判
    expect(detectProfileKey('https://discovery-api.intern-ai.org.cn/v1', 'deepseek-v4')).toBe('chat-template');
    expect(detectProfileKey('https://chat.intern-ai.org.cn/api/v1/', 'intern-s1-pro')).toBe('thinking-mode');
  });

  it("buildThinkingBody('auto', ...) discovery 网关 off → chat_template_kwargs.enable_thinking:false（实测该网关唯一有效的关闭写法）", () => {
    expect(buildThinkingBody('auto', 'off', 'https://discovery-api.intern-ai.org.cn/v1', 'Sage-A1.5')).toEqual({
      chat_template_kwargs: { enable_thinking: false },
    });
  });

  it('model 关键词兜底（兼容代理/中转场景）', () => {
    expect(detectProfileKey('https://gw.test/v1', 'deepseek-r1')).toBe('deepseek-thinking');
    expect(detectProfileKey('https://gw.test/v1', 'qwen3-max')).toBe('openai-native');
    expect(detectProfileKey('https://gw.test/v1', 'o3-mini')).toBe('effort-only');
    expect(detectProfileKey('https://gw.test/v1', 'o1-preview')).toBe('effort-only');
  });

  it('识别不出 → null（调用方省略思考字段）', () => {
    expect(detectProfileKey('https://gw.test/v1', 'gpt-4o')).toBeNull();
  });

  it("buildThinkingBody('auto', ...) 识别不出时返回空对象（fail-safe）", () => {
    expect(buildThinkingBody('auto', 'high', 'https://gw.test/v1', 'gpt-4o')).toEqual({});
  });

  it("buildThinkingBody('auto', ...) 命中 qwen 时发 enable_thinking + reasoning_effort", () => {
    expect(buildThinkingBody('auto', 'high', 'https://dashscope.aliyuncs.com/compatible-mode/v1', 'qwen3-max')).toEqual({
      enable_thinking: true,
      reasoning_effort: 'high',
    });
  });
});
