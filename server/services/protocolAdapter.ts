/**
 * 原生协议适配器（Gemini 3 / Anthropic，指南 §4）。
 *
 * 前端与 OpenAI 兼容路径完全同构地表达「思考意图」（档位 off/low/medium/high/null + 能力声明），
 * 本模块负责把统一意图翻译成原生协议的请求形状，并把原生响应归一化回统一形状：
 *
 * | 协议 | 端点 | 鉴权 | 关闭表达 | 强度表达 | 思考内容 |
 * | --- | --- | --- | --- | --- | --- |
 * | gemini | {base}/models/{model}:generateContent | x-goog-api-key | thinkingLevel:'MINIMAL' | thinkingLevel 直传 | parts[].thought===true |
 * | anthropic | {base}/messages | x-api-key + anthropic-version | 不传 thinking（该方言无禁用字段） | thinking.budget_tokens | content[].type==='thinking' |
 *
 * 预算规则（指南 §4 / §7.2）：
 * - gemini：思考 token 计入 maxOutputTokens，思考开启且无人指定时按档位抬高（同 §7.2 分级表）；
 * - anthropic：max_tokens 官方必填，且要同时装下思考与答案 —— 发「档位预算 + 答题空间」；
 *   用户显式填了小的 max_tokens 时先把预算压进去，压不到下限 1024 就干脆不发思考块
 *   （用户填的数永远优先，400 永远不该是配置选择的后果）。
 *
 * 纯函数、无副作用、不依赖 express，便于单测。
 */

import type { ChatMessage } from '../types.js';
import type { ThinkingLevel } from './thinkingAdapter.js';

/** 支持的原生协议（openai 走 llmProxy 原路径，不经本模块） */
export type ApiFormatKey = 'gemini' | 'anthropic';

/** 全部合法的 apiFormat wire 值（含 openai；路由校验用） */
export const API_FORMATS: readonly string[] = ['openai', 'gemini', 'anthropic'];

/** 归一化 wire 值：openai / 非法值一律回落 openai（与 thinkingProfile 的宽容口径一致） */
export function resolveApiFormat(format: string | undefined): 'openai' | ApiFormatKey {
  if (format === 'gemini' || format === 'anthropic') {
    return format;
  }
  return 'openai';
}

/** Anthropic 思考预算下限（官方文档：budget_tokens >= 1024 且严格小于 max_tokens） */
const ANTHROPIC_BUDGET_MIN: number = 1024;

/** Anthropic 答题空间：max_tokens = 思考预算 + 该值（指南示例 high → 24576 + 4096 = 28672） */
const ANTHROPIC_ANSWER_SPACE: number = 4096;

/** Anthropic 未开启思考时 max_tokens 的兜底值（官方标 REQUIRED，不能不发） */
const ANTHROPIC_FALLBACK_MAX_TOKENS: number = 8192;

/** 分级预算（与 thinkingAdapter 的 §7.2 表一致；此处独立声明避免跨模块循环依赖） */
const THINKING_BUDGET: Record<'low' | 'medium' | 'high', number> = {
  low: 4096,
  medium: 8192,
  high: 24576,
};

