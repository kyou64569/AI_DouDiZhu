/**
 * LLM 透传代理核心。
 *
 * 职责严格限定为：URL 规范化 → 带超时的 fetch 转发 → 响应/错误归一化。
 * 本文件禁止出现任何游戏逻辑、持久化、提示词构造、认证逻辑。
 */

import {
  ErrorCode,
  ProxyError,
  type ChatRequest,
  type ChatResponse,
  type FetchModelsRequest,
  type FetchModelsResponse,
  type ModelItem,
  type TestConnectionRequest,
  type TestConnectionResponse,
  type UpstreamChatPayload,
  type UpstreamModelsPayload,
} from '../types.js';
import { applyThinkingBudget, buildThinkingBody, resolveProfileKey } from './thinkingAdapter.js';
import {
  buildChatEndpoint,
  buildChatHeaders,
  buildModelsEndpoint,
  buildNativeChatBody,
  extractNativeContent,
  parseNativeModels,
  parseUpstreamStreamLine,
  resolveApiFormat,
  type ApiFormatKey,
} from './protocolAdapter.js';
import {
  describeHttpStatus,
  extractUpstreamError,
  fetchWithTimeout,
  isPrivateHost,
  isPrivateUpstreamAllowed,
  mapHttpStatus,
  readBodyWithTimeout,
  readStreamByLine,
} from './httpUtils.js';
import { logger, maskApiKey } from '../utils/logger.js';

/** 解析 LLM_TIMEOUT_MS 环境变量；非法（非数字/NaN/≤0）时回落默认并 warn（L-1） */
function envDefaultTimeoutMs(): number {
  const raw: string | undefined = process.env.LLM_TIMEOUT_MS;
  if (raw !== undefined && raw !== '') {
    const n: number = Number(raw);
    if (Number.isFinite(n) && n > 0) {
      return n;
    }
    logger.warn('llmProxy', `LLM_TIMEOUT_MS 非法值 "${raw}"，已回落默认 15000ms`);
  }
  return 15000;
}

/** 默认转发超时（毫秒），可被 .env 的 LLM_TIMEOUT_MS 覆盖 */
const DEFAULT_TIMEOUT_MS: number = envDefaultTimeoutMs();

/** chat 接口默认超时（毫秒），对应 PRD D4 的 AI 决策 8s 硬超时 */
const DEFAULT_CHAT_TIMEOUT_MS: number = 8000;

/** 连通性探活的超时（毫秒），保持较短以便快速反馈 */
const TEST_TIMEOUT_MS: number = 10000;

const MODULE_MODELS: string = 'llm/models';
const MODULE_CHAT: string = 'llm/chat';
const MODULE_TEST: string = 'llm/test';

/** 响应体大小上限（P1 DoS 防护：10MB） */
const MAX_BODY_SIZE: number = 10 * 1024 * 1024;

/**
 * 带超时读取响应体并解码为文本（共享 readBodyWithTimeout 的文本封装）。
 */
async function readTextWithTimeout(response: Response, timeoutMs: number): Promise<string> {
  const bytes: Uint8Array = await readBodyWithTimeout(response, timeoutMs, MAX_BODY_SIZE);
  return new TextDecoder().decode(bytes);
}

/** LLM 代理的 fetch 选项（错误文案按 LLM 类别生成，DNS rebinding 校验默认开启）。 */
const LLM_FETCH_OPTS = { kind: 'LLM' } as const;

/**
 * 规范化 baseUrl，容忍用户各种写法。
 *
 * 以下输入等价，均归一化为 `https://api.x.com/v1`：
 * - `https://api.x.com`
 * - `https://api.x.com/`
 * - `https://api.x.com/v1`
 * - `https://api.x.com/v1/`
 *
 * 规则：
 * 1. 去除首尾空白与结尾所有 `/`；
 * 2. 缺少协议时补 `https://`（`localhost` / `127.0.0.1` 补 `http://`）；
 * 3. 若路径末段已是版本段（`v1`、`v2`… 或 `api/vN`），保持不变；
 * 4. 否则追加默认版本段（OpenAI 兼容 `/v1`；Gemini 原生传 `v1beta`）。
 *
 * @param rawBaseUrl 用户填写的原始 base url
 * @param defaultVersion 无版本段时追加的默认版本段
 * @returns 规范化后的 base url，不含结尾斜杠
 * @throws ProxyError 当 URL 无法解析时
 */
