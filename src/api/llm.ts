/**
 * LLM 相关的后端接口调用。
 *
 * 对应 Node 代理的三个路由：
 * - POST /api/llm/models
 * - POST /api/llm/test
 * - POST /api/llm/chat
 */

import { postJson, type RequestOptions } from './client';
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
