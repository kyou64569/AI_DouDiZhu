/**
 * LLM / TTS 透传代理共享的 HTTP 工具集。
 *
 * 抽取自 llmProxy.ts 与 ttsProxy.ts 中逐字重复的实现，保证：
 * - SSRF / DNS rebinding 防护只需改一处（原审查报告 S-1 / 建议清单 #18）；
 * - 超时、错误码映射、上游错误提取行为在两个代理间完全一致。
 *
 * 本文件禁止出现任何游戏逻辑、持久化、提示词构造、认证逻辑。
 */

import { ErrorCode, ProxyError } from '../types.js';
import { lookup } from 'node:dns/promises';
// 注意：express 的 Response 必须用别名导入，避免遮蔽全局 fetch 的 Response 类型
// （fetchWithTimeout / readBodyWithTimeout 的签名依赖全局 Response）
import type { NextFunction, Request, Response as ExpressResponse } from 'express';

/** 上游服务类别，用于生成面向用户的中文错误文案。 */
export type UpstreamKind = 'LLM' | 'TTS';

/**
 * 是否显式放行内网/私有上游（ALLOW_PRIVATE_UPSTREAM=true/1/on/yes）。
 * 默认拦截私有网段（SSRF 防护）；局域网自建 LLM/TTS（如 192.168.x.x 的 Ollama）
 * 需在服务端设置该环境变量显式放行——同时会关闭 DNS rebinding 到私有段的校验。
 */
export function isPrivateUpstreamAllowed(): boolean {
  const raw: string | undefined = process.env.ALLOW_PRIVATE_UPSTREAM;
  if (raw === undefined) {
    return false;
  }
  return ['1', 'true', 'yes', 'on'].includes(raw.trim().toLowerCase());
}

/**
 * 判断 hostname 是否为私有/内网/链路本地地址（SSRF 防护）。
 * 拦截：10/8、172.16/12、192.168/16、169.254/16（含云元数据）、回环与 0.0.0.0。
 * 注意：localhost/127.* 在 normalizeBaseUrl 已显式放行（本地 LLM 场景），
 * 此处仅拦截可被利用于横向移动的私有段。
 */
