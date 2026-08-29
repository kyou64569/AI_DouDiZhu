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
import {
  describeHttpStatus,
  extractUpstreamError,
  fetchWithTimeout,
  isPrivateHost,
  isPrivateUpstreamAllowed,
  mapHttpStatus,
  readBodyWithTimeout,
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

  // 已带版本段则保持原样，否则补 v1
  const hasVersionSegment: boolean = /^v\d+(alpha|beta)?$/.test(last);
  if (!hasVersionSegment) {
    segments.push('v1');
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
  const baseUrl: string = normalizeBaseUrl(req.baseUrl);
  const url: string = `${baseUrl}/models`;
  const startedAt: number = Date.now();

  logger.info(MODULE_MODELS, '转发模型列表请求', { baseUrl, key: maskApiKey(req.apiKey) });

  const response: Response = await fetchWithTimeout(
    url,
    { method: 'GET', headers: buildHeaders(req.apiKey, false) },
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

  // P3 合并超时：fetch + body 共享总 deadline，避免 2*timeoutMs 叠加
  const deadline: number = startedAt + timeoutMs;
  const fetchTimeout: number = Math.max(1000, deadline - Date.now());
  const response: Response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: buildHeaders(req.apiKey, true),
      body: JSON.stringify(body),
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
    const readTimeout: number = Math.max(1000, deadline - Date.now());
    const raw: string = await readTextWithTimeout(response, readTimeout);
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
