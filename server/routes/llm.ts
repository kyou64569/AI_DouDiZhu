/**
 * LLM 透传路由。
 *
 * 只做三件事：参数校验 → 调用 llmProxy → 包装统一响应信封。
 * 禁止在此写入任何游戏逻辑或持久化。
 */

import { Router, type Request, type Response } from 'express';
import {
  ErrorCode,
  ProxyError,
  type ApiResponse,
  type ChatMessage,
  type ChatRequest,
  type ChatResponse,
  type FetchModelsRequest,
  type FetchModelsResponse,
  type TestConnectionRequest,
  type TestConnectionResponse,
} from '../types.js';
import { chatCompletion, chatCompletionStream, fetchModels, testConnection } from '../services/llmProxy.js';
import type { ProxyStreamEvent } from '../services/llmProxy.js';
import {
  THINKING_LEVELS,
  THINKING_PROFILE_SELECTIONS,
  type ThinkingProfileSelection,
} from '../services/thinkingAdapter.js';
import { resolveApiFormat } from '../services/protocolAdapter.js';
import { rateLimit } from '../services/httpUtils.js';
import { logger, maskApiKey } from '../utils/logger.js';

const router: Router = Router();

// 轻量内存速率限制（共享实现见 services/httpUtils.ts）：按 IP 限流，防局域网滥用
const chatLimiter = rateLimit(30, 60_000);
const modelsLimiter = rateLimit(20, 60_000);
const testLimiter = rateLimit(20, 60_000);

/** 构造成功响应信封 */
function ok<T>(data: T): ApiResponse<T> {
  return { code: ErrorCode.OK, data, message: 'ok' };
}

/** 构造失败响应信封 */
function fail(code: number, message: string): ApiResponse<null> {
  return { code, data: null, message };
}

/**
 * 校验并提取 baseUrl / apiKey / apiFormat 公共字段。
 * @throws ProxyError 参数缺失时
 */
function requireBaseFields(body: unknown): { baseUrl: string; apiKey: string; apiFormat?: 'openai' | 'gemini' | 'anthropic' } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ProxyError(ErrorCode.INVALID_BODY, '请求体必须是 JSON 对象');
  }
  const obj = body as Record<string, unknown>;

  const baseUrl: string = typeof obj.baseUrl === 'string' ? obj.baseUrl.trim() : '';
  if (baseUrl.length === 0) {
    throw new ProxyError(ErrorCode.MISSING_BASE_URL, '缺少 baseUrl');
  }

  const apiKey: string = typeof obj.apiKey === 'string' ? obj.apiKey.trim() : '';
  if (apiKey.length === 0) {
    throw new ProxyError(ErrorCode.MISSING_API_KEY, '缺少 apiKey');
  }

  // 协议格式按白名单收敛，非法/缺省回落 openai（与 thinkingProfile 宽容口径一致）
  const apiFormat: 'openai' | 'gemini' | 'anthropic' | undefined =
    typeof obj.apiFormat === 'string' ? resolveApiFormat(obj.apiFormat) : undefined;

  return { baseUrl, apiKey, apiFormat };
}

/**
 * 校验 chat 专有字段。
 * @throws ProxyError
 */
function requireChatFields(body: unknown): {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  timeoutMs?: number;
  thinkingLevel?: 'off' | 'low' | 'medium' | 'high';
  thinkingProfile?: ThinkingProfileSelection;
  maxTokens?: number;
} {
  const obj = body as Record<string, unknown>;

  const model: string = typeof obj.model === 'string' ? obj.model.trim() : '';
  if (model.length === 0 || model.length > 128) {
    throw new ProxyError(ErrorCode.MISSING_MODEL, 'model 不能为空且长度不超过 128');
  }

  const rawMessages: unknown = obj.messages;
  const MAX_MESSAGES: number = 50;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0 || rawMessages.length > MAX_MESSAGES) {
    throw new ProxyError(ErrorCode.INVALID_MESSAGES, `messages 必须是 1~${MAX_MESSAGES} 个元素的数组`);
  }

  const messages: ChatMessage[] = [];
  for (const item of rawMessages) {
    if (item === null || typeof item !== 'object') {
      throw new ProxyError(ErrorCode.INVALID_MESSAGES, 'messages 中存在非对象元素');
    }
    const m = item as Record<string, unknown>;
    const role: unknown = m.role;
    const content: unknown = m.content;
    if (role !== 'system' && role !== 'user' && role !== 'assistant') {
      throw new ProxyError(ErrorCode.INVALID_MESSAGES, 'messages[].role 必须是 system/user/assistant 之一');
    }
    if (typeof content !== 'string') {
      throw new ProxyError(ErrorCode.INVALID_MESSAGES, 'messages[].content 必须是字符串');
    }
    messages.push({ role, content });
  }

  const temperature: number | undefined =
    typeof obj.temperature === 'number' && Number.isFinite(obj.temperature) ? obj.temperature : undefined;
  const timeoutMs: number | undefined =
    typeof obj.timeoutMs === 'number' && Number.isFinite(obj.timeoutMs) && obj.timeoutMs > 0 ? obj.timeoutMs : undefined;
  // 思考参数：档位与方言均按白名单收敛，非法值视为「未设置」（不发思考字段）。
  // 前端下拉只发合法值，这里兜底防篡改 / 旧客户端。
  const thinkingLevel: 'off' | 'low' | 'medium' | 'high' | undefined = THINKING_LEVELS.includes(
    obj.thinkingLevel as (typeof THINKING_LEVELS)[number],
  )
    ? (obj.thinkingLevel as (typeof THINKING_LEVELS)[number])
    : undefined;
  const thinkingProfile: ThinkingProfileSelection | undefined = THINKING_PROFILE_SELECTIONS.includes(
    obj.thinkingProfile as (typeof THINKING_PROFILE_SELECTIONS)[number],
  )
    ? (obj.thinkingProfile as ThinkingProfileSelection)
    : undefined;
  // 输出上限：正数即可（上游各自有天花板校验），非法值视为未填写（交给预算层决定）
  const maxTokens: number | undefined =
    typeof obj.maxTokens === 'number' && Number.isFinite(obj.maxTokens) && obj.maxTokens > 0
      ? obj.maxTokens
      : undefined;

  return { model, messages, temperature, timeoutMs, thinkingLevel, thinkingProfile, maxTokens };
}

