/**
 * httpUtils 共享工具回归测试。
 *
 * 重点覆盖 P1 修复：readBodyWithTimeout 超时中断时必须抛 NETWORK_TIMEOUT，
 * 而不是把 reader.cancel() 后「正常结束」的截断数据当成功返回
 * （旧行为会让 TTS 拿到半截音频而不报错）。
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response as ExpressResponse } from 'express';
import { ErrorCode, ProxyError } from '../../server/types';
import {
  isPrivateUpstreamAllowed,
  rateLimit,
  readBodyWithTimeout,
} from '../../server/services/httpUtils';

/** 构造一个正常结束的响应体流（全局 fetch Response） */
function streamOf(chunks: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) {
        controller.enqueue(new TextEncoder().encode(c));
      }
      controller.close();
    },
  });
  return { body: stream } as unknown as Response;
}

/** 构造一个先出一小段数据、之后永久挂起的流（模拟上游响应头到达后 body 挂死） */
function stallAfterFirstChunk(firstChunk: string): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(firstChunk));
      // 不 close、不再 enqueue —— 消费完第一段后 read 永久挂起
    },
  });
  return { body: stream } as unknown as Response;
}

describe('readBodyWithTimeout', () => {
  it('流正常结束时返回完整字节', async () => {
    const bytes: Uint8Array = await readBodyWithTimeout(streamOf(['hello', '-', 'world']), 2000, 1024);
    expect(new TextDecoder().decode(bytes)).toBe('hello-world');
  });

  it('P1 回归：超时中断时抛 NETWORK_TIMEOUT，而非把截断数据当成功返回', async () => {
    const promise: Promise<Uint8Array> = readBodyWithTimeout(stallAfterFirstChunk('partial-'), 1000, 1024 * 1024);
    await expect(promise).rejects.toMatchObject({
      name: 'ProxyError',
      code: ErrorCode.NETWORK_TIMEOUT,
    });
  }, 5000);

  it('超过 maxBytes 立即中止并抛 UPSTREAM_BAD_RESPONSE', async () => {
    await expect(readBodyWithTimeout(streamOf(['0123456789']), 2000, 5)).rejects.toMatchObject({
      name: 'ProxyError',
      code: ErrorCode.UPSTREAM_BAD_RESPONSE,
    });
  });

  it('超限 ProxyError 保留原始语义（不被超时归一化吞掉）', async () => {
    try {
      await readBodyWithTimeout(streamOf(['0123456789']), 2000, 5);
      expect.unreachable('应当抛出 UPSTREAM_BAD_RESPONSE');
    } catch (err: unknown) {
      expect(err).toBeInstanceOf(ProxyError);
      expect((err as ProxyError).code).toBe(ErrorCode.UPSTREAM_BAD_RESPONSE);
      expect((err as ProxyError).message).toContain('大小限制');
    }
  });
});

describe('rateLimit', () => {
  /** 可断言状态码的假 Response */
  interface FakeResponse {
    statusCode?: number;
    status(code: number): FakeResponse;
    json(body: unknown): void;
  }

  function makeRes(): FakeResponse {
    return {
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json() {},
    };
  }

  function makeReq(ip: string, path: string): Request {
    return { ip, path } as unknown as Request;
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('窗口内超过 max 返回 429，窗口重置后恢复放行', () => {
    vi.useFakeTimers();
    const limiter = rateLimit(2, 60_000);
    const next: ReturnType<typeof vi.fn> = vi.fn();
    const req: Request = makeReq('1.2.3.4', '/api/llm/chat');

    limiter(req, makeRes() as unknown as ExpressResponse, next as unknown as NextFunction);
    limiter(req, makeRes() as unknown as ExpressResponse, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledTimes(2);

    const blocked: FakeResponse = makeRes();
    limiter(req, blocked as unknown as ExpressResponse, next as unknown as NextFunction);
    expect(blocked.statusCode).toBe(429);
    expect(next).toHaveBeenCalledTimes(2);

    // 窗口过后重新放行
    vi.advanceTimersByTime(60_001);
    limiter(req, makeRes() as unknown as ExpressResponse, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledTimes(3);
  });

  it('不同 IP 各自计数、互不影响', () => {
    const limiter = rateLimit(1, 60_000);
    const next: ReturnType<typeof vi.fn> = vi.fn();
    limiter(makeReq('1.1.1.1', '/x'), makeRes() as unknown as ExpressResponse, next as unknown as NextFunction);
    limiter(makeReq('2.2.2.2', '/x'), makeRes() as unknown as ExpressResponse, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledTimes(2);
  });
});

describe('isPrivateUpstreamAllowed', () => {
  const KEY: string = 'ALLOW_PRIVATE_UPSTREAM';

  afterEach(() => {
    delete process.env[KEY];
  });

  it('默认关闭；true/1/on/yes（不区分大小写与空格）开启，其余视为关闭', () => {
    expect(isPrivateUpstreamAllowed()).toBe(false);
    process.env[KEY] = 'true';
    expect(isPrivateUpstreamAllowed()).toBe(true);
    process.env[KEY] = ' TRUE ';
    expect(isPrivateUpstreamAllowed()).toBe(true);
    process.env[KEY] = 'on';
    expect(isPrivateUpstreamAllowed()).toBe(true);
    process.env[KEY] = '0';
    expect(isPrivateUpstreamAllowed()).toBe(false);
  });
});
