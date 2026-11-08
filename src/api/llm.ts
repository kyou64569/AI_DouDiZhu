/**
 * LLM 相关的后端接口调用。
 *
 * 对应 Node 代理的三个路由：
 * - POST /api/llm/models
 * - POST /api/llm/test
 * - POST /api/llm/chat
 */

import { postJson, API_BASE, ApiError, type RequestOptions } from './client';
import { ApiErrorCode } from '@/types/api';
import type {
  ChatRequest,
  ChatResponse,
  FetchModelsRequest,
  FetchModelsResponse,
  TestConnectionRequest,
  TestConnectionResponse,
} from '@/types/api';

/** AI 决策硬超时（PRD D4）。前端留出 2s 余量以便捕获后端超时响应 */
export const AI_TIMEOUT_MS: number = 8000;

/** 拉取模型列表的超时 */
const MODELS_TIMEOUT_MS: number = 20000;

/** 连通性测试的超时 */
const TEST_TIMEOUT_MS: number = 15000;

/**
 * 拉取可用模型列表（REQ-M2）。
 *
 * @param req 含 baseUrl 与 apiKey
 * @param options 超时与中止控制
 * @returns 归一化后的模型列表
 * @throws ApiError
 */
export async function fetchModels(
  req: FetchModelsRequest,
  options: RequestOptions = {},
): Promise<FetchModelsResponse> {
  return postJson<FetchModelsResponse, FetchModelsRequest>('/llm/models', req, {
    timeoutMs: options.timeoutMs ?? MODELS_TIMEOUT_MS,
    signal: options.signal,
  });
}

/**
 * 连通性测试（REQ-M3）。
 *
 * 注意：本接口不修改任何已保存配置，仅做探活。
 *
 * @param req 含 baseUrl 与 apiKey
 * @param options 超时与中止控制
 * @returns `{ success, latencyMs }`
 * @throws ApiError
 */
export async function testConnection(
  req: TestConnectionRequest,
  options: RequestOptions = {},
): Promise<TestConnectionResponse> {
  return postJson<TestConnectionResponse, TestConnectionRequest>('/llm/test', req, {
    timeoutMs: options.timeoutMs ?? TEST_TIMEOUT_MS,
    signal: options.signal,
  });
}

/**
 * 对话补全（REQ-R8）。
 *
 * 默认 8s 硬超时；超时会抛出 `ApiError`，由 AI 编排层降级为兜底决策。
 *
 * @param req 含 baseUrl、apiKey、model、messages
 * @param options 超时与中止控制
 * @returns `{ content, latencyMs }`
 * @throws ApiError
 */
export async function chatCompletion(req: ChatRequest, options: RequestOptions = {}): Promise<ChatResponse> {
  const timeoutMs: number = options.timeoutMs ?? req.timeoutMs ?? AI_TIMEOUT_MS;
  const payload: ChatRequest = { ...req, timeoutMs };
  // 前端超时略大于后端，确保能收到后端归一化的超时错误信封
  return postJson<ChatResponse, ChatRequest>('/llm/chat', payload, {
    timeoutMs: timeoutMs + 2000,
    signal: options.signal,
  });
}

/** 流式对话补全的增量回调集合 */
export interface ChatStreamHandlers {
  /** 思考内容增量（reasoning），可能完全不触发（模型未返回思考） */
  onThinking?: (delta: string) => void;
  /** 正文增量（一般不需要，done 已带完整答案；预留用于调试视图） */
  onAnswer?: (delta: string) => void;
  /** 外部中止信号（换局/重置时由 gameStore 触发） */
  signal?: AbortSignal;
  /** 整体超时毫秒数（语义同 chatCompletion：覆盖从发起到流结束全程） */
  timeoutMs?: number;
}

/**
 * 流式对话补全（POST /api/llm/chat-stream，NDJSON 事件流）。
 *
 * 与 chatCompletion 同语义：返回 `{ content, latencyMs }`、失败抛 `ApiError`、
 * 永不产生部分成功——只有收到 done 事件才返回。思考/正文增量通过 handlers 实时回调。
 * postJson 只支持整体 JSON 响应，无法复用，这里独立走 fetch + getReader。
 *
 * @throws ApiError（error 事件 / 流提前结束 / 超时 / 外部中止）
 */
