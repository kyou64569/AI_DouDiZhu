/**
 * 后端请求 / 响应类型定义。
 *
 * 本文件字段必须与前端 `src/types/api.ts` 完全一致（DESIGN §4.6）。
 * 任何一侧修改都必须同步另一侧，否则集成时会出现静默的字段错配。
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

/** POST /api/llm/models —— 拉取模型列表 */
export type FetchModelsRequest = LLMBaseRequest;

/** 归一化后的单个模型条目 */
export interface ModelItem {
  id: string;
  name: string;
}

export interface FetchModelsResponse {
  models: ModelItem[];
}

/** POST /api/llm/test —— 连通性测试 */
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

/** POST /api/llm/chat —— 对话补全 */
export interface ChatRequest extends LLMBaseRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  /** 是否开启推理（thinking）模式 */
  thinking?: boolean;
  /** 推理强度：low / medium / high */
  reasoningEffort?: 'low' | 'medium' | 'high';
  /** 请求超时毫秒数，默认 8000 */
  timeoutMs?: number;
}

export interface ChatResponse {
  /** 模型返回的文本内容 */
  content: string;
  /** 实际耗时 */
  latencyMs: number;
}

/** POST /api/tts/synthesize —— TTS 语音合成（OpenAI 兼容 /audio/speech） */
export interface TtsSynthesizeRequest extends LLMBaseRequest {
  /** TTS 模型，如 "tts-1" */
  model: string;
  /** 音色 id，如 "alloy" / "onyx" / "nova" / "shimmer" */
  voice: string;
  /** 待合成文本（中文，建议 <= 60 字） */
  input: string;
  /** 语速 0.25~4.0，默认 1.0 */
  speed?: number;
}

export interface TtsSynthesizeResponse {
  /** base64 编码的音频（audio/mpeg） */
  audioBase64: string;
  /** 音频 MIME，如 "audio/mpeg" */
  contentType: string;
  /** 合成耗时毫秒 */
  latencyMs: number;
}

/**
 * 错误码分段（DESIGN §8.3）。
 * 0 成功 / 1000+ 参数 / 2000+ 上游 / 3000+ 网络超时 / 9000 未知。
 */
export const ErrorCode = {
  /** 成功 */
  OK: 0,

  /** 缺少 baseUrl */
  MISSING_BASE_URL: 1001,
  /** 缺少 apiKey */
  MISSING_API_KEY: 1002,
  /** baseUrl 格式非法 */
  INVALID_BASE_URL: 1003,
  /** 缺少 model */
  MISSING_MODEL: 1004,
  /** messages 非法 */
  INVALID_MESSAGES: 1005,
  /** 请求体不是合法对象 */
  INVALID_BODY: 1006,
  /** 缺少 voice（TTS 音色） */
  MISSING_VOICE: 1007,
  /** 缺少 input（TTS 合成文本） */
  MISSING_INPUT: 1008,

  /** 上游认证失败 401/403 */
  UPSTREAM_AUTH_FAILED: 2001,
  /** 上游接口不存在 404 */
  UPSTREAM_NOT_FOUND: 2002,
  /** 上游 5xx */
  UPSTREAM_SERVER_ERROR: 2003,
  /** 上游返回体无法解析 */
  UPSTREAM_BAD_RESPONSE: 2004,
  /** 上游限流 429 */
  UPSTREAM_RATE_LIMITED: 2005,
  /** 其他 4xx */
  UPSTREAM_BAD_REQUEST: 2006,

  /** 请求超时 */
  NETWORK_TIMEOUT: 3001,
  /** 连接失败 */
  NETWORK_UNREACHABLE: 3002,

  /** 未知错误 */
  UNKNOWN: 9000,
} as const;

/** 错误码字面量联合类型 */
export type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * 代理层内部错误。
 * 携带归一化后的错误码与安全的（不含 apiKey 的）用户可读信息。
 */
export class ProxyError extends Error {
  public readonly code: ErrorCodeValue;

  /** 上游 HTTP 状态码，无则 0 */
  public readonly httpStatus: number;

  constructor(code: ErrorCodeValue, message: string, httpStatus: number = 0) {
    super(message);
    this.name = 'ProxyError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

/** OpenAI 兼容 `/models` 响应的宽松形状 */
export interface UpstreamModelsPayload {
  data?: Array<{ id?: unknown; name?: unknown; [key: string]: unknown }>;
  models?: Array<{ id?: unknown; name?: unknown; [key: string]: unknown }>;
  [key: string]: unknown;
}

/** OpenAI 兼容 `/chat/completions` 响应的宽松形状 */
export interface UpstreamChatPayload {
  choices?: Array<{
    message?: { role?: unknown; content?: unknown; reasoning_content?: unknown };
    text?: unknown;
    delta?: { content?: unknown };
    [key: string]: unknown;
  }>;
  error?: { message?: unknown; type?: unknown; code?: unknown };
  [key: string]: unknown;
}