/** 原生聊天请求的完整形状（URL / 头 / 体），由 llmProxy 直接发出 */
export interface NativeChatRequest {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

/** 原生模型列表请求（URL + 头） */
export interface NativeModelsRequest {
  url: string;
  headers: Record<string, string>;
}

// ---------- URL / 鉴权 ----------

/**
 * 构造聊天补全的原生端点。
 *
 * @param format 已解析的协议（gemini / anthropic）
 * @param baseUrl 已按协议归一化的根路径（gemini 到 /v1beta，anthropic 到 /v1）
 * @param streaming 是否流式（gemini 用 :streamGenerateContent?alt=sse）
 */
export function buildChatEndpoint(format: ApiFormatKey, baseUrl: string, model: string, streaming: boolean = false): string {
  if (format === 'gemini') {
    // 官方模型名形如 models/gemini-3-pro，路径里不能带 models/ 前缀
    const bare: string = model.replace(/^models\//, '');
    const method: string = streaming ? 'streamGenerateContent?alt=sse' : 'generateContent';
    return `${baseUrl}/models/${encodeURIComponent(bare)}:${method}`;
  }
  return `${baseUrl}/messages`;
}

/** 聊天请求的鉴权头（Authorization 头只在此处构造，绝不写入日志） */
export function buildChatHeaders(format: ApiFormatKey, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (format === 'gemini') {
    headers['x-goog-api-key'] = apiKey;
  } else {
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  }
  return headers;
}

/** 模型列表端点与鉴权头（连通性测试复用同一端点） */
export function buildModelsEndpoint(format: ApiFormatKey, baseUrl: string, apiKey: string): NativeModelsRequest {
  if (format === 'gemini') {
    return { url: `${baseUrl}/models?pageSize=1000`, headers: buildChatHeaders(format, apiKey) };
  }
  return { url: `${baseUrl}/models?limit=1000`, headers: buildChatHeaders(format, apiKey) };
}

// ---------- 请求体翻译 ----------

/** 把统一档位映射成 Gemini thinkingLevel：off→'MINIMAL'（无真关闭开关，等效关闭），low/medium/high 直传 */
function toGeminiThinkingLevel(level: ThinkingLevel): string {
  return level === 'off' ? 'MINIMAL' : level;
}

/**
 * 翻译 Gemini 原生请求体。
 *
 * - messages → contents（assistant → model 角色；system → systemInstruction）
 * - 未设置（null）→ 不写 thinkingConfig（跟随模型默认）；off → MINIMAL；low/medium/high 直传
 * - thinkingConfig 必须位于 generationConfig 内部（指南 §4）——写成顶层字段会被
 *   Google 的 proto-JSON 解析器 400（Unknown name "thinkingConfig": Cannot find field）
 * - 写 thinkingConfig 必须同时 includeThoughts:true，否则思考块不返回（指南 §7.3）
 * - 思考开启且无人指定时按档位抬高 maxOutputTokens；off/未设置不动预算
 */
export function buildGeminiChatBody(
  messages: ChatMessage[],
  temperature: number | undefined,
  level: ThinkingLevel | null,
  userMaxTokens: number | undefined,
): Record<string, unknown> {
  const systemTexts: string[] = [];
  const contents: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemTexts.push(m.content);
      continue;
    }
    contents.push({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] });
  }

  const body: Record<string, unknown> = { contents };
  if (systemTexts.length > 0) {
    body.systemInstruction = { parts: [{ text: systemTexts.join('\n\n') }] };
  }

  const generationConfig: Record<string, unknown> = {};
  if (typeof temperature === 'number' && Number.isFinite(temperature)) {
    generationConfig.temperature = temperature;
  }
  if (level !== null && level !== 'off') {
    generationConfig.maxOutputTokens =
      typeof userMaxTokens === 'number' && Number.isFinite(userMaxTokens) && userMaxTokens > 0
        ? userMaxTokens
        : THINKING_BUDGET[level];
  } else if (
    typeof userMaxTokens === 'number' &&
    Number.isFinite(userMaxTokens) &&
    userMaxTokens > 0
  ) {
    generationConfig.maxOutputTokens = userMaxTokens;
  }
  if (level !== null) {
    generationConfig.thinkingConfig = {
      thinkingLevel: toGeminiThinkingLevel(level),
      includeThoughts: true,
    };
  }
  if (Object.keys(generationConfig).length > 0) {
    body.generationConfig = generationConfig;
  }
  return body;
}

