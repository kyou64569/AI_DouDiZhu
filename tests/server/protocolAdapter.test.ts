import { describe, it, expect } from 'vitest';
import {
  buildAnthropicChatBody,
  buildChatEndpoint,
  buildChatHeaders,
  buildGeminiChatBody,
  buildModelsEndpoint,
  extractAnthropicContent,
  extractGeminiContent,
  parseAnthropicModels,
  parseGeminiModels,
  resolveApiFormat,
} from '../../server/services/protocolAdapter';
import type { ChatMessage } from '../../server/types';

const MESSAGES: ChatMessage[] = [
  { role: 'system', content: '你是斗地主 AI。' },
  { role: 'user', content: '请出牌' },
  { role: 'assistant', content: '3' },
  { role: 'user', content: '要不起，过' },
];

describe('resolveApiFormat', () => {
  it('gemini/anthropic 保留，其余（含缺省/非法）一律回落 openai', () => {
    expect(resolveApiFormat('gemini')).toBe('gemini');
    expect(resolveApiFormat('anthropic')).toBe('anthropic');
    expect(resolveApiFormat('openai')).toBe('openai');
    expect(resolveApiFormat(undefined)).toBe('openai');
    expect(resolveApiFormat('claude')).toBe('openai');
  });
});

describe('端点与鉴权头', () => {
  it('gemini：/models/{model}:generateContent，models/ 前缀被剥离，x-goog-api-key 鉴权', () => {
    expect(buildChatEndpoint('gemini', 'https://g.example.com/v1beta', 'models/gemini-3-pro')).toBe(
      'https://g.example.com/v1beta/models/gemini-3-pro:generateContent',
    );
    const headers = buildChatHeaders('gemini', 'K');
    expect(headers['x-goog-api-key']).toBe('K');
    expect(headers.Authorization).toBeUndefined();
  });

  it('anthropic：/v1/messages，x-api-key + anthropic-version', () => {
    expect(buildChatEndpoint('anthropic', 'https://a.example.com/v1', 'claude-sonnet-4')).toBe(
      'https://a.example.com/v1/messages',
    );
    const headers = buildChatHeaders('anthropic', 'K');
    expect(headers['x-api-key']).toBe('K');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('模型列表端点：gemini 带 pageSize，anthropic 带 limit，鉴权头一致', () => {
    expect(buildModelsEndpoint('gemini', 'https://g.example.com/v1beta', 'K').url).toBe(
      'https://g.example.com/v1beta/models?pageSize=1000',
    );
    expect(buildModelsEndpoint('anthropic', 'https://a.example.com/v1', 'K').url).toBe(
      'https://a.example.com/v1/models?limit=1000',
    );
  });
});

describe('Gemini 请求体翻译', () => {
  it('system → systemInstruction；assistant → model 角色', () => {
    const body = buildGeminiChatBody(MESSAGES, 0.3, null, undefined);
    expect(body.systemInstruction).toEqual({ parts: [{ text: '你是斗地主 AI。' }] });
    expect(body.contents).toEqual([
      { role: 'user', parts: [{ text: '请出牌' }] },
      { role: 'model', parts: [{ text: '3' }] },
      { role: 'user', parts: [{ text: '要不起，过' }] },
    ]);
  });

  it('未设置（null）→ 不写 thinkingConfig（跟随模型默认），也不动 maxOutputTokens', () => {
    const body = buildGeminiChatBody(MESSAGES, 0.3, null, undefined);
    expect(body.thinkingConfig).toBeUndefined();
    expect(body.generationConfig).toEqual({ temperature: 0.3 });
  });

  it('off → generationConfig.thinkingLevel=MINIMAL（Gemini 3 无真关闭开关，等效关闭），预算不动', () => {
    const body = buildGeminiChatBody(MESSAGES, undefined, 'off', undefined);
    // thinkingConfig 必须嵌在 generationConfig 内（顶层会被 Google proto-JSON 400）
    expect(body.generationConfig).toEqual({
      thinkingConfig: { thinkingLevel: 'MINIMAL', includeThoughts: true },
    });
    expect(body.thinkingConfig).toBeUndefined();
  });

  it('low/medium/high → 直传枚举 + includeThoughts 必开 + 按档位抬 maxOutputTokens（均在 generationConfig 内）', () => {
    expect(buildGeminiChatBody(MESSAGES, undefined, 'medium', undefined)).toEqual({
      contents: expect.any(Array),
      systemInstruction: expect.anything(),
      generationConfig: {
        maxOutputTokens: 8192,
        thinkingConfig: { thinkingLevel: 'medium', includeThoughts: true },
      },
    });
    expect(buildGeminiChatBody(MESSAGES, undefined, 'high', undefined)).toEqual({
      contents: expect.any(Array),
      systemInstruction: expect.anything(),
      generationConfig: {
        maxOutputTokens: 24576,
        thinkingConfig: { thinkingLevel: 'high', includeThoughts: true },
      },
    });
  });

  it('用户显式填写的 maxTokens 永远优先', () => {
    const body = buildGeminiChatBody(MESSAGES, undefined, 'high', 5000);
    expect((body.generationConfig as Record<string, unknown>).maxOutputTokens).toBe(5000);
  });
});

describe('Anthropic 请求体翻译', () => {
  it('system → 顶层 system；messages 仅含 user/assistant；温度钳制到 0~1', () => {
    const body = buildAnthropicChatBody(MESSAGES, 0.9, null, undefined);
    expect(body.system).toBe('你是斗地主 AI。');
    expect(body.messages).toEqual([
      { role: 'user', content: '请出牌' },
      { role: 'assistant', content: '3' },
      { role: 'user', content: '要不起，过' },
    ]);
    expect(body.max_tokens).toBe(8192); // max_tokens 官方必填的兜底值
    expect(body.thinking).toBeUndefined();
    expect(buildAnthropicChatBody(MESSAGES, 1.5, null, undefined).temperature).toBe(1);
  });

  it('思考开启 → 发「档位预算 + 答题空间」（high → budget 24576 + max 28672）', () => {
    const body = buildAnthropicChatBody(MESSAGES, undefined, 'high', undefined);
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 24576 });
    expect(body.max_tokens).toBe(28672);
    expect(buildAnthropicChatBody(MESSAGES, undefined, 'low', undefined).max_tokens).toBe(8192); // 4096+4096
  });

  it('用户填了小的 max_tokens：预算先被压缩塞进去（用户值永远优先）', () => {
    const body = buildAnthropicChatBody(MESSAGES, undefined, 'high', 10000);
    expect(body.thinking).toEqual({ type: 'enabled', budget_tokens: 5904 }); // 10000 - 4096
    expect(body.max_tokens).toBe(10000);
  });

  it('用户填的 max_tokens 连 1024 下限都装不下时：干脆不发思考块（400 不该是配置选择的后果）', () => {
    const body = buildAnthropicChatBody(MESSAGES, undefined, 'high', 5000);
    expect(body.thinking).toBeUndefined();
    expect(body.max_tokens).toBe(5000);
  });

  it('off 与未设置 → 不传 thinking（该方言无禁用字段，省略即关闭）', () => {
    expect(buildAnthropicChatBody(MESSAGES, undefined, 'off', undefined).thinking).toBeUndefined();
    expect(buildAnthropicChatBody(MESSAGES, undefined, null, undefined).thinking).toBeUndefined();
  });
});