export function isPrivateHost(hostname: string): boolean {
  const h: string = hostname.toLowerCase();
  if (h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const a: number = Number(m[1]);
    const b: number = Number(m[2]);
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  if (h === '169.254.169.254') return true;
  return false;
}

/** DNS 解析安全结果缓存：hostname → 是否安全（防每请求重复解析） */
const dnsSafeCache: Map<string, boolean> = new Map<string, boolean>();
const DNS_CACHE_MAX: number = 200;

/** DNS 校验用严格私有判定：除 isPrivateHost 覆盖段外，域名解析到 127.x 环回也拦截（防 rebinding 攻击本机） */
function isPrivateIpForDns(ip: string): boolean {
  if (isPrivateHost(ip)) {
    return true;
  }
  const m: RegExpMatchArray | null = ip.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  return m !== null && Number(m[1]) === 127;
}

/**
 * DNS rebinding 防护：域名解析后的 IP 若是内网/私有/环回则拒绝。
 * 仅对域名做解析校验；IP 字面量与 localhost 由 isPrivateHost / 调用方已处理。
 * 解析失败（DNS 无记录等）不拦截——fetch 阶段会自然失败。
 */
async function assertDnsSafe(hostname: string): Promise<void> {
  // 用户显式放行内网上游时，rebinding 到私有段的校验随之关闭（IP 字面量同样已由调用方放行）
  if (isPrivateUpstreamAllowed()) {
    return;
  }
  const h: string = hostname.toLowerCase();
  if (h === 'localhost' || /^(\d+\.){3}\d+$/.test(h) || h === '::1' || h === '[::1]') {
    return;
  }
  const cached: boolean | undefined = dnsSafeCache.get(h);
  if (cached === false) {
    throw new ProxyError(ErrorCode.INVALID_BASE_URL, 'baseUrl 解析后的地址指向内网/私有网段，已拦截');
  }
  if (cached === true) {
    return;
  }
  try {
    const { address }: { address: string } = await lookup(h, { family: 0 });
    if (isPrivateIpForDns(address)) {
      dnsSafeCache.set(h, false);
      throw new ProxyError(ErrorCode.INVALID_BASE_URL, 'baseUrl 解析后的地址指向内网/私有网段，已拦截（可能为 DNS rebinding）');
    }
    dnsSafeCache.set(h, true);
  } catch (err: unknown) {
    if (err instanceof ProxyError) {
      throw err;
    }
    // DNS 解析失败：不拦截，交给 fetch 自然报错
  }
  if (dnsSafeCache.size > DNS_CACHE_MAX) {
    dnsSafeCache.clear();
  }
}

/** fetchWithTimeout 的可选项。 */
export interface FetchWithTimeoutOptions {
  /** 服务类别，用于网络错误文案（如「无法连接上游 LLM 服务」） */
  kind?: UpstreamKind;
  /** 是否执行 DNS rebinding 校验（默认开启） */
  dnsCheck?: boolean;
  /** 外部中止信号（如客户端断连），触发时中止上游 fetch */
  signal?: AbortSignal;
}

/**
 * 带超时的 fetch。
 * 超时通过 AbortController 实现，超时/网络错误均归一化为 ProxyError。
 * 附带 DNS rebinding 防护（可经 opts.dnsCheck 关闭）。
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  opts: FetchWithTimeoutOptions = {},
): Promise<Response> {
  if (opts.dnsCheck !== false) {
    try {
      await assertDnsSafe(new URL(url).hostname);
    } catch (err: unknown) {
      if (err instanceof ProxyError) {
        throw err;
      }
    }
  }

  const controller: AbortController = new AbortController();
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    controller.abort();
  }, Math.max(1000, timeoutMs));
  // 外部信号（如客户端断连）并入同一控制器：外部中止 → 中止上游 fetch
  const externalSignal: AbortSignal | undefined = opts.signal;
  const onExternalAbort = (): void => {
    controller.abort();
  };
  if (externalSignal !== undefined) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort);
    }
  }

  const serviceLabel: string = opts.kind === 'TTS' ? '上游 TTS 服务' : '上游服务';
  try {
    const response: Response = await fetch(url, { ...init, signal: controller.signal });
    return response;
  } catch (err: unknown) {
    const name: string = err instanceof Error ? err.name : '';
    if (name === 'AbortError' || name === 'TimeoutError') {
      // 外部中止（客户端断连/换局取消）不是超时：区分错误码，避免正常取消被记成超时
      if (externalSignal?.aborted === true) {
        throw new ProxyError(ErrorCode.CLIENT_ABORTED, '客户端已断开连接，请求已取消');
      }
      throw new ProxyError(ErrorCode.NETWORK_TIMEOUT, `请求上游超时（${timeoutMs}ms）`);
    }
    const detail: string = err instanceof Error ? err.message : String(err);
    throw new ProxyError(ErrorCode.NETWORK_UNREACHABLE, `无法连接${serviceLabel}：${detail}`);
  } finally {
    if (externalSignal !== undefined) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
    clearTimeout(timer);
  }
}

/**
 * 带超时读取响应体为原始字节（M2 / M-1 统一实现）。
 * 响应头到达后 body 流挂死时（上游慢流/挂起），超时中断读取并归一化为 ProxyError，
 * 避免连接与内存被长期占用。读取通过 reader 手动消费，abort 时 cancel 底层流。
 *
 * @param response 已到达响应头的 Response
 * @param timeoutMs 读取超时毫秒
 * @param maxBytes 响应体大小上限（字节），超限即中止（防 DoS/OOM）
 */
export async function readBodyWithTimeout(
  response: Response,
  timeoutMs: number,
  maxBytes: number,
): Promise<Uint8Array> {
  const controller: AbortController = new AbortController();
  const timer: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
  try {
    if (response.body === null) {
      return new Uint8Array(await response.arrayBuffer());
    }
    const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
    const abortHandler = (): void => {
      reader.cancel().catch(() => {});
    };
    controller.signal.addEventListener('abort', abortHandler);
    try {
      const chunks: Uint8Array[] = [];
      let totalSize: number = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) {
          // abort 触发的 reader.cancel() 会让挂起的 read 以 done「正常」结束而非抛错，
          // 此处必须显式检查信号，否则会把截断数据当成功返回（TTS 会拿到半截音频）
          if (controller.signal.aborted) {
            throw new ProxyError(ErrorCode.NETWORK_TIMEOUT, `读取上游响应体超时（${timeoutMs}ms）`);
          }
          break;
        }
        totalSize += chunk.value.length;
        if (totalSize > maxBytes) {
          reader.cancel().catch(() => {});
          throw new ProxyError(ErrorCode.UPSTREAM_BAD_RESPONSE, `上游响应体超过大小限制（${maxBytes} 字节）`);
        }
        chunks.push(chunk.value);
      }
      const total: number = chunks.reduce((n: number, c: Uint8Array): number => n + c.length, 0);
      const merged: Uint8Array = new Uint8Array(total);
      let offset: number = 0;
      for (const c of chunks) {
        merged.set(c, offset);
        offset += c.length;
      }
      return merged;
    } finally {
      controller.signal.removeEventListener('abort', abortHandler);
      reader.releaseLock();
    }
  } catch (err: unknown) {
    const name: string = err instanceof Error ? err.name : '';
    if (name === 'AbortError' || controller.signal.aborted) {
      throw new ProxyError(ErrorCode.NETWORK_TIMEOUT, `读取上游响应体超时（${timeoutMs}ms）`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** readStreamByLine 的可选项。 */
export interface StreamReadOptions {
  /** 空闲超时毫秒数：超过该时长没有新数据块到达即中止（思考型模型首块可能较慢，默认 20000） */
  idleTimeoutMs?: number;
  /** 整体 deadline 毫秒数（自调用时刻起算，覆盖整条流） */
  overallMs: number;
  /** 转发总量上限（字节），超限中止（防 OOM，默认 10MB） */
  maxBytes?: number;
  /**
   * 外部中止信号（如客户端断连）：触发时立即中止读取并归一化为 CLIENT_ABORTED。
   * 必须显式传入——响应头到达后 fetchWithTimeout 已解除外部信号的联动监听，
   * 不传的话客户端断连既不会中止上游（空耗上游 token/连接），中途 AbortError
   * 还会被误报成「空闲超时」。
   */
  signal?: AbortSignal;
}

/**
 * 逐块读取上游流式响应体，按 UTF-8 行拆分逐行回调 onLine（不含行尾符，空行不回调）。
 *
 * 超时模型与 readBodyWithTimeout 的整体 deadline 不同：流式响应是「空闲超时 + 整体 deadline」
 * 双保险——思考型模型可能长时间不吐首块、之后逐块到达，若按整体计时会把正常长思考误杀。
 * abort 时 cancel 底层流；超时/中止归一化为 ProxyError(NETWORK_TIMEOUT)。
 */
export async function readStreamByLine(
  response: Response,
  onLine: (line: string) => void,
  options: StreamReadOptions,
): Promise<void> {
  const idleMs: number = Math.max(1000, options.idleTimeoutMs ?? 20000);
  const maxBytes: number = options.maxBytes ?? 10 * 1024 * 1024;
  const controller: AbortController = new AbortController();
  /** 记录哪路超时触发（整体 / 空闲），用于生成准确的错误文案 */
  let timeoutKind: 'overall' | 'idle' | null = null;
  // 外部中止（客户端断连）并入同一控制器：断连立即中止上游读取，避免空耗上游 token/连接
  const externalSignal: AbortSignal | undefined = options.signal;
  const onExternalAbort = (): void => {
    controller.abort();
  };
  if (externalSignal !== undefined) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', onExternalAbort);
    }
  }
  /** 中止统一归一化：外部取消 → CLIENT_ABORTED；内部超时 → 按超时路别给准确文案 */
  const buildAbortError = (): ProxyError =>
    externalSignal?.aborted === true
      ? new ProxyError(ErrorCode.CLIENT_ABORTED, '客户端已断开连接，流式读取已中止')
      : new ProxyError(
          ErrorCode.NETWORK_TIMEOUT,
          timeoutKind === 'overall'
            ? `上游流式响应整体超时（${Math.max(1000, options.overallMs)}ms 内未完成）`
            : `上游流式响应空闲超时（${idleMs}ms 内无新数据）`,
        );
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  const armIdleTimer = (): void => {
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
    }
    idleTimer = setTimeout(() => {
      timeoutKind = 'idle';
      controller.abort();
    }, idleMs);
  };
  const overallTimer: ReturnType<typeof setTimeout> = setTimeout(() => {
    timeoutKind = 'overall';
    controller.abort();
  }, Math.max(1000, options.overallMs));
  try {
    if (response.body === null) {
      throw new ProxyError(ErrorCode.UPSTREAM_BAD_RESPONSE, '上游流式响应没有 body');
    }
    const reader: ReadableStreamDefaultReader<Uint8Array> = response.body.getReader();
    const abortHandler = (): void => {
      reader.cancel().catch(() => {});
    };
    controller.signal.addEventListener('abort', abortHandler);
    const decoder = new TextDecoder('utf-8');
    let buffer: string = '';
    let totalBytes: number = 0;
    try {
      armIdleTimer();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) {
          // abort 触发的 reader.cancel() 会让挂起的 read 以 done「正常」结束而非抛错，
          // 必须显式检查信号（同 readBodyWithTimeout 的防坑），否则把截断数据当正常结束
          if (controller.signal.aborted) {
            throw buildAbortError();
          }
          break;
        }
        armIdleTimer();
        totalBytes += chunk.value.length;
        if (totalBytes > maxBytes) {
          reader.cancel().catch(() => {});
          throw new ProxyError(ErrorCode.UPSTREAM_BAD_RESPONSE, `上游响应体超过大小限制（${maxBytes} 字节）`);
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        let idx: number = buffer.indexOf('\n');
        while (idx >= 0) {
          const line: string = buffer.slice(0, idx).replace(/\r$/, '');
          buffer = buffer.slice(idx + 1);
          if (line.length > 0) {
            onLine(line);
          }
          idx = buffer.indexOf('\n');
        }
      }
      // 流正常结束：flush 解码器残留（无换行结尾的最后一行）
      buffer += decoder.decode();
      const tail: string = buffer.replace(/\r$/, '');
      if (tail.length > 0) {
        onLine(tail);
      }
    } finally {
      controller.signal.removeEventListener('abort', abortHandler);
      reader.releaseLock();
    }
  } catch (err: unknown) {
    const name: string = err instanceof Error ? err.name : '';
    if (name === 'AbortError' || controller.signal.aborted) {
      throw buildAbortError();
    }
    throw err;
  } finally {
    if (externalSignal !== undefined) {
      externalSignal.removeEventListener('abort', onExternalAbort);
    }
    if (idleTimer !== null) {
      clearTimeout(idleTimer);
    }
    clearTimeout(overallTimer);
  }
}

