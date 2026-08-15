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
import { buildThinkingBody, detectProvider } from './thinkingAdapter.js';
import { logger, maskApiKey } from '../utils/logger.js';

/** 默认转发超时（毫秒），可被 .env 的 LLM_TIMEOUT_MS 覆盖 */
const DEFAULT_TIMEOUT_MS: number = Number(process.env.LLM_TIMEOUT_MS ?? 15000);

/** chat 接口默认超时（毫秒），对应 PRD D4 的 AI 决策 8s 硬超时 */
const DEFAULT_CHAT_TIMEOUT_MS: number = 8000;

/** 连通性探活的超时（毫秒），保持较短以便快速反馈 */
const TEST_TIMEOUT_MS: number = 10000;

/** 连通性探活允许的最大响应体尺寸提示（仅用于日志，不做截断） */
const MODULE_MODELS: string = 'llm/models';
const MODULE_CHAT: string = 'llm/chat';
const MODULE_TEST: string = 'llm/test';

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
 * 4. 否则追加 `/v1`。
 *
 * @param rawBaseUrl 用户填写的原始 base url
 * @returns 规范化后的 base url，不含结尾斜杠
 * @throws ProxyError 当 URL 无法解析时
 */
export function normalizeBaseUrl(rawBaseUrl: string): string {
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

  // 清理路径：去掉空段与结尾斜杠
  const segments: string[] = parsed.pathname.split('/').filter((seg) => seg.length > 0);
  const last: string = segments.length > 0 ? segments[segments.length - 1].toLowerCase() : '';

  // 已带版本段则保持原样，否则补 v1
  const hasVersionSegment: boolean = /^v\d+(alpha|beta)?$/.test(last);
  if (!hasVersionSegment) {
    segments.push('v1');
  }

  const path: string = segments.length > 0 ? '/' + segments.join('/') : '';
  return `${parsed.protocol}//${parsed.host}${path}`;
}