/**
 * 翻译 Anthropic 原生请求体。
 *
 * - system 消息提取到顶层 system 字符串；messages 仅保留 user/assistant
 * - max_tokens 必填：思考开启时发「档位预算 + 答题空间」；用户显式填了 max_tokens 时先压缩预算
 *   （budget = min(档位预算, userMax - 答题空间)），压不到 1024 下限就干脆不发思考块
 * - off 与未设置：不传 thinking（该方言没有禁用字段），max_tokens 用用户值或兜底值
 * - temperature 官方范围 0~1，超界静默钳制（该 API 对越界值不保证兼容）
 */
export function buildAnthropicChatBody(
  messages: ChatMessage[],
  temperature: number | undefined,
  level: ThinkingLevel | null,
  userMaxTokens: number | undefined,
): Record<string, unknown> {
  const systemTexts: string[] = [];
  const chatMessages: Array<Record<string, unknown>> = [];
  for (const m of messages) {
    if (m.role === 'system') {
      systemTexts.push(m.content);
      continue;
    }
    chatMessages.push({ role: m.role, content: m.content });
  }

  const body: Record<string, unknown> = { messages: chatMessages };
  if (systemTexts.length > 0) {
    body.system = systemTexts.join('\n\n');
  }

  const userMax: number | undefined =
    typeof userMaxTokens === 'number' && Number.isFinite(userMaxTokens) && userMaxTokens > 0
      ? userMaxTokens
      : undefined;

  const thinkingOn: boolean = level !== null && level !== 'off';
  let maxTokens: number;
  if (thinkingOn) {
    const desired: number = THINKING_BUDGET[level as 'low' | 'medium' | 'high'];
    if (userMax !== undefined) {
      // 用户填的数永远优先：先把思考预算压进它的天花板，压不到 1024 下限就放弃思考块
      const squeezed: number = Math.min(desired, userMax - ANTHROPIC_ANSWER_SPACE);
      maxTokens = userMax;
      if (squeezed >= ANTHROPIC_BUDGET_MIN) {
        body.thinking = { type: 'enabled', budget_tokens: squeezed };
      }
    } else {
      maxTokens = desired + ANTHROPIC_ANSWER_SPACE;
      body.thinking = { type: 'enabled', budget_tokens: desired };
    }
  } else {
    maxTokens = userMax ?? ANTHROPIC_FALLBACK_MAX_TOKENS;
  }
  body.max_tokens = maxTokens;

  if (typeof temperature === 'number' && Number.isFinite(temperature)) {
    body.temperature = Math.min(Math.max(temperature, 0), 1);
  }
  return body;
}

/** 按协议把统一意图翻译成原生请求（llmProxy 的唯一入口） */
export function buildNativeChatBody(
  format: ApiFormatKey,
  messages: ChatMessage[],
  temperature: number | undefined,
  level: ThinkingLevel | null,
  userMaxTokens: number | undefined,
): Record<string, unknown> {
  if (format === 'gemini') {
    return buildGeminiChatBody(messages, temperature, level, userMaxTokens);
  }
  return buildAnthropicChatBody(messages, temperature, level, userMaxTokens);
}

// ---------- 响应提取 ----------

/**
 * 从 Gemini 响应中提取正文。
 * 思考内容在 parts[].thought===true 的块里，必须过滤掉（思考不是答案）。
 */
export function extractGeminiContent(payload: Record<string, unknown>): string {
  const candidates = payload.candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return '';
  }
  const first = candidates[0] as Record<string, unknown> | null;
  if (first === null || typeof first !== 'object') {
    return '';
  }
  const content = first.content as Record<string, unknown> | null | undefined;
  const parts = content !== null && typeof content === 'object' ? content.parts : undefined;
  if (!Array.isArray(parts)) {
    return '';
  }
  const texts: string[] = [];
  for (const part of parts) {
    if (part === null || typeof part !== 'object') {
      continue;
    }
    const p = part as Record<string, unknown>;
    if (p.thought === true) {
      continue;
    }
    if (typeof p.text === 'string' && p.text.length > 0) {
      texts.push(p.text);
    }
  }
  return texts.join('');
}

/**
 * 从 Anthropic 响应中提取正文。
 * content 是块数组：type==='thinking' 的是思考，type==='text' 的才是答案。
 */