/**
 * 把上游 HTTP 状态码归一化为内部错误码。
 */
export function mapHttpStatus(status: number): (typeof ErrorCode)[keyof typeof ErrorCode] {
  if (status === 401 || status === 403) {
    return ErrorCode.UPSTREAM_AUTH_FAILED;
  }
  if (status === 404) {
    return ErrorCode.UPSTREAM_NOT_FOUND;
  }
  if (status === 429) {
    return ErrorCode.UPSTREAM_RATE_LIMITED;
  }
  if (status >= 500) {
    return ErrorCode.UPSTREAM_SERVER_ERROR;
  }
  return ErrorCode.UPSTREAM_BAD_REQUEST;
}

/** HTTP 状态码对应的中文说明（按服务类别区分文案）。 */
export function describeHttpStatus(status: number, kind: UpstreamKind = 'LLM'): string {
  const isTts: boolean = kind === 'TTS';
  if (status === 401 || status === 403) {
    return isTts
      ? 'API Key 认证失败，请检查密钥是否正确、是否拥有 TTS 接口权限'
      : 'API Key 认证失败，请检查密钥是否正确、是否有该接口权限';
  }
  if (status === 404) {
    return isTts
      ? '上游 TTS 接口不存在，请检查 baseUrl 是否正确（常见形如 https://api.openai.com/v1）'
      : '上游接口不存在，请检查 baseUrl 是否正确（常见形如 https://api.openai.com/v1）';
  }
  if (status === 429) {
    return isTts ? '上游 TTS 服务限流，请稍后重试' : '上游服务限流，请稍后重试';
  }
  if (status >= 500) {
    return isTts ? `上游 TTS 服务内部错误（HTTP ${status}）` : `上游服务内部错误（HTTP ${status}）`;
  }
  return isTts ? `上游 TTS 返回错误（HTTP ${status}）` : `上游返回错误（HTTP ${status}）`;
}