/**
 * 带超时的 fetch。
 * 超时通过 AbortController 实现，超时/网络错误均归一化为 ProxyError。
 *
 * @param url 目标地址
 * @param init fetch 参数
 * @param timeoutMs 超时毫秒
 */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller: AbortController = new AbortController();
  const timer: NodeJS.Timeout = setTimeout(() => {
    controller.abort();
  }, Math.max(1000, timeoutMs));

  try {
    const response: Response = await fetch(url, { ...init, signal: controller.signal });
    return response;
  } catch (err: unknown) {
    const name: string = err instanceof Error ? err.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') {
      throw new ProxyError(ErrorCode.NETWORK_TIMEOUT, `请求上游超时（${timeoutMs}ms）`);
    }
    const detail: string = err instanceof Error ? err.message : String(err);
    throw new ProxyError(ErrorCode.NETWORK_UNREACHABLE, `无法连接上游服务：${detail}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 带超时读取响应体文本（M2）。
 * 响应头到达后 body 流挂死时（上游慢流/挂起），超时中断读取并归一化为 ProxyError，
 * 避免连接与内存被长期占用。读取通过 reader 手动消费，abort 时 cancel 底层流。
 */
async function readBodyWithTimeout(response: Response, timeoutMs: number): Promise<string> {
  const controller: AbortController = new AbortController();
  const timer: NodeJS.Timeout = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    if (response.body === null) {
      return await response.text();
    }
    const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
    const abortHandler = (): void => {
      reader.cancel().catch(() => {});
    };
    controller.signal.addEventListener('abort', abortHandler);
    try {
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value }: ReadableStreamReadResult<Uint8Array> = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const total: number = chunks.reduce((n: number, c: Uint8Array): number => n + c.length, 0);
      const merged: Uint8Array = new Uint8Array(total);
      let offset: number = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }
      return new TextDecoder().decode(merged);
    } finally {
      controller.signal.removeEventListener('abort', abortHandler);
      reader.releaseLock();
    }
  } catch (err: unknown) {
    const name: string = err instanceof Error ? err.name : '';
    if (name === 'AbortError' || controller.signal.aborted) {
      throw new ProxyError(ErrorCode.NETWORK_TIMEOUT, `读取上游响应体超时（${timeoutMs}ms）`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 把上游 HTTP 状态码归一化为内部错误码。
 */
function mapHttpStatus(status: number): (typeof ErrorCode)[keyof typeof ErrorCode] {
  if (status === 401 || status === 403) {
    return ErrorCode.UPSTREAM_AUTH_FAILED;
  }
  if (status === 404) {
    return ErrorCode.UPSTREAM_NOT_FOUND;
  }
  if (status === 429) {
    return ErrorCode.UPSTREAM_RATE_LIMITED;
  }
  if (status >= 500) {
    return ErrorCode.UPSTREAM_SERVER_ERROR;
  }
  return ErrorCode.UPSTREAM_BAD_REQUEST;
}

/** HTTP 状态码对应的中文说明 */
function describeHttpStatus(status: number): string {
  if (status === 401 || status === 403) {
    return 'API Key 认证失败，请检查密钥是否正确、是否有该接口权限';
  }
  if (status === 404) {
    return '上游接口不存在，请检查 baseUrl 是否正确（常见形如 https://api.openai.com/v1）';
  }
  if (status === 429) {
    return '上游服务限流，请稍后重试';
  }
  if (status >= 500) {
    return `上游服务内部错误（HTTP ${status}）`;
  }
  return `上游返回错误（HTTP ${status}）`;
}

/**
 * 读取上游错误响应体并提取安全的错误描述。
 * 只提取 message 文本，绝不回显请求中的 apiKey。
 */
async function extractUpstreamError(response: Response): Promise<string> {
  let text: string = '';
  try {
    text = await response.text();
  } catch {
    text = '';
  }
  if (text.length === 0) {
    return '';
  }

  // 优先按 JSON 解析取 error.message
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const errField = obj.error;
      if (errField !== null && typeof errField === 'object') {
        const msg = (errField as Record<string, unknown>).message;
        if (typeof msg === 'string' && msg.length > 0) {
          return msg.slice(0, 300);
        }
      }
      if (typeof obj.message === 'string' && obj.message.length > 0) {
        return obj.message.slice(0, 300);
      }
    }
  } catch {
    // 非 JSON，退化为截断纯文本
  }
  return text.slice(0, 300);
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
  const baseUrl: string = normalizeBaseUrl(req.baseUrl);
  const url: string = `${baseUrl}/models`;
  const startedAt: number = Date.now();

  logger.info(MODULE_MODELS, '转发模型列表请求', { baseUrl, key: maskApiKey(req.apiKey) });

  const response: Response = await fetchWithTimeout(
    url,
    { method: 'GET', headers: buildHeaders(req.apiKey, false) },
    DEFAULT_TIMEOUT_MS,
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
    const raw: string = await readBodyWithTimeout(response, DEFAULT_TIMEOUT_MS);
    payload = JSON.parse(raw) as UpstreamModelsPayload;
  } catch (err: unknown) {
    if (err instanceof ProxyError) {
      throw err;
    }
    logger.error(MODULE_MODELS, '上游响应不是合法 JSON', { baseUrl, key: maskApiKey(req.apiKey) });
    throw new ProxyError(ErrorCode.UPSTREAM_BAD_RESPONSE, '上游返回的不是合法 JSON，可能 baseUrl 指向了非 OpenAI 兼容服务');
  }

  const rawList: Array<Record<string, unknown>> = Array.isArray(payload.data)
    ? (payload.data as Array<Record<string, unknown>>)
    : Array.isArray(payload.models)
      ? (payload.models as Array<Record<string, unknown>>)
      : [];

  const models: ModelItem[] = [];
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

  models.sort((a, b) => a.id.localeCompare(b.id));

  logger.info(MODULE_MODELS, '模型列表获取成功', {
    baseUrl,
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
  const baseUrl: string = normalizeBaseUrl(req.baseUrl);
  const url: string = `${baseUrl}/models`;
  const startedAt: number = Date.now();

  logger.info(MODULE_TEST, '发起连通性探活', { baseUrl, key: maskApiKey(req.apiKey) });

  const response: Response = await fetchWithTimeout(
    url,
    { method: 'GET', headers: buildHeaders(req.apiKey, false) },
    TEST_TIMEOUT_MS,
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
    await readBodyWithTimeout(response, TEST_TIMEOUT_MS);
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
 * 对话补全：转发 `POST {baseUrl}/chat/completions`。
 *
 * @param req 含 baseUrl、apiKey、model、messages
 * @returns `{ content, latencyMs }`
 * @throws ProxyError
 */
export async function chatCompletion(req: ChatRequest): Promise<ChatResponse> {
  const baseUrl: string = normalizeBaseUrl(req.baseUrl);
  const url: string = `${baseUrl}/chat/completions`;
  // M3：客户端可传 timeoutMs，服务端必须钳制上限，防止任意长超时请求挂满连接池（无鉴权透传下即 DoS）
  const MAX_TIMEOUT_MS: number = 120000;
  const timeoutMs: number =
    typeof req.timeoutMs === 'number' && Number.isFinite(req.timeoutMs) && req.timeoutMs > 0
      ? Math.min(req.timeoutMs, MAX_TIMEOUT_MS)
      : DEFAULT_CHAT_TIMEOUT_MS;

  const body: Record<string, unknown> = {
    model: req.model,
    messages: req.messages,
    stream: false,
  };
  if (typeof req.temperature === 'number' && Number.isFinite(req.temperature)) {
    body.temperature = req.temperature;
  }
  // 思考（推理）参数：按服务商把抽象意图翻译成它认得的字段形状。
  // 不同服务商语义不同（DeepSeek 用 thinking 布尔、OpenAI o 系列用 reasoning_effort、
  // Qwen/QwQ 用 enable_thinking），且严格网关会因陌生字段直接 400。
  // 因此统一走 thinkingAdapter：识别不出的服务商默认省略思考字段（fail-safe），绝不赌「它会不会忽略」。
  const thinkingFragment = buildThinkingBody(
    detectProvider(req.baseUrl, req.model),
    req.thinking === true,
    req.reasoningEffort === 'low' || req.reasoningEffort === 'medium' || req.reasoningEffort === 'high'
      ? req.reasoningEffort
      : undefined,
  );
  Object.assign(body, thinkingFragment);

  const startedAt: number = Date.now();
  logger.info(MODULE_CHAT, '转发对话补全请求', {
    baseUrl,
    model: req.model,
    key: maskApiKey(req.apiKey),
    messages: req.messages.length,
    timeout: `${timeoutMs}ms`,
  });

  const response: Response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: buildHeaders(req.apiKey, true),
      body: JSON.stringify(body),
    },
    timeoutMs,
  );

  const latencyMs: number = Date.now() - startedAt;

  if (!response.ok) {
    const detail: string = await extractUpstreamError(response);
    const code = mapHttpStatus(response.status);
    const message: string = detail.length > 0 ? `${describeHttpStatus(response.status)}：${detail}` : describeHttpStatus(response.status);
    logger.error(MODULE_CHAT, '上游返回错误', {
      baseUrl,
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
    const raw: string = await readBodyWithTimeout(response, timeoutMs);
    payload = JSON.parse(raw) as UpstreamChatPayload;
  } catch (err: unknown) {
    if (err instanceof ProxyError) {
      throw err;
    }
    logger.error(MODULE_CHAT, '上游响应不是合法 JSON', { baseUrl, model: req.model, key: maskApiKey(req.apiKey) });
    throw new ProxyError(ErrorCode.UPSTREAM_BAD_RESPONSE, '上游返回的不是合法 JSON');
  }

  const content: string = extractChatContent(payload);
  if (content.length === 0) {
    logger.warn(MODULE_CHAT, '上游返回内容为空', {
      baseUrl,
      model: req.model,
      key: maskApiKey(req.apiKey),
      latency: `${latencyMs}ms`,
    });
    throw new ProxyError(ErrorCode.UPSTREAM_BAD_RESPONSE, '上游返回内容为空，未能提取到 choices[0].message.content');
  }

  logger.info(MODULE_CHAT, '对话补全成功', {
    baseUrl,
    model: req.model,
    key: maskApiKey(req.apiKey),
    chars: content.length,
    latency: `${latencyMs}ms`,
  });

  return { content, latencyMs };
}
