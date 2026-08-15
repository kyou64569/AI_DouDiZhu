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
import { chatCompletion, fetchModels, testConnection } from '../services/llmProxy.js';
import { logger, maskApiKey } from '../utils/logger.js';

const router: Router = Router();

/** 构造成功响应信封 */
function ok<T>(data: T): ApiResponse<T> {
  return { code: ErrorCode.OK, data, message: 'ok' };
}

/** 构造失败响应信封 */
function fail(code: number, message: string): ApiResponse<null> {
  return { code, data: null, message };
}

/**
 * 校验并提取 baseUrl / apiKey 公共字段。
 * @throws ProxyError 参数缺失时
 */
function requireBaseFields(body: unknown): { baseUrl: string; apiKey: string } {
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

  return { baseUrl, apiKey };
}

/**
 * 校验 chat 专有字段。
 * @throws ProxyError
 */
function requireChatFields(body: unknown): { model: string; messages: ChatMessage[]; temperature?: number; timeoutMs?: number } {
  const obj = body as Record<string, unknown>;

  const model: string = typeof obj.model === 'string' ? obj.model.trim() : '';
  if (model.length === 0) {
    throw new ProxyError(ErrorCode.MISSING_MODEL, '缺少 model');
  }

  const rawMessages: unknown = obj.messages;
  if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
    throw new ProxyError(ErrorCode.INVALID_MESSAGES, 'messages 必须是非空数组');
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
  const thinking: boolean | undefined = typeof obj.thinking === 'boolean' ? obj.thinking : undefined;
  const reasoningEffort: 'low' | 'medium' | 'high' | undefined =
    obj.reasoningEffort === 'low' || obj.reasoningEffort === 'medium' || obj.reasoningEffort === 'high'
      ? obj.reasoningEffort
      : undefined;

  return { model, messages, temperature, timeoutMs, thinking, reasoningEffort };
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
  res.status(200).json(fail(ErrorCode.UNKNOWN, `服务内部错误：${detail}`));
}

/**
 * POST /api/llm/models
 * 拉取上游模型列表。
 */
router.post('/models', async (req: Request, res: Response): Promise<void> => {
  const module = 'llm/models';
  try {
    const base = requireBaseFields(req.body);
    const payload: FetchModelsRequest = { baseUrl: base.baseUrl, apiKey: base.apiKey };
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
router.post('/test', async (req: Request, res: Response): Promise<void> => {
  const module = 'llm/test';
  try {
    const base = requireBaseFields(req.body);
    const payload: TestConnectionRequest = { baseUrl: base.baseUrl, apiKey: base.apiKey };
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
router.post('/chat', async (req: Request, res: Response): Promise<void> => {
  const module = 'llm/chat';
  try {
    const base = requireBaseFields(req.body);
    const chat = requireChatFields(req.body);
    const payload: ChatRequest = {
      baseUrl: base.baseUrl,
      apiKey: base.apiKey,
      model: chat.model,
      messages: chat.messages,
      temperature: chat.temperature,
      thinking: chat.thinking,
      reasoningEffort: chat.reasoningEffort,
      timeoutMs: chat.timeoutMs,
    };
    logger.debug(module, '收到请求', { model: payload.model, key: maskApiKey(payload.apiKey) });
    const data: ChatResponse = await chatCompletion(payload);
    res.status(200).json(ok(data));
  } catch (err: unknown) {
    sendError(res, module, err);
  }
});

export default router;