/**
 * 清洗上游错误消息：去 HTML 标签与控制字符，截断 limit 字符，防 XSS/信息泄漏。
 */
export function sanitizeUpstreamMessage(msg: string, limit: number = 200): string {
  // 有意移除上游错误消息中的控制字符（防日志注入/终端转义），no-control-regex 例外
  // eslint-disable-next-line no-control-regex
  const cleaned: string = msg.replace(/<[^>]*>/g, '').replace(/[\x00-\x1f\x7f]/g, '').trim();
  return cleaned.slice(0, limit) || '上游服务返回了错误';
}

/**
 * 读取上游错误响应体并提取安全的错误描述。
 * 只提取 message 文本，绝不回显请求中的 apiKey。
 */
export async function extractUpstreamError(response: Response, limit: number = 200): Promise<string> {
  let text: string = '';
  try {
    text = await response.text();
  } catch {
    text = '';
  }
  if (text.length === 0) {
    return '';
  }

  // 优先按 JSON 解析取 error.message
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed !== null && typeof parsed === 'object') {
      const obj = parsed as Record<string, unknown>;
      const errField = obj.error;
      if (errField !== null && typeof errField === 'object') {
        const msg = (errField as Record<string, unknown>).message;
        if (typeof msg === 'string' && msg.length > 0) {
          return sanitizeUpstreamMessage(msg, limit);
        }
      }
      if (typeof obj.message === 'string' && obj.message.length > 0) {
        return sanitizeUpstreamMessage(obj.message, limit);
      }
    }
  } catch {
    // 非 JSON，退化为截断纯文本
  }
  return sanitizeUpstreamMessage(text, limit);
}

