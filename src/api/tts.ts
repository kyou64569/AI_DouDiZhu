/**
 * TTS 语音合成后端接口调用（对应 Node 代理 POST /api/tts/synthesize）。
 */

import { postJson, type RequestOptions } from './client';
import type { TtsSynthesizeRequest, TtsSynthesizeResponse } from '@/types/api';

/** TTS 合成默认超时（毫秒） */
export const TTS_TIMEOUT_MS: number = 15000;

/**
 * 请求上游合成语音，返回 base64 音频。
 *
 * @param req 含 baseUrl、apiKey、model、voice、input
 * @param options 超时与中止控制
 * @throws ApiError
 */
export async function synthesizeSpeech(
  req: TtsSynthesizeRequest,
  options: RequestOptions = {},
): Promise<TtsSynthesizeResponse> {
  return postJson<TtsSynthesizeResponse, TtsSynthesizeRequest>('/tts/synthesize', req, {
    timeoutMs: options.timeoutMs ?? TTS_TIMEOUT_MS,
    signal: options.signal,
  });
}
