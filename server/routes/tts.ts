/**
 * TTS 透传路由（OpenAI 兼容 /audio/speech）。
 *
 * 只做三件事：参数校验 → 调用 ttsProxy → 包装统一响应信封。
 * 禁止在此写入任何游戏逻辑或持久化。
 */

import { Router, type Request, type Response } from 'express';
import {
  ErrorCode,
  ProxyError,
  type ApiResponse,
  type TtsSynthesizeRequest,
  type TtsSynthesizeResponse,
} from '../types.js';
import { synthesizeSpeech } from '../services/ttsProxy.js';
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

/** 校验并提取 baseUrl / apiKey 公共字段。 */
function requireBaseFields(body: unknown): { baseUrl: string; apiKey: string } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ProxyError(ErrorCode.INVALID_BODY, '请求体必须是 JSON 对象');
  }
  const obj = body as Record<string, unknown>;
  const baseUrl: string = typeof obj.baseUrl === 'string' ? obj.baseUrl.trim() : '';
  if (baseUrl.length === 0) throw new ProxyError(ErrorCode.MISSING_BASE_URL, '缺少 baseUrl');
  const apiKey: string = typeof obj.apiKey === 'string' ? obj.apiKey.trim() : '';
  if (apiKey.length === 0) throw new ProxyError(ErrorCode.MISSING_API_KEY, '缺少 apiKey');
  return { baseUrl, apiKey };
}

/** 校验 TTS 专有字段。 */
function requireTtsFields(body: unknown): { model: string; voice: string; input: string; speed?: number } {
  const obj = body as Record<string, unknown>;
  const model: string = typeof obj.model === 'string' ? obj.model.trim() : '';
  if (model.length === 0) throw new ProxyError(ErrorCode.MISSING_MODEL, '缺少 model');
  const voice: string = typeof obj.voice === 'string' ? obj.voice.trim() : '';
  if (voice.length === 0) throw new ProxyError(ErrorCode.MISSING_VOICE, '缺少 voice');
  const input: string = typeof obj.input === 'string' ? obj.input.trim() : '';
  if (input.length === 0) throw new ProxyError(ErrorCode.MISSING_INPUT, '缺少 input（合成文本）');
  const speed: number | undefined =
    typeof obj.speed === 'number' && Number.isFinite(obj.speed) ? obj.speed : undefined;
  return { model, voice, input, speed };
}

/** 统一异常 → 响应信封。 */
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
 * POST /api/tts/synthesize
 * TTS 语音合成透传。
 */
router.post('/synthesize', async (req: Request, res: Response): Promise<void> => {
  const module = 'tts/synthesize';
  try {
    const base = requireBaseFields(req.body);
    const tts = requireTtsFields(req.body);
    const payload: TtsSynthesizeRequest = { ...base, ...tts };
    const data: TtsSynthesizeResponse = await synthesizeSpeech(payload);
    res.status(200).json(ok(data));
  } catch (err: unknown) {
    sendError(res, module, err);
  }
});

export default router;