/** 限流桶：key（IP+路径）→ 窗口内计数与窗口重置时间 */
interface RateEntry {
  count: number;
  resetAt: number;
}
const rateBuckets: Map<string, RateEntry> = new Map<string, RateEntry>();
/** 超过该桶数时触发一次过期清扫，防止 Map 随「IP×路径」组合无限增长 */
const RATE_SWEEP_THRESHOLD: number = 256;

/**
 * 轻量内存速率限制（按 IP+路径），防局域网滥用；超限返回 429。
 * 写入时顺带清扫过期桶；进程重启即清零，仅满足本地单机工具的防护需求。
 */
export function rateLimit(
  max: number,
  windowMs: number,
): (req: Request, res: ExpressResponse, next: NextFunction) => void {
  return (req: Request, res: ExpressResponse, next: NextFunction): void => {
    const key: string = `${req.ip ?? 'unknown'}:${req.path}`;
    const now: number = Date.now();
    if (rateBuckets.size > RATE_SWEEP_THRESHOLD) {
      for (const [k, v] of rateBuckets) {
        if (now > v.resetAt) {
          rateBuckets.delete(k);
        }
      }
    }
    const entry: RateEntry | undefined = rateBuckets.get(key);
    if (entry === undefined || now > entry.resetAt) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }
    if (entry.count < max) {
      entry.count += 1;
      next();
      return;
    }
    res.status(429).json({ code: ErrorCode.UNKNOWN, data: null, message: '请求过于频繁，请稍后重试' });
  };
}