export async function chatCompletionStream(
  req: ChatRequest,
  handlers: ChatStreamHandlers = {},
): Promise<ChatResponse> {
  const timeoutMs: number = handlers.timeoutMs ?? req.timeoutMs ?? AI_TIMEOUT_MS;
  const payload: ChatRequest = { ...req, timeoutMs };

  const controller: AbortController = new AbortController();
  const timer: ReturnType<typeof setTimeout> = setTimeout((): void => controller.abort(), timeoutMs + 2000);
  const onExternalAbort = (): void => controller.abort();
  if (handlers.signal !== undefined) {
    if (handlers.signal.aborted) {
      controller.abort();
    } else {
      handlers.signal.addEventListener('abort', onExternalAbort);
    }
  }

  try {
    const response: Response = await fetch(`${API_BASE}/llm/chat-stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!response.ok) {
      // 框架级错误（参数校验/限流等）走统一 JSON 信封而非 NDJSON，尽量取回真实 code/message，
      // 别把信封内容折叠成笼统的 `HTTP xxx`
      let code: number = ApiErrorCode.UNKNOWN;
      let message: string = `HTTP ${response.status}`;
      try {
        const parsed: unknown = await response.json();
        if (parsed !== null && typeof parsed === 'object') {
          const obj = parsed as Record<string, unknown>;
          if (typeof obj.code === 'number') {
            code = obj.code;
          }
          if (typeof obj.message === 'string' && obj.message.length > 0) {
            message = obj.message;
          }
        }
      } catch {
        /* 非 JSON 信封（如被网关改写），维持兜底文案 */
      }
      throw new ApiError(code, message, response.status);
    }
    if (response.body === null) {
      throw new ApiError(ApiErrorCode.UPSTREAM_BAD_RESPONSE, '流式响应没有 body');
    }

    const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
    const decoder: TextDecoder = new TextDecoder('utf-8');
    let buffer: string = '';
    let result: ChatResponse | null = null;
    const handleLine = (rawLine: string): void => {
      const line: string = rawLine.trim();
      if (line.length === 0) {
        return;
      }
      let event: unknown;
      try {
        event = JSON.parse(line);
      } catch {
        return; // 容忍个别残缺行
      }
      if (event === null || typeof event !== 'object') {
        return;
      }
      const ev = event as Record<string, unknown>;
      if (ev.type === 'thinking' && typeof ev.text === 'string') {
        handlers.onThinking?.(ev.text);
        return;
      }
      if (ev.type === 'answer' && typeof ev.text === 'string') {
        handlers.onAnswer?.(ev.text);
        return;
      }
      if (ev.type === 'done' && typeof ev.content === 'string') {
        result = { content: ev.content, latencyMs: typeof ev.latencyMs === 'number' ? ev.latencyMs : 0 };
        return;
      }
      if (ev.type === 'error') {
        throw new ApiError(
          typeof ev.code === 'number' ? ev.code : ApiErrorCode.UNKNOWN,
          typeof ev.message === 'string' ? ev.message : '上游流式请求失败',
        );
      }
    };

    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      let idx: number = buffer.indexOf('\n');
      while (idx >= 0) {
        handleLine(buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
        idx = buffer.indexOf('\n');
      }
    }
    if (buffer.trim().length > 0) {
      handleLine(buffer);
    }

    if (result !== null) {
      return result;
    }
    // 走到这里：流结束但没收到 done——先区分中止（超时/取消）再按坏响应处理
    if (controller.signal.aborted) {
      throw handlers.signal?.aborted === true
        ? new ApiError(ApiErrorCode.CLIENT_ABORTED, '请求已取消', 0)
        : new ApiError(ApiErrorCode.NETWORK_TIMEOUT, `流式请求超时（${timeoutMs}ms）`, 0);
    }
    throw new ApiError(ApiErrorCode.UPSTREAM_BAD_RESPONSE, '流式响应提前结束，未收到完整结果');
  } catch (err: unknown) {
    // fetch 阶段被 abort 时抛 DOMException(AbortError)，归一化成与 postJson 一致的 ApiError
    if (err instanceof ApiError) {
      throw err;
    }
    const name: string = err instanceof Error ? err.name : '';
    if (name === 'AbortError' || name === 'TimeoutError' || controller.signal.aborted) {
      throw handlers.signal?.aborted === true
        ? new ApiError(ApiErrorCode.CLIENT_ABORTED, '请求已取消', 0)
        : new ApiError(ApiErrorCode.NETWORK_TIMEOUT, `流式请求超时（${timeoutMs}ms）`, 0);
    }
    throw err;
  } finally {
    if (handlers.signal !== undefined) {
      handlers.signal.removeEventListener('abort', onExternalAbort);
    }
    clearTimeout(timer);
  }
}