/**
 * 统一异常 → 响应信封。
 * 保证任何异常都返回结构化错误而不是进程崩溃或 HTML 错误页。
 */
function sendError(res: Response, module: string, err: unknown): void {
  if (err instanceof ProxyError) {
    logger.warn(module, '请求失败', { code: err.code, msg: err.message });
    res.status(200).json(fail(err.code, err.message));
    return;
  }
  const detail: string = err instanceof Error ? err.message : String(err);
  logger.error(module, '未知异常', { msg: detail });
  res.status(500).json(fail(ErrorCode.UNKNOWN, '服务内部错误，请稍后重试'));
}

/**
 * POST /api/llm/models
 * 拉取上游模型列表。
 */
router.post('/models', modelsLimiter, async (req: Request, res: Response): Promise<void> => {
  const module = 'llm/models';
  try {
    const base = requireBaseFields(req.body);
    const payload: FetchModelsRequest = { baseUrl: base.baseUrl, apiKey: base.apiKey, apiFormat: base.apiFormat };
    const data: FetchModelsResponse = await fetchModels(payload);
    res.status(200).json(ok(data));
  } catch (err: unknown) {
    sendError(res, module, err);
  }
});

/**
 * POST /api/llm/test
 * 连通性探活，返回 `{ success, latencyMs }`。
 * 上游不可达时返回结构化错误（code 非 0），不抛出到进程层。
 */
router.post('/test', testLimiter, async (req: Request, res: Response): Promise<void> => {
  const module = 'llm/test';
  try {
    const base = requireBaseFields(req.body);
    const payload: TestConnectionRequest = {
      baseUrl: base.baseUrl,
      apiKey: base.apiKey,
      apiFormat: base.apiFormat,
    };
    const data: TestConnectionResponse = await testConnection(payload);
    res.status(200).json(ok(data));
  } catch (err: unknown) {
    sendError(res, module, err);
  }
});

/**
 * POST /api/llm/chat
 * 对话补全透传。
 */
router.post('/chat', chatLimiter, async (req: Request, res: Response): Promise<void> => {
  const module = 'llm/chat';
  try {
    const base = requireBaseFields(req.body);
    const chat = requireChatFields(req.body);
    const payload: ChatRequest = {
      baseUrl: base.baseUrl,
      apiKey: base.apiKey,
      apiFormat: base.apiFormat,
      model: chat.model,
      messages: chat.messages,
      temperature: chat.temperature,
      thinkingLevel: chat.thinkingLevel,
      thinkingProfile: chat.thinkingProfile,
      maxTokens: chat.maxTokens,
      timeoutMs: chat.timeoutMs,
    };
    logger.debug(module, '收到请求', { model: payload.model, key: maskApiKey(payload.apiKey) });
    const data: ChatResponse = await chatCompletion(payload);
    res.status(200).json(ok(data));
  } catch (err: unknown) {
    sendError(res, module, err);
  }
});

/**
 * POST /api/llm/chat-stream
 * 流式对话补全：以 NDJSON 逐行下发统一事件（thinking/answer/done/error）。
 * 客户端断连时中止上游 fetch，避免空耗连接。
 */
router.post('/chat-stream', chatLimiter, async (req: Request, res: Response): Promise<void> => {
  const module = 'llm/chat-stream';
  try {
    const base = requireBaseFields(req.body);
    const chat = requireChatFields(req.body);
    const payload: ChatRequest = {
      baseUrl: base.baseUrl,
      apiKey: base.apiKey,
      apiFormat: base.apiFormat,
      model: chat.model,
      messages: chat.messages,
      temperature: chat.temperature,
      thinkingLevel: chat.thinkingLevel,
      thinkingProfile: chat.thinkingProfile,
      maxTokens: chat.maxTokens,
      timeoutMs: chat.timeoutMs,
    };
    logger.debug(module, '收到请求', { model: payload.model, key: maskApiKey(payload.apiKey) });

    res.status(200);
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache');
    // 关闭中间层缓冲（Nginx 等），本机直连/桌面版无碍，公网部署时保流式
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // 客户端断连 → 中止上游 fetch（chatCompletionStream 内部通过该信号联动）
    const upstreamAbort: AbortController = new AbortController();
    let closed: boolean = false;
    res.on('close', (): void => {
      closed = true;
      upstreamAbort.abort();
    });
    const send = (event: ProxyStreamEvent): void => {
      if (closed || res.writableEnded) {
        return;
      }
      res.write(`${JSON.stringify(event)}\n`);
    };

    await chatCompletionStream(payload, send, upstreamAbort.signal);
    if (!closed && !res.writableEnded) {
      res.end();
    }
  } catch (err: unknown) {
    // chatCompletionStream 内部已把一切异常转成 error 事件；走到这里属于框架级异常
    sendError(res, module, err);
  }
});

export default router;