export function extractAnthropicContent(payload: Record<string, unknown>): string {
  const blocks = payload.content;
  if (!Array.isArray(blocks)) {
    return '';
  }
  const texts: string[] = [];
  for (const block of blocks) {
    if (block === null || typeof block !== 'object') {
      continue;
    }
    const b = block as Record<string, unknown>;
    if (b.type === 'text' && typeof b.text === 'string' && b.text.length > 0) {
      texts.push(b.text);
    }
  }
  return texts.join('');
}

/** 按协议提取正文（llmProxy 的唯一入口） */
export function extractNativeContent(format: ApiFormatKey, payload: Record<string, unknown>): string {
  return format === 'gemini' ? extractGeminiContent(payload) : extractAnthropicContent(payload);
}

// ---------- 模型列表 ----------

/** Gemini 模型列表条目（name 形如 "models/gemini-3-pro"） */
export interface NativeModelItem {
  id: string;
  name: string;
}

/**
 * 解析 Gemini 模型列表：仅保留支持 generateContent 的条目，id 去掉 models/ 前缀。
 */
export function parseGeminiModels(payload: Record<string, unknown>): NativeModelItem[] {
  const rawList = payload.models;
  if (!Array.isArray(rawList)) {
    return [];
  }
  const items: NativeModelItem[] = [];
  const seen: Set<string> = new Set<string>();
  for (const entry of rawList) {
    if (entry === null || typeof entry !== 'object') {
      continue;
    }
    const e = entry as Record<string, unknown>;
    const methods = e.supportedGenerationMethods;
    if (Array.isArray(methods) && !methods.includes('generateContent')) {
      continue;
    }
    const rawName: string = typeof e.name === 'string' ? e.name : '';
    if (rawName.length === 0) {
      continue;
    }
    const id: string = rawName.replace(/^models\//, '');
    if (id.length === 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const name: string = typeof e.displayName === 'string' && e.displayName.length > 0 ? e.displayName : id;
    items.push({ id, name });
  }
  return items;
}

/**
 * 解析 Anthropic 模型列表（data[].id / display_name）。
 */
export function parseAnthropicModels(payload: Record<string, unknown>): NativeModelItem[] {
  const rawList = payload.data;
  if (!Array.isArray(rawList)) {
    return [];
  }
  const items: NativeModelItem[] = [];
  const seen: Set<string> = new Set<string>();
  for (const entry of rawList) {
    if (entry === null || typeof entry !== 'object') {
      continue;
    }
    const e = entry as Record<string, unknown>;
    const id: string = typeof e.id === 'string' ? e.id : '';
    if (id.length === 0 || seen.has(id)) {
      continue;
    }
    seen.add(id);
    const name: string = typeof e.display_name === 'string' && e.display_name.length > 0 ? e.display_name : id;
    items.push({ id, name });
  }
  return items;
}

/** 按协议解析模型列表（llmProxy 的唯一入口） */
export function parseNativeModels(format: ApiFormatKey, payload: Record<string, unknown>): NativeModelItem[] {
  return format === 'gemini' ? parseGeminiModels(payload) : parseAnthropicModels(payload);
}

// ---------- 流式响应解析（SSE 行 → 统一增量事件） ----------

/** 上游流式解析结果：一次行事件可能同时携带思考与正文增量（如 Gemini 多 part 块） */
export interface StreamDelta {
  /** 是否上游流结束标记（OpenAI 的 data: [DONE]） */
  done?: boolean;
  /** 思考内容增量 */
  thinking?: string;
  /** 正文增量 */
  answer?: string;
}

/** 从 SSE 行提取 data 载荷；非 data 行（event:/注释/空行）返回 null */
function extractSseData(line: string): string | null {
  if (!line.startsWith('data:')) {
    return null;
  }
  const payload: string = line.slice(5).trim();
  return payload.length > 0 ? payload : null;
}

/**
 * 解析 OpenAI 兼容流式响应行。
 * 思考在 delta.reasoning_content（部分网关用 delta.reasoning，一并兼容），正文在 delta.content。
 */
export function parseOpenAiStreamLine(line: string): StreamDelta | null {
  const payload: string | null = extractSseData(line);
  if (payload === null) {
    return null;
  }
  if (payload === '[DONE]') {
    return { done: true };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') {
    return null;
  }
  const choices = (parsed as Record<string, unknown>).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return null;
  }
  const first = choices[0] as Record<string, unknown> | null;
  const delta =
    first !== null && typeof first === 'object' ? (first.delta as Record<string, unknown> | undefined) : undefined;
  if (delta === undefined || delta === null || typeof delta !== 'object') {
    return null;
  }
  const result: StreamDelta = {};
  const reasoning = delta.reasoning_content ?? delta.reasoning;
  if (typeof reasoning === 'string' && reasoning.length > 0) {
    result.thinking = reasoning;
  }
  if (typeof delta.content === 'string' && delta.content.length > 0) {
    result.answer = delta.content;
  }
  return result.thinking !== undefined || result.answer !== undefined ? result : null;
}

/**
 * 解析 Gemini 流式响应行（:streamGenerateContent?alt=sse 的 data JSON）。
 * parts[].thought===true 的是思考块，其余是正文；一个事件可同时含两类 part。
 */
export function parseGeminiStreamLine(line: string): StreamDelta | null {
  const payload: string | null = extractSseData(line);
  if (payload === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') {
    return null;
  }
  const candidates = (parsed as Record<string, unknown>).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }
  const first = candidates[0] as Record<string, unknown> | null;
  if (first === null || typeof first !== 'object') {
    return null;
  }
  const content = first.content as Record<string, unknown> | undefined;
  const parts = content !== null && typeof content === 'object' ? content.parts : undefined;
  if (!Array.isArray(parts)) {
    return null;
  }
  const result: StreamDelta = {};
  const thinkingParts: string[] = [];
  const answerParts: string[] = [];
  for (const part of parts) {
    if (part === null || typeof part !== 'object') {
      continue;
    }
    const p = part as Record<string, unknown>;
    if (typeof p.text !== 'string' || p.text.length === 0) {
      continue;
    }
    if (p.thought === true) {
      thinkingParts.push(p.text);
    } else {
      answerParts.push(p.text);
    }
  }
  if (thinkingParts.length > 0) {
    result.thinking = thinkingParts.join('');
  }
  if (answerParts.length > 0) {
    result.answer = answerParts.join('');
  }
  return result.thinking !== undefined || result.answer !== undefined ? result : null;
}