describe('响应提取', () => {
  it('gemini：thought===true 的块被过滤，只拼正文 text', () => {
    const payload = {
      candidates: [
        {
          content: {
            parts: [
              { text: '我先想想出哪张', thought: true },
              { text: '出 3' },
              { text: '，理由是拆顺子' },
            ],
          },
        },
      ],
    };
    expect(extractGeminiContent(payload)).toBe('出 3，理由是拆顺子');
  });

  it('gemini：candidates 缺失 / 被安全拦截时返回空串', () => {
    expect(extractGeminiContent({})).toBe('');
    expect(extractGeminiContent({ candidates: [{ finishReason: 'SAFETY' }] })).toBe('');
  });

  it('anthropic：只拼 type===text 的块，thinking 块不是答案', () => {
    const payload = {
      content: [
        { type: 'thinking', thinking: '对手剩牌推断……' },
        { type: 'text', text: '["action":"play"' },
        { type: 'text', text: ',"cards":["3"]}' },
      ],
    };
    expect(extractAnthropicContent(payload)).toBe('["action":"play","cards":["3"]}');
  });
});

describe('模型列表解析', () => {
  it('gemini：去掉 models/ 前缀，过滤不支持 generateContent 的条目', () => {
    const payload = {
      models: [
        { name: 'models/gemini-3-pro', displayName: 'Gemini 3 Pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-3-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
      ],
    };
    expect(parseGeminiModels(payload)).toEqual([
      { id: 'gemini-3-pro', name: 'Gemini 3 Pro' },
      { id: 'gemini-3-flash', name: 'gemini-3-flash' },
    ]);
  });

  it('anthropic：data[].id + display_name', () => {
    const payload = {
      data: [
        { id: 'claude-sonnet-4', display_name: 'Claude Sonnet 4' },
        { id: 'claude-opus-4', display_name: 'Claude Opus 4' },
      ],
    };
    expect(parseAnthropicModels(payload)).toEqual([
      { id: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
      { id: 'claude-opus-4', name: 'Claude Opus 4' },
    ]);
  });
});
