/**
 * TTS 透传代理（OpenAI 兼容 /audio/speech）。
 *
 * 职责严格限定为：规范化 URL → 带超时 fetch → 音频二进制转 base64 → 归一化错误。
 * 本文件禁止出现任何游戏逻辑、持久化、提示词构造、认证逻辑。
 */

import {
  ErrorCode,
  ProxyError,
  type TtsSynthesizeRequest,
  type TtsSynthesizeResponse,
} from '../types.js';
import { normalizeBaseUrl } from './llmProxy.js';
import { logger, maskApiKey } from '../utils/logger.js';

/** 默认转发超时（毫秒） */
const DEFAULT_TTS_TIMEOUT_MS: number = 15000;

/** 合成文本长度上限（防滥用） */
const MAX_INPUT_LEN: number = 200;

/** 带超时的 fetch。超时/网络错误均归一化为 ProxyError。 */
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller: AbortController = new AbortController();
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    controller.abort();
  }, Math.max(1000, timeoutMs));

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: unknown) {
    const name: string = err instanceof Error ? err.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') {
      throw new ProxyError(ErrorCode.NETWORK_TIMEOUT, `请求上游超时（${timeoutMs}ms）`);
    }
    const detail: string = err instanceof Error ? err.message : String(err);
    throw new ProxyError(ErrorCode.NETWORK_UNREACHABLE, `无法连接上游 TTS 服务：${detail}`);
  } finally {
    clearTimeout(timer);
  }
}

/** 把上游 HTTP 状态码归一化为内部错误码。 */
function mapHttpStatus(status: number): (typeof ErrorCode)[keyof typeof ErrorCode] {
  if (status === 401 || status === 403) return ErrorCode.UPSTREAM_AUTH_FAILED;
  if (status === 404) return ErrorCode.UPSTREAM_NOT_FOUND;
  if (status === 429) return ErrorCode.UPSTREAM_RATE_LIMITED;
  if (status >= 500) return ErrorCode.UPSTREAM_SERVER_ERROR;
  return ErrorCode.UPSTREAM_BAD_REQUEST;
}

/** HTTP 状态码对应的中文说明。 */
function describeHttpStatus(status: number): string {
  if (status === 401 || status === 403) return 'API Key 认证失败，请检查密钥是否正确、是否拥有 TTS 接口权限';
  if (status === 404) return '上游 TTS 接口不存在，请检查 baseUrl 是否正确（常见形如 https://api.openai.com/v1）';
  if (status === 429) return '上游 TTS 服务限流，请稍后重试';
  if (status >= 500) return `上游 TTS 服务内部错误（HTTP ${status}）`;
  return `上游 TTS 返回错误（HTTP ${status}）`;
}

/** 读取上游错误响应体并提取安全的错误描述（绝不回显 apiKey）。 */
async function extractUpstreamError(response: Response): Promise<string> {
  let text: string = '';
  try {
    text = await response.text();
  } catch {
    text = '';
  }
  if (text.length === 0) return '';

  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const errField = obj.error;
      if (errField !== null && typeof errField === 'object') {
        const msg = (errField as Record<string, unknown>).message;
        if (typeof msg === 'string' && msg.length > 0) return msg.slice(0, 300);
      }
      if (typeof obj.message === 'string' && obj.message.length > 0) return obj.message.slice(0, 300);
    }
  } catch {
    // 非 JSON，退化为截断纯文本
  }
  return text.slice(0, 300);
}

/**
 * 转发 TTS 合成：POST `{baseUrl}/audio/speech`（OpenAI 兼容）。
 *
 * @param req 含 baseUrl、apiKey、model、voice、input
 * @returns base64 音频 + MIME + 耗时
 * @throws ProxyError
 */
export async function synthesizeSpeech(req: TtsSynthesizeRequest): Promise<TtsSynthesizeResponse> {
  const baseUrl: string = normalizeBaseUrl(req.baseUrl);
  const url: string = `${baseUrl}/audio/speech`;
  const timeoutMs: number = DEFAULT_TTS_TIMEOUT_MS;

  const speed: number =
    typeof req.speed === 'number' && Number.isFinite(req.speed) && req.speed > 0
      ? Math.min(4, Math.max(0.25, req.speed))
      : 1;
  const body = {
    model: req.model,
    voice: req.voice,
    input: req.input.slice(0, MAX_INPUT_LEN),
    response_format: 'mp3',
    speed,
  };

  const startedAt: number = Date.now();
  logger.info('tts/synthesize', '转发 TTS 合成请求', {
    baseUrl,
    voice: req.voice,
    key: maskApiKey(req.apiKey),
    chars: body.input.length,
  });

  const response: Response = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${req.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'audio/mpeg',
      },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );

  const latencyMs: number = Date.now() - startedAt;

  if (!response.ok) {
    const detail: string = await extractUpstreamError(response);
    const code = mapHttpStatus(response.status);
    const message: string = detail.length > 0 ? `${describeHttpStatus(response.status)}：${detail}` : describeHttpStatus(response.status);
    logger.error('tts/synthesize', '上游返回错误', {
      baseUrl,
      key: maskApiKey(req.apiKey),
      code,
      status: response.status,
      latency: `${latencyMs}ms`,
    });
    throw new ProxyError(code, message, response.status);
  }

  const buf: ArrayBuffer = await response.arrayBuffer();
  const audioBase64: string = Buffer.from(buf).toString('base64');
  const contentType: string = response.headers.get('content-type') ?? 'audio/mpeg';

  logger.info('tts/synthesize', 'TTS 合成成功', {
    baseUrl,
    key: maskApiKey(req.apiKey),
    bytes: buf.byteLength,
    latency: `${latencyMs}ms`,
  });

  return { audioBase64, contentType, latencyMs };
}