/**
 * 解析 Anthropic 流式响应行。
 * 思考增量在 content_block_delta 的 delta.type==='thinking_delta'（字段 delta.thinking），
 * 正文在 delta.type==='text_delta'（字段 delta.text）。
 */
export function parseAnthropicStreamLine(line: string): StreamDelta | null {
  const payload: string | null = extractSseData(line);
  if (payload === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') {
    return null;
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.type !== 'content_block_delta') {
    return null;
  }
  const delta = obj.delta as Record<string, unknown> | undefined;
  if (delta === undefined || delta === null || typeof delta !== 'object') {
    return null;
  }
  const result: StreamDelta = {};
  if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string' && delta.thinking.length > 0) {
    result.thinking = delta.thinking;
  }
  if (delta.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
    result.answer = delta.text;
  }
  return result.thinking !== undefined || result.answer !== undefined ? result : null;
}

/** 按协议解析上游流式行（llmProxy 流式路径的唯一入口） */
export function parseUpstreamStreamLine(format: ApiFormatKey | 'openai', line: string): StreamDelta | null {
  if (format === 'gemini') {
    return parseGeminiStreamLine(line);
  }
  if (format === 'anthropic') {
    return parseAnthropicStreamLine(line);
  }
  return parseOpenAiStreamLine(line);
}
