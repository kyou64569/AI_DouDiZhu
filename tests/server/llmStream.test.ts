import { describe, it, expect } from 'vitest';
import {
  parseOpenAiStreamLine,
  parseGeminiStreamLine,
  parseAnthropicStreamLine,
  parseUpstreamStreamLine,
} from '../../server/services/protocolAdapter';

describe('parseOpenAiStreamLine（OpenAI 兼容流式）', () => {
  it('delta.reasoning_content → thinking；delta.content → answer', () => {
    expect(parseOpenAiStreamLine('data: {"choices":[{"delta":{"reasoning_content":"让我想想"}}]}')).toEqual({
      thinking: '让我想想',
    });
    expect(parseOpenAiStreamLine('data: {"choices":[{"delta":{"content":"{\\"action\\""}}]}')).toEqual({
      answer: '{"action"',
    });
  });

  it('兼容 delta.reasoning（OpenRouter 系网关变体）', () => {
    expect(parseOpenAiStreamLine('data: {"choices":[{"delta":{"reasoning":"推一下"}}]}')).toEqual({
      thinking: '推一下',
    });
  });

  it('data: [DONE] → done 标记', () => {
    expect(parseOpenAiStreamLine('data: [DONE]')).toEqual({ done: true });
  });

  it('非 data 行 / 无增量 delta / 非法 JSON → null', () => {
    expect(parseOpenAiStreamLine(': keep-alive')).toBeNull();
    expect(parseOpenAiStreamLine('event: ping')).toBeNull();
    expect(parseOpenAiStreamLine('data: {"choices":[{"delta":{"role":"assistant"}}]}')).toBeNull();
    expect(parseOpenAiStreamLine('data: {broken json')).toBeNull();
  });
});

describe('parseGeminiStreamLine（Gemini :streamGenerateContent?alt=sse）', () => {
  it('thought===true 的 part → thinking，其余 part → answer；单事件可同时含两类', () => {
    const line =
      'data: {"candidates":[{"content":{"parts":[{"text":"先看牌","thought":true},{"text":"出 3"}]}}]}';
    expect(parseGeminiStreamLine(line)).toEqual({ thinking: '先看牌', answer: '出 3' });
  });

  it('只有思考 part / 只有正文 part', () => {
    expect(
      parseGeminiStreamLine('data: {"candidates":[{"content":{"parts":[{"text":"推理","thought":true}]}}]}'),
    ).toEqual({ thinking: '推理' });
    expect(
      parseGeminiStreamLine('data: {"candidates":[{"content":{"parts":[{"text":"{\\"action\\":\\"pass\\"}"}]}}]}'),
    ).toEqual({ answer: '{"action":"pass"}' });
  });

  it('非 data 行 / 无 parts / 空数组 → null', () => {
    expect(parseGeminiStreamLine('event: message')).toBeNull();
    expect(parseGeminiStreamLine('data: {"candidates":[{}]}')).toBeNull();
    expect(parseGeminiStreamLine('data: {"candidates":[{"content":{"parts":[]}}]}')).toBeNull();
  });
});

describe('parseAnthropicStreamLine（Anthropic SSE 事件）', () => {
  it('thinking_delta → thinking；text_delta → answer', () => {
    expect(
      parseAnthropicStreamLine('data: {"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"算牌中"}}'),
    ).toEqual({ thinking: '算牌中' });
    expect(
      parseAnthropicStreamLine('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"{\\"score\\":2}"}}'),
    ).toEqual({ answer: '{"score":2}' });
  });

  it('其他事件类型（message_start / content_block_start 等）→ null', () => {
    expect(parseAnthropicStreamLine('data: {"type":"message_start"}')).toBeNull();
    expect(
      parseAnthropicStreamLine('data: {"type":"content_block_start","content_block":{"type":"thinking"}}'),
    ).toBeNull();
    // content_block_delta 但缺字段
    expect(parseAnthropicStreamLine('data: {"type":"content_block_delta","delta":{"type":"input_json_delta"}}')).toBeNull();
  });
});

describe('parseUpstreamStreamLine 分发', () => {
  it('按协议分发到对应解析器', () => {
    const openaiLine = 'data: {"choices":[{"delta":{"content":"x"}}]}';
    expect(parseUpstreamStreamLine('openai', openaiLine)).toEqual({ answer: 'x' });
    expect(parseUpstreamStreamLine('gemini', openaiLine)).toBeNull(); // openai 行给 gemini 解析器解析不出
    expect(parseUpstreamStreamLine('anthropic', 'data: {"type":"message_start"}')).toBeNull();
  });
});