export function normalizeBaseUrl(rawBaseUrl: string, defaultVersion: string = 'v1'): string {
  const trimmed: string = String(rawBaseUrl ?? '').trim();
  if (trimmed.length === 0) {
    throw new ProxyError(ErrorCode.MISSING_BASE_URL, '缺少 baseUrl');
  }

  // 补协议
  let withProtocol: string = trimmed;
  if (!/^https?:\/\//i.test(withProtocol)) {
    const isLocal: boolean = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(withProtocol);
    withProtocol = `${isLocal ? 'http' : 'https'}://${withProtocol}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new ProxyError(ErrorCode.INVALID_BASE_URL, 'baseUrl 格式非法，请填写形如 https://api.openai.com/v1 的地址');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ProxyError(ErrorCode.INVALID_BASE_URL, 'baseUrl 仅支持 http/https 协议');
  }

  // P1 SSRF 防护：拒绝内网/私有地址段与链路本地地址（含云元数据 169.254.169.254）
  // localhost/127.0.0.1 始终放行（本地 LLM 场景）；其余私有段默认拒绝，
  // 局域网自建模型可通过服务端环境变量 ALLOW_PRIVATE_UPSTREAM=true 显式放行
  if (!isPrivateUpstreamAllowed() && isPrivateHost(parsed.hostname)) {
    throw new ProxyError(
      ErrorCode.INVALID_BASE_URL,
      'baseUrl 不允许指向内网/私有地址；如使用局域网自建模型，请在服务端设置环境变量 ALLOW_PRIVATE_UPSTREAM=true',
    );
  }

  // 清理路径：去掉空段与结尾斜杠
  const segments: string[] = parsed.pathname.split('/').filter((seg) => seg.length > 0);
  const last: string = segments.length > 0 ? segments[segments.length - 1].toLowerCase() : '';

  // 已带版本段则保持原样，否则补默认版本段
  const hasVersionSegment: boolean = /^v\d+(alpha|beta)?$/.test(last);
  if (!hasVersionSegment) {
    segments.push(defaultVersion);
  }

  const path: string = segments.length > 0 ? '/' + segments.join('/') : '';
  return `${parsed.protocol}//${parsed.host}${path}`;
}

/**
 * 构造转发给上游的请求头。
 * 注意：Authorization 头只在此处构造，且绝不写入日志。
 */
function buildHeaders(apiKey: string, withJsonBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
  };
  if (withJsonBody) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

/**
 * 拉取模型列表：转发 `GET {baseUrl}/models`。
 *
 * @param req 含 baseUrl 与 apiKey
 * @returns 归一化的模型列表
 * @throws ProxyError
 */
export async function fetchModels(req: FetchModelsRequest): Promise<FetchModelsResponse> {
  const format: 'openai' | ApiFormatKey = resolveApiFormat(req.apiFormat);
  const baseUrl: string =
    format === 'gemini'
      ? normalizeBaseUrl(req.baseUrl, 'v1beta')
      : normalizeBaseUrl(req.baseUrl);
  const startedAt: number = Date.now();

  logger.info(MODULE_MODELS, '转发模型列表请求', { baseUrl, format, key: maskApiKey(req.apiKey) });

  let url: string;
  let headers: Record<string, string>;
  if (format === 'openai') {
    url = `${baseUrl}/models`;
    headers = buildHeaders(req.apiKey, false);
  } else {
    const endpoint = buildModelsEndpoint(format, baseUrl, req.apiKey);
    url = endpoint.url;
    headers = endpoint.headers;
  }

  const response: Response = await fetchWithTimeout(
    url,
    { method: 'GET', headers },
    DEFAULT_TIMEOUT_MS,
    LLM_FETCH_OPTS,
  );

  const latencyMs: number = Date.now() - startedAt;

  if (!response.ok) {
    const detail: string = await extractUpstreamError(response);
    const code = mapHttpStatus(response.status);
    const message: string = detail.length > 0 ? `${describeHttpStatus(response.status)}：${detail}` : describeHttpStatus(response.status);
    logger.error(MODULE_MODELS, '上游返回错误', {
      baseUrl,
      key: maskApiKey(req.apiKey),
      code,
      status: response.status,
      latency: `${latencyMs}ms`,
    });
    throw new ProxyError(code, message, response.status);
  }

  let payload: UpstreamModelsPayload;
  try {
    const raw: string = await readTextWithTimeout(response, DEFAULT_TIMEOUT_MS);
    payload = JSON.parse(raw) as UpstreamModelsPayload;
  } catch (err: unknown) {
    if (err instanceof ProxyError) {
      throw err;
    }
    logger.error(MODULE_MODELS, '上游响应不是合法 JSON', { baseUrl, key: maskApiKey(req.apiKey) });
    throw new ProxyError(ErrorCode.UPSTREAM_BAD_RESPONSE, '上游返回的不是合法 JSON，可能 baseUrl 指向了非 OpenAI 兼容服务');
  }

  const models: ModelItem[] = [];
  if (format === 'openai') {
    const rawList: Array<Record<string, unknown>> = Array.isArray(payload.data)
      ? (payload.data as Array<Record<string, unknown>>)
      : Array.isArray(payload.models)
        ? (payload.models as Array<Record<string, unknown>>)
        : [];

    const seen: Set<string> = new Set<string>();
    for (const item of rawList) {
      const id: string = typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : '';
      if (id.length === 0 || seen.has(id)) {
        continue;
      }
      seen.add(id);
      const name: string = typeof item.name === 'string' && item.name.length > 0 ? item.name : id;
      models.push({ id, name });
    }
  } else {
    // 原生协议：Gemini 过滤 generateContent 并去掉 models/ 前缀；Anthropic 取 data[].id
    for (const item of parseNativeModels(format, payload as Record<string, unknown>)) {
      models.push({ id: item.id, name: item.name });
    }
  }

  models.sort((a, b) => a.id.localeCompare(b.id));

  logger.info(MODULE_MODELS, '模型列表获取成功', {
    baseUrl,
    format,
    key: maskApiKey(req.apiKey),
    count: models.length,
    latency: `${latencyMs}ms`,
  });

  return { models };
}

/**
 * 连通性测试：以最小代价探活。
 *
 * 实现为请求 `GET {baseUrl}/models`（轻量、不消耗 token），
 * 记录往返延迟并返回。失败时抛出 ProxyError，由路由层归一化。
 *
 * @param req 含 baseUrl 与 apiKey
 * @returns `{ success, latencyMs }`
 */
export async function testConnection(req: TestConnectionRequest): Promise<TestConnectionResponse> {
  const format: 'openai' | ApiFormatKey = resolveApiFormat(req.apiFormat);
  const baseUrl: string =
    format === 'gemini'
      ? normalizeBaseUrl(req.baseUrl, 'v1beta')
      : normalizeBaseUrl(req.baseUrl);
  const startedAt: number = Date.now();

  logger.info(MODULE_TEST, '发起连通性探活', { baseUrl, format, key: maskApiKey(req.apiKey) });

  let url: string;
  let headers: Record<string, string>;
  if (format === 'openai') {
    url = `${baseUrl}/models`;
    headers = buildHeaders(req.apiKey, false);
  } else {
    const endpoint = buildModelsEndpoint(format, baseUrl, req.apiKey);
    url = endpoint.url;
    headers = endpoint.headers;
  }

  const response: Response = await fetchWithTimeout(
    url,
    { method: 'GET', headers },
    TEST_TIMEOUT_MS,
    LLM_FETCH_OPTS,
  );
  const latencyMs: number = Date.now() - startedAt;

  if (!response.ok) {
    const detail: string = await extractUpstreamError(response);
    const code = mapHttpStatus(response.status);
    const message: string = detail.length > 0 ? `${describeHttpStatus(response.status)}：${detail}` : describeHttpStatus(response.status);
    logger.error(MODULE_TEST, '探活失败', {
      baseUrl,
      key: maskApiKey(req.apiKey),
      code,
      status: response.status,
      latency: `${latencyMs}ms`,
    });
    throw new ProxyError(code, message, response.status);
  }

  // 主动释放响应体，避免连接挂起
  try {
    await readTextWithTimeout(response, TEST_TIMEOUT_MS);
  } catch {
    // 探活场景下响应体读取失败不影响结论
  }

  logger.info(MODULE_TEST, '探活成功', {
    baseUrl,
    key: maskApiKey(req.apiKey),
    latency: `${latencyMs}ms`,
  });

  return { success: true, latencyMs };
}

/**
 * 从上游 chat 响应中提取文本内容，兼容多种返回形状。
 */
function extractChatContent(payload: UpstreamChatPayload): string {
  const choices = payload.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return '';
  }
  const first = choices[0];
  if (first === null || typeof first !== 'object') {
    return '';
  }

  const message = first.message;
  if (message !== null && typeof message === 'object') {
    const content = (message as Record<string, unknown>).content;
    if (typeof content === 'string' && content.length > 0) {
      return content;
    }
    // 部分推理模型把正文放在 reasoning_content
    const reasoning = (message as Record<string, unknown>).reasoning_content;
    if (typeof reasoning === 'string' && reasoning.length > 0) {
      return reasoning;
    }
  }

  // 兼容 completions 风格
  if (typeof first.text === 'string' && first.text.length > 0) {
    return first.text;
  }

  const delta = first.delta;
  if (delta !== null && typeof delta === 'object') {
    const dc = (delta as Record<string, unknown>).content;
    if (typeof dc === 'string') {
      return dc;
    }
  }

  return '';
}

