/**
 * TTS 透传代理（OpenAI 兼容 /audio/speech）。
 *
 * 职责严格限定为：规范化 URL → 带超时 fetch → 音频二进制转 base64 → 归一化错误。
 * 本文件禁止出现任何游戏逻辑、持久化、提示词构造、认证逻辑。
 */

import {
  ProxyError,
  type TtsSynthesizeRequest,
  type TtsSynthesizeResponse,
} from '../types.js';
import { normalizeBaseUrl } from './llmProxy.js';
import {
  describeHttpStatus,
  extractUpstreamError,
  fetchWithTimeout,
  mapHttpStatus,
  readBodyWithTimeout,
} from './httpUtils.js';
import { logger, maskApiKey } from '../utils/logger.js';

/** 默认转发超时（毫秒） */
const DEFAULT_TTS_TIMEOUT_MS: number = 15000;

/** 合成文本长度上限（防滥用） */
const MAX_INPUT_LEN: number = 200;

/** TTS 代理的 fetch 选项（错误文案按 TTS 类别生成，DNS rebinding 校验默认开启）。 */
const TTS_FETCH_OPTS = { kind: 'TTS' } as const;

/**
 * 带超时读取音频响应体（M-1 修复：原 arrayBuffer() 无超时，上游慢流/挂起会长期占用连接）。
 * 读取过程中实时校验大小，超限即中止（防 DoS/OOM）。
 *
 * @throws ProxyError 读取超时或超过 maxBytes 时
 */
async function readAudioWithTimeout(response: Response, timeoutMs: number, maxBytes: number): Promise<ArrayBuffer> {
  const bytes: Uint8Array = await readBodyWithTimeout(response, timeoutMs, maxBytes);
  const buf: ArrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
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
    TTS_FETCH_OPTS,
  );

  const latencyMs: number = Date.now() - startedAt;

  if (!response.ok) {
    const detail: string = await extractUpstreamError(response, 300);
    const code = mapHttpStatus(response.status);
    const message: string = detail.length > 0 ? `${describeHttpStatus(response.status, 'TTS')}：${detail}` : describeHttpStatus(response.status, 'TTS');
    logger.error('tts/synthesize', '上游返回错误', {
      baseUrl,
      key: maskApiKey(req.apiKey),
      code,
      status: response.status,
      latency: `${latencyMs}ms`,
    });
    throw new ProxyError(code, message, response.status);
  }

  // M-1：带超时读取音频 body，读取中即校验大小（上游慢流/挂起不再长期占连接）
  const MAX_AUDIO_SIZE: number = 5 * 1024 * 1024; // P2 音频 DoS 防护：5MB 上限（约数分钟音频）
  const buf: ArrayBuffer = await readAudioWithTimeout(response, timeoutMs, MAX_AUDIO_SIZE);
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
