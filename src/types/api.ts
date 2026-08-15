/**
 * 前后端共享的请求 / 响应类型。
 *
 * 本文件字段必须与 `server/types.ts` 完全一致（DESIGN §4.6）。
 */

/** 统一响应信封 */
export interface ApiResponse<T> {
  /** 0 表示成功，非 0 为错误码 */
  code: number;
  data: T | null;
  message: string;
}

/** 所有 LLM 代理请求的公共字段 */
export interface LLMBaseRequest {
  baseUrl: string;
  apiKey: string;
}

/** POST /api/llm/models —— 拉取模型列表（REQ-M2） */
export type FetchModelsRequest = LLMBaseRequest;

/** 归一化后的单个模型条目 */
export interface ModelItem {
  id: string;
  name: string;
}

export interface FetchModelsResponse {
  models: ModelItem[];
}

/** POST /api/llm/test —— 连通性测试（REQ-M3） */
export type TestConnectionRequest = LLMBaseRequest;

export interface TestConnectionResponse {
  success: boolean;
  latencyMs: number;
}

/** 对话消息角色 */
export type ChatRole = 'system' | 'user' | 'assistant';

/** 对话消息 */
export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** POST /api/llm/chat —— 对话补全（REQ-R8） */
export interface ChatRequest extends LLMBaseRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  /** 是否开启推理（thinking）模式；由服务商语义决定，缺省不开启 */
  thinking?: boolean;
  /** 推理强度，仅 thinking 开启时有效：low / medium / high */
  reasoningEffort?: 'low' | 'medium' | 'high';
  /** 请求超时毫秒数，默认 8000（PRD D4） */
  timeoutMs?: number;
}

export interface ChatResponse {
  /** 模型返回的文本内容 */
  content: string;
  /** 实际耗时 */
  latencyMs: number;
}

/** POST /api/tts/synthesize —— TTS 语音合成（与 `server/types.ts` 对齐） */
export interface TtsSynthesizeRequest {
  baseUrl: string;
  apiKey: string;
  /** TTS 模型，如 "tts-1" */
  model: string;
  /** 音色 id，如 "alloy" / "onyx" / "nova" */
  voice: string;
  /** 待合成文本 */
  input: string;
  /** 语速 0.25~4.0 */
  speed?: number;
}

export interface TtsSynthesizeResponse {
  /** base64 编码的音频 */
  audioBase64: string;
  /** 音频 MIME */
  contentType: string;
  /** 合成耗时毫秒 */
  latencyMs: number;
}

/**
 * 错误码常量（与 `server/types.ts` 的 ErrorCode 对齐）。
 * 前端用于区分错误类型做差异化提示。
 */
export const ApiErrorCode = {
  OK: 0,

  MISSING_BASE_URL: 1001,
  MISSING_API_KEY: 1002,
  INVALID_BASE_URL: 1003,
  MISSING_MODEL: 1004,
  INVALID_MESSAGES: 1005,
  INVALID_BODY: 1006,
  MISSING_VOICE: 1007,
  MISSING_INPUT: 1008,

  UPSTREAM_AUTH_FAILED: 2001,
  UPSTREAM_NOT_FOUND: 2002,
  UPSTREAM_SERVER_ERROR: 2003,
  UPSTREAM_BAD_RESPONSE: 2004,
  UPSTREAM_RATE_LIMITED: 2005,
  UPSTREAM_BAD_REQUEST: 2006,

  NETWORK_TIMEOUT: 3001,
  NETWORK_UNREACHABLE: 3002,

  /** 前端本地错误：请求被中止 */
  CLIENT_ABORTED: 3003,

  UNKNOWN: 9000,
} as const;

/** 错误码值类型 */
export type ApiErrorCodeValue = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];