/**
 * 构造发往上游的完整请求（协议 / 端点 / 鉴权头 / 请求体），非流式与流式两路共享。
 *
 * @param req 归一化后的对话请求
 * @param streaming 是否流式（openai 体加 stream:true；anthropic 体加 stream:true；gemini 用端点变体）
 */
interface UpstreamRequest {
  format: 'openai' | ApiFormatKey;
  baseUrl: string;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function buildUpstreamRequest(req: ChatRequest, streaming: boolean): UpstreamRequest {
  const format: 'openai' | ApiFormatKey = resolveApiFormat(req.apiFormat);
  if (format === 'openai') {
    const baseUrl: string = normalizeBaseUrl(req.baseUrl);
    const body: Record<string, unknown> = {
      model: req.model,
      messages: req.messages,
      stream: streaming,
    };
    if (typeof req.temperature === 'number' && Number.isFinite(req.temperature)) {
      body.temperature = req.temperature;
    }
    // 思考（推理）参数：按所选方言把意图档位翻译成厂商认得的字段形状。
    // 各方言在「关闭思考」的字段位置/形状/类型上互不兼容（指南 §1），统一走 thinkingAdapter：
    // - thinkingLevel 缺省（未设置）→ 不发任何思考字段，存量配置请求体逐字节不变；
    // - 'off' → 按方言发禁用字段（默认开思考的模型才能真正关掉）；
    // - 方言 'auto' 按 baseUrl/model 检测，检测不出省略思考字段（fail-safe，避免严格网关 400）。
    const thinkingProfileSelection = req.thinkingProfile ?? 'auto';
    const thinkingLevel = req.thinkingLevel ?? null;
    const thinkingFragment = buildThinkingBody(thinkingProfileSelection, thinkingLevel, req.baseUrl, req.model);
    Object.assign(body, thinkingFragment);

    // 预算抬升（指南 §7.2）：思考 token 计入输出上限，思考开启且无人指定 max_tokens 时按档位抬高；
    // 调用方显式填写的值永远优先，off/未设置不发送该字段
    const budgetMaxTokens: number | undefined = applyThinkingBudget(
      resolveProfileKey(thinkingProfileSelection, req.baseUrl, req.model),
      thinkingLevel,
      req.maxTokens,
    );
    if (budgetMaxTokens !== undefined) {
      body.max_tokens = budgetMaxTokens;
    }
    return {
      format,
      baseUrl,
      url: `${baseUrl}/chat/completions`,
      headers: buildHeaders(req.apiKey, true),
      body,
    };
  }

  // Gemini 无版本段时默认 /v1beta；Anthropic 默认 /v1（版本段参数化见 normalizeBaseUrl）
  const baseUrl: string = normalizeBaseUrl(req.baseUrl, format === 'gemini' ? 'v1beta' : 'v1');
  const body: Record<string, unknown> = buildNativeChatBody(
    format,
    req.messages,
    req.temperature,
    req.thinkingLevel ?? null,
    req.maxTokens,
  );
  if (streaming && format === 'anthropic') {
    // Anthropic 通过体字段声明流式；Gemini 用端点变体（:streamGenerateContent?alt=sse）
    body.stream = true;
  }
  return {
    format,
    baseUrl,
    url: buildChatEndpoint(format, baseUrl, req.model, streaming && format === 'gemini'),
    headers: buildChatHeaders(format, req.apiKey),
    body,
  };
}

/**
 * 对话补全：转发 `POST {baseUrl}/chat/completions`（或原生协议端点）。
 *
 * @param req 含 baseUrl、apiKey、model、messages
 * @returns `{ content, latencyMs }`
 * @throws ProxyError
 */
export async function chatCompletion(req: ChatRequest): Promise<ChatResponse> {
  // M3：客户端可传 timeoutMs，服务端必须钳制上限，防止任意长超时请求挂满连接池（无鉴权透传下即 DoS）
  const MAX_TIMEOUT_MS: number = 120000;
  const timeoutMs: number =
    typeof req.timeoutMs === 'number' && Number.isFinite(req.timeoutMs) && req.timeoutMs > 0
      ? Math.min(req.timeoutMs, MAX_TIMEOUT_MS)
      : DEFAULT_CHAT_TIMEOUT_MS;

  const upstream: UpstreamRequest = buildUpstreamRequest(req, false);
  const url: string = upstream.url;

  const startedAt: number = Date.now();
  logger.info(MODULE_CHAT, '转发对话补全请求', {
    baseUrl: upstream.baseUrl,
    format: upstream.format,
    model: req.model,
    key: maskApiKey(req.apiKey),
    messages: req.messages.length,
    timeout: `${timeoutMs}ms`,
  });

  // P3 合并超时：fetch + body 共享总 deadline，避免 2*timeoutMs 叠加
  const deadline: number = startedAt + timeoutMs;
  const fetchTimeout: number = Math.max(1000, deadline - Date.now());
  const response: Response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: upstream.headers,
      body: JSON.stringify(upstream.body),
    },
    fetchTimeout,
    LLM_FETCH_OPTS,
  );

  const latencyMs: number = Date.now() - startedAt;

  if (!response.ok) {
    const detail: string = await extractUpstreamError(response);
    const code = mapHttpStatus(response.status);
    const message: string = detail.length > 0 ? `${describeHttpStatus(response.status)}：${detail}` : describeHttpStatus(response.status);
    logger.error(MODULE_CHAT, '上游返回错误', {
      baseUrl: upstream.baseUrl,
      model: req.model,
      key: maskApiKey(req.apiKey),
      code,
      status: response.status,
      latency: `${latencyMs}ms`,
    });
    throw new ProxyError(code, message, response.status);
  }

  let payload: UpstreamChatPayload;
  try {
    const readTimeout: number = Math.max(1000, deadline - Date.now());
    const raw: string = await readTextWithTimeout(response, readTimeout);
    payload = JSON.parse(raw) as UpstreamChatPayload;
  } catch (err: unknown) {
    if (err instanceof ProxyError) {
      throw err;
    }
    logger.error(MODULE_CHAT, '上游响应不是合法 JSON', { baseUrl: upstream.baseUrl, model: req.model, key: maskApiKey(req.apiKey) });
    throw new ProxyError(ErrorCode.UPSTREAM_BAD_RESPONSE, '上游返回的不是合法 JSON');
  }

  const content: string =
    upstream.format === 'openai'
      ? extractChatContent(payload)
      : extractNativeContent(upstream.format, payload as unknown as Record<string, unknown>);
  if (content.length === 0) {
    logger.warn(MODULE_CHAT, '上游返回内容为空', {
      baseUrl: upstream.baseUrl,
      format: upstream.format,
      model: req.model,
      key: maskApiKey(req.apiKey),
      latency: `${latencyMs}ms`,
    });
    throw new ProxyError(ErrorCode.UPSTREAM_BAD_RESPONSE, '上游返回内容为空，未能从响应中提取到答案文本');
  }

  logger.info(MODULE_CHAT, '对话补全成功', {
    baseUrl: upstream.baseUrl,
    format: upstream.format,
    model: req.model,
    key: maskApiKey(req.apiKey),
    chars: content.length,
    latency: `${latencyMs}ms`,
  });

  return { content, latencyMs };
}

/** 下游流式事件（NDJSON 逐行发送给前端） */
export type ProxyStreamEvent =
  | { type: 'thinking'; text: string }
  | { type: 'answer'; text: string }
  | { type: 'done'; content: string; latencyMs: number }
  | { type: 'error'; code: number; message: string };

/** 流式空闲超时（毫秒）：超过该时长上游无新数据块视为断流（思考型模型首块可能较慢） */
const STREAM_IDLE_TIMEOUT_MS: number = 20000;

/**
 * 流式对话补全：以 `stream:true` 请求上游，把 SSE 增量翻译成统一事件逐个回调 send，
 * 全部异常（上游错/超时/空正文）都以 error 事件收尾而不是抛出——调用方（路由）只管
 * 逐事件写出并在本函数返回后 res.end()。
 *
 * 超时模型：上游等待响应头用 fetchWithTimeout（timeoutMs），流读取用「空闲 20s + 整体 timeoutMs」
 * 双保险（见 readStreamByLine）。
 *
 * @param req 归一化后的对话请求（同 /chat）
 * @param send 事件回调
 * @param externalSignal 外部中止信号（客户端断连时中止上游 fetch，可选）
 */
export async function chatCompletionStream(
  req: ChatRequest,
  send: (event: ProxyStreamEvent) => void,
  externalSignal?: AbortSignal,
): Promise<void> {
  const startedAt: number = Date.now();
  const MAX_TIMEOUT_MS: number = 120000;
  const timeoutMs: number =
    typeof req.timeoutMs === 'number' && Number.isFinite(req.timeoutMs) && req.timeoutMs > 0
      ? Math.min(req.timeoutMs, MAX_TIMEOUT_MS)
      : DEFAULT_CHAT_TIMEOUT_MS;
  // 共享 deadline（与非流式路径同口径）：流读取的整体上限从【请求发起时刻】起算，
  // 而不是从响应头到达后重新计时——否则服务端超时事件会晚于客户端自身的
  // timeoutMs+2000 兜底（上游慢发响应头时），错误信息被客户端笼统的超时文案顶掉
  const deadlineMs: number = startedAt + timeoutMs;

  try {
    const upstream: UpstreamRequest = buildUpstreamRequest(req, true);
    logger.info(MODULE_CHAT, '转发流式对话补全请求', {
      baseUrl: upstream.baseUrl,
      format: upstream.format,
      model: req.model,
      key: maskApiKey(req.apiKey),
      messages: req.messages.length,
      timeout: `${timeoutMs}ms`,
    });

    const response: Response = await fetchWithTimeout(
      upstream.url,
      {
        method: 'POST',
        headers: upstream.headers,
        body: JSON.stringify(upstream.body),
      },
      Math.max(1000, deadlineMs - Date.now()),
      { ...LLM_FETCH_OPTS, signal: externalSignal },
    );

    if (!response.ok) {
      const detail: string = await extractUpstreamError(response);
      const code = mapHttpStatus(response.status);
      const message: string =
        detail.length > 0
          ? `${describeHttpStatus(response.status)}：${detail}`
          : describeHttpStatus(response.status);
      logger.error(MODULE_CHAT, '流式上游返回错误', {
        baseUrl: upstream.baseUrl,
        format: upstream.format,
        model: req.model,
        key: maskApiKey(req.apiKey),
        status: response.status,
      });
      send({ type: 'error', code, message });
      return;
    }

    // 服务端聚合正文：done 事件携带完整答案，前端决策管线直接使用，无需自行拼接
    let content: string = '';
    const handleLine = (line: string): void => {
      const delta = parseUpstreamStreamLine(upstream.format, line);
      if (delta === null || delta.done === true) {
        return;
      }
      if (delta.thinking !== undefined) {
        send({ type: 'thinking', text: delta.thinking });
      }
      if (delta.answer !== undefined) {
        content += delta.answer;
        send({ type: 'answer', text: delta.answer });
      }
    };
    await readStreamByLine(response, handleLine, {
      overallMs: Math.max(1000, deadlineMs - Date.now()),
      idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
      // 客户端断连信号必须显式传入：响应头到达后 fetchWithTimeout 已解除联动，
      // 不传的话断连既不中止上游（空耗 token），AbortError 还会被误报成空闲超时
      signal: externalSignal,
    });

    if (content.length === 0) {
      logger.warn(MODULE_CHAT, '流式上游返回内容为空', {
        baseUrl: upstream.baseUrl,
        format: upstream.format,
        model: req.model,
        key: maskApiKey(req.apiKey),
        latency: `${Date.now() - startedAt}ms`,
      });
      send({
        type: 'error',
        code: ErrorCode.UPSTREAM_BAD_RESPONSE,
        message: '上游返回内容为空，未能从流式响应中提取到答案文本',
      });
      return;
    }

    const latencyMs: number = Date.now() - startedAt;
    logger.info(MODULE_CHAT, '流式对话补全成功', {
      baseUrl: upstream.baseUrl,
      format: upstream.format,
      model: req.model,
      key: maskApiKey(req.apiKey),
      chars: content.length,
      latency: `${latencyMs}ms`,
    });
    send({ type: 'done', content, latencyMs });
  } catch (err: unknown) {
    const code: number = err instanceof ProxyError ? err.code : ErrorCode.UNKNOWN;
    const message: string =
      err instanceof ProxyError ? err.message : `服务内部错误：${err instanceof Error ? err.message : String(err)}`;
    if (code === ErrorCode.CLIENT_ABORTED) {
      // 客户端断连/换局取消是正常路径：info 即可，不刷 error 噪音；
      // error 事件照发（res 已关闭时 send 自动丢弃，仅覆盖理论上的竞态窗口）
      logger.info(MODULE_CHAT, '客户端已取消，流式中止', {
        model: req.model,
        key: maskApiKey(req.apiKey),
      });
    } else {
      logger.error(MODULE_CHAT, '流式对话补全失败', {
        model: req.model,
        key: maskApiKey(req.apiKey),
        msg: message,
      });
    }
    send({ type: 'error', code, message });
  }
}
